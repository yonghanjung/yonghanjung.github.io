"""Cross-fitted augmented mean contrast with regularized entropy-calibration weights.

This is the actual browser/native routine, not pseudocode. Inputs contain observed
rows only. Graph eligibility is verified separately by editor_engine.py.

Fixed BEFORE accuracy experiments: two stratified folds; linear + coordinatewise
square basis; averaged outcome ridge penalty .001; entropy slope penalty .01;
L-BFGS-B maxiter400, gradient tolerance1e-5. No heldout weight normalization or
clipping. Fail closed: n<128, any train arm<32, heldout arm<8, solver failure,
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
from scipy.special import logsumexp

METHOD = "2-fold balancing-weight AIPW (regularized entropy calibration)"
RIDGE = .001
BALANCE_PENALTY = .01
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
                   ridge=RIDGE, balance_penalty=BALANCE_PENALTY, folds=2,
                   basis="training-standardized linear and coordinatewise squares",
                   max_seconds=max_seconds)
    details = dict(method_id="balancing_aipw_v1", options=options,
        implementation=dict(file="balancing_aipw.py", entry="estimate_balancing_aipw",
                            sha256=_implementation_sha256()),
        nuisance=dict(outcome="Arm-specific ridge least squares; intercept not penalized",
            weights="Direct positive inverse-weight nuisance via regularized entropy calibration; no propensity-probability fit",
            weight_objective="logsumexp(B_arm @ theta) - mean(B_train) @ theta + .01/2 * ||theta||^2",
            inverse_weight="n_train * exp(B @ theta) / sum_train_arm(exp(B @ theta))",
            score="m1 - m0 + I(A=1)*alpha1*(Y-m1) - I(A=0)*alpha0*(Y-m0)",
            cross_fitting="2 treatment-stratified folds; preprocessing and both nuisance fits use training rows only"),
        normalization="Training arm weight mass equals n_train. Raw heldout score averaged over all n rows; no heldout renormalization or clipping.",
        sources=SOURCE_URLS,
        limitations=["Finite basis and fixed regularization can leave bias or misspecification error.",
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
                    def objective(theta):
                        check()
                        score = ba@theta
                        normalizer = logsumexp(score)
                        normalized = np.exp(score-normalizer)
                        value = normalizer-target@theta + BALANCE_PENALTY/2*(theta@theta)
                        gradient = ba.T@normalized-target+BALANCE_PENALTY*theta
                        if not np.isfinite(value) or not np.isfinite(gradient).all():
                            raise FloatingPointError("Nonfinite entropy calibration objective/gradient")
                        return float(value), gradient
                    fitted = minimize(objective, np.zeros(bt.shape[1]), jac=True,
                        method="L-BFGS-B", options=dict(maxiter=400, ftol=1e-12, gtol=1e-7)) if bt.shape[1] else None
                    theta = fitted.x if fitted is not None else np.zeros(0)
                    objective_value, gradient = objective(theta)
                    lognorm = float(logsumexp(ba@theta))
                    normalized = np.exp(ba@theta-lognorm)
                    imbalance = ba.T@normalized-target
                    max_balance = float(np.max(np.abs(imbalance), initial=0.))
                    logalpha = np.log(len(train))+bv@theta-lognorm
                    alpha = np.exp(logalpha)
                    if not np.isfinite(alpha).all() or np.any(alpha <= 0):
                        return fail("Inverse weights are nonfinite or numerically zero")
                    weights[test, arm] = alpha
                    w = alpha[observed]
                    mass = float(w.sum()/len(test))
                    ess = float(w.sum()**2/(w@w))
                    share = float(w.max()/w.sum())
                    diagnostics = dict(n_train_arm=count, n_test_arm=test_count,
                        solver_success=bool(fitted.success) if fitted is not None else True,
                        solver_message=str(fitted.message) if fitted is not None else "intercept-only calibration",
                        iterations=int(fitted.nit) if fitted is not None else 0,
                        objective=objective_value, gradient_max=float(np.max(np.abs(gradient), initial=0.)),
                        training_max_moment_imbalance=max_balance,
                        training_weight_mass=float(np.exp(np.log(len(train))+logsumexp(ba@theta)-lognorm)/len(train)),
                        heldout_weight_mass=mass, heldout_ess=ess,
                        heldout_max_normalized_share=share, heldout_max_inverse_weight=float(w.max()),
                        train_outcome_rmse=float(np.sqrt(np.mean((my+x@coefficients-ya)**2))))
                    info["arms"][str(arm)] = diagnostics
                    check()
                    if (not diagnostics["solver_success"] or diagnostics["gradient_max"] > 1e-5):
                        return fail("Entropy calibration did not converge to the fixed numerical tolerance")
                    if not np.isfinite([ess,share,mass,max_balance]).all():
                        return fail("Nonfinite weight diagnostics")
                    if ess < max(10., .05*test_count) or share > .20 or max_balance > .5:
                        return fail("WEAK_OVERLAP: inverse weights or covariate imbalance exceed the fixed safety limits")
                    if ess < .25*test_count or share > .05 or not .5 <= mass <= 2. or max_balance > .1:
                        warnings.append("Weight diagnostics suggest weak overlap or imperfect balance; the estimate may be unreliable.")
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
