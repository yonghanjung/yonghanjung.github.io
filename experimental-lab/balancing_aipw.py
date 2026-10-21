"""Actual client/native XGBoost means and minimum-variance baseline weights.

Two treatment-stratified outer folds fit arm-specific XGBoost means. AIPW and
IPW additionally minimize E[W^2] subject to empirical training E[W]=1 and
E[W*mu_a(X)]=E[mu_a(X)] with W=I(A=a)*w_a(X), w_a>=1e-8. This positive floor is
inside the fitted class. The heldout function is the same positive-part affine
function of the training-fitted prediction; no heldout normalization is used.
IPW uses outcome learning for its balance constraint, but no residual correction.
OR fits no weights. All scores use the original total-n denominator.

XGBoost 2.1.4 uses fixed 64 rounds/depth3/eta.05/hist/single thread/lambda1/
min_child_weight5, all original numeric witness coordinates, train-only means
and seeds. Zero real coordinates use a constant-zero feature and actual XGBoost.
No truth, test-label fitting, density approximation or simulator is used here.
Constraint infeasibility, required fit failure, extreme heldout concentration,
nonfinite arithmetic and deadlines return no value. Engineering checks do not
certify positivity, model correctness, double robustness or confidence coverage.
"""
import hashlib
from pathlib import Path
from time import perf_counter
import numpy as np
import xgboost as xgb

METHODS = {
    "aipw": "2-fold AIPW (XGBoost; minimum-variance outcome balance)",
    "outcome_regression": "2-fold outcome regression (XGBoost plug-in)",
    "ipw": "2-fold IPW (minimum-variance XGBoost outcome balance; raw mean)"}
METHOD = METHODS["aipw"]
METHOD_IDS = {"aipw":"minimum_variance_aipw_v1", "outcome_regression":"xgboost_outcome_regression_v1",
              "ipw":"minimum_variance_ipw_v1"}
WEIGHT_FLOOR = 1e-8
CONSTRAINT_TOLERANCE = 1e-8
XGBOOST_PARAMS = dict(objective="reg:squarederror", max_depth=3, eta=.05,
    tree_method="hist", nthread=1, subsample=1., colsample_bytree=1.,
    reg_lambda=1., min_child_weight=5.)
XGBOOST_ROUNDS = 64
SOURCE_URLS = ["https://xgboost.readthedocs.io/en/release_2.1.0/python/python_api.html#xgboost.train",
               "https://doi.org/10.1111/ectj.12097",
               "https://doi.org/10.1080/01621459.2015.1023805"]


def _implementation_sha256():
    try:
        filename = globals().get("__file__")
        return hashlib.sha256(Path(filename).read_bytes()).hexdigest() if filename else None
    except (OSError, TypeError):
        return None


def fit_xgboost_mean(train_x, train_y, query_x, *, seed, check):
    """Actual XGBoost conditional means, one booster per response coordinate.

    Inputs must already be the selected training rows. No query labels or truth
    enter fitting. A zero-feature problem gets one explicit constant-zero column.
    Returns predictions and exact training-only settings/fit diagnostics.
    """
    check()
    if xgb.__version__ != "2.1.4":
        raise ValueError("This routine requires xgboost==2.1.4 for native/browser replay parity")
    x, y, q = (np.array(v, dtype=float, copy=True) for v in (train_x, train_y, query_x))
    if y.ndim == 1:
        y = y[:,None]
    if (x.ndim != 2 or q.ndim != 2 or y.ndim != 2 or len(x) != len(y)
            or not len(x) or x.shape[1] != q.shape[1]
            or any(not np.isfinite(v).all() for v in (x,y,q))):
        raise ValueError("XGBoost needs aligned finite training coordinates/responses and query coordinates")
    original_width = x.shape[1]
    constant_feature = not original_width
    if constant_feature:
        x, q = np.zeros((len(x),1)), np.zeros((len(q),1))
    class Deadline(xgb.callback.TrainingCallback):
        def after_iteration(self, model, epoch, evals_log):
            check()
            return False
    predictions, fits = [], []
    for coordinate in range(y.shape[1]):
        check()
        params = dict(XGBOOST_PARAMS, seed=int(seed), base_score=float(y[:,coordinate].mean()))
        training = xgb.DMatrix(x, label=y[:,coordinate], nthread=1)
        booster = xgb.train(params, training, num_boost_round=XGBOOST_ROUNDS, callbacks=[Deadline()])
        check()
        prediction = booster.predict(xgb.DMatrix(q,nthread=1)).astype(float)
        fitted = booster.predict(training).astype(float)
        check()
        if not np.isfinite(prediction).all() or not np.isfinite(fitted).all():
            raise FloatingPointError("XGBoost returned nonfinite predictions")
        predictions.append(prediction)
        fits.append(dict(params=params, rounds=XGBOOST_ROUNDS,
            train_outcome_rmse=float(np.sqrt(np.mean((fitted-y[:,coordinate])**2)))))
    return np.column_stack(predictions), dict(regression="XGBoost", version=xgb.__version__,
        original_coordinates=int(original_width), constant_zero_feature=constant_feature, fits=fits)


