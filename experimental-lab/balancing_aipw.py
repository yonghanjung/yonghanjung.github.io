"""Cross-fitted augmented mean contrast with bounded calibration weights.

This is the actual browser/native routine, not pseudocode. Inputs contain observed
rows only. Graph eligibility is verified separately by editor_engine.py.

Fixed BEFORE accuracy experiments: two stratified folds; linear + coordinatewise
square basis; averaged outcome ridge penalty .001; bounded-calibration slope penalty .01; weight class [1,20];
L-BFGS-B maxiter400, gradient tolerance1e-5. Each training arm must have
prevalence strictly greater than 1/20 for finite intercept calibration. No posthoc weight normalization or
clipping. The bound is part of the fitted weight function, not a clipped fit. Fail closed: n<128, any train arm<32, heldout arm<8, solver failure,
nonfinite arithmetic, heldout arm ESS<max(10,.05*n_arm), maximum normalized arm
weight share>.20, or training max moment imbalance>.5. Warning: ESS<.25*n_arm,
share>.05, heldout arm mass outside[.5,2], or training imbalance>.1.
These are engineering safeguards, NOT a positivity certificate or inference.
Finite basis, fixed regularization and misspecification can leave bias. No
unconditional double-robustness, finite-sample unbiasedness or CI is claimed.
"""
import hashlib
from pathlib import Path
from time import perf_counter
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

METHOD = "2-fold balancing-weight AIPW (bounded calibration)"
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


def estimate_balancing_aipw(covariates, treatment, outcome, *, seed=5,
                            intervention=1, reference=0, max_seconds=10):
    """Return a JSON-safe scalar contrast; never reads a model or truth.

    covariates: numeric n-by-p matrix (p may be zero), treatment: n binary values,
    outcome: n finite scalar values. Nominal covariates must be full one-hot
    encoded before this call. The two regimes must be in {0,1}.
    """
    started = perf_counter()
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
                   ridge=RIDGE, balance_penalty=BALANCE_PENALTY, weight_cap=WEIGHT_CAP, folds=2,
                   basis="training-standardized linear and coordinatewise squares",
                   max_seconds=max_seconds)
    details = dict(method_id="balancing_aipw_v2", options=options,
        implementation=dict(file="balancing_aipw.py", entry="estimate_balancing_aipw",
                            sha256=_implementation_sha256()),
        nuisance=dict(outcome="Arm-specific ridge least squares; intercept not penalized",
            weights="Direct inverse-weight nuisance in a fitted [1,20] bounded calibration class; no propensity-probability fit",
            weight_objective="19/n_train * sum_arm(logaddexp(0, intercept + B@slopes)) - 1/n_train * sum_other_arm(intercept + B@slopes) + .01/2 * ||slopes||^2",
            inverse_weight="1 + 19*expit(intercept + B@slopes)",
            score="m1 - m0 + I(A=1)*alpha1*(Y-m1) - I(A=0)*alpha0*(Y-m0)",
            cross_fitting="2 treatment-stratified folds; preprocessing and both nuisance fits use training rows only"),
        normalization="Unpenalized intercept learns training arm mass n_train up to solver tolerance. Raw heldout score averaged over all n rows; no posthoc normalization or clipping.",
        sources=SOURCE_URLS,
        limitations=["Finite basis, fixed regularization and the [1,20] inverse-weight class can leave bias; true inverse weights outside the class are not consistently represented.",
                     "Weights balance selected training moments approximately; this does not certify positivity.",
                     "No unconditional double robustness, finite-sample unbiasedness or confidence interval is claimed."])
    result = dict(status="UNKNOWN", method=METHOD, n=n, approximate=True,
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
    predictions = np.empty((n, 2)); weights = np.zeros((n, 2))
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
                    if count < 32 or test_count < 8:
                        return fail("INSUFFICIENT_DATA: each training arm needs 32 rows and each heldout arm 8")
                    ba, ya = bt[selected], y[train][selected]
                    bx, my = ba.mean(axis=0), float(ya.mean())
                    x = ba-bx
                    coefficients = np.linalg.solve(x.T@x/count + RIDGE*np.eye(x.shape[1]),
                                                    x.T@(ya-my)/count)
                    predictions[test, arm] = my+(bv-bx)@coefficients
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
                    diagnostics = dict(n_train_arm=count, n_test_arm=test_count,
                        solver_success=bool(fitted.success),
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
                        heldout_max_normalized_share=share, heldout_max_inverse_weight=float(w.max()),
                        train_outcome_rmse=float(np.sqrt(np.mean((my+x@coefficients-ya)**2))))
                    info["arms"][str(arm)] = diagnostics
                    check()
                    if (not diagnostics["solver_success"] or diagnostics["gradient_max"] > 1e-5):
                        return fail("Bounded calibration did not converge to the fixed numerical tolerance")
                    if not np.isfinite([ess,share,mass,max_balance]).all():
                        return fail("Nonfinite weight diagnostics")
                    if ess < max(10., .05*test_count) or share > .20 or max_balance > .5:
                        return fail("WEAK_OVERLAP: inverse weights or covariate imbalance exceed the fixed safety limits")
                    if (ess < .25*test_count or share > .05 or not .5 <= mass <= 2. or max_balance > .1
                            or diagnostics["cap_saturation_fraction_heldout_arm"] > .05):
                        warnings.append("Weight diagnostics show imperfect balance, concentration or active weight bounds; this is not a positivity certificate and the estimate may be unreliable.")
            score = (predictions[:,1]-predictions[:,0]
                     +(a==1)*weights[:,1]*(y-predictions[:,1])
                     -(a==0)*weights[:,0]*(y-predictions[:,0]))
            value = float(score.mean())*(intervention-reference)
            check()
            if not np.isfinite(value) or not np.isfinite(score).all():
                return fail("Augmented score produced nonfinite values")
    except (TimeoutError, FloatingPointError, np.linalg.LinAlgError, OverflowError) as error:
        return fail(str(error))
    details["fit_performed"] = True
    result["diagnostics"].update(outcome_contrast_mean=float((predictions[:,1]-predictions[:,0]).mean())*(intervention-reference),
        augmentation_mean=float((score-(predictions[:,1]-predictions[:,0])).mean())*(intervention-reference))
    if warnings:
        result["warning"] = warnings[0]
    return dict(result, status="OK", estimate=value)
