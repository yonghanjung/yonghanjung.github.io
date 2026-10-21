"""Cross-fitted baseline AIPW, outcome-regression and raw-IPW contrasts.

This is the actual browser/native routine, not pseudocode. Inputs contain observed
rows only. Graph eligibility is verified separately by editor_engine.py.

AIPW preserves the original default score. Outcome regression fits only the
outcome nuisance; raw IPW fits only the inverse-weight nuisance. Unused nuisance
fits and their diagnostic gates are not run.

Original AIPW settings fixed before prior accuracy experiments: two stratified folds; linear + coordinatewise
square basis; averaged outcome ridge penalty .001; bounded-calibration slope penalty .01; weight class [1,20];
L-BFGS-B maxiter400, gradient tolerance1e-5. All choices fail closed for n<128,
any training arm<32, nonfinite arithmetic, required-fit failure or deadline.
Only AIPW requires training-arm prevalence strictly greater than 1/20 for
finite bounded-logistic intercept calibration. AIPW/IPW require heldout arm>=8,
their own solver convergence,
heldout arm ESS>=max(10,.05*n_arm), maximum normalized arm weight share<=.20,
and training max moment imbalance<=.5. Their warnings flag ESS<.25*n_arm,
share>.05, heldout arm mass outside[.5,2], training imbalance>.1, or active bounds.
Outcome Regression runs no weight fit or weight diagnostic gates. IPW instead
uses the documented UCA-style quadratic RN helper, with projected coefficients,
ratio projection [.01,50], training-arm normalization and prevalence conversion;
the [1,20] calibration feasibility restriction applies only to AIPW.
AIPW has no posthoc weight normalization or clipping: its bound is part of the
fitted weight function. IPW projects the raw RN ratio to [.01,50] and normalizes
by its training-arm mean before prevalence conversion; it never renormalizes
heldout weights.
These are engineering safeguards, NOT a positivity certificate or inference.
Finite basis, fixed regularization and misspecification can leave bias. No
unconditional double-robustness, finite-sample unbiasedness or CI is claimed.
"""
import hashlib
from pathlib import Path
from time import perf_counter
import numpy as np
from scipy.optimize import minimize, nnls
from scipy.linalg import cholesky, solve_triangular
from scipy.special import expit

METHOD = "2-fold balancing-weight AIPW (bounded calibration)"
METHODS = {"aipw": METHOD,
           "outcome_regression": "2-fold outcome regression (ridge plug-in)",
           "ipw": "2-fold IPW (UCA-style quadratic balancing; raw mean)"}
METHOD_IDS = {"aipw": "balancing_aipw_v2", "outcome_regression": "outcome_regression_v1",
              "ipw": "uca_balancing_ipw_v1"}
RIDGE = .001
BALANCE_PENALTY = .01
WEIGHT_CAP = 20.
SOURCE_URLS = [
    "https://doi.org/10.1093/pan/mpr025",
    "https://doi.org/10.1093/biomet/asz059",
    "https://doi.org/10.1111/ectj.12097",
]

def _implementation_sha256():
    # A pasted notebook/exec cell has no reliable source file. Computation must
    # still work; never pretend to have verified a source fingerprint there.
    try:
        filename = globals().get("__file__")
        return hashlib.sha256(Path(filename).read_bytes()).hexdigest() if filename else None
    except (OSError, TypeError):
        return None


class _UCABalancingError(ValueError):
    """A failed IPW-only finite-dictionary ratio fit."""
    def __init__(self, message, diagnostics=None):
        super().__init__(message)
        self.diagnostics = diagnostics or {}


