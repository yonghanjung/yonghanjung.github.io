(() => {
  document.body.dataset.view = "easy";
  $("easy-layout").append($("easy-result"));
  const choose = $("easy-example"),
    run = $("run-estimate"),
    progress = $("easy-progress"),
    canvasBox = document.querySelector(".canvas"),
    editorLayout = document.querySelector("#editor-view .layout");
  canvasBox.append($("node-menu"));
  $("graph-slot").append(canvasBox);
  const identifyButton = $("easy-identify"),
    estimateButton = $("easy-estimate");
  let current = "adjustment",
    custom = false,
    running = false,
    loading = false,
    baseline = "",
    beforeEdit = "",
    draftDirty = false,
    roles = {},
    stageNext = 3,
    declaredClusters = {},
    groundTruthSignature = null,
    randomSizes = {};
  const defaults = {
    adjustment: { a: "A", c: "X", y: "Y", m: "" },
    frontdoor: { a: "A", c: "C", y: "Y", m: "M" },
    sequential: {
      stages: [
        { id: 1, c: "C1", a: "A1", y: "" },
        { id: 2, c: "C2", a: "A2", y: "Y" },
      ],
    },
  };
  let stages = structuredClone(defaults.sequential.stages);
  const structure = () =>
    JSON.stringify({
      nodes: nodes.map(({ name, observed, dimension, family, variable_type, category_levels }) => ({
        name,
        observed,
        dimension,
        family,
        variable_type,
        category_levels,
      })),
      edges,
      query: ["query-type", "query-x", "query-y", "query-z", "query-summary", "query-values", "query-reference", "query-evidence"].map(
        (id) => $(id).value
      ),
    });
  const signature = () =>
    JSON.stringify({
      structure: structure(),
      parameters: model?.variables,
      dirty,
      fields: ["rows", "model-seed", "data-seed", "noise"].map((id) => $(id).value),
    });
  const names = (text) =>
    text.trim()
      ? text
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
  function stageFields() {
    const box = $("role-stages");
    box.replaceChildren();
    stages.forEach((s, i) => {
      const section = document.createElement("fieldset");
      section.className = "time-stage";
      section.innerHTML =
        "<legend>Time " + s.id + '</legend><button class="remove-stage" type="button" aria-label="Remove time ' + s.id + '">Remove</button>';
      for (const [k, label] of [
        ["c", "Covariates (before treatment)"],
        ["a", "Treatment"],
        ["y", "Outcomes (after treatment)"],
      ]) {
        const l = document.createElement("label");
        l.textContent = label;
        const input = document.createElement("input");
        input.value = s[k];
        input.dataset.stage = i;
        input.dataset.role = k;
        input.placeholder = k === "c" ? "C" + s.id : k === "a" ? "A" + s.id : "Y" + s.id;
        l.append(input);
        section.append(l);
      }
      section.querySelector("button").onclick = () => {
        stages.splice(i, 1);
        stageFields();
        pending();
      };
      box.append(section);
    });
  }
  function pending() {
    if (loading) return;
    CausalDataPreview.clear();
    draftDirty = true;
    $("easy-result").hidden = true;
    run.disabled = true;
    identifyButton.disabled = true;
    estimateButton.disabled = true;
    $("role-error").textContent = "";
    $("role-status").textContent = "Variable names changed. Update graph to apply them.";
  }
  $("role-fields").addEventListener("input", (e) => {
    if (e.target.dataset.stage !== undefined) stages[Number(e.target.dataset.stage)][e.target.dataset.role] = e.target.value;
    pending();
  });
  $("add-time").onclick = () => {
    stages.push({ id: stageNext++, c: "", a: "", y: "" });
    stageFields();
    pending();
  };
  function fields() {
    const cov = (text) => ClusterSyntax.parse(text);
    if (current === "sequential")
      return stages.map((s) => {
        const c = cov(s.c);
        return { id: s.id, c: c.names, clusters: c.clusters, a: names(s.a), y: names(s.y), m: [] };
      });
    const c = cov($("role-c").value);
    return [
      {
        id: 1,
        a: names($("role-a").value),
        c: c.names,
        clusters: c.clusters,
        y: names($("role-y").value),
        m: current === "frontdoor" ? names($("role-m").value) : [],
      },
    ];
  }
  function validate(fs) {
    const flat = fs.flatMap((s) => ["c", "a", "m", "y"].flatMap((k) => s[k]));
    const bad = flat.find((n) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(n));
    if (bad) throw Error("“" + bad + "” is not a valid name. Start with a letter; use letters, digits, or underscores.");
    const reserved = flat.find((n) => n.startsWith("U"));
    if (reserved) throw Error("Names starting with U are reserved for hidden roots by the current engine. Rename “" + reserved + "”.");
    const seen = new Set();
    for (const n of flat) {
      if (seen.has(n)) throw Error("“" + n + "” is used more than once. Use a distinct name for every role and time (for example X1 and X2).");
      seen.add(n);
    }
    const clusters = Object.assign({}, ...fs.map((s) => s.clusters)),
      physical = flat.filter((n) => !clusters[n]);
    for (const members of Object.values(clusters)) physical.push(...members);
    if (new Set(physical).size !== physical.length) throw Error("A column name is repeated across clusters or variables.");
    if (physical.length > 100) throw Error("Use at most 100 physical columns.");
    if (flat.length + (current === "frontdoor" && flat.length ? 1 : 0) > 100) throw Error("Use at most 100 variables, including the hidden root.");
    return flat;
  }
  function orderK() {
    const mode = $("markov-order").value;
    if (mode === "full") return Infinity;
    const k = Number(mode === "custom" ? $("markov-k").value : mode);
    if (!Number.isSafeInteger(k) || k < 1) throw Error("Markovian order must be a whole number of at least 1.");
    return k;
  }
  function build(fs) {
    const ns = [],
      es = [],
      metadata = {};
    const add = (n, key, t) => {
      ns.push({ name: n, observed: true, dimension: 1, family: key === "a" ? "binary" : "linear", x: 100, y: 100 });
      metadata[n] = {
        column: current === "sequential" ? t : { c: 0, a: 1, m: 2, y: current === "frontdoor" ? 3 : 2 }[key],
        role: key,
        time: fs[t].id,
      };
    };
    fs.forEach((s, t) => ["c", "a", "m", "y"].forEach((k) => s[k].forEach((n) => add(n, k, t))));
    const link = (as, bs) => {
      for (const a of as) for (const b of bs) if (a !== b && !es.some((e) => e[0] === a && e[1] === b)) es.push([a, b]);
    };
    if (current === "sequential") {
      const k = orderK();
      for (let i = 0; i < fs.length; i++) {
        const s = fs[i];
        for (let j = 0; j < i; j++) if (s.id - fs[j].id <= k) link([...fs[j].c, ...fs[j].a, ...fs[j].y], [...s.c, ...s.a, ...s.y]);
        link(s.c, [...s.a, ...s.y]);
        link(s.a, s.y);
      }
    } else {
      const s = fs[0];
      link(s.c, [...s.a, ...s.m, ...s.y]);
      if (current === "frontdoor") {
        if (ns.length) {
          ns.push({ name: "U_hidden", observed: false, dimension: 1, family: "", x: 100, y: 100 });
          metadata.U_hidden = { column: 0, role: "hidden" };
          link(["U_hidden"], [...s.a, ...s.y]);
        }
        link(s.a, s.m);
        link(s.m, s.y);
      } else link(s.a, s.y);
    }
    metadata.__columns = current === "sequential" ? fs.length : current === "frontdoor" ? 4 : 3;
    metadata.__sequential = current === "sequential";
    metadata.__structure = current;
    metadata.__stages = fs.map((s) => ({ id: s.id }));
    return { nodes: ns, edges: es, X: fs.flatMap((s) => s.a), Y: fs.flatMap((s) => s.y), Z: current === "adjustment" ? fs[0].c : [], metadata };
  }
  const baseRender = render;
  render = function () {
    baseRender();
    if (window.causalEngineActiveBindings?.()) {
      for (const n of nodes) {
        const members = boundMembers(n.name);
        if (!members.length || !isCluster(n.name)) continue;
        const group = [...svg.querySelectorAll("[data-node]")].find((g) => g.dataset.node === n.name);
        if (!group) continue;
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "cluster-caption");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("y", -RADIUS - 13);
        text.textContent = n.name + " (" + (members.length > 3 ? members[0] + ", …, " + members.at(-1) : members.join(", ")) + ")";
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = n.name + " = (" + members.join(", ") + ") · " + members.length + " columns";
        group.append(title, text);
        group.setAttribute("aria-label", title.textContent);
      }
    }
    if (roles.__sequential) {
      const count = Number(svg.dataset.columns) || roles.__columns,
        w = svg.viewBox.baseVal.width,
        h = svg.viewBox.baseVal.height,
        g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.style.pointerEvents = "none";
      const labels = [...roles.__stages.map((s) => "Time " + s.id), ...(nodes.some((n) => !roles[n.name]) ? ["Unassigned"] : [])];
      labels.forEach((label, i) => {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", 90 + (i * (w - 180)) / Math.max(1, count - 1));
        text.setAttribute("y", 45);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", "#64706b");
        text.setAttribute("font-size", "16");
        text.textContent = label;
        g.append(text);
      });
      svg.append(g);
    }
    const memberMap = Object.fromEntries(nodes.map((n) => [n.name, boundMembers(n.name)]).filter(([name, m]) => isCluster(name) && m.length));
    ClusterView.draw(svg, nodes, edges, bends, memberMap);
  };
  function setExtent(layout) {
    $("canvas").dataset.columns = layout.columnCount;
    $("canvas").setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
    $("canvas").style.minWidth = Math.max(680, layout.width * 0.8) + "px";
    $("canvas").style.height = Math.max(360, layout.height * 0.8) + "px";
  }
  function arrangeGraph() {
    if (!nodes.length) return;
    const before = RoleLayout.metrics(nodes, edges, bends),
      layout = RoleLayout.arrange(nodes, edges, roles);
    nodes = layout.nodes;
    bends = layout.bends;
    setExtent(layout);
    render();
    window.causalEngineLayoutMetrics = { before, after: layout.metrics, nodes: nodes.length, edges: edges.length };
    $("layout-status").textContent = "Arranged " + nodes.length + " nodes; relationships unchanged.";
  }
  $("auto-arrange").onclick = arrangeGraph;
  function methodChoice() {
    const actions = queryNames("query-x"),
      targets = queryNames("query-y"),
      action = nodes.find((n) => n.name === actions[0]);
    const baseline =
      current === "adjustment" &&
      !custom &&
      actions.length === 1 &&
      targets.length > 0 &&
      action?.dimension === 1 &&
      (action.variable_type === "binary" || action.family === "binary") &&
      targets.every((name) => nodes.find((n) => n.name === name)?.dimension === 1);
    $("estimation-method-wrap").hidden = !baseline;
    $("estimation-method").disabled = running;
    return baseline ? $("estimation-method").value : "auto";
  }
  function describe() {
    methodChoice();
    refreshRandomDimensions();
    const legacy = $("dimension").closest("label");
    legacy.hidden = dataSource === "random" && randomCandidates().some((n) => n.name === selected?.name);
    for (const [k, id] of [
      ["model-seed", "random-model-seed"],
      ["data-seed", "random-data-seed"],
    ])
      if (document.activeElement !== $(id)) $(id).value = $(k).value;
    const a = queryNames("query-x");
    for (const [id, field] of [
      ["contrast-action", "query-values"],
      ["contrast-reference", "query-reference"],
    ]) {
      let vals = [];
      try {
        const obj = assignments(field);
        vals = a.map((n) => obj[n]);
      } catch {}
      const same = vals.length && vals.every((v) => typeof v === "number" && Number.isFinite(v) && v === vals[0]);
      $(id).disabled = running || (!!vals.length && !same);
      $(id).value = same ? vals[0] : "";
      $(id).placeholder = same ? "" : "Custom";
    }
  }
  function applyFields() {
    CausalDataPreview.clear();
    try {
      const fs = fields();
      validate(fs);
      const g = build(fs);
      loading = true;
      declaredClusters = Object.assign({}, ...fs.map((s) => s.clusters));
      ClusterView.clear();
      randomSizes = {};
      roles = g.metadata;
      const layout = RoleLayout.arrange(g.nodes, g.edges, roles);
      setExtent(layout);
      if (g.nodes.length) loadGraph({ ...g, nodes: layout.nodes, bends: [...layout.bends].map(([k, b]) => [...JSON.parse(k), b.x, b.y]) });
      else {
        nodes = [];
        edges = [];
        bends.clear();
        $("query-x").value = "";
        $("query-y").value = "";
        $("query-z").value = "";
        invalidate();
        select(null);
        render();
      }
      for (const [k, id] of [
        ["X", "query-x"],
        ["Y", "query-y"],
        ["Z", "query-z"],
      ])
        $(id).value = g[k].join(", ");
      $("query-type").value = "interventional";
      $("query-summary").value = "mean_difference";
      $("query-values").value = JSON.stringify(Object.fromEntries(g.X.map((n) => [n, 1])));
      $("query-reference").value = JSON.stringify(Object.fromEntries(g.X.map((n) => [n, 0])));
      $("query-evidence").value = "{}";
      $("model-seed").value = 7;
      $("data-seed").value = 5;
      $("noise").value = "normal";
      updateQuery();
      custom = false;
      draftDirty = false;
      choose.value = current;
      $("easy-result").hidden = true;
      $("role-error").textContent = "";
      $("role-status").textContent = "";
      run.disabled = false;
      identifyButton.disabled = false;
      estimateButton.disabled = false;
      baseline = structure();
      loading = false;
      describe();
      if (window.refreshCSVMapping) window.refreshCSVMapping();
      window.causalEngineRoleState = { stages: structuredClone(fs), targets: g.Y, treatments: g.X };
      window.causalEngineLayoutMetrics = {
        before: RoleLayout.metrics(layout.nodes, g.edges, new Map()),
        after: layout.metrics,
        nodes: g.nodes.length,
        edges: g.edges.length,
      };
    } catch (error) {
      loading = false;
      $("role-error").textContent = error.message;
      run.disabled = true;
    }
  }
  $("apply-roles").onclick = () => {
    if (custom && !confirm("Replace your manually edited graph with this role template?")) return;
    applyFields();
  };
  function preset(key) {
    loading = true;
    current = key;
    const d = defaults[key];
    $("role-general").hidden = key === "sequential";
    $("role-timeline").hidden = key !== "sequential";
    $("role-m-label").hidden = key !== "frontdoor";
    if (key === "sequential") {
      stages = structuredClone(d.stages);
      stageNext = 3;
      stageFields();
    } else for (const k of ["a", "c", "y", "m"]) $("role-" + k).value = d[k];
    loading = false;
    applyFields();
    progress.textContent = "";
  }
  function markCustom() {
    if (loading || custom) return;
    custom = true;
    choose.querySelector('[value="custom"]').hidden = false;
    choose.value = "custom";
    $("easy-result").hidden = true;
    $("role-status").textContent = "Manual graph changes are kept. Update graph explicitly to replace them.";
    describe();
  }
  function temporalIssue() {
    if (current !== "sequential") return "";
    for (const [a, b] of edges) {
      const x = roles[a],
        y = roles[b];
      if (x && y && (x.time > y.time || (x.time === y.time && ({ c: 0, a: 1, y: 2 }[x.role] ?? 0) > ({ c: 0, a: 1, y: 2 }[y.role] ?? 0))))
        return "An arrow runs backward in the entered timeline (" + a + " → " + b + "). Remove it or update the timeline before continuing.";
    }
    return "";
  }
  const dataGraphKey = () =>
    JSON.stringify({
      nodes: nodes.map(({ name, observed, dimension, family, variable_type, category_levels }) => ({
        name,
        observed,
        dimension,
        family,
        variable_type,
        category_levels,
      })),
      edges,
    });
  function checkChanges() {
    if (groundTruthSignature && groundTruthSignature !== truthStamp()) {
      document.querySelectorAll(".ground-truth").forEach((e) => e.remove());
      groundTruthSignature = null;
    }
    const snapshotKey = CausalDataPreview.key();
    if (snapshotKey && (snapshotKey.graph !== dataGraphKey() || (snapshotKey.random && snapshotKey.random !== randomSignature())))
      CausalDataPreview.clear();
    if (!loading && !running && structure() !== baseline) {
      markCustom();
      if (window.refreshCSVMapping) window.refreshCSVMapping();
    }
    const issue = temporalIssue();
    if (issue) {
      $("role-error").textContent = issue;
      run.disabled = true;
      identifyButton.disabled = true;
      estimateButton.disabled = true;
    } else if (!draftDirty && !running) {
      run.disabled = false;
      identifyButton.disabled = false;
      estimateButton.disabled = false;
    }
  }
  const originalInvalidate = invalidate;
  invalidate = function (...args) {
    originalInvalidate(...args);
    checkChanges();
  };
  setInterval(checkChanges, 250);
  choose.onchange = () => {
    if (choose.value === "custom") return;
    const key = choose.value;
    if ((custom || draftDirty) && !confirm("Replace your draft and edited graph with this structure’s starting values?")) {
      choose.value = custom ? "custom" : current;
      return;
    }
    preset(key);
  };
  $("easy-records").onchange = () => {
    const n = Number($("easy-records").value);
    if (!Number.isSafeInteger(n) || n < 1 || n > 5000) {
      $("data-error").textContent = "Records must be a whole number from 1 to 5,000.";
      return;
    }
    CausalDataPreview.clear();
    $("rows").value = n;
    $("rows").dispatchEvent(new Event("change"));
    $("easy-result").hidden = true;
  };
  const editor = $("editor-view");
  $("settings-content").append(editor);
  const graphTools = document.createElement("div");
  graphTools.className = "graph-file-tools";
  graphTools.append($("graph-input"), $("reset"));
  editor.prepend(graphTools);
  const nativeActions = document.querySelector("header .actions");
  if (nativeActions) editor.prepend(nativeActions);
  const panel = editor.querySelector(".layout");
  if (panel?.querySelector("aside")) panel.prepend(panel.querySelector("aside"));
  function openDetails() {
    if (running) return;
    beforeEdit = signature();
    editor.hidden = false;
    $("right-settings-slot").hidden = false;
    document.body.dataset.view = "details";
  }
  $("edit-selected").onclick = openDetails;
  $("back-easy").onclick = () => {
    if (beforeEdit !== signature()) markCustom();
    editor.hidden = true;
    $("right-settings-slot").hidden = true;
    document.body.dataset.view = "easy";
    $("easy-layout").append($("easy-result"));
    describe();
  };
  for (const id of ["contrast-action", "contrast-reference"])
    $(id).onchange = () => {
      const value = Number($(id).value);
      if ($(id).value === "" || !Number.isFinite(value)) {
        $("role-error").textContent = "Enter finite numeric treatment and reference values.";
        return;
      }
      const field = id === "contrast-action" ? "query-values" : "query-reference";
      $(field).value = JSON.stringify(Object.fromEntries(queryNames("query-x").map((n) => [n, value])));
      clearComputation();
      $("easy-result").hidden = true;
      baseline = structure();
    };
  $("markov-order").onchange = () => {
    $("markov-k-label").hidden = $("markov-order").value !== "custom";
    pending();
  };
  $("markov-k").oninput = pending;
  function ancestorsOf(outcome) {
    const seen = new Set(),
      todo = [outcome];
    while (todo.length) {
      const child = todo.pop();
      for (const [a, b] of edges)
        if (b === child && !seen.has(a)) {
          seen.add(a);
          todo.push(a);
        }
    }
    return seen;
  }
  function setBusy(value, label) {
    running = value;
    window.CausalBenchmarkUI?.lock(value);
    editor.inert = value;
    canvasBox.inert = value;
    for (const el of document.querySelectorAll(
      "#role-fields input,#role-fields select,#role-fields button,.contrast-controls input,#random-options input,#csv-paste,#load-pasted-csv,#load-example-csv,#csv-mapping select,#csv-mapping input,#csv-file"
    ))
      el.disabled = value;
    for (const id of [
      "easy-example",
      "easy-records",
      "apply-roles",
      "add-time",
      "easy-identify",
      "easy-estimate",
      "run-estimate",
      "edit-selected",
      "choose-csv",
      "choose-random",
      "generate-data",
      "choose-benchmark",
      "benchmark-select",
      "benchmark-estimate",
      "benchmark-download",
      "restore-graph",
      "estimation-method",
    ])
      $(id).disabled =
        value ||
        (draftDirty && ["easy-identify", "easy-estimate", "run-estimate"].includes(id)) ||
        (["benchmark-estimate", "benchmark-download"].includes(id) && !$("benchmark-select").value);
    identifyButton.textContent = value && label === "Identify" ? "Identifying…" : "Identify";
    run.textContent = value && label === "Estimate" ? "Estimating…" : "Run estimate";
    if (!value) describe();
  }
  function validateQuestion() {
    checkChanges();
    if (draftDirty) throw Error("Update the graph before continuing.");
    const issue = temporalIssue();
    if (issue) throw Error(issue);
    if (!queryNames("query-x").length || !queryNames("query-y").length)
      throw Error("Enter at least one treatment and outcome, then update the graph.");
    if (!custom && current === "frontdoor" && !fields()[0].m.length) throw Error("Enter at least one mediator for the Front-door template.");
  }
  function resultPanel(title) {
    $("result-heading").textContent = title;
    $("outcome-results").replaceChildren();
    $("batch-regime").textContent = "";
    $("easy-result").hidden = true;
  }
  identifyButton.onclick = async () => {
    if (running) return;
    try {
      validateQuestion();
      if ($("query-type").value !== "interventional" || Object.keys(queryEvidence()).length)
        throw Error("Identify checks interventional questions without factual evidence. Change these settings first.");
    } catch (e) {
      progress.textContent = e.message;
      return;
    }
    const targets = queryNames("query-y"),
      actions = queryNames("query-x"),
      stamp = structure();
    setBusy(true, "Identify");
    resultPanel("Identification");
    progress.textContent = "Checking the graph…";
    const output = [];
    try {
      for (const target of targets) {
        const result = await request("identify", {
          nodes,
          edges,
          X: actions,
          Y: [target],
          Z: queryNames("query-z"),
          max_seconds: 10,
          max_orders: 256,
          max_mc_unions: 256,
        });
        if (structure() !== stamp || draftDirty) throw Error("The graph or question changed. Identify again.");
        const section = document.createElement("section");
        section.className = "outcome-result";
        const h = document.createElement("h3");
        h.textContent = target;
        const status = document.createElement("p");
        status.className = "outcome-value";
        status.dataset.outcome = target;
        status.dataset.status = result.identification.status;
        status.textContent =
          { IDENTIFIABLE: "Identifiable", NOT_IDENTIFIABLE: "Not identifiable" }[result.identification.status] || result.identification.status;
        if (targets.length > 1) section.append(h);
        section.append(status);
        if (result.identification.status === "IDENTIFIABLE") {
          const formula = document.createElement("div");
          formula.className = "outcome-formula";
          try {
            const math = CausalExpectation.render(result, target, actions, nodes);
            if (math) {
              formula.append(math);
              if (math.dataset.adjustmentVariables) {
                const variables = JSON.parse(math.dataset.adjustmentVariables),
                  d = document.createElement("details"),
                  summary = document.createElement("summary"),
                  p = document.createElement("p");
                summary.textContent = "C = (" + variables.length + " adjustment variables)";
                p.textContent = "C = (" + variables.join(", ") + ")";
                d.append(summary, p);
                formula.append(d);
              }
            }
          } catch (error) {
            formula.textContent = error.message;
          }
          section.append(formula);
        }
        const details = document.createElement("details"),
          summary = document.createElement("summary");
        summary.textContent = "Details";
        details.append(summary);
        const reason = document.createElement("p");
        reason.textContent = result.identification.reason || "";
        details.append(reason);
        if (reason.textContent) section.append(details);
        $("outcome-results").append(section);
        output.push({ outcome: target, result });
      }
      $("easy-result").hidden = false;
      window.causalEngineIdentificationResults = output;
      progress.textContent = "";
    } catch (e) {
      progress.textContent = e.message;
    } finally {
      setBusy(false);
      checkChanges();
    }
  };
  estimateButton.onclick = () => {
    try {
      validateQuestion();
      $("estimate-options").hidden = false;
      progress.textContent = "";
    } catch (e) {
      progress.textContent = e.message;
    }
  };
  let dataSource = null,
    csvTable = null,
    csvRaw = "",
    csvName = "",
    columnMapping = {},
    fileGeneration = 0,
    csvReadPending = false,
    bindingActive = false,
    csvBindingGraph = "";
  const columnsDetails = document.createElement("details");
  columnsDetails.id = "data-columns";
  columnsDetails.hidden = true;
  columnsDetails.innerHTML = "<summary>Data columns</summary>";
  columnsDetails.append($("csv-mapping"));
  $("easy-graph").append(columnsDetails);
  window.causalEngineActiveBindings = () =>
    (bindingActive && dataSource === "csv") ||
    Object.keys(declaredClusters).length > 0 ||
    (dataSource === "random" && randomCandidates().some((n) => randomSize(n.name) > 1));
  function toggleView(name) {
    ClusterView.toggle(name);
    render();
    [...svg.querySelectorAll("[data-node]")].find((g) => g.dataset.node === name)?.focus();
  }
  function isCluster(name) {
    return Boolean(
      (dataSource === "random" && randomSize(name) > 1) ||
        declaredClusters[name] ||
        (bindingActive && dataSource === "csv" && Array.isArray(columnMapping[name]))
    );
  }
  function boundMembers(name) {
    if (dataSource === "random" && randomSize(name) > 1) {
      const p = randomSize(name),
        v = model?.variables?.[name];
      return v?.shape?.[0] === p ? [...v.columns] : randomNames(name, p);
    }
    if (!(bindingActive && dataSource === "csv")) return declaredClusters[name] || [];
    const value = columnMapping[name];
    return Array.isArray(value) ? value : value ? [value] : [];
  }
  function refreshBinding() {
    columnsDetails.hidden = !bindingActive || dataSource !== "csv";
    render();
    window.causalEngineDataBindings = bindingActive && dataSource === "csv" ? structuredClone(columnMapping) : null;
  }
  window.causalEngineClearBinding = () => {
    bindingActive = false;
    refreshBinding();
  };
  function clusterEligible(name) {
    return (
      !queryNames("query-x").includes(name) &&
      !queryNames("query-y").includes(name) &&
      queryNames("query-x").every((a) => !ancestorsOf(name).has(a)) &&
      (roles[name]?.role === "c" || queryNames("query-z").includes(name))
    );
  }

  function csvSnapshot() {
    if (csvTable)
      CausalDataPreview.set({ csv: csvRaw, table: csvTable, name: csvName, source: "csv", key: { graph: dataGraphKey(), file: fileGeneration } });
  }
  function acceptCSV(text, name) {
    bindingActive = true;
    csvBindingGraph = dataGraphKey();
    csvTable = CausalCSV.parse(text);
    csvRaw = text;
    csvName = name;
    mappingGraph = "";
    columnMapping = {};
    renderMapping();
    $("csv-status").textContent = name + " · " + csvTable.rows.length.toLocaleString() + " rows";
    csvSnapshot();
  }
  window.causalEngineUseCSV = (text, name, benchmark = null) => {
    if (running) throw Error("Wait for the current operation.");
    ++fileGeneration;
    window.causalEngineBenchmark = benchmark;
    csvReadPending = false;
    chooseSource("csv");
    $("estimate-options").hidden = false;
    $("csv-file").value = "";
    acceptCSV(text, name);
    $("easy-result").hidden = true;
  };
  window.causalEngineCancelCSVRead = () => {
    ++fileGeneration;
    csvReadPending = false;
  };
  function chooseSource(source) {
    if (running) return;
    if (dataSource !== source) {
      ++fileGeneration;
      csvReadPending = false;
      CausalDataPreview.clear();
      $("easy-result").hidden = true;
      progress.textContent = "";
      window.causalEngineDataResults = null;
      window.causalEngineDataSource = null;
    }
    dataSource = source;
    const tools = $("dataset-tools");
    if (source === "random") $("random-options").append(tools);
    else $("easy-view").insertBefore(tools, document.querySelector(".easy-help"));
    if (source === "random") {
      bindingActive = false;
      window.causalEngineDataBindings = null;
    } else if (csvTable) bindingActive = true;
    $("benchmark-options").hidden = true;
    $("choose-benchmark").setAttribute("aria-pressed", "false");
    editor.dataset.source = source;
    $("csv-options").hidden = source !== "csv";
    $("random-options").hidden = source !== "random";
    $("run-estimate").hidden = false;
    $("choose-csv").setAttribute("aria-pressed", String(source === "csv"));
    $("choose-random").setAttribute("aria-pressed", String(source === "random"));
    $("data-error").textContent = "";
    if (source === "csv" && csvTable) csvSnapshot();
    refreshBinding();
  }
  $("choose-csv").onclick = () => chooseSource("csv");
  $("choose-random").onclick = () => {
    chooseSource("random");
    refreshRandomDimensions();
    $("random-model-seed").value = $("model-seed").value;
    $("random-data-seed").value = $("data-seed").value;
  };
  for (const [k, id] of [
    ["model-seed", "random-model-seed"],
    ["data-seed", "random-data-seed"],
  ])
    $(id).onchange = () => {
      const value = Number($(id).value);
      if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) {
        $("data-error").textContent = "Use a whole-number seed from 0 to 4294967295.";
        return;
      }
      $(k).value = value;
      $(k).dispatchEvent(new Event("change"));
      CausalDataPreview.clear();
      $("easy-result").hidden = true;
    };
  let mappingGraph = "";
  function benchmarkNote() {
    const box = $("benchmark-analysis-note"),
      d = window.causalEngineBenchmark;
    box.replaceChildren();
    if (!d) return;
    const used = new Set(Object.values(columnMapping).flat()),
      missing = d.covariates.filter((c) => !used.has(c)),
      p = document.createElement("p");
    p.textContent =
      d.label +
      " · " +
      (missing.length
        ? missing.length + " of " + d.covariates.length + " released covariates are not mapped."
        : "All " + d.covariates.length + " released covariates are mapped.");
    box.append(p);
    if (missing.length) {
      const details = document.createElement("details"),
        summary = document.createElement("summary"),
        list = document.createElement("p");
      summary.textContent = "Unmapped covariates";
      list.textContent = missing.join(", ");
      details.append(summary, list);
      box.append(details);
    }
    if (d.estimate_options?.categorical_encoding === "one_hot") {
      const note = document.createElement("p");
      note.textContent = "Nominal covariates use indicator features during estimation.";
      box.append(note);
    }
  }
  function renderMapping() {
    benchmarkNote();
    if (csvTable) {
      const sig = JSON.stringify({
        names: nodes.filter((n) => n.observed).map((n) => [n.name, n.dimension, clusterEligible(n.name)]),
        headers: csvTable.headers,
        mapping: columnMapping,
      });
      if (mappingGraph === sig) return;
      mappingGraph = sig;
    }
    const box = $("csv-mapping");
    box.replaceChildren();
    if (!csvTable) {
      refreshBinding();
      return;
    }
    for (const n of nodes.filter((n) => n.observed)) {
      if (columnMapping[n.name] === undefined) {
        if (declaredClusters[n.name]) columnMapping[n.name] = [...declaredClusters[n.name]];
        else if (csvTable.headers.includes(n.name)) columnMapping[n.name] = n.name;
      }
      const eligible = clusterEligible(n.name),
        members = boundMembers(n.name);
      if (eligible) {
        const details = document.createElement("details"),
          summary = document.createElement("summary"),
          choices = document.createElement("div");
        details.className = "column-cluster";
        summary.textContent = n.name + " · " + members.length + " column" + (members.length === 1 ? "" : "s");
        choices.className = "column-choices";
        for (const h of csvTable.headers) {
          const label = document.createElement("label"),
            input = document.createElement("input");
          input.type = "checkbox";
          input.value = h;
          input.checked = members.includes(h);
          input.dataset.binding = n.name;
          input.onchange = () => {
            columnMapping[n.name] = [...choices.querySelectorAll("input:checked")].map((e) => e.value);
            summary.textContent = n.name + " · " + columnMapping[n.name].length + " columns";
            mappingChanged();
          };
          label.append(input, document.createTextNode(h));
          choices.append(label);
        }
        details.append(summary, choices);
        box.append(details);
      } else {
        const row = document.createElement("div");
        row.className = "mapping-row";
        const label = document.createElement("label"),
          select = document.createElement("select");
        select.id = "map-" + n.name;
        label.htmlFor = select.id;
        label.textContent = n.name;
        select.append(new Option("Choose column…", ""));
        for (const h of csvTable.headers) select.append(new Option(h, h));
        select.value = (typeof columnMapping[n.name] === "string" ? columnMapping[n.name] : "") || (csvTable.headers.includes(n.name) ? n.name : "");
        columnMapping[n.name] = select.value;
        select.onchange = () => {
          columnMapping[n.name] = select.value;
          mappingChanged();
        };
        row.append(label, select);
        box.append(row);
      }
    }
    benchmarkNote();
    refreshBinding();
  }
  function mappingChanged() {
    bindingActive = true;
    benchmarkNote();
    $("easy-result").hidden = true;
    $("data-error").textContent = "";
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    refreshBinding();
  }

  $("csv-file").addEventListener("click", () => {
    $("csv-file").value = "";
  });
  $("csv-file").onchange = async () => {
    const generation = ++fileGeneration;
    window.causalEngineBenchmark = null;
    bindingActive = false;
    refreshBinding();
    $("benchmark-analysis-note").textContent = "";
    csvReadPending = true;
    CausalDataPreview.clear();
    csvTable = null;
    mappingGraph = "";
    columnMapping = {};
    $("csv-mapping").replaceChildren();
    $("csv-status").textContent = "";
    $("data-error").textContent = "";
    $("easy-result").hidden = true;
    const file = $("csv-file").files[0];
    if (!file) {
      csvReadPending = false;
      return;
    }
    try {
      const text = await file.text();
      if (generation !== fileGeneration) return;
      acceptCSV(text, file.name);
    } catch (e) {
      if (generation === fileGeneration) $("data-error").textContent = e.message;
    } finally {
      if (generation === fileGeneration) csvReadPending = false;
    }
  };
  async function loadAlternateCSV(text, name, generation = ++fileGeneration) {
    if (running || generation !== fileGeneration) return;
    window.causalEngineBenchmark = null;
    bindingActive = false;
    csvReadPending = true;
    CausalDataPreview.clear();
    $("easy-result").hidden = true;
    try {
      acceptCSV(text, name);
      $("data-error").textContent = "";
    } catch (error) {
      $("data-error").textContent = error.message;
    } finally {
      if (generation === fileGeneration) csvReadPending = false;
    }
  }
  $("load-pasted-csv").onclick = () => loadAlternateCSV($("csv-paste").value, "Pasted CSV");
  const drop = $("csv-drop");
  drop.ondragover = (event) => {
    event.preventDefault();
    drop.dataset.over = "true";
  };
  drop.ondragleave = () => delete drop.dataset.over;
  drop.ondrop = async (event) => {
    event.preventDefault();
    delete drop.dataset.over;
    if (running) return;
    const file = event.dataTransfer.files[0],
      generation = ++fileGeneration;
    if (!file) return;
    csvReadPending = true;
    try {
      const text = await file.text();
      if (generation === fileGeneration) await loadAlternateCSV(text, file.name, generation);
    } catch (error) {
      if (generation === fileGeneration) $("data-error").textContent = error.message;
    } finally {
      if (generation === fileGeneration) csvReadPending = false;
    }
  };
  $("load-example-csv").onclick = async () => {
    if (running) return;
    const generation = ++fileGeneration;
    csvReadPending = true;
    try {
      const response = await fetch("./examples/upload-cluster.csv");
      if (!response.ok) throw Error("Example CSV is unavailable.");
      const text = await response.text();
      if (generation === fileGeneration) await loadAlternateCSV(text, "upload-cluster.csv", generation);
    } catch (error) {
      if (generation === fileGeneration) $("data-error").textContent = error.message;
    } finally {
      if (generation === fileGeneration) csvReadPending = false;
    }
  };
  function randomCandidates() {
    return nodes.filter((n) => n.observed && clusterEligible(n.name) && n.family !== "binary" && n.variable_type !== "categorical");
  }
  function randomSize(name) {
    return randomSizes[name] ?? declaredClusters[name]?.length ?? 1;
  }
  function randomNames(name, p) {
    return declaredClusters[name]?.length === p
      ? [...declaredClusters[name]]
      : Array.from({ length: p }, (_, i) => (name === "X" ? "x" + (i + 1) : name + "_" + (i + 1)));
  }
  function randomConfig(validateInputs = false) {
    const sizes = {},
      members = {};
    if (validateInputs)
      for (const input of document.querySelectorAll("#random-dimensions input")) {
        const value = Number(input.value);
        if (input.value === "" || !Number.isSafeInteger(value) || value < 1 || value > 50) throw Error("Use a whole-number dimension from 1 to 50.");
      }
    for (const n of randomCandidates()) {
      const p = randomSize(n.name);
      if (!Number.isSafeInteger(p) || p < 1 || p > 50) throw Error("Random covariate dimensions must be whole numbers from 1 to 50.");
      if (declaredClusters[n.name] && declaredClusters[n.name].length !== p)
        throw Error(n.name + " declares " + declaredClusters[n.name].length + " members. Edit that declaration first, or use plain " + n.name + ".");
      if (p > 1 || declaredClusters[n.name]) {
        sizes[n.name] = p;
        members[n.name] = randomNames(n.name, p);
      }
    }
    return { random_cluster_sizes: sizes, random_cluster_members: members };
  }
  window.causalEngineRandomConfig = () => randomConfig(true);
  function refreshRandomDimensions() {
    const box = $("random-dimensions"),
      wanted = randomCandidates();
    if (box.dataset.names === wanted.map((n) => n.name).join("|")) {
      for (const n of wanted) {
        const input = $("random-dimension-" + n.name);
        if (input && document.activeElement !== input) input.value = randomSize(n.name);
      }
      return;
    }
    box.dataset.names = wanted.map((n) => n.name).join("|");
    box.replaceChildren();
    for (const n of wanted) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      label.textContent = n.name + " dimension";
      input.id = "random-dimension-" + n.name;
      input.type = "number";
      input.min = "1";
      input.max = "50";
      input.step = "1";
      input.value = randomSize(n.name);
      input.oninput = () => {
        CausalDataPreview.clear();
        $("easy-result").hidden = true;
      };
      input.onchange = () => {
        const p = Number(input.value);
        if (input.value === "" || !Number.isSafeInteger(p) || p < 1 || p > 50) {
          $("data-error").textContent = "Use a whole-number dimension from 1 to 50.";
          return;
        }
        if (declaredClusters[n.name] && p !== declaredClusters[n.name].length) {
          $("data-error").textContent =
            n.name + " declares " + declaredClusters[n.name].length + " members. Edit Covariates first, or use plain " + n.name + ".";
          input.value = randomSize(n.name);
          return;
        }
        randomSizes[n.name] = p;
        invalidate();
        CausalDataPreview.clear();
        $("easy-result").hidden = true;
        $("data-error").textContent = "";
        refreshBinding();
      };
      label.append(input);
      box.append(label);
    }
  }
  let retainedRandomSignature = null;
  const originalGenerate = $("generate").onclick;
  $("generate").onclick = async () => {
    if (nodes.some((n) => n.variable_type === "categorical")) {
      message("Random data for categorical variables is not supported; use CSV or Benchmarks.", true);
      return;
    }
    const previous = sample;
    await originalGenerate();
    if (model && sample && sample !== previous) {
      retainedRandomSignature = randomSignature();
      if (dataSource === "random") showRandomSnapshot();
    }
  };
  function randomSignature() {
    return JSON.stringify({
      graph: dataGraphKey(),
      token,
      parameters: model?.variables,
      rows: $("rows").value,
      data_seed: $("data-seed").value,
      model_seed: $("model-seed").value,
      noise: $("noise").value,
      random_clusters: randomConfig(),
    });
  }
  function showRandomSnapshot() {
    const key = { graph: dataGraphKey(), random: randomSignature(), token, sample_id: sample.sample_id };
    if (CausalDataPreview.key()?.random !== key.random || CausalDataPreview.key()?.sample_id !== key.sample_id)
      CausalDataPreview.set({ csv: sample.csv, name: "causalengine-random-" + sample.sample_id, source: "random", key });
  }
  async function ensureRandomData() {
    const records = Number($("easy-records").value);
    if (!Number.isSafeInteger(records) || records < 1 || records > 5000) throw Error("Records must be a whole number from 1 to 5,000.");
    for (const id of ["random-model-seed", "random-data-seed"]) {
      const v = Number($(id).value);
      if ($(id).value === "" || !Number.isSafeInteger(v) || v < 0 || v > 4294967295) throw Error("Use whole-number seeds from 0 to 4294967295.");
    }
    randomConfig(true);
    if (nodes.some((n) => n.variable_type === "categorical"))
      throw Error("Random data for categorical variables is not supported; use CSV or Benchmarks.");
    const version = revision;
    if (!(model && sample && !dirty && retainedRandomSignature === randomSignature())) {
      const previous = sample;
      window.causalEngineBatch = true;
      try {
        await $("generate").onclick();
      } finally {
        window.causalEngineBatch = false;
      }
      if (revision !== version || draftDirty) throw Error("The graph changed. Generate data again.");
      if (!model || !sample || sample === previous) throw Error($("status").textContent || "Random data generation did not finish.");
      retainedRandomSignature = randomSignature();
    }
    showRandomSnapshot();
    return {
      token,
      sample_id: sample.sample_id,
      n: sample.shape[0],
      ...(window.causalEngineRandomKey ? { random_key: window.causalEngineRandomKey } : {}),
      random_bindings: window.causalEngineRandomBindings,
    };
  }
  $("generate-data").onclick = async () => {
    if (running) return;
    try {
      if (draftDirty) throw Error("Update the graph before generating data.");
      if (!nodes.length) throw Error("Add at least one variable first.");
      if (dirty) throw Error("Apply pending node changes first.");
    } catch (error) {
      $("data-error").textContent = error.message;
      return;
    }
    setBusy(true, "Generate");
    $("data-error").textContent = "";
    progress.textContent = "Generating random data on your device…";
    try {
      const source = await ensureRandomData();
      progress.textContent = source.n.toLocaleString() + " random records ready.";
    } catch (error) {
      $("data-error").textContent = error.message;
      progress.textContent = "";
    } finally {
      setBusy(false);
      checkChanges();
    }
  };
  const dataToolbar = document.querySelector(".dataset-toolbar");
  dataToolbar.hidden = true;
  const previewSet = CausalDataPreview.set,
    previewClear = CausalDataPreview.clear;
  CausalDataPreview.set = (data) => {
    previewSet(data);
    dataToolbar.hidden = false;
  };
  CausalDataPreview.clear = () => {
    previewClear();
    dataToolbar.hidden = true;
  };
  for (const id of ["random-model-seed", "random-data-seed"])
    $(id).addEventListener("input", () => {
      CausalDataPreview.clear();
      $("easy-result").hidden = true;
      groundTruthSignature = null;
    });
  function truthStamp() {
    return JSON.stringify({ graph: signature(), source: dataSource, file: fileGeneration, mapping: columnMapping });
  }
  let benchmarkTruth;
  async function addTruth(section, target, source, sourceInfo, fullAction, fullReference, graphNodes, graphEdges, used, intervention, reference) {
    const stamp = truthStamp();
    let label = "Ground truth",
      value = null,
      detail = "",
      status = "UNAVAILABLE";
    try {
      if (source === "random") {
        const result = await request("sample_reference", {
          source: "random",
          token: sourceInfo.token,
          sample_id: sourceInfo.sample_id,
          ...(sourceInfo.random_key ? { random_key: sourceInfo.random_key } : {}),
          nodes: graphNodes,
          edges: graphEdges,
          type: "interventional",
          summary: "mean_difference",
          targets: [target],
          intervention,
          reference,
          Z: [],
          n: Math.max(...Object.values(randomConfig().random_cluster_sizes || {}), 1) > 8 ? 512 : 2048,
          max_seconds: 10,
        });
        const ref = result.model_reference;
        value = ref?.values?.[target];
        status = ref?.status || "UNAVAILABLE";
        label = result.reference_kind === "exact_model_mean" ? "Ground truth (exact)" : "Model reference (Monte Carlo)";
        detail = "Mean difference in this fixed simulated model, not an average of the generated rows.";
        if (result.reference_kind === "monte_carlo_model_mean")
          detail +=
            " Approximate result using " +
            result.reference_draws +
            " draws. " +
            (Number.isFinite(ref?.standard_errors?.[target]) ? "Monte Carlo standard error: " + ref.standard_errors[target].toPrecision(3) : "");
      } else {
        const d = window.causalEngineBenchmark;
        if (!d) return;
        const actions = Object.keys(fullAction);
        if (actions.length !== 1 || columnMapping[actions[0]] !== d.treatment || columnMapping[target] !== d.outcome || sourceInfo.n !== d.rows)
          return;
        const a = fullAction[actions[0]],
          b = fullReference[actions[0]];
        if (![0, 1].includes(a) || ![0, 1].includes(b)) return;
        const truth = await (benchmarkTruth ??= fetch("./benchmarks/ground-truth.json").then((r) => {
            if (!r.ok) throw Error("Benchmark reference is unavailable.");
            return r.json();
          })),
          row = truth.datasets[d.id];
        if (!row || (row.factual_sha256 && row.factual_sha256 !== d.sha256)) return;
        if (row.status === "AVAILABLE") {
          value = (a - b) * row.value;
          status = "OK";
          detail =
            "Mean of supplied expected treatment effects across the " +
            row.n.toLocaleString() +
            " released rows. This is not a population ATE or an average of noisy realized differences.";
        } else detail = row.reason || "This dataset has no supplied unit-level ground truth.";
      }
    } catch (error) {
      detail = "Reference unavailable: " + error.message;
    }
    if (stamp !== truthStamp()) return;
    const box = document.createElement("div");
    box.className = "ground-truth";
    box.dataset.status = status;
    box.dataset.outcome = target;
    box.dataset.value = status === "OK" && Number.isFinite(value) ? value : "";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const result = document.createElement("span");
    result.textContent = status === "OK" && Number.isFinite(value) ? value.toFixed(3) : "Not available";
    box.append(strong, result);
    if (detail) {
      const details = document.createElement("details"),
        summary = document.createElement("summary"),
        p = document.createElement("p");
      summary.textContent = "Definition";
      p.textContent = detail;
      details.append(summary, p);
      box.append(details);
    }
    section.append(box);
    groundTruthSignature = truthStamp();
  }
  function replayData(source, projected, graphNodes, graphEdges) {
    let data = projected;
    if (source === "random") {
      const mapping = {},
        types = {};
      for (const node of graphNodes.filter((n) => n.observed)) {
        const variable = model.variables[node.name];
        const columns = variable.columns;
        mapping[node.name] = columns.length === 1 ? columns[0] : [...columns];
        for (const column of columns) types[column] = variable.variable_type;
      }
      data = CausalCSV.project(CausalCSV.parse(sample.csv), mapping, graphNodes, types);
    }
    return {
      csv: CausalDataPreview.csv({ headers: data.columns, rows: data.rows }),
      nodes: graphNodes,
      edges: graphEdges,
      mapping: structuredClone(data.mapping),
      column_types: structuredClone(data.column_types),
      column_codebooks: structuredClone(data.column_codebooks || {}),
      data_seed: source === "random" ? sample.source_seed ?? Number($("data-seed").value) : 5,
    };
  }
  function estimateRow(outcome, result, used, omitted, context, multiple) {
    const e = result.data_estimate,
      section = document.createElement("section");
    section.className = "outcome-result";
    const h = document.createElement("h3");
    h.textContent = outcome;
    if (multiple) section.append(h);
    const values = e?.values || {},
      keys = Object.keys(values),
      ok = e?.status === "OK" && keys.some((k) => Number.isFinite(values[k]));
    for (const name of ok ? keys : [outcome]) {
      const p = document.createElement("p");
      p.className = "outcome-value";
      p.dataset.outcome = name;
      p.dataset.status = e?.status || "UNAVAILABLE";
      p.dataset.value = ok && Number.isFinite(values[name]) ? values[name] : "";
      p.textContent = ok && Number.isFinite(values[name]) ? values[name].toFixed(3) : "Not available";
      section.append(p);
    }
    if (!ok) {
      const note = document.createElement("p");
      note.textContent = "No estimate was returned. See Details.";
      section.append(note);
    }
    const raw = [e?.warning, e?.info].filter(Boolean).join(" ");
    if (raw) {
      const warning = document.createElement("p");
      warning.className = "easy-warning";
      warning.textContent =
        e?.estimation_details?.method_id === "balancing_aipw_v1"
          ? raw
          : /weak|coverage|overlap/i.test(raw)
            ? "Approximate estimate: too few comparable records may make this result unreliable."
            : raw;
      section.append(warning);
    }
    if (omitted.length) {
      const note = document.createElement("p");
      note.textContent =
        "Computed actions: " + (used.join(", ") || "none") + ". " + omitted.join(", ") + " are not ancestors of this outcome in the drawn graph.";
      section.append(note);
    }
    CausalEstimationDetails.attach(section, e, context);
    return section;
  }
  $("estimation-method").onchange = () => {
    if (running) return;
    $("easy-result").hidden = true;
    $("outcome-results").replaceChildren();
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    groundTruthSignature = null;
    progress.textContent = "";
  };
  run.onclick = async () => {
    if (running) return;
    let projected, fullAction, fullReference;
    try {
      validateQuestion();
      for (const id of ["contrast-action", "contrast-reference"])
        if (!$(id).disabled && ($(id).value === "" || !Number.isFinite(Number($(id).value))))
          throw Error("Enter finite treatment and reference values.");
      fullAction = actionValues();
      fullReference = checkedAssignments("query-reference");
      if (![fullAction, fullReference].every((o) => Object.values(o).every((v) => typeof v === "number" && Number.isFinite(v))))
        throw Error("Use finite numeric treatment and reference values.");
      if (!dataSource) throw Error("Choose Upload CSV or Random Data.");
      if ($("query-type").value !== "interventional" || Object.keys(queryEvidence()).length)
        throw Error("Estimation supports interventional mean differences without factual evidence. Clear factual evidence in settings.");
      if (dataSource === "csv") {
        if (csvReadPending) throw Error("Wait for the selected CSV file to finish reading.");
        if (!csvTable) throw Error("Choose a valid CSV file first.");
        projected = CausalCSV.project(csvTable, columnMapping, nodes, window.causalEngineBenchmark?.node_types || {});
        if (window.causalEngineBenchmark?.category_levels)
          projected.column_codebooks = Object.fromEntries(
            Object.entries(window.causalEngineBenchmark.category_levels).filter(([name]) => projected.columns.includes(name))
          );
      }
      if (dirty) throw Error("Apply pending node changes in settings first.");
    } catch (e) {
      $("data-error").textContent = e.message;
      return;
    }
    const targets = queryNames("query-y"),
      actions = queryNames("query-x"),
      version = revision,
      graphNodes = structuredClone(nodes),
      graphEdges = structuredClone(edges),
      savedY = $("query-y").value,
      savedSummary = $("query-summary").value,
      source = dataSource,
      requestedMethod = methodChoice();
    setBusy(true, "Estimate");
    resultPanel("Mean difference");
    $("data-error").textContent = "";
    progress.textContent = source === "csv" ? "Reading selected data on your device…" : "Generating random data on your device…";
    const results = [];
    let sourceInfo;
    try {
      if (source === "csv") {
        sourceInfo = await request("load_data", { nodes: graphNodes, edges: graphEdges, ...projected, data_seed: 5 });
        if (sourceInfo.status !== "READY") throw Error(sourceInfo.reason || "CSV data could not be loaded.");
      } else {
        sourceInfo = await ensureRandomData();
      }
      let replay;
      try {
        replay = replayData(source, projected, graphNodes, graphEdges);
      } catch (error) {
        replay = { error: error.message };
      }
      for (const target of targets) {
        if (revision !== version || draftDirty) throw Error("The graph changed. Estimate again.");
        const ancestors = ancestorsOf(target),
          validKeys = [fullAction, fullReference].every((o) => Object.keys(o).length === actions.length && actions.every((n) => n in o)),
          used = actions.filter((n) => !validKeys || ancestors.has(n)),
          omitted = actions.filter((n) => !used.includes(n)),
          pick = (o) => (validKeys ? Object.fromEntries(Object.entries(o).filter(([n]) => used.includes(n))) : o);
        const result = await request("estimate_data", {
          source,
          estimation_method: requestedMethod,
          ...(source === "csv"
            ? { data_id: sourceInfo.data_id, ...(sourceInfo.binding_key ? { binding_key: sourceInfo.binding_key } : {}) }
            : { token: sourceInfo.token, sample_id: sourceInfo.sample_id, ...(sourceInfo.random_key ? { random_key: sourceInfo.random_key } : {}) }),
          nodes: graphNodes,
          edges: graphEdges,
          type: "interventional",
          summary: "mean_difference",
          targets: [target],
          intervention: pick(fullAction),
          reference: pick(fullReference),
          Z: queryNames("query-z"),
          ...(source === "csv" && window.causalEngineBenchmark?.estimate_options ? window.causalEngineBenchmark.estimate_options : {}),
          max_seconds: 10,
        });
        if (revision !== version || draftDirty) throw Error("The graph changed. Estimate again.");
        results.push({ outcome: target, result, computed_actions: used });
        const context = {
          ...replay,
          query: {
            type: "interventional",
            summary: "mean_difference",
            targets: [target],
            estimation_method: requestedMethod,
            intervention: pick(fullAction),
            reference: pick(fullReference),
            Z: queryNames("query-z"),
            max_seconds: 10,
          },
          estimate_options: source === "csv" ? structuredClone(window.causalEngineBenchmark?.estimate_options || {}) : {},
        };
        const section = estimateRow(target, result, used, omitted, context, targets.length > 1);
        $("outcome-results").append(section);
        await addTruth(
          section,
          target,
          source,
          sourceInfo,
          fullAction,
          fullReference,
          graphNodes,
          graphEdges,
          used,
          pick(fullAction),
          pick(fullReference)
        );
      }
      window.causalEngineDataResults = results;
      window.causalEngineDataSource = sourceInfo;
      $("batch-regime").textContent =
        Object.entries(fullAction)
          .map(([n, v]) => n + "=" + JSON.stringify(v))
          .join(", ") +
        " vs " +
        Object.entries(fullReference)
          .map(([n, v]) => n + "=" + JSON.stringify(v))
          .join(", ");
      $("easy-result").hidden = false;
      const completion = results.every((row) => row.result.data_estimate?.status === "OK") ? "Estimated from " : "Processed ";
      progress.textContent = completion + sourceInfo.n.toLocaleString() + (source === "csv" ? " CSV rows." : " random records.");
    } catch (e) {
      $("data-error").textContent = e.message;
      $("easy-result").hidden = true;
      progress.textContent = "";
    } finally {
      window.causalEngineBatch = false;
      $("query-y").value = savedY;
      $("query-summary").value = savedSummary;
      updateQuery();
      clearComputation();
      setBusy(false);
      checkChanges();
      describe();
    }
  };
  window.refreshCSVMapping = renderMapping;
  let previousGraph = null;
  const stateFields = [
    "role-a",
    "role-c",
    "role-y",
    "role-m",
    "markov-order",
    "markov-k",
    "query-type",
    "query-x",
    "query-y",
    "query-z",
    "query-summary",
    "query-values",
    "query-reference",
    "query-evidence",
    "rows",
    "model-seed",
    "data-seed",
    "noise",
  ];
  function rememberGraph() {
    if (previousGraph || !(custom || draftDirty || dirty)) return;
    previousGraph = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      bends: [...bends].map(([k, v]) => [...JSON.parse(k), v.x, v.y]),
      roles: structuredClone(roles),
      current,
      custom,
      draftDirty,
      stages: structuredClone(stages),
      stageNext,
      fields: Object.fromEntries(stateFields.map((id) => [id, $(id).value])),
      extent: svg.getAttribute("viewBox"),
      minWidth: svg.style.minWidth,
      height: svg.style.height,
      columns: svg.dataset.columns,
    };
    $("restore-graph").hidden = false;
  }
  $("restore-graph").onclick = () => {
    if (running || !previousGraph) return;
    const s = previousGraph;
    loading = true;
    current = s.current;
    roles = s.roles;
    stages = s.stages;
    stageNext = s.stageNext;
    stageFields();
    svg.setAttribute("viewBox", s.extent);
    svg.style.minWidth = s.minWidth;
    svg.style.height = s.height;
    svg.dataset.columns = s.columns;
    loadGraph({ nodes: s.nodes, edges: s.edges, bends: s.bends });
    for (const [id, value] of Object.entries(s.fields)) $(id).value = value;
    $("role-general").hidden = current === "sequential";
    $("role-timeline").hidden = current !== "sequential";
    $("role-m-label").hidden = current !== "frontdoor";
    $("markov-k-label").hidden = $("markov-order").value !== "custom";
    custom = s.custom;
    draftDirty = s.draftDirty;
    choose.value = custom ? "custom" : current;
    $("right-settings-slot").hidden = true;
    editor.hidden = true;
    document.body.dataset.view = "easy";
    baseline = structure();
    loading = false;
    previousGraph = null;
    $("restore-graph").hidden = true;
    $("easy-result").hidden = true;
    $("estimate-options").hidden = true;
    CausalDataPreview.clear();
    dataSource = null;
    csvTable = null;
    window.causalEngineBenchmark = null;
    window.causalEngineDataSource = null;
    window.causalEngineDataResults = null;
    $("benchmark-analysis-note").replaceChildren();
    $("data-error").textContent = "";
    $("role-error").textContent = "";
    $("role-status").textContent = draftDirty ? "Your draft inputs were restored. Update graph to apply them." : "";
    progress.textContent = "Previous graph restored. Data and results were cleared.";
    updateQuery();
    render();
    describe();
    run.disabled = identifyButton.disabled = estimateButton.disabled = draftDirty;
    checkChanges();
  };
  window.causalEngineBenchmarkStamp = () =>
    JSON.stringify({
      graph: signature(),
      inputs: [...document.querySelectorAll("#role-fields input,#role-fields select")].map((el) => [
        el.id,
        el.dataset.stage,
        el.dataset.role,
        el.value,
      ]),
    });
  window.causalEngineBenchmarkLock = (value) => setBusy(value, "Benchmark");
  window.causalEngineEstimateBenchmark = async (dataset, text) => {
    setBusy(false);
    validateQuestion();
    const actions = queryNames("query-x"),
      targets = queryNames("query-y"),
      observed = nodes.filter((n) => n.observed),
      covariates = observed.filter((n) => clusterEligible(n.name));
    if (current === "frontdoor" || current === "sequential")
      throw Error(
        "This benchmark has no " +
          (current === "frontdoor" ? "mediator" : "time-specific treatment and outcome") +
          " column bindings for the selected structure. Your graph is unchanged. Use Upload CSV for those bindings."
      );
    if (actions.length !== 1 || targets.length !== 1 || covariates.length !== 1 || observed.length !== 3)
      throw Error(
        "Benchmark binding needs one treatment, one outcome, and one baseline covariate cluster in the current graph. Your graph is unchanged. Use Upload CSV → Data columns for custom bindings."
      );
    const graphBefore = structure();
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    const reuse =
      bindingActive &&
      dataSource === "csv" &&
      window.causalEngineBenchmark?.id === dataset.id &&
      csvRaw === text &&
      csvBindingGraph === dataGraphKey();
    if (!reuse) {
      window.causalEngineUseCSV(text, dataset.label, dataset);
      columnMapping = { [actions[0]]: dataset.treatment, [targets[0]]: dataset.outcome, [covariates[0].name]: [...dataset.covariates] };
    }
    mappingGraph = "";
    bindingActive = true;
    renderMapping();
    $("benchmark-options").hidden = false;
    $("csv-options").hidden = true;
    $("random-options").hidden = true;
    $("run-estimate").hidden = true;
    $("choose-csv").setAttribute("aria-pressed", "false");
    $("choose-random").setAttribute("aria-pressed", "false");
    $("choose-benchmark").setAttribute("aria-pressed", "true");
    await run.onclick();
    if (structure() !== graphBefore) throw Error("The graph changed. Estimate again.");
    return window.causalEngineDataResults;
  };

  const nativePointerUp = svg.onpointerup;
  svg.onpointerup = (event) => {
    if (drag?.node && !drag.moved && mode === "move" && isCluster(drag.node.name) && boundMembers(drag.node.name).length) {
      const name = drag.node.name;
      drag = null;
      toggleView(name);
      return;
    }
    nativePointerUp(event);
  };
  svg.addEventListener(
    "pointerdown",
    (event) => {
      if (!ClusterView.any()) return;
      const group = event.target.closest("[data-node]");
      if (!group) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const name = group.dataset.node;
      if (isCluster(name)) {
        toggleView(name);
      } else select({ name });
    },
    true
  );
  svg.addEventListener(
    "keydown",
    (event) => {
      const name = event.target.closest("[data-node]")?.dataset.node;
      if (name && isCluster(name) && boundMembers(name).length && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleView(name);
      }
    },
    true
  );
  svg.addEventListener(
    "dblclick",
    (event) => {
      if (ClusterView.any()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );
  preset("adjustment");
})();
