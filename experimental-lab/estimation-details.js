/* Report the estimator that actually ran, with a retained-data reproduction. */
(() => {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const pythonJSON = (value) => "json.loads(" + JSON.stringify(JSON.stringify(value)) + ")";
  const shortNumber = (value) => (Number.isFinite(value) ? Number(value).toPrecision(6) : String(value));
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = element("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function field(list, label, value) {
    if (value === undefined || value === null || value === "") return;
    const kind = list.dataset.method,
      direct = kind !== "legacy";
    const aipw = kind?.startsWith("aipw"),
      bounded = kind === "aipw-v2" || kind === "ipw";
    const outcomeFit = list.dataset.outcomeFit !== "false",
      weightFit = list.dataset.weightFit !== "false";
    const methodTopic = kind === "outcome-regression" ? "outcomeRegression" : kind === "ipw" ? "ipw" : aipw ? "aipw" : "legacy";
    const keys = {
      Status: "status",
      Estimator: methodTopic,
      "Requested method": "estimator",
      "Graph criterion": "criterion",
      "Adjustment variables": "adjustment",
      "AIPW (augmented inverse probability weighting)": methodTopic,
      "Outcome models": direct ? (outcomeFit ? "outcome" : "unused") : "legacyOutcome",
      "Inverse weights": direct ? (weightFit ? "weights" : "unused") : "legacyWeights",
      "Inverse-weight function": bounded ? "link" : "actualSettings",
      "Fitted weight bound": "cap",
      "Cross-fitting": "crossfit",
      "Balance objective": bounded ? "balance" : "actualSettings",
      Score: kind === "outcome-regression" ? "orScore" : kind === "ipw" ? "ipwScore" : "score",
      Folds: direct ? "folds" : "legacyFolds",
      "Fold seed": "seed",
      "Outcome ridge penalty": "ridge",
      "Balance penalty": bounded ? "penalty" : "actualSettings",
      Basis: "basis",
      "Normalization / clipping": weightFit && bounded ? "normalization" : "actualSettings",
      "Covariate feature recipes": "adjustment",
      "Data uncertainty": "uncertainty",
      "Near-bound weights": "saturation",
      "Actual nuisance fits": "fitCalls",
    };
    const title = element("dt", label);
    CausalMethodHelp.add(
      title,
      keys[label] || (/training mass residual/.test(label) ? "mass" : /near-bound fraction/.test(label) ? "saturation" : undefined)
    );
    list.append(title, element("dd", typeof value === "string" ? value : JSON.stringify(value)));
  }
  function legacyReplay(context) {
    const load = {
      nodes: context.nodes,
      edges: context.edges,
      mapping: context.mapping,
      column_types: context.column_types,
      column_codebooks: context.column_codebooks || {},
      data_seed: context.data_seed,
    };
    const query = { nodes: context.nodes, edges: context.edges, ...context.query, ...(context.estimate_options || {}) };
    return `# Install the CausalEngine package from Code & install first.\n# Save Download data beside this script as causalengine-estimate.csv.\nimport csv\nimport json\nfrom causalengine import Editor\n\nwith open("causalengine-estimate.csv", newline="", encoding="utf-8-sig") as f:\n    reader = csv.DictReader(f)\n    columns = reader.fieldnames\n    rows = [[float(row[c]) for c in columns] for row in reader]\neditor = Editor()\nloaded = editor.request("load_data", {**${pythonJSON(
      load
    )}, "columns": columns, "rows": rows})\nquery = ${pythonJSON(
      query
    )}\nresult = editor.request("estimate_data", {**query, "source": "csv", "data_id": loaded["data_id"], "binding_key": loaded["binding_key"]})\nprint(json.dumps(result["data_estimate"], indent=2))\n`;
  }
  function standalone(source, details) {
    const inputs = details.inputs,
      options = details.options;
    const spec = { ...inputs, estimator: options.estimator || "aipw", seed: options.seed, max_seconds: options.max_seconds };
    return (
      source.trimEnd() +
      `\n\n# Reproduce this estimate using the same retained rows, not simulated truth.\n# Save Download data beside this script as causalengine-estimate.csv.\nif __name__ == "__main__":\n    import csv\n    import json\n    import numpy as np\n\n    spec = ${pythonJSON(
        spec
      )}\n    with open("causalengine-estimate.csv", newline="", encoding="utf-8-sig") as f:\n        data = list(csv.DictReader(f))\n    def column(name):\n        return np.asarray([float(row[name]) for row in data], dtype=float)\n    features = []\n    for recipe in spec["covariates"]:\n        recipe = {"column": recipe} if isinstance(recipe, str) else recipe\n        values = column(recipe["column"])\n        features.append((values == recipe["equals"]).astype(float) if "equals" in recipe else values)\n    covariates = np.column_stack(features) if features else np.empty((len(data), 0))\n    result = estimate_balancing_aipw(\n        covariates, column(spec["treatment"]), column(spec["outcome"]),\n        seed=spec["seed"], intervention=spec["intervention"], reference=spec["reference"],\n        max_seconds=spec["max_seconds"], estimator=spec["estimator"],\n    )\n    print(json.dumps(result, indent=2))\n`
    );
  }
  async function actualSource(implementation) {
    const name = implementation.file;
    if (!/^[A-Za-z][A-Za-z0-9_]*\.py$/.test(name)) throw Error("The implementation source is not available.");
    const response = await fetch(new URL(name, location.href), { cache: "no-cache" });
    if (!response.ok) throw Error("Could not load the calculation source. Try again.");
    const source = await response.text();
    if (implementation.sha256) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      const sha = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (sha !== implementation.sha256) throw Error("The calculation source changed. Run the estimate again before copying code.");
    }
    return source;
  }
  function attach(section, estimate, context) {
    const metadata = estimate?.estimation_details;
    const aipw = ["balancing_aipw_v1", "balancing_aipw_v2"].includes(metadata?.method_id);
    const outcomeRegression = metadata?.method_id === "outcome_regression_v1",
      ipw = metadata?.method_id === "balancing_ipw_v1";
    const direct = aipw || outcomeRegression || ipw;
    const fitted = metadata?.nuisance?.used || metadata?.nuisance?.fitted || { outcome: aipw, weights: aipw };
    const method = estimate?.method || "Not available";
    const armMethods = [
      ...new Set(
        Object.values(estimate?.diagnostics?.arms || {})
          .map((arm) => arm.method)
          .filter(Boolean)
      ),
    ];
    const shownMethod = armMethods.length ? method + " — " + armMethods.join(" / ") : method;
    const methodName = element("p", "Estimator: " + shownMethod, "estimator-name");
    CausalMethodHelp.add(
      methodName,
      aipw ? "aipw" : outcomeRegression ? "outcomeRegression" : ipw ? "ipw" : metadata?.method_id ? "legacy" : "estimator"
    );
    section.append(methodName);
    const details = element("details", undefined, "estimation-details");
    details.append(element("summary", "Details"));
    const list = element("dl", undefined, "estimation-facts");
    list.dataset.method = aipw
      ? metadata.method_id === "balancing_aipw_v2"
        ? "aipw-v2"
        : "aipw-v1"
      : outcomeRegression
        ? "outcome-regression"
        : ipw
          ? "ipw"
          : "legacy";
    list.dataset.outcomeFit = String(fitted.outcome);
    list.dataset.weightFit = String(fitted.weights);
    field(list, "Status", estimate?.status || "UNAVAILABLE");
    field(list, "Estimator", method);
    const requestedLabels = {
      aipw: "AIPW",
      outcome_regression: "Outcome Regression (Plug-in)",
      ipw: "IPW",
      legacy_knn: "Graph plug-in (legacy API)",
      auto: "Automatic graph dispatch (API)",
    };
    field(list, "Requested method", requestedLabels[metadata?.requested_method]);
    field(list, "Graph criterion", estimate?.criterion);
    field(list, "Adjustment variables", estimate?.adjustment || metadata?.inputs?.adjustment);
    field(
      list,
      "AIPW (augmented inverse probability weighting)",
      aipw
        ? metadata.fit_performed === false
          ? "Not fitted: the treatment settings are identical."
          : estimate.status === "OK"
            ? "Yes — cross-fitted, with learned inverse weights."
            : "Attempted; no estimate was returned."
        : "No — this result uses the estimator named above."
    );
    if (direct) {
      field(list, "Outcome models", metadata.nuisance?.outcome);
      field(list, "Inverse weights", metadata.nuisance?.weights);
      field(list, "Inverse-weight function", metadata.nuisance?.inverse_weight);
      field(
        list,
        "Fitted weight bound",
        Number.isFinite(metadata.options?.weight_cap) ? "1 to " + metadata.options.weight_cap + " during fitting; no rows are trimmed." : undefined
      );
      field(list, "Cross-fitting", metadata.nuisance?.cross_fitting);
      field(list, "Balance objective", metadata.nuisance?.weight_objective);
      field(list, "Score", metadata.nuisance?.score);
      field(list, "Actual nuisance fits", metadata.fit_calls || metadata.nuisance?.fit_calls);
      field(list, "Folds", metadata.options?.folds);
      field(list, "Fold seed", metadata.options?.seed);
      field(list, "Outcome ridge penalty", metadata.options?.ridge);
      field(list, "Balance penalty", metadata.options?.balance_penalty);
      field(list, "Basis", metadata.options?.basis);
      field(list, "Normalization / clipping", metadata.normalization);
      field(list, "Treatment column", metadata.inputs?.treatment);
      field(list, "Outcome column", metadata.inputs?.outcome);
      field(list, "Covariate feature recipes", metadata.inputs?.covariates?.length);
    } else {
      field(list, "Outcome models", metadata?.nuisance?.outcome);
      field(list, "Inverse weights", metadata?.nuisance?.weights);
      field(list, "Fold seed", metadata?.options?.seed);
      const arms = estimate?.diagnostics?.arms;
      if (arms) for (const [name, arm] of Object.entries(arms)) field(list, name + " fit", arm.method);
      field(list, "Folds", estimate?.diagnostics?.folds);
      field(list, "Data uncertainty", estimate?.diagnostics?.data_uncertainty);
    }
    if (estimate?.reason) field(list, "Reason", estimate.reason);
    details.append(list);
    const documentLink = element("a", "Full methods documentation");
    documentLink.href = "./methods.html#" + (direct ? "score" : "dispatch");
    documentLink.target = "_blank";
    documentLink.rel = "noopener";
    const documentRow = element("p");
    documentRow.append(documentLink);
    details.append(documentRow);
    const diagnostics = metadata || estimate?.diagnostics ? { estimator: metadata, diagnostics: estimate?.diagnostics } : null;
    if (diagnostics) {
      const more = element("details");
      more.append(element("summary", outcomeRegression ? "Outcome fit diagnostics" : "Fit, balance & overlap diagnostics"));
      if (direct && fitted.weights && Number.isFinite(metadata.options?.weight_cap)) {
        const fit = element("dl", undefined, "estimation-facts");
        fit.dataset.method = list.dataset.method;
        fit.dataset.outcomeFit = list.dataset.outcomeFit;
        fit.dataset.weightFit = list.dataset.weightFit;
        field(
          fit,
          "Near-bound weights",
          "Fraction in the observed treatment arm with α ≥ 0.99 × " +
            metadata.options.weight_cap +
            "; training and held-out rows are evaluated separately."
        );
        for (const [index, fold] of (estimate?.diagnostics?.fold_details || []).entries()) {
          for (const [arm, values] of Object.entries(fold.arms || {})) {
            const label = "Fold " + (index + 1) + ", arm " + arm;
            field(fit, label + " training mass residual", values.training_mass_residual);
            field(fit, label + " training near-bound fraction", values.cap_saturation_fraction_train_arm);
            field(fit, label + " held-out near-bound fraction", values.cap_saturation_fraction_heldout_arm);
          }
        }
        more.append(fit);
      }
      more.append(element("pre", JSON.stringify(diagnostics, null, 2), "estimation-code"));
      const diagnosticHeading = element("div", undefined, "method-help-heading");
      diagnosticHeading.append(more);
      CausalMethodHelp.add(diagnosticHeading, outcomeRegression ? "outcomeDiagnostics" : "diagnostics");
      details.append(diagnosticHeading);
    }
    for (const note of metadata?.limitations || []) details.append(element("p", note));
    if (context?.csv) {
      const panel = element("details", undefined, "calculation-code");
      panel.append(element("summary", "Calculation code"));
      panel.append(
        element(
          "p",
          direct
            ? "The implementation below is the code used by this estimate. Run it with the retained data; the model reference is not an input. Requires NumPy and SciPy."
            : "The replay uses the retained data and the installed CausalEngine package. The actual implementation source is available below."
        )
      );
      CausalMethodHelp.add(panel.querySelector("p"), "reproduce");
      const actions = element("div", undefined, "calculation-actions");
      const data = element("button", "Download data");
      data.type = "button";
      data.onclick = () => download(context.csv, "causalengine-estimate.csv", "text/csv;charset=utf-8");
      const copy = element("button", "Copy code");
      copy.type = "button";
      copy.disabled = true;
      const save = element("button", "Download .py");
      save.type = "button";
      save.disabled = true;
      actions.append(data, copy, save);
      panel.append(actions);
      const status = element("p", "Open to load the calculation source.", "calculation-status");
      const code = element("pre", "", "estimation-code");
      code.tabIndex = 0;
      panel.append(status, code);
      let script = "",
        started = false;
      panel.addEventListener("toggle", async () => {
        if (!panel.open || started) return;
        started = true;
        status.textContent = "Loading calculation source…";
        try {
          const implementation = metadata?.implementation || { file: "editor_engine.py" };
          const source = await actualSource(implementation);
          if (direct) script = standalone(source, metadata);
          else {
            script = legacyReplay(context);
            const impl = element("details");
            impl.append(element("summary", "Actual implementation: " + implementation.file));
            impl.append(element("pre", source, "estimation-code"));
            panel.append(impl);
          }
          code.textContent = script;
          copy.disabled = false;
          save.disabled = false;
          status.textContent = "Save Download data as causalengine-estimate.csv beside the script.";
        } catch (error) {
          started = false;
          status.textContent = error.message;
        }
      });
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(script);
          status.textContent = "Code copied.";
        } catch {
          const selection = getSelection(),
            range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          status.textContent = "Code selected. Press Ctrl+C or ⌘C to copy.";
        }
      };
      save.onclick = () => download(script, "reproduce_estimate.py", "text/x-python;charset=utf-8");
      details.append(panel);
    }
    section.append(details);
  }
  window.CausalEstimationDetails = { attach };
})();