def _fit_uca_ipw_ratio(train_coordinates, selected, test_coordinates, seed, check):
    """One-stage finite-dictionary adaptation of UCA adjacent-source RN fitting.

    current = outer-training C|A=a; previous = all outer-training C.
    This helper accepts no outcome or heldout arm labels. All transforms, centers,
    fitting and normalization use training rows only. It is not the frozen UCA
    saturated-indicator benchmark and does not implement general UCA graphs.
    """
    source_rows, target_rows = int(selected.sum()), len(train_coordinates)
    prevalence = source_rows/target_rows
    if source_rows == 0 or not 0 < prevalence < 1:
        raise _UCABalancingError("UCA ratio fitting requires both observed training arms")
    x, evaluation = np.tanh(train_coordinates), np.tanh(test_coordinates)
    current = x[selected]
    width = x.shape[1]
    rng = np.random.default_rng(seed)
    pool = np.vstack((current, x))
    centers = pool[rng.choice(len(pool), min(24, len(pool)), replace=False)] if width else np.empty((0,0))
    def features(values):
        check()
        if not width:
            return np.ones((len(values),1))
        positive = (values+1)/2
        distance = np.maximum(0, (values*values).sum(1)[:,None]
                              +(centers*centers).sum(1)[None,:]-2*values@centers.T)/width
        return np.column_stack((np.ones(len(values)), positive, 1-positive,
            positive*positive, (1-positive)**2, np.exp(-distance/.35)))
    phi, target_phi = features(current), features(x)
    gram = phi.T@phi/source_rows + .002*np.eye(phi.shape[1])
    moment = target_phi.mean(0)
    def objective(coefficients):
        check()
        product = gram@coefficients
        value, gradient = .5*float(coefficients@product)-float(moment@coefficients), product-moment
        if not np.isfinite(value) or not np.isfinite(gradient).all():
            raise FloatingPointError("Nonfinite UCA quadratic objective or gradient")
        return value, gradient
    maxiter = 3*len(moment)
    try:
        # G=L L.T; this NNLS objective differs from the same quadratic only by
        # an additive constant. No statistical fitting setting is changed.
        # Explicitly discard the unused triangle before passing L.T to NNLS.
        factor = np.tril(cholesky(gram,lower=True))
        response = solve_triangular(factor,moment,lower=True)
        check()
        coefficients, residual_norm = nnls(factor.T,response,maxiter=maxiter)
        check()
    except (RuntimeError,np.linalg.LinAlgError) as error:
        raise _UCABalancingError(str(error),dict(solver_success=False,solver_message=str(error),
            solver="SciPy NNLS on Cholesky-transformed quadratic",iterations=None,
            solver_maxiter=maxiter,projected_kkt_residual=None)) from error
    value, gradient = objective(coefficients)
    kkt = float(np.max(np.abs(coefficients-np.maximum(0,coefficients-gradient)),initial=0.))
    success = bool(np.isfinite(coefficients).all() and np.all(coefficients >= 0)
                   and np.isfinite(residual_norm) and kkt <= 1e-4)
    solver_info = dict(solver_success=success,solver_message="SciPy nnls returned normally",
        solver="SciPy NNLS on Cholesky-transformed quadratic",iterations=None,
        solver_maxiter=maxiter,solver_residual_norm=float(residual_norm),
        objective=value,projected_kkt_residual=kkt)
    if not success:
        raise _UCABalancingError("UCA balancing solver failed its fixed projected-KKT tolerance",solver_info)
    raw = phi@coefficients
    projected = np.clip(raw,.01,50)
    normalizer = float(projected.mean())
    if not np.isfinite(normalizer) or normalizer <= 0:
        raise _UCABalancingError("UCA balancing has a nonpositive training normalizer")
    training_ratio = projected/normalizer
    raw_test = features(evaluation)@coefficients
    heldout_ratio = np.clip(raw_test,.01,50)/normalizer
    training_alpha, alpha = training_ratio/prevalence, heldout_ratio/prevalence
    check()
    diagnostics = dict(solver_info,
        ratio_feature_count=len(moment),ratio_center_seed=seed,
        ratio_center_count=len(centers),training_arm_prevalence=prevalence,
        ratio_normalizer=normalizer,
        training_ratio_mean=float(training_ratio.mean()),
        training_raw_ratio_max_balance=float(np.max(np.abs(phi.T@raw/source_rows-moment),initial=0.)),
        training_post_ratio_max_balance=float(np.max(np.abs(phi.T@training_ratio/source_rows-moment),initial=0.)),
        ratio_floor_fraction_train_arm=float(np.mean(raw < .01)),ratio_cap_fraction_train_arm=float(np.mean(raw > 50)),
        ratio_floor_fraction_heldout_cohort=float(np.mean(raw_test < .01)),ratio_cap_fraction_heldout_cohort=float(np.mean(raw_test > 50)),
        actual_ratio_lower=.01/normalizer,actual_ratio_upper=50/normalizer,
        actual_inverse_weight_lower=.01/(normalizer*prevalence),actual_inverse_weight_upper=50/(normalizer*prevalence))
    return training_alpha, alpha, diagnostics