class _BalanceError(ValueError):
    def __init__(self,message,diagnostics=None):
        super().__init__(message)
        self.diagnostics=diagnostics or {}


def _fit_minimum_variance_weights(training_mu, selected, heldout_mu, check):
    """Exact two-equality empirical minimum-L2 positive-weight fit.

    Whole-training rows are the target; selected arm rows carry nonzero W.
    Sorting plus prefix/suffix cumulative moments gives O(m log m) fitting.
    Canonical constant/extreme-tie extensions are defined explicitly. This
    routine accepts no outcomes/heldout labels and never repairs constraints by
    posthoc normalization. Training-fitted duals define every heldout weight.
    """
    check()
    g=np.asarray(training_mu,dtype=float); selected=np.asarray(selected,dtype=bool)
    evaluation=np.asarray(heldout_mu,dtype=float)
    if (g.ndim!=1 or selected.shape!=g.shape or evaluation.ndim!=1
            or not np.isfinite(g).all() or not np.isfinite(evaluation).all()):
        raise _BalanceError("Invalid fitted-outcome balance inputs")
    N,m=len(g),int(selected.sum());eps=WEIGHT_FLOOR
    if not 0 < m < N:
        raise _BalanceError("WEIGHT_FEASIBILITY: both training arms are required")
    target=float(g.mean());scale=float(g.std())
    if scale<=1e-12:
        scale=1.
    z=(g-target)/scale; ev=(evaluation-target)/scale; za=z[selected]
    target_z=float(z.mean());R=N-m*eps
    q=(N*target_z-eps*float(za.sum()))/R
    low,high=float(za.min()),float(za.max())
    diagnostics=dict(solver="sorted affine-positive active set",solver_success=False,
        iterations=None,weight_floor=eps,training_mu_target=target,training_mu_scale=scale,
        floor_adjusted_target=q,training_arm_mu_min=float(g[selected].min()),
        training_arm_mu_max=float(g[selected].max()),feasible_hull_min=low,feasible_hull_max=high)
    def fail(message):
        raise _BalanceError(message,diagnostics)
    if R<=0 or q<low-1e-12 or q>high+1e-12:
        fail("WEIGHT_FEASIBILITY: cohort fitted-outcome target lies outside the floor-adjusted training-arm convex hull")
    ordered=np.sort(za);count=len(ordered)
    candidates=[]
    if high-low<=1e-12:
        candidates.append((N/m,0.,"constant training-arm prediction"))
    else:
        # Boundary optimum: floor on all nonextreme rows, excess R split over
        # tied extremes. Nearest nonextreme prediction is exactly at the floor.
        for extreme,other in ((high,ordered[ordered<high]),(low,ordered[ordered>low])):
            if abs(q-extreme)<=1e-12 and len(other):
                k=int(np.sum(ordered==extreme));next_value=float(other[-1] if extreme==high else other[0])
                slope=(R/k)/(extreme-next_value)
                candidates.append((eps-slope*next_value,slope,"extreme-tie boundary"))
        sums=np.r_[0.,np.cumsum(ordered)];squares=np.r_[0.,np.cumsum(ordered*ordered)]
        total=float(sums[-1])
        # A nonfloor affine-positive set is a sorted prefix or suffix. Boundary
        # checks suffice for each candidate; construct a whole vector only once.
        for suffix in (False,True):
            for k in range(count,1,-1):
                check()
                start=count-k if suffix else 0;end=count if suffix else k
                S1=float(sums[end]-sums[start]);S2=float(squares[end]-squares[start])
                D=k*S2-S1*S1
                if D<=1e-13*max(k*S2,S1*S1,1.):
                    continue
                U=N-eps*(count-k);V=N*target_z-eps*(total-S1)
                b0=(U*S2-V*S1)/D;b1=(k*V-S1*U)/D
                if (suffix and b1<0) or (not suffix and b1>0):
                    continue
                active_boundary=ordered[start] if suffix else ordered[end-1]
                if b0+b1*active_boundary<eps-1e-10:
                    continue
                if k<count:
                    inactive_boundary=ordered[start-1] if suffix else ordered[end]
                    if b0+b1*inactive_boundary>eps+1e-10:
                        continue
                candidates.append((b0,b1,"interior sorted active set"))
                break
    for b0,b1,case in candidates:
        check()
        weights=np.maximum(eps,b0+b1*za)
        mass=float(weights.sum()/N);moment=float(weights@za/N)
        mass_error=abs(mass-1.);mu_error=abs(moment-target_z)
        if mass_error>CONSTRAINT_TOLERANCE or mu_error>CONSTRAINT_TOLERANCE:
            continue
        alpha=np.maximum(eps,b0+b1*ev)
        if not np.isfinite(weights).all() or not np.isfinite(alpha).all():
            fail("Nonfinite minimum-variance fitted weights")
        check()
        diagnostics.update(solver_success=True,solution_case=case,dual_intercept=float(b0),dual_slope=float(b1),
            objective=float(weights@weights/N),training_weight_mass=mass,
            training_mass_residual=mass-1.,training_standardized_mu_residual=moment-target_z,
            training_mu_balance_residual=float(weights@g[selected]/N-target),
            training_kkt_residual=float(np.max(np.abs(weights-np.maximum(eps,b0+b1*za)),initial=0.)),
            training_floor_fraction=float(np.mean(weights<=eps)),heldout_floor_fraction=float(np.mean(alpha<=eps)),
            training_min_weight=float(weights.min()),training_max_weight=float(weights.max()))
        return weights,alpha,diagnostics
    fail("WEIGHT_FEASIBILITY: no finite active-set solution satisfies both equalities at the fixed tolerance")


