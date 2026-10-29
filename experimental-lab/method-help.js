/* Contextual explanations only. Estimation and data state are never modified. */
(() => {
  const topics = {
    conditionalOR: [
      "Row-specific conditional means",
      "Conditioning on names C evaluates E[Y | do(A=a), C=C_i] at each original row’s observed C_i. ATE subtracts the two arm-specific conditional means at the same C_i. A do-calculus Rule 2 certificate permits direct XGBoost Y~A,C; otherwise a certified joint interventional distribution is sampled with existing kernels and projected to Y~C. All learned stages use outer-training data only. Identical conditioning values in different held-out folds can have slightly different predictions because each fold uses a different fitted model. Synthetic draws are integration data, not more observations. Per-arm unsupported rows remain unavailable. No AIPW/IPW or confidence interval is claimed.",
      "conditioning",
    ],
    empiricalNoFit: [
      "Observed data without a relevant intervention",
      "No relevant intervention remains for this outcome. APO is the direct observed sample mean; ATE subtracts identical observed means and is exactly zero. No outcome model, propensity, inverse weights, cross-fitting or nearest-neighbor estimator is fitted. No sampling confidence interval is reported.",
      "continuous-or",
    ],
    randomGeneration: [
      "Random generation settings",
      "These settings produced the retained rows. Treatment dimension 1–4 generates a binary scalar or ordered tuple. Linear outcome uses an affine parent function plus noise. Binary outcome generates 0/1 with a logistic-threshold mechanism. Neural Outcome uses a fixed dense neural-network parent function plus noise; the model seed draws its layers, activation and weights once. Each choice selects normal noise. Vector mechanisms can mix noise, so member independence is not assumed. Changing generation settings requires Generate Data; changing only the query reuses the same rows.",
      "data",
    ],
    estimand: [
      "Query",
      "APO is the interventional mean E[Y(a)] for one complete treatment assignment. ATE is E[Y(a)] − E[Y(a₀)] for two assignments, evaluated on the same retained rows. APO does not define or subtract a reference assignment. Its outcome fits use only the requested assignment; propensity IPW still trains on all observed joint classes.",
      "score",
    ],
    jointTreatment: [
      "Joint treatment assignment",
      "A treatment cluster is one ordered tuple. For A(a1, a2), choose a value for each member in that order. Propensity IPW fits the probability of the whole observed tuple, never a product of separate marginal probabilities. The logical causal graph is unchanged.",
      "data",
    ],
    propensityIPW: [
      "IPW with XGBoost propensity",
      "IPW fits an actual XGBoost classifier of the whole treatment assignment from the verified adjustment coordinates. It uses held-out probabilities to form inverse weights, with no outcome regression or fitted balancing function. For vector treatment the classes are ordered joint tuples.",
      "ipw",
    ],
    propensity: [
      "Joint propensity model",
      "The propensity is the fitted probability of the entire treatment tuple conditional on the actual adjustment coordinates. One XGBoost classifier is fitted per outer training fold. The inverse is evaluated without clipping, stabilization or held-out renormalization; fitted probabilities do not establish true positivity.",
      "ipw",
    ],
    propensityParameters: [
      "Classifier settings",
      "The actual fit records binary:logistic for two classes or multi:softprob for more classes, the joint class map, seed and fixed tree settings. Binary fits start from the training class-1 proportion. Multiclass fits use log training-class proportions as base margins on both training and prediction rows, overriding the common base score. Initialization uses only outer-training treatment labels, never held-out labels, outcomes or ground truth. It never multiplies separately fitted marginal propensities.",
      "ipw",
    ],
    probabilityGuard: [
      "Low-probability warning threshold",
      "A small positive requested probability produces a warning, not a sample-size rejection. It is used without clipping or held-out normalization. A zero or nonfinite denominator, an unobserved requested assignment, or a failed fit can prevent computation; the result then states the actual reason. Fitted probabilities do not establish true positivity.",
      "diagnostics",
    ],
    propensityScore: [
      "IPW score",
      "APO averages I(A=a)Y / p̂(a|C) over the total retained row count. ATE subtracts the reference-assignment score. There is no outcome model, residual correction or division by a held-out weight sum.",
      "score",
    ],
    propensityNormalization: [
      "Raw inverse probability weights",
      "The estimator uses raw inverse joint probabilities. It does not clip or stabilize probabilities, multiply marginal probabilities, normalize held-out weights, or trim rows. Small positive probabilities and concentrated weights produce warnings; a zero or nonfinite denominator prevents a finite estimate.",
      "ipw",
    ],
    propensityDiagnostics: [
      "Propensity diagnostics",
      "The actual classifier settings, ordered class map, held-out requested probabilities and inverse-weight concentration are reported. They diagnose numerical support and concentration, not causal positivity or observed-data confidence intervals.",
      "diagnostics",
    ],
    estimator: [
      "Estimator",
      "For eligible binary-treatment baseline questions, choose AIPW, Outcome Regression (Plug-in), or IPW. Continuous scalar treatments support explicit Outcome Regression with a verified adjustment witness; continuous AIPW/IPW are unavailable. These choices never silently substitute a different method. Other graph-specific queries report their actual computation or reason.",
      "dispatch",
    ],
    continuousOR: [
      "Continuous Outcome Regression",
      "Two-fold XGBoost learns the outcome mean conditional on the continuous treatment and verified adjustment variables. It predicts at the requested treatment value on held-out covariates, then averages over the retained cohort. The two requested means are contrasted for ATE. No treatment discretization, density/inverse weights, residual correction, general-ID fallback or confidence interval is used. Local smoothness and conditional support near the requested value remain assumptions; range diagnostics cannot prove them.",
      "continuous-or",
    ],
    minimumAIPW: [
      "AIPW",
      "A nuisance is a supporting fitted function. AIPW combines arm-specific XGBoost outcome predictions with learned weights and held-out residual corrections. The weights minimize their training second moment subject to mass and fitted-outcome mean constraints. Balancing one prediction does not establish correct causal assumptions or unconditional double robustness.",
      "score",
    ],
    xgboostOR: [
      "Outcome Regression (Plug-in)",
      "Each treatment arm fits an actual XGBoost outcome model using training rows only. For APO the requested-arm predictions are averaged; ATE subtracts the reference-arm predictions on the same held-out rows. This estimator fits no weights and applies no residual correction; prediction error or extrapolation can leave bias.",
      "outcome-regression",
    ],
    minimumIPW: [
      "IPW",
      "This estimator fits XGBoost outcome predictions to define its training balance constraints, then learns minimum-second-moment positive weights. Its final score averages weighted observed outcomes only, without the AIPW residual correction. Only the scalar fitted-outcome mean is constrained, not all covariate moments.",
      "ipw",
    ],
    xgboostOutcome: [
      "XGBoost outcome models",
      "Each arm uses XGBoost 2.1.4 to predict its outcome from the actual verified adjustment coordinates. A model is fitted on that arm's outer-training rows, then predicts the training cohort and held-out rows. The current AIPW needs these predictions for its weight constraints; propensity-based IPW fits no outcome model. Held-out outcomes and ground truth are never fitting inputs.",
      "outcome",
    ],
    xgboostParameters: [
      "XGBoost parameters",
      "The fixed implementation uses 64 boosting rounds, depth 3, learning rate 0.05, histogram trees, one thread, L2 regularization 1 and minimum child weight 5, with full row/column sampling. Each fit records its actual seed and base score in the diagnostics. The settings are fixed, without held-out tuning.",
      "outcome",
    ],
    xgboostBasis: [
      "Regression coordinates",
      "The XGBoost models receive the original verified adjustment-witness coordinates, including all recorded categorical indicator recipes. They do not use the former linear/squared or tanh/RBF dictionaries. For an empty feature set, the implementation explicitly supplies one constant-zero coordinate.",
      "basis",
    ],
    minimumWeights: [
      "Minimum-second-moment weights",
      "For each arm, the weights minimize the empirical sum of squared training weights, with a positive floor, subject to exact training mass and the arm-model's scalar fitted-outcome mean matching its mean over the full training cohort. No separate propensity-probability model is fitted. Raw covariate imbalance remains diagnostic.",
      "weights",
    ],
    minimumLink: [
      "Fitted weight function",
      "The training-fitted dual coefficients define a positive affine function of the standardized outcome prediction, lower-bounded by 1e-8. Training prediction scaling and duals are reused on held-out rows. There is no upper weight cap or conversion from a density ratio by arm prevalence.",
      "weights",
    ],
    minimumBalance: [
      "Balance constraints and objective",
      "The objective minimizes the training second moment of arm weights. The empirical arm-weight mass divided by the full training count equals one; the weighted arm prediction mean equals the full training-cohort prediction mean, within the reported tolerance. This balances one fitted prediction, not every covariate or arbitrary function.",
      "weights",
    ],
    muBalance: [
      "Fitted-outcome balance diagnostics",
      "The target and scaling come from the arm model's predictions over the outer-training cohort. Mass and standardized fitted-outcome equality residuals must meet the fixed 1e-8 tolerance. The raw residual is in outcome units. Duals, objective and reported KKT residual describe that implemented fit; they do not certify population balance or positivity.",
      "diagnostics",
    ],
    weightFloor: [
      "Positive weight floor",
      "Weights are constrained to be at least 1e-8 inside the fitted optimization problem. The floor fraction reports how many evaluated arm weights are at that lower bound. There is no upper cap, post-hoc normalization or row trimming; a positive floor does not establish positivity of treatment probabilities.",
      "weights",
    ],
    minimumNormalization: [
      "Training mass and held-out score",
      "Training arm mass is an equality constraint, not a post-hoc rescaling step. The fitted weight function is evaluated on held-out rows without renormalizing their weights. The effect score is averaged over the total retained row count, rather than a held-out weight sum.",
      "weights",
    ],
    minimumIPWScore: [
      "IPW score",
      "For each held-out row, use its observed-arm weight times the outcome, with the treatment/reference signs. Average over the total retained count. XGBoost predictions enter the weight fit's balance constraints, but no predicted-outcome difference or residual correction is added to this IPW score.",
      "score",
    ],
    xgboostGraph: [
      "Graph plug-in estimator",
      "This supported graph branch uses actual XGBoost for conditional outcome means. Nonterminal conditional row-drawing kernels still use normalized nearest-neighbor sampling, and unconditional averages use empirical rows. These are different components; the sampling kernels are not a replacement regression or AIPW correction. Details records the actual branch and fit parameters.",
      "uca",
    ],
    aipw: [
      "Balancing AIPW",
      "A nuisance is a supporting prediction or weight function used to estimate the requested effect. AIPW combines separate outcome predictions and learned inverse weights with an observed-outcome correction on held-out rows. Its fixed fitted class can still leave bias.",
      "score",
    ],
    outcomeRegression: [
      "Outcome Regression (Plug-in)",
      "This fits a separate ridge outcome model for each treatment arm on training rows, then averages their predicted difference on held-out rows. It fits no inverse weights and uses no residual correction. A wrong outcome model can leave bias.",
      "outcome",
    ],
    ipw: [
      "IPW",
      "Inverse probability weighting uses UCA-style quadratic balancing to learn a covariate-only density-ratio function, then converts it to inverse weights using training-arm normalization and prevalence. It fits no outcome regression. Raw held-out weighted outcomes are averaged over all rows; fixed features, regularization and ratio projection can leave bias.",
      "weights",
    ],
    ucaWeights: [
      "UCA-style IPW weights",
      "Each arm fits a nonnegative quadratic density-ratio model from the verified adjustment features only. Its raw predictions are projected to [0.01, 50], divided by their training-arm mean, and divided by the training-arm prevalence. No outcome regression or outcome values enter this weight fit.",
      "ipw",
    ],
    ucaLink: [
      "Inverse-weight function",
      "The inverse weight is the projected raw ratio divided by its training-arm mean and training-arm prevalence. The raw-ratio interval [0.01, 50] is not the interval of the final inverse weights; Details records their actual bounds.",
      "ipw",
    ],
    ucaProjection: [
      "Raw ratio projection",
      "The raw density-ratio prediction is projected to [0.01, 50] before training-arm normalization. Final inverse weights have different bounds because the ratio is divided by the training normalizer and arm prevalence. No rows are trimmed.",
      "ipw",
    ],
    ucaBasis: [
      "UCA-style feature dictionary",
      "This covariate-only dictionary uses training-standardized tanh features, their positive/complement and squared components, and a training-derived RBF dictionary. The configured center budget is 24; exp(-mean-squared-distance / 0.35) uses 0.35 as its distance denominator, not a Gaussian standard deviation. The separate diagnostic basis is linear features and coordinatewise squares.",
      "ipw",
    ],
    ucaBalance: [
      "Quadratic balancing objective",
      "The arm-specific ratio coefficients minimize the implemented quadratic calibration loss with nonnegative coefficients and a fixed ridge penalty. The fit uses training covariates only. This is a one-stage covariate-only adaptation of the UCA weight-fitting idea, not the general graph UCA estimator.",
      "ipw",
    ],
    ucaPenalty: [
      "Ratio ridge penalty",
      "IPW uses a fixed 0.002 ridge penalty in its nonnegative quadratic ratio fit. AIPW retains its separate bounded-logistic calibration with penalty 0.01. Neither fixed penalty guarantees exact balance or an unbiased effect estimate.",
      "ipw",
    ],
    ucaNormalization: [
      "Training ratio normalization",
      "After raw-ratio projection, the ratio is normalized by its mean over the observed training arm and divided by that arm's training prevalence. Held-out weights are not renormalized. The final IPW estimate divides by the total row count, not the held-out weight sum.",
      "ipw",
    ],
    unused: [
      "Not fitted",
      "This selected estimator does not fit or use this nuisance function. The actual nuisance-fit counts and recorded method identify what was computed.",
      "dispatch",
    ],
    fitCalls: [
      "Actual nuisance fits",
      "The counts record calls actually performed. A two-fold ATE AIPW run fits four outcome models and four balancing functions; APO fits two of each. Outcome Regression fits only the corresponding outcome models. Current IPW fits two whole-treatment XGBoost classifiers, no outcome model or balancing function. Failures or identical ATE regimes can use fewer.",
      "diagnostics",
    ],
    orScore: [
      "Outcome-regression score",
      "For APO average the requested-arm prediction over all retained held-out rows. For ATE subtract the reference-arm prediction before averaging. No fitted weights or observed-outcome residual correction are used.",
      "score",
    ],
    ipwScore: [
      "IPW score",
      "For each held-out row, take the observed treatment-arm weighted outcome minus the observed reference-arm weighted outcome. Average these scores over the total retained row count, not the held-out weight sum. No outcome model is fitted.",
      "score",
    ],
    outcomeDiagnostics: [
      "Outcome-fit diagnostics",
      "These diagnostics describe the outcome regressions that actually ran, including training RMSE and training/held-out arm counts where returned. This estimator fits no inverse weights, so weight balance, bound saturation and weight effective sample size are not its fitted diagnostics.",
      "diagnostics",
    ],
    legacy: [
      "Graph plug-in estimator",
      "This is not AIPW. Baseline adjustment uses two-fold kNN outcome prediction. Other supported graphs can use a two-fold normalized-kNN conditional-kernel plug-in. The result and its Details name the actual branch and fitted components.",
      "legacy",
    ],
    status: [
      "Result status",
      "OK means this computation returned a finite estimate. Small samples or unstable weights can still produce warnings beside the number. This does not certify the causal assumptions or accuracy. If computation fails, its actual reason appears on the result card and in Details.",
      "diagnostics",
    ],
    estimateWarnings: [
      "Estimate warnings",
      "These messages report small training or held-out groups, small positive probabilities, or concentrated weights. Their reference thresholds are diagnostic guidance, not minimum sample-size requirements. A finite result stays visible; warnings do not certify its accuracy, positivity, or a confidence interval. Details records the actual counts and diagnostics.",
      "diagnostics",
    ],
    computationFailure: [
      "Why no estimate was computed",
      "The result shows the actual computation failure, such as a requested assignment with no observed rows, an empty training group, a zero or nonfinite denominator, or a fit that did not complete. This differs from a small-sample warning and does not by itself prove that the causal effect is unidentifiable.",
      "diagnostics",
    ],
    criterion: [
      "Graph criterion",
      "This is the criterion certified for the supplied graph. The graph represents your causal assumptions; the computation does not establish that those assumptions hold in the real world.",
      "dispatch",
    ],
    adjustment: [
      "Adjustment variables",
      "These are the actual verified adjustment variables used for this result. Every selected vector member and its recorded feature recipe is retained. Variables outside the witness are not silently added.",
      "data",
    ],
    outcome: [
      "Outcome models",
      "A nuisance is a supporting fitted function. Here, each treatment arm has its own ridge regression predicting the outcome from the actual adjustment features. The intercept is unpenalized. Models are fitted on training rows only.",
      "outcome",
    ],
    legacyOutcome: [
      "Legacy outcome models",
      "Baseline adjustment predicts each treatment-arm outcome using two-fold kNN g-computation. A general graph plug-in can instead evaluate conditional kernels. These components have no AIPW residual correction; see the actual method and arm fits.",
      "legacy",
    ],
    weights: [
      "Inverse-weight nuisance",
      "The two arm-specific functions are learned directly to calibrate each observed arm toward the full training cohort. No separate propensity-probability model is fitted, and the two functions need not define one coherent probability model.",
      "weights",
    ],
    legacyWeights: [
      "Legacy weights",
      "This graph branch does not fit the baseline balancing-weight nuisances. Conditional row-drawing kernels and fitted conditional means are separate components, reported in the actual method-specific metadata.",
      "legacy",
    ],
    link: [
      "Inverse-weight function",
      "The fitted function is 1 + 19 × expit(intercept + basis × slopes), so its values stay between 1 and 20. This constrains the fitted class itself; rows are not trimmed and weights are not clipped after fitting.",
      "weights",
    ],
    cap: [
      "Fitted weight bound",
      "The inverse-weight class has bounds 1 and 20 during fitting. This stabilizes learning but can leave bias when the needed inverse weights are outside that class. It is not a proof of positivity.",
      "weights",
    ],
    basis: [
      "Feature basis",
      "Actual adjustment coordinates and any recorded categorical indicator recipes are standardized on the training fold. Coordinatewise squares are added and the combined basis is centered and scaled on that fold. Held-out rows use those learned transformations.",
      "basis",
    ],
    ridge: [
      "Outcome ridge penalty",
      "The outcome regression minimizes training mean squared error plus a 0.001 penalty on squared slope coefficients. Its intercept is not penalized. The finite basis and fixed penalty can leave outcome-prediction error.",
      "outcome",
    ],
    penalty: [
      "Balance penalty",
      "The calibration objective penalizes squared slope coefficients with fixed strength 0.01. Its intercept is unpenalized and learns training arm mass. The penalty allows approximate rather than exact balance.",
      "weights",
    ],
    balance: [
      "Calibration objective",
      "Each arm fits a convex bounded-calibration loss on training rows. The unpenalized intercept fits arm mass; the slope terms target cohort feature moments with a fixed regularization penalty. The full implemented objective is in Methods.",
      "weights",
    ],
    crossfit: [
      "Cross-fitting",
      "Two treatment-stratified folds are used. Learned preprocessing and the nuisance functions required by the selected estimator are fitted on one fold, then evaluated on the other. Each row contributes one held-out score.",
      "cross-fitting",
    ],
    folds: [
      "Folds",
      "The data are split into two treatment-stratified groups. Each group is evaluated using nuisance functions learned from the other group. The final estimate averages the held-out scores across all retained rows.",
      "cross-fitting",
    ],
    legacyFolds: [
      "Legacy folds",
      "The legacy graph plug-in routines use a seeded random-permutation split into two unstratified folds. Held-out rows use outcome predictions or conditional kernels learned from the other fold. These routines do not apply the AIPW residual correction.",
      "legacy",
    ],
    actualSettings: [
      "Actual implementation settings",
      "This value describes the implementation that returned this result. Read its recorded settings and SHA-checked calculation source; the current Methods page documents the current estimator implementations.",
      "reproduce",
    ],
    seed: [
      "Fold seed",
      "This is the actual deterministic seed used for the estimator's fold split. Reproduction uses this seed with the retained CSV and exact column recipes; it does not regenerate a simulated model.",
      "cross-fitting",
    ],
    score: [
      "Augmented score",
      "For APO the held-out score is the requested-arm prediction plus its inverse-weighted observed-arm residual. ATE subtracts the corresponding reference-arm score. The raw scores are averaged across all retained rows, without held-out weight renormalization.",
      "score",
    ],
    normalization: [
      "Mass and normalization",
      "An unpenalized calibration intercept learns training arm weight mass up to solver tolerance. There is no post-hoc weight normalization, clipping or row trimming. The selected weighted estimator uses the raw held-out score average.",
      "weights",
    ],
    diagnostics: [
      "Fit, balance and overlap diagnostics",
      "Solver status, weight concentration, effective sample size, moment imbalance, arm mass and bound saturation are engineering diagnostics. They can reveal instability; they do not establish positivity, certify accuracy, or supply an observed-data confidence interval.",
      "diagnostics",
    ],
    saturation: [
      "Near-bound fraction",
      "This is the fraction of evaluated observed-arm weights at least 0.99 times the upper bound. Training and held-out fractions are separate. A small fraction alone does not establish adequate overlap.",
      "diagnostics",
    ],
    mass: [
      "Training mass residual",
      "This records how far the fitted observed-arm training weight mass is from its cohort target, using the implementation's normalization. It measures calibration fit, not causal validity or effect-estimation uncertainty.",
      "diagnostics",
    ],
    uncertainty: [
      "Observed-data uncertainty",
      "The app does not currently estimate a standard error or confidence interval for this observed-data estimate. Monte Carlo standard error, when shown, belongs only to the simulated-model reference.",
      "diagnostics",
    ],
    reproduce: [
      "Reproduce this calculation",
      "Download data retains the same selected rows. The script contains the actual SHA-checked numerical implementation, selected estimator, original column recipes, treatment comparison and fold seed. Model reference values are not fitting inputs.",
      "reproduce",
    ],
    modelReference: [
      "Model reference",
      "A model reference evaluates an interventional mean (APO) or mean contrast (ATE) in the fixed simulated model. It is separate from the estimate fitted to generated rows and is not a training input. It is computed only where supported; its label distinguishes exact and Monte Carlo evaluation.",
      "reference",
    ],
    exactReference: [
      "Exact model reference",
      "This is the interventional mean (APO) or mean contrast (ATE) in the fixed simulated model, computed analytically where supported. It is separate from the estimate fitted to generated rows and is never a nuisance-training input.",
      "reference",
    ],
    mcReference: [
      "Monte Carlo model reference",
      "This approximates the interventional mean (APO) or mean contrast (ATE) in the fixed simulated model using simulation draws. Its Monte Carlo standard error describes numerical simulation error, not uncertainty in the observed-data estimate.",
      "reference",
    ],
    benchmark: [
      "Benchmark ground truth",
      "For supported releases, this is the released-row mean of supplied expected outcomes (APO), or expected treatment effects (ATE), for the matched query. It is not a population ATE or a mean of noisy realized differences. LaLonde has no supplied paired truth.",
      "benchmark",
    ],
  };
  const popup = document.createElement("div");
  popup.id = "method-help-tooltip";
  popup.className = "method-tooltip";
  popup.setAttribute("role", "tooltip");
  popup.hidden = true;
  document.body.append(popup);
  let active = null,
    pinned = false,
    inside = false,
    timer;
  function close() {
    clearTimeout(timer);
    if (active) {
      active.setAttribute("aria-expanded", "false");
      active.removeAttribute("aria-describedby");
    }
    popup.hidden = true;
    active = null;
    pinned = false;
    inside = false;
  }
  function place() {
    if (!active || popup.hidden) return;
    const rect = active.getBoundingClientRect();
    if (!rect.width || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
      close();
      return;
    }
    const width = Math.min(340, innerWidth - 24);
    popup.style.width = width + "px";
    popup.style.maxHeight = Math.max(48, innerHeight - 24) + "px";
    const height = popup.getBoundingClientRect().height;
    const below = innerHeight - rect.bottom - 8,
      above = rect.top - 8;
    const top = below < height && above > below ? rect.top - height - 8 : rect.bottom + 8;
    popup.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + "px";
    popup.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + "px";
  }
  function show(button, pin = false) {
    clearTimeout(timer);
    if (active !== button) close();
    active = button;
    pinned = pin || pinned;
    popup.textContent = topics[button.dataset.methodHelp][1];
    popup.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-describedby", popup.id);
    place();
  }
  function scheduleClose() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pinned && !inside && document.activeElement !== active) close();
    }, 160);
  }
  function add(node, key) {
    if (!node || !topics[key]) return;
    if (node.querySelector?.(":scope > .method-help")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "method-help";
    button.textContent = "?";
    button.dataset.methodHelp = key;
    button.setAttribute("aria-label", "Help: " + topics[key][0]);
    button.setAttribute("aria-controls", popup.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") show(button);
    });
    button.addEventListener("pointerleave", scheduleClose);
    button.addEventListener("focus", () => show(button));
    button.addEventListener("blur", () => {
      if (active === button) close();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (active === button && pinned) close();
      else show(button, true);
    });
    node.append(button);
    return button;
  }
  popup.addEventListener("pointerenter", () => {
    inside = true;
    clearTimeout(timer);
  });
  popup.addEventListener("pointerleave", () => {
    inside = false;
    scheduleClose();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) {
      event.preventDefault();
      close();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (active && !active.contains(event.target) && !popup.contains(event.target)) close();
  });
  document.addEventListener("scroll", place, true);
  addEventListener("resize", place);
  window.CausalMethodHelp = { add, topics, close };
  add(document.getElementById("estimation-method-help"), "estimator");
})();
