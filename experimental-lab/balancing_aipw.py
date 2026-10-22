"""Actual client/native XGBoost means and minimum-variance baseline weights.

Two treatment-stratified outer folds fit required nuisance functions.
AIPW additionally minimizes E[W^2] subject to empirical training E[W]=1 and
E[W*mu_a(X)]=E[mu_a(X)] with W=I(A=a)*w_a(X), w_a>=1e-8. This positive floor is
inside the fitted class. The heldout function is the same positive-part affine
function of the training-fitted prediction; no heldout normalization is used.
IPW instead fits actual joint-treatment XGBoost propensities, with no outcome
fit, direct balance fit, marginal products or probability clipping.
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
    "ipw": "2-fold IPW (XGBoost joint propensity; raw mean)"}
METHOD = METHODS["aipw"]
METHOD_IDS = {"aipw":"minimum_variance_aipw_v1", "outcome_regression":"xgboost_outcome_regression_v1",
              "ipw":"xgboost_propensity_ipw_v1"}
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


_UNSET = object()
MIN_PROPENSITY = 1e-6
MAX_JOINT_CLASSES = 32


def fit_xgboost_propensity(train_x, labels, query_x, *, n_classes, seed, check):
    """Actual joint-class probabilities; no outcome arguments or marginal fits."""
    check()
    if xgb.__version__ != "2.1.4":
        raise ValueError("This routine requires xgboost==2.1.4")
    x,q=np.asarray(train_x,dtype=float),np.asarray(query_x,dtype=float)
    labels=np.asarray(labels,dtype=int)
    if (x.ndim!=2 or q.ndim!=2 or x.shape[1]!=q.shape[1] or labels.shape!=(len(x),)
            or not 2<=n_classes<=MAX_JOINT_CLASSES or set(np.unique(labels))!=set(range(n_classes))
            or not np.isfinite(x).all() or not np.isfinite(q).all()):
        raise ValueError("Joint propensity needs finite coordinates and every stored joint class in its training fold")
    original=x.shape[1]
    if not original:
        x,q=np.zeros((len(x),1)),np.zeros((len(q),1))
    params=dict(XGBOOST_PARAMS,seed=int(seed))
    params['objective']='binary:logistic' if n_classes==2 else 'multi:softprob'
    training_priors=np.bincount(labels,minlength=n_classes)/len(labels)
    if n_classes==2:
        params['base_score']=float(labels.mean())
    else:
        params.update(num_class=n_classes,base_score=.5)
    class Deadline(xgb.callback.TrainingCallback):
        def after_iteration(self,model,epoch,evals_log):
            check();return False
    training_matrix=xgb.DMatrix(x,label=labels,nthread=1)
    prediction_matrix=xgb.DMatrix(q,nthread=1)
    training_logits=None
    if n_classes>2:
        training_logits=np.log(training_priors)
        training_matrix.set_base_margin(np.tile(training_logits,(len(x),1)))
        prediction_matrix.set_base_margin(np.tile(training_logits,(len(q),1)))
    booster=xgb.train(params,training_matrix,num_boost_round=XGBOOST_ROUNDS,callbacks=[Deadline()])
    check();pred=booster.predict(prediction_matrix).astype(float);check()
    probabilities=np.column_stack([1-pred,pred]) if n_classes==2 else pred
    if (probabilities.shape!=(len(q),n_classes) or not np.isfinite(probabilities).all()
            or np.any(probabilities<0) or np.any(probabilities>1)
            or not np.allclose(probabilities.sum(1),1,atol=1e-6,rtol=0)):
        raise ValueError("XGBoost joint probabilities violate the stored class matrix contract")
    return probabilities,dict(regression='XGBoost joint-treatment classifier',version=xgb.__version__,
        params=params,rounds=XGBOOST_ROUNDS,original_coordinates=original,constant_zero_feature=not original,
        n_classes=n_classes,class_counts=np.bincount(labels,minlength=n_classes).tolist(),
        initialization=dict(kind='training_class_log_prior_margin' if n_classes>2 else 'training_class1_prevalence_base_score',
            source='Outer-training treatment labels only; no outcomes or heldout class frequencies',
            class_order=list(range(n_classes)),training_priors=training_priors.tolist(),base_score=params['base_score'],
            base_score_overridden=n_classes>2,base_margin_log_priors=training_logits.tolist() if training_logits is not None else None,
            base_margin_applied_to=['training','prediction'] if n_classes>2 else []),
        max_probability_sum_residual=float(np.max(np.abs(probabilities.sum(1)-1))),
        normalization='Native binary logistic / multiclass softmax probabilities; no posthoc clipping or renormalization')


def estimate_balancing_aipw(covariates,treatment,outcome,*,seed=5,intervention=1,reference=_UNSET,max_seconds=10,estimator="aipw",estimand="ate"):
    """ATE contrast or APO for a scalar/ordered binary joint treatment.

    AIPW uses the prior minimum-variance fitted-outcome balance; OR uses means.
    IPW uses whole-tuple propensity classification, never marginal products or Y.
    All scores have the original total-n denominator and no heldout normalization.
    """
    started=perf_counter()
    if not isinstance(estimator,str) or estimator not in METHODS:
        raise ValueError("estimator must be aipw, outcome_regression or ipw")
    if estimand not in {'ate','apo'}:
        raise ValueError("estimand must be ate or apo")
    if reference is _UNSET:
        reference=0 if estimand=='ate' else None
    if estimand=='apo' and reference is not None:
        raise ValueError("APO has no reference assignment; omit reference")
    if type(seed) is not int or not 0<=seed<2**32:
        raise ValueError("seed must be an integer from 0 to 2**32-1")
    if type(max_seconds) not in (int,float) or not np.isfinite(max_seconds) or not 0<max_seconds<=30:
        raise ValueError("max_seconds must be positive and at most 30")
    z,raw_a,y=(np.array(v,dtype=float,copy=True) for v in (covariates,treatment,outcome))
    scalar=raw_a.ndim==1;a=raw_a[:,None] if scalar else raw_a
    if z.ndim!=2 or a.ndim!=2 or not a.shape[1] or y.ndim!=1 or len(z)!=len(a) or len(a)!=len(y):
        raise ValueError("Use aligned n-by-p covariates, scalar/ordered binary treatment and scalar outcome arrays")
    n,p=z.shape;k=a.shape[1]
    if (not 1<=n<=5000 or p+k+1>100 or n*(p+k+1)>500000
            or any(not np.isfinite(v).all() for v in (z,a,y)) or not np.isin(a,[0,1]).all()):
        raise ValueError("Use finite numeric rows, binary treatment coordinates, <=5000 rows and <=100 physical columns")
    def assignment(value,label):
        v=np.asarray(value,dtype=float)
        if scalar:
            if v.shape!=():raise ValueError(label+" must be a scalar binary assignment")
            v=v.reshape(1)
        if v.shape!=(k,) or not np.isfinite(v).all() or not np.isin(v,[0,1]).all():
            raise ValueError(label+" must contain one 0/1 value per ordered treatment member")
        return v
    primary=assignment(intervention,'Intervention');baseline=assignment(reference,'Reference') if estimand=='ate' else None
    public_assignment=lambda v:float(v[0]) if scalar else v.tolist()
    classes,codes=np.unique(a,axis=0,return_inverse=True)
    use_outcome=estimator!='ipw';use_weights=estimator=='aipw';use_propensity=estimator=='ipw'
    options=dict(seed=seed,intervention=public_assignment(primary),reference=public_assignment(baseline) if baseline is not None else None,
        max_seconds=max_seconds,estimator=estimator,estimand=estimand,folds=2,xgboost_version='2.1.4',
        xgboost=dict(XGBOOST_PARAMS,num_boost_round=XGBOOST_ROUNDS),
        basis='Original verified adjustment-witness coordinates, including all full one-hot coordinates',
        diagnostic_basis='Whole-training standardized original witness coordinates, linear only',
        weight_floor=WEIGHT_FLOOR if use_weights else None,constraint_tolerance=CONSTRAINT_TOLERANCE if use_weights else None,
        minimum_propensity=MIN_PROPENSITY if use_propensity else None,probability_clipping=False,
        ridge=None,balance_penalty=None,weight_cap=None)
    if use_propensity:
        options['xgboost']=dict(XGBOOST_PARAMS,objective='binary:logistic'if len(classes)==2 else'multi:softprob',num_boost_round=XGBOOST_ROUNDS)
        if len(classes)>2:options['xgboost']['num_class']=len(classes)
        options['propensity_initialization']='Binary: training class1 prevalence base_score; multiclass: training log-class-prior base_margin on both training and prediction matrices, overriding base_score'
    nuisance=dict(outcome='Arm-specific XGBoost 2.1.4 conditional mean' if use_outcome else 'Not fitted: IPW propensity training does not use outcomes',
        used=dict(outcome=use_outcome,weights=use_weights or use_propensity,propensity=use_propensity),direct_weight_solver=use_weights,
        fitted=dict(outcome=False,weights=False,propensity=False),fit_calls=dict(outcome=0,weights=0,propensity=0),
        fit_completed=dict(outcome=0,weights=0,propensity=0),
        weights='Minimum-second-moment exact training mass and fitted-outcome balance' if use_weights else 'Derived as inverse joint propensity; no direct weight solver' if use_propensity else 'Not fitted',
        propensity='One XGBoost binary/multiclass joint-assignment classifier per outer fold, trained on all training rows/classes' if use_propensity else 'Not fitted',
        weight_objective='min sum_arm(w^2)/n_train subject to exact mass and scalar fitted-outcome balance, w>=1e-8' if use_weights else None,
        inverse_weight='1 / P_hat(whole ordered treatment tuple = requested assignment | C)' if use_propensity else 'max(1e-8, dual_intercept + dual_slope * standardized_mu_a(X))' if use_weights else None,
        cross_fitting='2 joint-treatment-stratified folds; all nuisance learning uses outer training rows only')
    nuisance['score']=dict(aipw='m_a + I(A_tuple=a)*w_a*(Y-m_a)',outcome_regression='m_a',ipw='I(A_tuple=a)*Y/p_hat_a')[estimator]+(' ; subtract reference-arm score' if estimand=='ate' else '')
    details=dict(method_id=METHOD_IDS[estimator],options=options,estimand=estimand,
        query=dict(estimand=estimand,intervention=options['intervention'],reference=options['reference']),
        treatment_encoding=dict(kind='joint_discrete_assignment',members=k,classes=classes.tolist(),class_order='lexicographic ordered tuples'),
        implementation=dict(file='balancing_aipw.py',entry='estimate_balancing_aipw',sha256=_implementation_sha256()),nuisance=nuisance,
        normalization='Raw heldout score over total n; no probability clipping, stabilization, trimming or heldout weight normalization',sources=SOURCE_URLS,
        limitations=['Joint-class probability learning and finite samples can misspecify inverse weights; scalar-mu balance is not all-function balance.',
            'No positivity certificate, unconditional double robustness or observed-data confidence interval is claimed.'])
    result=dict(status='UNKNOWN',method=METHODS[estimator],estimand=estimand,n=n,approximate=True,
        diagnostics=dict(folds=2,covariate_coordinates=p,treatment_coordinates=k,data_uncertainty='not estimated',fold_details=[]),estimation_details=details)
    def check():
        if perf_counter()-started>=max_seconds:raise TimeoutError('Estimator deadline exhausted; no partial estimate is returned')
    def fail(reason):return dict(result,status='UNKNOWN',reason=reason)
    if n<128:return fail('INSUFFICIENT_DATA: use at least 128 rows')
    if estimand=='ate' and np.array_equal(primary,baseline):
        details['fit_performed']=False;result['diagnostics']['identical_regimes']=True
        return dict(result,status='OK',estimate=0.)
    if len(classes)>MAX_JOINT_CLASSES:return fail('JOINT_SUPPORT: at most 32 observed joint treatment classes are supported; none were pooled or dropped')
    requested=[]
    for value in [primary]+([baseline] if baseline is not None else []):
        match=np.flatnonzero(np.all(classes==value,axis=1))
        if not len(match):return fail('JOINT_SUPPORT: a requested whole treatment assignment is not observed')
        requested.append(int(match[0]))
    wanted=sorted(set(requested));primary_code=requested[0];reference_code=requested[1] if len(requested)>1 else None
    expected=2*len(wanted);fold=np.empty(n,int);rng=np.random.default_rng(seed)
    for code in range(len(classes)):
        ids=np.flatnonzero(codes==code);fold[rng.permutation(ids)]=np.arange(len(ids))%2
    predictions={code:np.empty(n)for code in wanted} if use_outcome else {}
    weights={code:np.zeros(n)for code in wanted} if(use_weights or use_propensity)else{};warnings=[]
    try:
        for heldout in (0,1):
            check();train=np.flatnonzero(fold!=heldout);test=np.flatnonzero(fold==heldout)
            info=dict(heldout=heldout,n_train=len(train),n_test=len(test),arms={});result['diagnostics']['fold_details'].append(info)
            center=z[train].mean(0);scale=z[train].std(0);scale=np.where(scale>1e-12,scale,1.);diagnostic_train=(z[train]-center)/scale
            for code in wanted:
                count=int(np.sum(codes[train]==code));test_count=int(np.sum(codes[test]==code))
                if count<32 or ((use_weights or use_propensity)and test_count<8):return fail('INSUFFICIENT_DATA: each requested training class needs32 rows and weighted heldout class8')
            probabilities=None
            if use_propensity:
                if len(classes)<2 or set(np.unique(codes[train]))!=set(range(len(classes))):return fail('JOINT_SUPPORT: every stored joint class must be observed in each classifier training fold')
                nuisance['fit_calls']['propensity']+=1
                probabilities,propensity_info=fit_xgboost_propensity(z[train],codes[train],z[test],n_classes=len(classes),seed=(seed+104729*(heldout+1))%2**32,check=check)
                info['propensity_fit']=propensity_info
                if probabilities.shape!=(len(test),len(classes)) or not np.isfinite(probabilities).all() or np.any(probabilities<0) or np.any(probabilities>1) or not np.allclose(probabilities.sum(1),1,atol=1e-6,rtol=0):return fail('PROPENSITY_INVALID: joint probability matrix shape/order/domain violated')
                nuisance['fit_completed']['propensity']+=1;nuisance['fitted']['propensity']=nuisance['fit_completed']['propensity']==2
            for code in wanted:
                check();selected=codes[train]==code;observed=codes[test]==code
                count,test_count=int(selected.sum()),int(observed.sum());diag=dict(n_train_arm=count,n_test_arm=test_count,assignment=classes[code].tolist());info['arms'][str(code)]=diag
                if use_outcome:
                    nuisance['fit_calls']['outcome']+=1
                    predicted,fit_info=fit_xgboost_mean(z[train][selected],y[train][selected],np.vstack([z[train],z[test]]),seed=(seed+104729*(heldout+1)+1009*(code+1))%2**32,check=check)
                    training_mu,heldout_mu=predicted[:len(train),0],predicted[len(train):,0];predictions[code][test]=heldout_mu
                    diag.update(outcome_fit=fit_info,train_outcome_rmse=fit_info['fits'][0]['train_outcome_rmse'])
                    nuisance['fit_completed']['outcome']+=1;nuisance['fitted']['outcome']=nuisance['fit_completed']['outcome']==expected
                if use_weights:
                    nuisance['fit_calls']['weights']+=1
                    training_w,alpha,weight_info=_fit_minimum_variance_weights(training_mu,selected,heldout_mu,check);diag.update(weight_info)
                    nuisance['fit_completed']['weights']+=1;nuisance['fitted']['weights']=nuisance['fit_completed']['weights']==expected
                    diag['training_max_moment_imbalance']=float(np.max(np.abs(diagnostic_train[selected].T@training_w/len(train)-diagnostic_train.mean(0)),initial=0.))
                elif use_propensity:
                    prop=probabilities[:,code];diag['minimum_queried_propensity']=float(prop.min());diag['maximum_queried_propensity']=float(prop.max())
                    if np.any(prop<MIN_PROPENSITY):return fail('PROPENSITY_SUPPORT: queried joint assignment probability below1e-6; no clipping or estimate')
                    alpha=1/prop
                else:continue
                weights[code][test]=alpha;w=alpha[observed];mass=float(w.sum()/len(test));ess=float(w.sum()**2/(w@w));share=float(w.max()/w.sum())
                diag.update(heldout_weight_mass=mass,heldout_ess=ess,heldout_max_normalized_share=share,heldout_max_inverse_weight=float(w.max()));check()
                if not np.isfinite([mass,ess,share]).all():return fail('Nonfinite inverse-weight diagnostics')
                if ess<max(10.,.05*test_count)or share>.20:return fail('WEAK_OVERLAP: heldout inverse-weight concentration exceeds the fixed safety limits')
                if ess<.25*test_count or share>.05 or not .5<=mass<=2. or diag.get('training_max_moment_imbalance',0)>.1:warnings.append('Finite-sample inverse weights or covariate imbalance may be unreliable; this does not certify positivity.')
        scores={}
        for code in wanted:
            indicator=codes==code
            if estimator=='aipw':scores[code]=predictions[code]+indicator*weights[code]*(y-predictions[code])
            elif estimator=='outcome_regression':scores[code]=predictions[code]
            else:scores[code]=indicator*weights[code]*y
        if estimand=='apo':score=scores[primary_code]
        elif scalar and len(classes)==2 and np.array_equal(classes[:,0],[0,1]) and estimator in {'aipw','outcome_regression'}:
            # Preserve prior scalar arithmetic, including reverse-sign symmetry.
            score=predictions[1]-predictions[0]
            if estimator=='aipw':score=score+(codes==1)*weights[1]*(y-predictions[1])-(codes==0)*weights[0]*(y-predictions[0])
            score=score*(primary[0]-baseline[0])
        else:score=scores[primary_code]-scores[reference_code]
        value=float(score.mean());check()
        if not np.isfinite(score).all()or not np.isfinite(value):return fail('Selected score produced nonfinite values')
    except(TimeoutError,FloatingPointError,ValueError,OverflowError,xgb.core.XGBoostError)as error:
        if isinstance(error,_BalanceError):diag.update(error.diagnostics)
        return fail(str(error))
    details['fit_performed']=True
    result['diagnostics']['arm_score_means']={str(code):float(scores[code].mean())for code in wanted}
    if use_outcome:
        outcome_score=predictions[primary_code] if estimand=='apo' else (predictions[1]-predictions[0])*(primary[0]-baseline[0]) if scalar and len(classes)==2 else predictions[primary_code]-predictions[reference_code]
        result['diagnostics']['outcome_contrast_mean' if estimand=='ate' else 'outcome_mean']=float(outcome_score.mean())
        if estimator=='aipw':result['diagnostics']['augmentation_mean']=value-float(outcome_score.mean())
    if use_propensity:result['diagnostics']['raw_weighted_outcome_contrast_mean' if estimand=='ate' else 'raw_weighted_outcome_mean']=value
    if warnings:result['warning']=warnings[0]
    return dict(result,status='OK',estimate=value)
