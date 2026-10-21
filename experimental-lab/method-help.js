/* Contextual explanations only. Estimation and data state are never modified. */
(() => {
  const topics = {
    estimator: [
      "Estimator",
      "Automatic uses balancing AIPW for eligible binary-treatment baseline questions. Other questions keep their supported graph estimator. Graph plug-in (legacy) explicitly selects the earlier estimator. The method reported with the result is the one that actually ran.",
      "dispatch",
    ],
    aipw: [
      "Balancing AIPW",
      "A nuisance is a supporting prediction or weight function used to estimate the requested effect. AIPW combines separate outcome predictions and learned inverse weights with an observed-outcome correction on held-out rows. Its fixed fitted class can still leave bias.",
      "score",
    ],
    legacy: [
      "Graph plug-in estimator",
      "This is not AIPW. Baseline adjustment uses two-fold kNN outcome prediction. Other supported graphs can use a two-fold normalized-kNN conditional-kernel plug-in. The result and its Details name the actual branch and fitted components.",
      "legacy",
    ],
    status: [
      "Result status",
      "OK means this computation returned an estimate under its supported graph and numerical checks. It does not certify the causal assumptions or accuracy. An unavailable result has its actual reason in Details.",
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
      "The legacy branch does not fit the bounded inverse-weight nuisance used by AIPW. Its actual prediction or conditional-kernel weighting is reported in the method-specific metadata.",
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
      "Two treatment-stratified folds are used. Learned preprocessing, outcome models and inverse-weight functions are fitted on one fold, then evaluated on the other. Each row contributes one held-out augmented score.",
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
      "This value describes the implementation that returned this result. Read its recorded settings and SHA-checked calculation source; the current Methods page documents the current bounded-calibration version.",
      "reproduce",
    ],
    seed: [
      "Fold seed",
      "This is the actual deterministic seed used for the estimator's fold split. Reproduction uses this seed with the retained CSV and exact column recipes; it does not regenerate a simulated model.",
      "cross-fitting",
    ],
    score: [
      "Augmented score",
      "The held-out score combines the difference in arm-specific outcome predictions with inverse-weighted residual corrections for observed outcomes. The raw scores are averaged across all retained rows, without held-out weight renormalization.",
      "score",
    ],
    normalization: [
      "Mass and normalization",
      "An unpenalized calibration intercept learns training arm weight mass up to solver tolerance. There is no post-hoc weight normalization, clipping or row trimming. The estimate uses the raw held-out augmented-score average.",
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
      "Download data retains the same selected rows. The balancing-AIPW script contains the actual SHA-checked numerical implementation, original column recipes, treatment comparison and fold seed. Model reference values are not fitting inputs.",
      "reproduce",
    ],
    modelReference: [
      "Model reference",
      "A model reference compares population means in the fixed simulated model. It is separate from the estimate fitted to generated rows and is not a training input. It is computed only where supported; its label distinguishes exact and Monte Carlo evaluation.",
      "reference",
    ],
    exactReference: [
      "Exact model reference",
      "This is the population mean contrast in the fixed simulated model, computed analytically where supported. It is separate from the estimate fitted to generated rows and is never a nuisance-training input.",
      "reference",
    ],
    mcReference: [
      "Monte Carlo model reference",
      "This approximates the population contrast in the fixed simulated model using simulation draws. Its Monte Carlo standard error describes numerical simulation error, not uncertainty in the observed-data estimate.",
      "reference",
    ],
    benchmark: [
      "Benchmark ground truth",
      "For supported releases, this is the mean of supplied expected treatment effects across the released rows for the matched treatment comparison. It is not a population ATE or a mean of noisy realized differences. LaLonde has no supplied paired truth.",
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