def estimate_balancing_aipw(covariates,treatment,outcome,*,seed=5,intervention=1,reference=0,max_seconds=10,estimator="aipw"):
    """Actual same-data baseline score; all methods fit XGBoost outcome means.

    AIPW/IPW weights exactly balance the scalar fitted arm outcome prediction on
    training rows. This is not all-function/covariate balance or a positivity
    certificate. Original rows and target ATE are retained, including failures.
    """
    started=perf_counter()
    if not isinstance(estimator,str) or estimator not in METHODS:
        raise ValueError("estimator must be aipw, outcome_regression or ipw")
    if type(seed) is not int or not 0<=seed<2**32:
        raise ValueError("seed must be an integer from 0 to 2**32-1")
    if type(max_seconds) not in (int,float) or not np.isfinite(max_seconds) or not 0<max_seconds<=30:
        raise ValueError("max_seconds must be positive and at most 30")
    for level in (intervention,reference):
        if type(level) not in (int,float) or level not in (0,1):
            raise ValueError("Use binary intervention/reference levels 0 or 1")
    z,a,y=(np.array(v,dtype=float,copy=True) for v in (covariates,treatment,outcome))
    if z.ndim!=2 or a.ndim!=1 or y.ndim!=1 or len(z)!=len(a) or len(a)!=len(y):
        raise ValueError("Use aligned n-by-p covariates and scalar treatment/outcome arrays")
    n,p=z.shape
    if (not 1<=n<=5000 or p>98 or n*(p+2)>500000 or any(not np.isfinite(v).all() for v in (z,a,y))
            or not np.isin(a,[0,1]).all()):
        raise ValueError("Use finite numeric rows, binary treatment, <=5000 rows and <=100 physical columns")
    use_weights=estimator!="outcome_regression"
    options=dict(seed=seed,intervention=intervention,reference=reference,max_seconds=max_seconds,estimator=estimator,
        folds=2,xgboost_version="2.1.4",xgboost=dict(XGBOOST_PARAMS,num_boost_round=XGBOOST_ROUNDS),
        basis="Original verified adjustment-witness coordinates, including all full one-hot coordinates",
        diagnostic_basis="Whole-training standardized original witness coordinates, linear only",
        weight_floor=WEIGHT_FLOOR if use_weights else None,constraint_tolerance=CONSTRAINT_TOLERANCE if use_weights else None,
        ridge=None,balance_penalty=None,weight_cap=None)
    details=dict(method_id=METHOD_IDS[estimator],options=options,
        implementation=dict(file="balancing_aipw.py",entry="estimate_balancing_aipw",sha256=_implementation_sha256()),
        nuisance=dict(outcome="Arm-specific XGBoost 2.1.4 conditional outcome mean; 64 fixed rounds",
            used=dict(outcome=True,weights=use_weights),fitted=dict(outcome=False,weights=False),
            fit_calls=dict(outcome=0,weights=0),fit_completed=dict(outcome=0,weights=0),
            weights="Minimum-second-moment weights with exact training mass and scalar fitted-outcome balance" if use_weights else "Not fitted by this estimator",
            weight_objective="min sum_arm(w^2)/n_train subject to sum_arm(w)/n_train=1 and sum_arm(w*mu_a)/n_train=mean_cohort(mu_a), w>=1e-8" if use_weights else None,
            inverse_weight="max(1e-8, dual_intercept + dual_slope * standardized_mu_a(X))" if use_weights else None,
            score={"aipw":"m1 - m0 + I(A=1)*w1*(Y-m1) - I(A=0)*w0*(Y-m0)",
                "outcome_regression":"m1 - m0","ipw":"I(A=1)*w1*Y - I(A=0)*w0*Y"}[estimator],
            cross_fitting="2 treatment-stratified folds; XGBoost, prediction scaling and weight fitting use outer training rows only"),
        normalization="Exact training mass constraint; raw heldout score averaged over total n; no heldout normalization, trimming or propensity conversion" if use_weights else "Raw heldout XGBoost prediction contrast averaged over total n; no weights",
        sources=SOURCE_URLS,
        limitations=["Only the scalar fitted-outcome prediction is balanced, not every covariate or function.",
            "XGBoost misspecification, extrapolation and heldout weight concentration can bias results; engineering guards do not certify positivity.",
            "No unconditional double robustness, finite-sample unbiasedness or confidence interval is claimed."])
    result=dict(status="UNKNOWN",method=METHODS[estimator],n=n,approximate=True,
        diagnostics=dict(folds=2,covariate_coordinates=p,data_uncertainty="not estimated",fold_details=[]),estimation_details=details)
    def check():
        if perf_counter()-started>=max_seconds:
            raise TimeoutError("Estimator deadline exhausted; no partial estimate is returned")
    def fail(reason):
        return dict(result,status="UNKNOWN",reason=reason)
    if n<128:
        return fail("INSUFFICIENT_DATA: use at least 128 rows")
    if intervention==reference:
        details["fit_performed"]=False
        result["diagnostics"]["identical_regimes"]=True
        return dict(result,status="OK",estimate=0.)
    fold=np.empty(n,dtype=int);rng=np.random.default_rng(seed)
    for arm in (0,1):
        ids=np.flatnonzero(a==arm);fold[rng.permutation(ids)]=np.arange(len(ids))%2
    predictions=np.empty((n,2));weights=np.zeros((n,2)) if use_weights else None;warnings=[]
    try:
        for heldout in (0,1):
            check();train=np.flatnonzero(fold!=heldout);test=np.flatnonzero(fold==heldout)
            info=dict(heldout=heldout,n_train=len(train),n_test=len(test),arms={});result["diagnostics"]["fold_details"].append(info)
            center=z[train].mean(0);scale=z[train].std(0);scale=np.where(scale>1e-12,scale,1.)
            diagnostic_train=(z[train]-center)/scale
            for arm in (0,1):
                check();selected=a[train]==arm;observed=a[test]==arm
                count,test_count=int(selected.sum()),int(observed.sum())
                if count<32 or (use_weights and test_count<8):
                    return fail("INSUFFICIENT_DATA: each training arm needs 32 rows"+(" and each heldout arm 8" if use_weights else ""))
                diag=dict(n_train_arm=count,n_test_arm=test_count);info["arms"][str(arm)]=diag
                fit_seed=(seed+104729*(heldout+1)+1009*(arm+1))%2**32
                details["nuisance"]["fit_calls"]["outcome"]+=1
                predicted,fit_info=fit_xgboost_mean(z[train][selected],y[train][selected],np.vstack([z[train],z[test]]),seed=fit_seed,check=check)
                training_mu,heldout_mu=predicted[:len(train),0],predicted[len(train):,0]
                predictions[test,arm]=heldout_mu
                diag.update(outcome_fit=fit_info,train_outcome_rmse=fit_info["fits"][0]["train_outcome_rmse"])
                details["nuisance"]["fit_completed"]["outcome"]+=1
                details["nuisance"]["fitted"]["outcome"]=details["nuisance"]["fit_completed"]["outcome"]==4
                if not use_weights:
                    continue
                details["nuisance"]["fit_calls"]["weights"]+=1
                training_w,alpha,weight_info=_fit_minimum_variance_weights(training_mu,selected,heldout_mu,check)
                diag.update(weight_info);weights[test,arm]=alpha
                details["nuisance"]["fit_completed"]["weights"]+=1
                details["nuisance"]["fitted"]["weights"]=details["nuisance"]["fit_completed"]["weights"]==4
                w=alpha[observed];mass=float(w.sum()/len(test));ess=float(w.sum()**2/(w@w));share=float(w.max()/w.sum())
                imbalance=float(np.max(np.abs(diagnostic_train[selected].T@training_w/len(train)-diagnostic_train.mean(0)),initial=0.))
                diag.update(training_max_moment_imbalance=imbalance,heldout_weight_mass=mass,heldout_ess=ess,
                    heldout_max_normalized_share=share,heldout_max_inverse_weight=float(w.max()))
                check()
                if not np.isfinite([mass,ess,share,imbalance]).all():
                    return fail("Nonfinite minimum-variance weight diagnostics")
                if ess<max(10.,.05*test_count) or share>.20:
                    return fail("WEAK_OVERLAP: heldout inverse-weight concentration exceeds the fixed safety limits")
                if ess<.25*test_count or share>.05 or not .5<=mass<=2. or imbalance>.1:
                    warnings.append("Weight concentration, extrapolation or raw-covariate imbalance is imperfect; only fitted-outcome training balance is constrained and this does not certify positivity.")
        if estimator=="aipw":
            score=predictions[:,1]-predictions[:,0]+(a==1)*weights[:,1]*(y-predictions[:,1])-(a==0)*weights[:,0]*(y-predictions[:,0])
        elif estimator=="outcome_regression":
            score=predictions[:,1]-predictions[:,0]
        else:
            score=(a==1)*weights[:,1]*y-(a==0)*weights[:,0]*y
        value=float(score.mean())*(intervention-reference);check()
        if not np.isfinite(value) or not np.isfinite(score).all():
            return fail("Selected estimator score produced nonfinite values")
    except (TimeoutError,FloatingPointError,ValueError,OverflowError,xgb.core.XGBoostError) as error:
        if isinstance(error,_BalanceError):
            diag.update(error.diagnostics)
        return fail(str(error))
    details["fit_performed"]=True
    result["diagnostics"]["outcome_contrast_mean"]=float((predictions[:,1]-predictions[:,0]).mean())*(intervention-reference)
    if estimator=="aipw":
        result["diagnostics"]["augmentation_mean"]=value-result["diagnostics"]["outcome_contrast_mean"]
    if estimator=="ipw":
        result["diagnostics"]["raw_weighted_outcome_contrast_mean"]=value
    if warnings:
        result["warning"]=warnings[0]
    return dict(result,status="OK",estimate=value)
