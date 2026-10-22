/* Anchored, browser-local benchmark selection and estimation. */
(() => {
  const $ = (id) => document.getElementById(id),
    root = new URL("benchmarks/", location.href),
    trigger = $("benchmark-select"),
    list = $("benchmark-list");
  let datasets = [],
    generation = 0,
    selected = null,
    loading = false,
    active = 0;
  trigger.value = "";
  function close() {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }
  function highlight() {
    [...list.children].forEach((option, i) => (option.dataset.active = String(i === active)));
    if (list.children[active]) {
      trigger.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    }
  }
  function open() {
    if (trigger.disabled || !datasets.length) return;
    active = Math.max(
      0,
      datasets.findIndex((d) => d.id === selected?.id)
    );
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    highlight();
  }
  function busy(value) {
    loading = value;
    if (value) close();
    trigger.disabled = value;
    list.inert = value;
    for (const id of ["benchmark-download", "benchmark-estimate"]) $(id).disabled = value || !selected;
  }
  window.CausalBenchmarkUI = {
    lock(value) {
      if (value) close();
      list.inert = value || loading;
    },
    async estimateSelected() {
      if (loading) return;
      if (!selected) {
        $("benchmark-status").textContent = "Choose a dataset to estimate.";
        trigger.focus();
        open();
        return;
      }
      return action(true);
    },
  };
  function choose(id) {
    window.causalEngineEnterBenchmark?.();
    ++generation;
    if (selected?.id !== id) {
      CausalDataPreview.clear();
      window.causalEngineClearBinding?.();
      window.causalEngineDataResults = null;
      window.causalEngineDataSource = null;
    }
    selected = datasets.find((d) => d.id === id) || null;
    trigger.value = selected?.id || "";
    $("benchmark-value").textContent = selected?.label || "Choose dataset…";
    [...list.children].forEach((option) => option.setAttribute("aria-selected", String(option.dataset.id === selected?.id)));
    info(selected);
    $("benchmark-assumption").hidden = true;
    $("benchmark-status").textContent = "";
    $("easy-result").hidden = true;
    $("easy-progress").textContent = "";
    close();
    busy(false);
    trigger.focus();
  }
  function options() {
    list.replaceChildren(
      ...datasets.map((d, i) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = "benchmark-option-" + d.id;
        option.dataset.id = d.id;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(d.id === selected?.id));
        option.tabIndex = -1;
        option.textContent = d.label;
        option.onclick = () => choose(d.id);
        option.onpointermove = () => {
          active = i;
          highlight();
        };
        return option;
      })
    );
  }
  trigger.onclick = () => (list.hidden ? open() : close());
  trigger.onkeydown = (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) {
        open();
        if (event.key === "Home") active = 0;
        if (event.key === "End") active = datasets.length - 1;
      } else if (event.key === "Home") active = 0;
      else if (event.key === "End") active = datasets.length - 1;
      else active = (active + (event.key === "ArrowDown" ? 1 : -1) + datasets.length) % datasets.length;
      highlight();
    } else if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) open();
      else if (datasets[active]) choose(datasets[active].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") close();
  };
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".benchmark-picker")) close();
  });
  function info(dataset) {
    const box = $("benchmark-info");
    box.replaceChildren();
    if (!dataset) return;
    const overview = document.createElement("p");
    overview.textContent =
      dataset.rows.toLocaleString() +
      " rows · " +
      dataset.covariates.length +
      " covariates · Treatment: " +
      dataset.treatment +
      " · Outcome: " +
      dataset.outcome;
    box.append(overview);
    const details = document.createElement("details"),
      summary = document.createElement("summary");
    summary.textContent = "Dataset details";
    details.append(summary);
    for (const text of [dataset.source_versions, ...(dataset.notes || []), "Covariates: " + dataset.covariates.join(", ")]) {
      if (!text) continue;
      const p = document.createElement("p");
      p.textContent = text;
      details.append(p);
    }
    for (const [i, url] of (dataset.source_urls || []).entries()) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = i ? " · Source " + (i + 1) : "Source";
      details.append(a);
    }
    const license = document.createElement("p");
    license.textContent = "License: " + (typeof dataset.license === "string" ? dataset.license : JSON.stringify(dataset.license));
    details.append(license);
    if (dataset.license_url) {
      const a = document.createElement("a");
      a.href = new URL(dataset.license_url, root);
      a.textContent = "Read dataset license";
      details.append(a);
    }
    if (Object.keys(dataset.category_levels || {}).length) {
      const h = document.createElement("p"),
        pre = document.createElement("pre");
      h.textContent = "Category codebook";
      pre.textContent = JSON.stringify(dataset.category_levels, null, 2);
      pre.style.whiteSpace = "pre-wrap";
      details.append(h, pre);
    }
    box.append(details);
  }
  $("choose-benchmark").onclick = async () => {
    window.causalEngineEnterBenchmark?.();
    window.causalEngineCancelCSVRead?.();
    const turn = ++generation;
    close();
    $("benchmark-status").textContent = "";
    $("easy-result").hidden = true;
    $("easy-progress").textContent = "";
    CausalDataPreview.clear();
    $("benchmark-options").hidden = false;
    $("csv-options").hidden = true;
    $("random-options").hidden = true;
    $("run-estimate").hidden = true;
    for (const id of ["choose-csv", "choose-random"]) $(id).setAttribute("aria-pressed", "false");
    $("choose-benchmark").setAttribute("aria-pressed", "true");
    if (datasets.length) return;
    try {
      $("benchmark-status").textContent = "Loading dataset list…";
      const response = await fetch(new URL("manifest.json", root));
      if (!response.ok) throw Error("Dataset list is not available (" + response.status + ").");
      const manifest = await response.json();
      if (turn !== generation) return;
      datasets = manifest.datasets || [];
      options();
      $("benchmark-status").textContent = "";
    } catch (error) {
      if (turn === generation) $("benchmark-status").textContent = error.message;
    }
  };
  for (const id of ["choose-csv", "choose-random"])
    $(id).addEventListener("click", () => {
      ++generation;
      close();
      $("benchmark-options").hidden = true;
      $("choose-benchmark").setAttribute("aria-pressed", "false");
    });
  async function action(estimate) {
    if (!selected || loading) return;
    const entry = selected,
      turn = ++generation,
      stamp = window.causalEngineBenchmarkStamp();
    busy(true);
    if (estimate) window.causalEngineBenchmarkLock(true);
    try {
      $("benchmark-status").textContent = "Reading " + entry.label + "…";
      const response = await fetch(new URL(entry.csv, root));
      if (!response.ok) throw Error("CSV is not available (" + response.status + ").");
      const text = await response.text();
      if (turn !== generation) return;
      if (estimate) {
        if (stamp !== window.causalEngineBenchmarkStamp()) throw Error("The graph or inputs changed. Select Estimate again.");
        const results = await window.causalEngineEstimateBenchmark(entry, text);
        if (!results?.length) throw Error($("data-error").textContent || "Estimation did not finish.");
        const computed = results.filter(
          (row) => row.result.data_estimate?.status === "OK" && Object.values(row.result.data_estimate.values || {}).some(Number.isFinite)
        ).length;
        $("benchmark-status").textContent =
          entry.label +
          " · " +
          (computed === results.length
            ? entry.rows.toLocaleString() + " rows estimated."
            : computed
              ? "Computed " + computed + " of " + results.length + " estimates. See the result reasons."
              : "Could not compute an estimate. See the result reason.");
        $("result-heading").textContent = ($("estimate-query").value === "apo" ? "APO · E[Y(a)]" : "ATE · Mean difference") + " · " + entry.label;
        $("easy-result").scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        CausalDataPreview.download(text, entry.csv);
        $("benchmark-status").textContent = "Downloaded " + entry.label + ".";
      }
    } catch (error) {
      if (turn === generation) $("benchmark-status").textContent = error.message;
    } finally {
      if (estimate) window.causalEngineBenchmarkLock(false);
      busy(false);
    }
  }
  $("benchmark-download").onclick = () => action(false);
  $("benchmark-estimate").onclick = () => action(true);
})();