def estimate_balancing_aipw(covariates, treatment, outcome, *, seed=5,
                            intervention=1, reference=0, max_seconds=10, estimator="aipw"):
    """Return a JSON-safe scalar contrast; never reads a model or truth.

    covariates: numeric n-by-p matrix (p may be zero), treatment: n binary values,
    outcome: n finite scalar values. Nominal covariates must be full one-hot
    encoded before this call. The two regimes must be in {0,1}.
    estimator selects aipw (default), outcome_regression or raw ipw; each uses
    only its required nuisance fits, with the same fold allocation and training-only
    scaling; its weight dictionary and diagnostic basis are method-specific.
    """
    started = perf_counter()
    if not isinstance(estimator, str) or estimator not in METHODS:
        raise ValueError("estimator must be aipw, outcome_regression or ipw")
    use_outcome, use_weights = estimator != "ipw", estimator != "outcome_regression"
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("seed must be an integer from 0 to 2**32-1")
    if (type(max_seconds) not in (int, float) or not np.isfinite(max_seconds)
            or not 0 < max_seconds <= 30):
        raise ValueError("max_seconds must be positive and at most 30")
    for level in (intervention, reference):
        if type(level) not in (int, float) or level not in (0, 1):
            raise ValueError("Use binary intervention/reference levels 0 or 1")
    z = np.array(covariates, dtype=float, copy=True)
    a = np.array(treatment, dtype=float, copy=True)
    y = np.array(outcome, dtype=float, copy=True)
    if (z.ndim != 2 or a.ndim != 1 or y.ndim != 1
            or len(z) != len(a) or len(a) != len(y)):
        raise ValueError("Use aligned n-by-p covariates and scalar treatment/outcome arrays")
    n, p = z.shape
    if (not 1 <= n <= 5000 or p > 98 or n*(p+2) > 500000
            or not np.isfinite(z).all() or not np.isfinite(a).all()
            or not np.isfinite(y).all() or not np.isin(a, [0, 1]).all()):
        raise ValueError("Use finite numeric rows, binary treatment, <=5000 rows and <=100 physical columns")
    options = dict(seed=seed, intervention=intervention, reference=reference,
                   ridge=RIDGE if use_outcome else None, balance_penalty=(.002 if estimator == "ipw" else BALANCE_PENALTY) if use_weights else None,
                   weight_cap=WEIGHT_CAP if estimator == "aipw" else None, folds=2, estimator=estimator,
                   basis="training-standardized linear and coordinatewise squares",
                   max_seconds=max_seconds)
    if estimator == "ipw":
        options.update(ratio_floor=.01,ratio_cap=50,ratio_centers=24,ratio_rbf_width=.35,
            ratio_solver="SciPy NNLS on Cholesky-transformed quadratic",ratio_solver_maxiter_factor=3,ratio_projected_kkt_tolerance=1e-4,
            basis="training-standardized tanh positive/complement/square and RBF dictionary",
            diagnostic_basis="training-standardized linear and coordinatewise squares")
    details = dict(method_id=METHOD_IDS[estimator], options=options,
        implementation=dict(file="balancing_aipw.py", entry="estimate_balancing_aipw",
                            sha256=_implementation_sha256()),
        nuisance=dict(outcome="Arm-specific ridge least squares; intercept not penalized" if use_outcome else "Not fitted by this estimator",
            used=dict(outcome=use_outcome, weights=use_weights), fitted=dict(outcome=False, weights=False),
            fit_calls=dict(outcome=0, weights=0), fit_completed=dict(outcome=0, weights=0),
            weights="Direct inverse-weight nuisance in a fitted [1,20] bounded calibration class; no propensity-probability fit" if use_weights else "Not fitted by this estimator",
            weight_objective="19/n_train * sum_arm(logaddexp(0, intercept + B@slopes)) - 1/n_train * sum_other_arm(intercept + B@slopes) + .01/2 * ||slopes||^2" if use_weights else None,
            inverse_weight="1 + 19*expit(intercept + B@slopes)" if use_weights else None,
            score={"aipw":"m1 - m0 + I(A=1)*alpha1*(Y-m1) - I(A=0)*alpha0*(Y-m0)",
                   "outcome_regression":"m1 - m0", "ipw":"I(A=1)*alpha1*Y - I(A=0)*alpha0*Y"}[estimator],
            cross_fitting="2 treatment-stratified folds; preprocessing and selected nuisance fits use training rows only"),
        normalization=("Unpenalized intercept learns training arm mass n_train up to solver tolerance. Raw heldout score averaged over all n rows; no posthoc normalization or clipping." if use_weights else "Raw heldout predicted outcome contrast averaged over all n rows; no inverse weights are fitted or normalized."),
        sources=SOURCE_URLS,
        limitations=[("Finite basis, fixed regularization and the [1,20] inverse-weight class can leave bias; true inverse weights outside the class are not consistently represented." if use_weights else "Finite-basis, fixed-ridge outcome regression can be misspecified and biased."),
                     ("Weights balance selected training moments approximately; this does not certify positivity." if use_weights else "No weight-based overlap diagnostics are computed; outcome extrapolation and poor support can leave bias."),
                     "No unconditional double robustness, finite-sample unbiasedness or confidence interval is claimed."])
    if estimator == "ipw":
        details["nuisance"].update(
            weights="UCA-style adjacent-source finite-dictionary quadratic density-ratio fit; no propensity-probability fit",
            weight_objective="0.5*coef.T@(E_arm[phi*phi.T]+.002*I)@coef - E_cohort[phi].T@coef; coef>=0",
            inverse_weight="clip(phi@coef,.01,50)/(training_ratio_normalizer*training_arm_prevalence)")
        details["normalization"] = "Projected RN ratio divided by its training-arm mean, then by training-arm prevalence. Raw heldout weighted outcome contrast uses total n; no heldout normalization."
        details["weight_provenance"] = dict(recipe="UCA adjacent-source quadratic RN finite-dictionary one-stage baseline adaptation",
            source="uca_sdr.py::PositiveFeatures/fit_local_weight; jmlr-5.tex adjacent-source quadratic loss",
            adaptation="C-only: no binary proposal gates; training-only standardization then tanh; positive/complement/squares plus RBF24",
            frozen_paper_benchmark_literal_port=False,
            source_optimizer="L-BFGS-B",product_optimizer="Cholesky-transformed nonnegative least squares on exactly the same quadratic")
        details["limitations"] = ["Finite dictionary, fixed ridge, train-normalized ratio projection and imperfect overlap can bias IPW; balancing is not a true RN-ratio or positivity certificate.",
            "The raw ratio projection [.01,50] is not a bound of 50 on final inverse weights; bounds depend on the training normalizer and prevalence.",
            "No finite-sample unbiasedness or confidence interval is claimed."]
    result = dict(status="UNKNOWN", method=METHODS[estimator], n=n, approximate=True,
                  diagnostics=dict(folds=2, covariate_coordinates=p,
                      data_uncertainty="not estimated", fold_details=[]),
                  estimation_details=details)
    def check():
        if perf_counter() - started >= max_seconds:
            raise TimeoutError("Estimator deadline exhausted; no partial estimate is returned")
    def fail(reason):
        return dict(result, status="UNKNOWN", reason=reason)
    if n < 128:
        return fail("INSUFFICIENT_DATA: use at least 128 rows")
    if intervention == reference:
        check()
        details["fit_performed"] = False
        result["diagnostics"]["identical_regimes"] = True
        return dict(result, status="OK", estimate=0.0)
    fold = np.empty(n, dtype=int)
    rng = np.random.default_rng(seed)
    for arm in (0, 1):
        indices = np.flatnonzero(a == arm)
        fold[rng.permutation(indices)] = np.arange(len(indices)) % 2
    predictions = np.empty((n, 2)) if use_outcome else None
    weights = np.zeros((n, 2)) if use_weights else None
    warnings = []
    try:
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            for heldout in (0, 1):
                check()
                train, test = np.flatnonzero(fold != heldout), np.flatnonzero(fold == heldout)
                info = dict(heldout=heldout, n_train=len(train), n_test=len(test), arms={})
                result["diagnostics"]["fold_details"].append(info)
                center, scale = z[train].mean(axis=0), z[train].std(axis=0)
                scale = np.where(scale > 1e-12, scale, 1.)
                standardized = (z-center)/scale
                basis = np.concatenate([standardized, standardized**2], axis=1)
                bcenter, bscale = basis[train].mean(axis=0), basis[train].std(axis=0)
                bscale = np.where(bscale > 1e-12, bscale, 1.)
                basis = (basis-bcenter)/bscale
                if not np.isfinite(basis).all():
                    return fail("Nonfinite train-only basis transformation")
                bt, bv = basis[train], basis[test]
                target = bt.mean(axis=0)
                info["basis_coordinates"] = int(basis.shape[1])
                for arm in (0, 1):
                    check()
                    selected = a[train] == arm
                    observed = a[test] == arm
                    count, test_count = int(selected.sum()), int(observed.sum())
                    if count < 32 or (use_weights and test_count < 8):
                        return fail("INSUFFICIENT_DATA: each training arm needs 32 rows" + (" and each heldout arm 8" if use_weights else ""))
                    ba = bt[selected]
                    diagnostics = dict(n_train_arm=count, n_test_arm=test_count)
                    info["arms"][str(arm)] = diagnostics
                    if use_outcome:
                        ya = y[train][selected]
                        bx, my = ba.mean(axis=0), float(ya.mean())
                        x = ba-bx
                        details["nuisance"]["fit_calls"]["outcome"] += 1
                        coefficients = np.linalg.solve(x.T@x/count + RIDGE*np.eye(x.shape[1]),
                                                        x.T@(ya-my)/count)
                        predictions[test, arm] = my+(bv-bx)@coefficients
                        diagnostics["train_outcome_rmse"] = float(np.sqrt(np.mean((my+x@coefficients-ya)**2)))
                        details["nuisance"]["fit_completed"]["outcome"] += 1
                        details["nuisance"]["fitted"]["outcome"] = details["nuisance"]["fit_completed"]["outcome"] == 4
                    if not use_weights:
                        check()
                        continue
                    if estimator == "ipw":
                        details["nuisance"]["fit_calls"]["weights"] += 1
                        ratio_seed = (seed+104729*(heldout+1)+1009*(arm+1)) % 2**32
                        training_alpha, alpha, ratio_info = _fit_uca_ipw_ratio(
                            standardized[train], selected, standardized[test], ratio_seed, check)
                        weights[test,arm] = alpha
                        w = alpha[observed]
                        mass = float(w.sum()/len(test));ess = float(w.sum()**2/(w@w));share = float(w.max()/w.sum())
                        max_balance = float(np.max(np.abs(ba.T@training_alpha/len(train)-target),initial=0.))
                        diagnostics.update(ratio_info,training_weight_mass=float(training_alpha.sum()/len(train)),
                            training_mass_residual=float(training_alpha.sum()/len(train)-1),
                            training_max_moment_imbalance=max_balance,heldout_weight_mass=mass,heldout_ess=ess,
                            heldout_max_normalized_share=share,heldout_max_inverse_weight=float(w.max()))
                        details["nuisance"]["fit_completed"]["weights"] += 1
                        details["nuisance"]["fitted"]["weights"] = details["nuisance"]["fit_completed"]["weights"] == 4
                        check()
                        if not np.isfinite([ess,share,mass,max_balance]).all():
                            return fail("Nonfinite UCA balancing diagnostics")
                        if ess < max(10.,.05*test_count) or share > .20 or max_balance > .5:
                            return fail("WEAK_OVERLAP: inverse weights or covariate imbalance exceed the fixed safety limits")
                        if ess < .25*test_count or share > .05 or not .5 <= mass <= 2. or max_balance > .1:
                            warnings.append("UCA-style finite-feature balance or weight concentration is imperfect; the estimate may be unreliable and this does not certify positivity.")
                        continue
                    prevalence = count/len(train)
                    if not 1/WEIGHT_CAP < prevalence < 1:
                        return fail("WEIGHT_FEASIBILITY: each training arm must have prevalence strictly greater than 1/20 for finite bounded calibration")
                    other = bt[~selected]
                    def objective(theta):
                        check()
                        arm_score = theta[0]+ba@theta[1:]
                        other_score = theta[0]+other@theta[1:]
                        arm_alpha = 1+(WEIGHT_CAP-1)*expit(arm_score)
                        value = ((WEIGHT_CAP-1)*np.logaddexp(0,arm_score).sum()-other_score.sum())/len(train)
                        value += BALANCE_PENALTY/2*(theta[1:]@theta[1:])
                        gradient = np.r_[(arm_alpha.sum()-len(train))/len(train),
                            ba.T@arm_alpha/len(train)-target+BALANCE_PENALTY*theta[1:]]
                        if not np.isfinite(value) or not np.isfinite(gradient).all():
                            raise FloatingPointError("Nonfinite bounded calibration objective/gradient")
                        return float(value), gradient
                    initial = np.zeros(bt.shape[1]+1)
                    inverse_prevalence = len(train)/count
                    initial[0] = np.log((inverse_prevalence-1)/(WEIGHT_CAP-inverse_prevalence))
                    details["nuisance"]["fit_calls"]["weights"] += 1
                    fitted = minimize(objective, initial, jac=True, method="L-BFGS-B",
                        options=dict(maxiter=400, ftol=1e-12, gtol=1e-7))
                    theta = fitted.x
                    objective_value, gradient = objective(theta)
                    training_logit = theta[0]+bt@theta[1:]
                    test_logit = theta[0]+bv@theta[1:]
                    training_alpha = 1+(WEIGHT_CAP-1)*expit(training_logit[selected])
                    imbalance = ba.T@training_alpha/len(train)-target
                    max_balance = float(np.max(np.abs(imbalance), initial=0.))
                    alpha = 1+(WEIGHT_CAP-1)*expit(test_logit)
                    if not np.isfinite(alpha).all() or np.any(alpha <= 0):
                        return fail("Inverse weights are nonfinite or numerically zero")
                    weights[test, arm] = alpha
                    w = alpha[observed]
                    mass = float(w.sum()/len(test))
                    ess = float(w.sum()**2/(w@w))
                    share = float(w.max()/w.sum())
                    diagnostics.update(solver_success=bool(fitted.success),
                        solver_message=str(fitted.message),
                        iterations=int(fitted.nit),
                        objective=objective_value, gradient_max=float(np.max(np.abs(gradient), initial=0.)),
                        training_max_moment_imbalance=max_balance,
                        training_weight_mass=float(training_alpha.sum()/len(train)),
                        training_mass_residual=float(training_alpha.sum()/len(train)-1),
                        cap_saturation_fraction_train_arm=float(np.mean(training_alpha >= .99*WEIGHT_CAP)),
                        cap_saturation_fraction_heldout_arm=float(np.mean(w >= .99*WEIGHT_CAP)),
                        max_abs_logit_train_cohort=float(np.max(np.abs(training_logit))),
                        max_abs_logit_heldout_cohort=float(np.max(np.abs(test_logit))),
                        heldout_weight_mass=mass, heldout_ess=ess,
                        heldout_max_normalized_share=share, heldout_max_inverse_weight=float(w.max()))
                    info["arms"][str(arm)] = diagnostics
                    check()
                    if (not diagnostics["solver_success"] or diagnostics["gradient_max"] > 1e-5):
                        return fail("Bounded calibration did not converge to the fixed numerical tolerance")
                    if not np.isfinite([ess,share,mass,max_balance]).all():
                        return fail("Nonfinite weight diagnostics")
                    details["nuisance"]["fit_completed"]["weights"] += 1
                    details["nuisance"]["fitted"]["weights"] = details["nuisance"]["fit_completed"]["weights"] == 4
                    if ess < max(10., .05*test_count) or share > .20 or max_balance > .5:
                        return fail("WEAK_OVERLAP: inverse weights or covariate imbalance exceed the fixed safety limits")
                    if (ess < .25*test_count or share > .05 or not .5 <= mass <= 2. or max_balance > .1
                            or diagnostics["cap_saturation_fraction_heldout_arm"] > .05):
                        warnings.append("Weight diagnostics show imperfect balance, concentration or active weight bounds; this is not a positivity certificate and the estimate may be unreliable.")
            if estimator == "aipw":
                score = (predictions[:,1]-predictions[:,0]
                         +(a==1)*weights[:,1]*(y-predictions[:,1])
                         -(a==0)*weights[:,0]*(y-predictions[:,0]))
            elif estimator == "outcome_regression":
                score = predictions[:,1]-predictions[:,0]
            else:
                score = (a==1)*weights[:,1]*y-(a==0)*weights[:,0]*y
            value = float(score.mean())*(intervention-reference)
            check()
            if not np.isfinite(value) or not np.isfinite(score).all():
                return fail("Selected estimator score produced nonfinite values")
    except (TimeoutError, FloatingPointError, np.linalg.LinAlgError, OverflowError, _UCABalancingError) as error:
        if isinstance(error,_UCABalancingError):
            diagnostics.update(error.diagnostics)
        return fail(str(error))
    details["fit_performed"] = True
    if use_outcome:
        result["diagnostics"]["outcome_contrast_mean"] = float((predictions[:,1]-predictions[:,0]).mean())*(intervention-reference)
    if estimator == "aipw":
        result["diagnostics"]["augmentation_mean"] = float((score-(predictions[:,1]-predictions[:,0])).mean())*(intervention-reference)
    if estimator == "ipw":
        result["diagnostics"]["raw_weighted_outcome_contrast_mean"] = value
    if warnings:
        result["warning"] = warnings[0]
    return dict(result, status="OK", estimate=value)
