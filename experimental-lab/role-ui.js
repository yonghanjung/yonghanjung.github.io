(() => {
  document.body.dataset.view = "easy";
  $("easy-layout").append($("easy-result"));
  const choose = $("easy-example"),
    run = $("run-estimate"),
    progress = $("easy-progress"),
    canvasBox = document.querySelector(".canvas"),
    editorLayout = document.querySelector("#editor-view .layout");
  canvasBox.append($("node-menu"));
  $("graph-slot").prepend(canvasBox);
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
      nodes: nodes.map(({ name, observed, dimension, family, variable_type, category_levels, members, noise_only }) => ({
        name,
        observed,
        dimension,
        family,
        variable_type,
        category_levels,
        members,
        noise_only,
      })),
      edges,
      query: [
        "estimate-query",
        "query-type",
        "query-x",
        "query-y",
        "query-z",
        "query-conditioning",
        "query-summary",
        "query-values",
        "query-reference",
        "query-evidence",
      ].map((id) => $(id).value),
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
        const c = cov(s.c),
          a = cov(s.a);
        return { id: s.id, c: c.names, clusters: { ...c.clusters, ...a.clusters }, a: a.names, y: names(s.y), m: [] };
      });
    const c = cov($("role-c").value),
      a = cov($("role-a").value);
    return [
      {
        id: 1,
        a: a.names,
        c: c.names,
        clusters: { ...c.clusters, ...a.clusters },
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
    for (const stage of fs)
      for (const name of stage.a) if (stage.clusters[name]?.length > 8) throw Error("Treatment clusters support at most 8 members.");
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
      const members = key === "a" ? fs[t].clusters[n] : null;
      ns.push({
        name: n,
        observed: true,
        dimension: members?.length || 1,
        family: key === "a" ? "binary" : "linear",
        ...(members ? { members: [...members] } : {}),
        x: 100,
        y: 100,
      });
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
  let methodMode = null,
    binaryMethod = "aipw",
    continuousMethod = "outcome_regression";
  function methodChoice() {
    let supportedQuery = $("query-type").value === "interventional" && ["mean", "mean_difference"].includes($("query-summary").value);
    try {
      supportedQuery &&= Object.keys(queryEvidence()).length === 0;
    } catch {
      supportedQuery = false;
    }
    const actions = queryNames("query-x"),
      targets = queryNames("query-y"),
      action = nodes.find((n) => n.name === actions[0]),
      kind =
        (dataSource === "random" && model?.variables?.[action?.name]?.variable_type) ||
        action?.variable_type ||
        (action?.family === "binary" ? "binary" : "continuous"),
      scalarTargets =
        targets.length > 0 &&
        targets.every((name) => nodes.find((n) => n.name === name)?.observed && nodes.find((n) => n.name === name)?.dimension === 1),
      conditional = supportedQuery && queryNames("query-conditioning").length > 0,
      continuous = supportedQuery && actions.length === 1 && action?.observed && action.dimension === 1 && kind === "continuous" && scalarTargets;
    const baseline =
      current === "adjustment" &&
      !custom &&
      actions.length === 1 &&
      targets.length > 0 &&
      action?.dimension >= 1 &&
      action.dimension <= 8 &&
      action.observed &&
      kind === "binary" &&
      scalarTargets;
    const mode = conditional ? "conditional" : continuous ? "continuous" : baseline ? "binary" : "auto",
      select = $("estimation-method");
    if (mode !== methodMode && mode !== "auto") select.value = conditional ? "outcome_regression" : continuous ? continuousMethod : binaryMethod;
    const changed = mode !== methodMode;
    methodMode = mode;
    for (const option of select.options) option.disabled = !option.value || ((continuous || conditional) && option.value !== "outcome_regression");
    $("estimation-method-wrap").hidden = mode === "auto";
    $("estimation-method-note").hidden = !(continuous || conditional);
    $("estimation-method-note").textContent = conditional
      ? "Row-specific conditioning uses certified conditional Outcome Regression or graph plug-in; conditional AIPW/IPW and confidence intervals are not implemented."
      : continuous
        ? "Continuous scalar treatment: select Outcome Regression (Plug-in). AIPW and IPW currently support binary treatment only."
        : "";
    $("estimation-method").disabled = running;
    if (changed) window.CausalPickers?.refresh();
    return mode === "auto" ? "auto" : select.value;
  }
  function describe() {
    if (["mean", "mean_difference"].includes($("query-summary").value))
      $("estimate-query").value = $("query-summary").value === "mean" ? "apo" : "ate";
    methodChoice();
    refreshRandomDimensions();
    refreshRandomTreatments();
    const legacy = $("dimension").closest("label");
    legacy.hidden = dataSource === "random" && [...randomCandidates(), ...randomTreatments()].some((n) => n.name === selected?.name);
    for (const [k, id] of [
      ["model-seed", "random-model-seed"],
      ["data-seed", "random-data-seed"],
    ])
      if (document.activeElement !== $(id)) $(id).value = $(k).value;
    renderAssignments();
  }
  const estimand = () => ($("estimate-query").value === "apo" ? "apo" : "ate");
  const querySummary = () => (estimand() === "apo" ? "mean" : "mean_difference");
  function actionMembers(name) {
    const n = nodes.find((n) => n.name === name),
      width = Number(n?.dimension) || 1;
    const known = boundMembers(name);
    return known.length === width
      ? known
      : n?.members?.length === width
        ? n.members
        : width > 1
          ? Array.from({ length: width }, (_, i) => name + "[" + i + "]")
          : [known[0] || name];
  }
  function syncAssignmentWidths() {
    for (const name of queryNames("query-x")) {
      const node = nodes.find((n) => n.name === name);
      if (node?.members && node.members.length !== node.dimension) node.members = [...actionMembers(name)];
    }
    for (const field of ["query-values", "query-reference"]) {
      let values;
      try {
        values = assignments(field);
      } catch {
        continue;
      }
      const fallback = field === "query-values" ? 1 : 0;
      for (const name of queryNames("query-x")) {
        const width = actionMembers(name).length,
          old = values[name];
        if (width > 1 && (!Array.isArray(old) || old.length !== width))
          values[name] = Array.from({ length: width }, (_, i) => (Array.isArray(old) ? old[i] ?? fallback : Number.isFinite(old) ? old : fallback));
        else if (width === 1 && Array.isArray(old)) values[name] = old[0] ?? fallback;
      }
      $(field).value = JSON.stringify(values);
    }
  }
  function clearQueryResult() {
    clearComputation();
    $("easy-result").hidden = true;
    $("outcome-results").replaceChildren();
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    groundTruthSignature = null;
    progress.textContent = "";
    baseline = structure();
  }
  function renderAssignments() {
    syncAssignmentWidths();
    const actions = queryNames("query-x"),
      vector = actions.length > 1 || actions.some((a) => actionMembers(a).length > 1),
      apo = estimand() === "apo";
    $("scalar-assignments").hidden = vector;
    $("contrast-reference-label").hidden = apo;
    $("contrast-vs").hidden = apo;
    $("estimate-query").disabled = running;
    if (!vector) {
      for (const [id, field] of [
        ["contrast-action", "query-values"],
        ["contrast-reference", "query-reference"],
      ]) {
        let value;
        try {
          value = assignments(field)[actions[0]];
        } catch {}
        $(id).disabled = running || !actions.length || (apo && id === "contrast-reference");
        $(id).value = typeof value === "number" && Number.isFinite(value) ? value : "";
      }
    }
    const box = $("treatment-components");
    const key = JSON.stringify([actions.map((a) => [a, actionMembers(a)]), apo]);
    if (box.dataset.assignments !== key) {
      box.dataset.assignments = key;
      box.replaceChildren();
      if (vector)
        for (const action of actions) {
          const fieldset = document.createElement("fieldset"),
            legend = document.createElement("legend");
          legend.textContent = action + " · joint assignment";
          fieldset.append(legend);
          actionMembers(action).forEach((member, i) => {
            const row = document.createElement("div");
            row.className = "contrast-controls";
            for (const [field, label] of [["query-values", "Treatment"], ...(!apo ? [["query-reference", "Reference"]] : [])]) {
              const l = document.createElement("label"),
                input = document.createElement("input");
              l.textContent = member + " · " + label;
              input.type = "number";
              input.step = "any";
              input.dataset.action = action;
              input.dataset.member = i;
              input.dataset.assignment = field;
              input.setAttribute("aria-label", action + " · " + member + " · " + label + " value");
              input.onchange = () => {
                if (input.value === "" || !Number.isFinite(Number(input.value))) {
                  $("role-error").textContent = "Enter finite numeric treatment values.";
                  clearQueryResult();
                  return;
                }
                try {
                  const values = assignments(field),
                    width = actionMembers(action).length;
                  if (width > 1) {
                    const tuple = Array.isArray(values[action]) ? [...values[action]] : Array(width).fill(field === "query-values" ? 1 : 0);
                    tuple[i] = Number(input.value);
                    values[action] = tuple;
                  } else values[action] = Number(input.value);
                  $(field).value = JSON.stringify(values);
                  $("role-error").textContent = "";
                  clearQueryResult();
                } catch (error) {
                  $("role-error").textContent = error.message;
                }
              };
              l.append(input);
              row.append(l);
            }
            fieldset.append(row);
          });
          box.append(fieldset);
        }
    }
    for (const input of box.querySelectorAll("input")) {
      input.disabled = running;
      if (document.activeElement !== input) {
        try {
          const value = assignments(input.dataset.assignment)[input.dataset.action];
          input.value = Array.isArray(value) ? value[Number(input.dataset.member)] : value ?? "";
        } catch {
          input.value = "";
        }
      }
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
        $("query-conditioning").value = "";
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
      $("query-summary").value = querySummary();
      $("query-values").value = JSON.stringify(
        Object.fromEntries(
          g.X.map((n) => [n, g.nodes.find((v) => v.name === n).dimension > 1 ? Array(g.nodes.find((v) => v.name === n).dimension).fill(1) : 1])
        )
      );
      $("query-reference").value = JSON.stringify(
        Object.fromEntries(
          g.X.map((n) => [n, g.nodes.find((v) => v.name === n).dimension > 1 ? Array(g.nodes.find((v) => v.name === n).dimension).fill(0) : 0])
        )
      );
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
      run.disabled = dataSource === "random" && !randomDataReady();
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
    choose.value = "edit-graph";
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
      nodes: nodes.map(({ name, observed, dimension, family, variable_type, category_levels, members, noise_only }) => ({
        name,
        observed,
        dimension,
        family,
        variable_type,
        category_levels,
        members,
        noise_only,
      })),
      edges,
    });
  let dataPromptTimer;
  function requestData(message, target) {
    progress.textContent = message;
    progress.classList.remove("data-required");
    void progress.offsetWidth;
    progress.classList.add("data-required");
    clearTimeout(dataPromptTimer);
    dataPromptTimer = setTimeout(() => progress.classList.remove("data-required"), 650);
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }
  function checkChanges() {
    if (groundTruthSignature && groundTruthSignature !== truthStamp()) {
      document.querySelectorAll(".comparison-definition").forEach((e) => e.remove());
      document.querySelectorAll("[data-estimate-comparison]").forEach((table) => {
        table.querySelectorAll("[data-reference-value], [data-comparison-error]").forEach((cell) => {
          cell.textContent = "N/A";
          cell.dataset.status = "UNAVAILABLE";
          cell.dataset.value = "";
        });
      });
      groundTruthSignature = null;
    }
    if (retainedRandomSignature && retainedRandomSignature !== randomSignature()) retainedRandomSignature = null;
    const snapshotKey = CausalDataPreview.key();
    if (snapshotKey && (snapshotKey.graph !== dataGraphKey() || (snapshotKey.random && snapshotKey.random !== randomSignature()))) {
      CausalDataPreview.clear();
      if (!running) progress.textContent = "";
    }
    if (!loading && !running && structure() !== baseline) {
      markCustom();
      clearQueryResult();
      if (window.refreshCSVMapping) window.refreshCSVMapping();
    }
    const issue = temporalIssue();
    if (issue) {
      $("role-error").textContent = issue;
      run.disabled = true;
      identifyButton.disabled = true;
      estimateButton.disabled = true;
    } else if (!draftDirty && !running) {
      run.disabled = dataSource === "random" && !randomDataReady();
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
    if (choose.value === "edit-graph") {
      choose.value = custom ? "edit-graph" : current;
      openDetails();
      return;
    }
    const key = choose.value;
    if (
      (custom || draftDirty || (document.body.dataset.view === "details" && beforeEdit !== signature())) &&
      !confirm("Replace your draft and edited graph with this structure’s starting values?")
    ) {
      choose.value = custom ? "edit-graph" : current;
      return;
    }
    if (document.body.dataset.view === "details") closeDetails();
    preset(key);
  };
  $("easy-records").onchange = () => {
    const n = Number($("easy-records").value);
    if (!Number.isSafeInteger(n) || n < 1 || n > 5000) {
      $("data-error").textContent = "Records must be a whole number from 1 to 5,000.";
      return;
    }
    if ($("data-error").textContent === "Records must be a whole number from 1 to 5,000.") $("data-error").textContent = "";
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
  let graphZoom = 1;
  function zoomGraph(next) {
    const slot = $("graph-viewport"),
      box = slot.getBoundingClientRect(),
      center = new DOMPoint(box.left + slot.clientLeft + slot.clientWidth / 2, box.top + slot.clientTop + slot.clientHeight / 2),
      anchor = center.matrixTransform(svg.getScreenCTM().inverse());
    graphZoom = Math.max(1, Math.min(3, next));
    slot.style.setProperty("--graph-zoom", graphZoom);
    $("graph-zoom-level").textContent = graphZoom * 100 + "%";
    $("graph-zoom-out").disabled = graphZoom === 1;
    $("graph-zoom-in").disabled = graphZoom === 3;
    if (graphZoom === 1) slot.scrollLeft = slot.scrollTop = 0;
    else {
      const point = anchor.matrixTransform(svg.getScreenCTM());
      slot.scrollLeft += point.x - center.x;
      slot.scrollTop += point.y - center.y;
    }
  }
  $("graph-fit").onclick = () => !running && zoomGraph(1);
  $("graph-zoom-out").onclick = () => !running && zoomGraph(graphZoom - 0.5);
  $("graph-zoom-in").onclick = () => !running && zoomGraph(graphZoom + 0.5);
  function openDetails() {
    if (running) return;
    beforeEdit = signature();
    editor.hidden = false;
    $("right-settings-slot").hidden = false;
    document.body.dataset.view = "details";
    moveGraphAnalysis(true);
    zoomGraph(1);
  }
  function closeDetails() {
    if (beforeEdit !== signature()) markCustom();
    editor.hidden = true;
    $("right-settings-slot").hidden = true;
    document.body.dataset.view = "easy";
    moveGraphAnalysis(false);
    zoomGraph(1);
    $("graph-viewport").style.removeProperty("--graph-zoom");
    describe();
  }
  $("back-easy").onclick = closeDetails;
  for (const id of ["contrast-action", "contrast-reference"])
    $(id).onchange = () => {
      const value = Number($(id).value);
      if ($(id).value === "" || !Number.isFinite(value)) {
        $("role-error").textContent = "Enter finite numeric treatment and reference values.";
        return;
      }
      const field = id === "contrast-action" ? "query-values" : "query-reference";
      $(field).value = JSON.stringify(Object.fromEntries(queryNames("query-x").map((n) => [n, value])));
      if (
        $("role-error").textContent === "Enter finite numeric treatment and reference values." &&
        [...document.querySelectorAll("#contrast-action,#contrast-reference,#scalar-assignments input,#treatment-components input")]
          .filter((input) => !input.disabled && input.getClientRects().length)
          .every((input) => input.value !== "" && Number.isFinite(Number(input.value)))
      )
        $("role-error").textContent = "";
      clearQueryResult();
    };
  for (const box of [$("scalar-assignments"), $("treatment-components")]) box.addEventListener("input", clearQueryResult);
  $("estimate-query").onchange = () => {
    $("query-summary").value = querySummary();
    updateQuery();
    renderAssignments();
    clearQueryResult();
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
    querySettings.inert = value;
    canvasBox.inert = value;
    for (const el of document.querySelectorAll(
      "#role-fields input,#role-fields select,#role-fields button,.contrast-controls input,#estimate-query,#random-options input,#random-options select,#csv-paste,#load-pasted-csv,#load-example-csv,#csv-mapping select,#csv-mapping input,#csv-mapping button,#csv-file"
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
        (id === "run-estimate" && dataSource === "random" && !randomDataReady()) ||
        (["benchmark-estimate", "benchmark-download"].includes(id) && !$("benchmark-select").value);
    identifyButton.textContent = value && label === "Identify" ? "Identifying…" : "Identify";
    estimateButton.textContent = value && ["Estimate", "Benchmark"].includes(label) ? "Estimating…" : "Estimate";
    run.textContent = value && label === "Estimate" ? "Estimating…" : "Run estimate";
    if (!value) {
      describe();
      updateColumnActions();
    }
  }
  function validateQuestion() {
    checkChanges();
    if (draftDirty) throw Error("Update the graph before continuing.");
    const issue = temporalIssue();
    if (issue) throw Error(issue);
    if ((!queryNames("query-x").length && !queryNames("query-conditioning").length) || !queryNames("query-y").length)
      throw Error("Enter at least one treatment and outcome, then update the graph.");
    for (const [id, label] of [
      ["query-x", "Treatment"],
      ["query-y", "Outcome"],
    ])
      for (const name of queryNames(id)) {
        const node = nodes.find((node) => node.name === name);
        if (!node) throw Error(label + " " + name + " is not in the current graph. Choose an existing Observed node.");
        if (!node.observed) throw Error(label + " " + name + " is Unobserved. Choose an Observed node or mark it as Observed.");
      }
    const conditioning = queryNames("query-conditioning");
    for (const name of conditioning) {
      if (!nodes.some((node) => node.name === name && node.observed))
        throw Error("Conditioning variable " + name + " must be an Observed node in the current graph.");
      if ([...queryNames("query-x"), ...queryNames("query-y")].includes(name))
        throw Error("This conditional interface requires distinct Treatment, Outcome and Conditioning on roles.");
    }
    if (conditioning.length && $("query-type").value !== "interventional")
      throw Error("Row-specific Conditioning on currently supports Interventional queries; factual counterfactual evidence is separate.");
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
    showGraphAnalysis();
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
    resultPanel(estimand() === "apo" ? "Identification · APO" : "Identification · ATE");
    progress.textContent = "Checking the graph…";
    const output = [];
    try {
      for (const target of targets) {
        const result = await request("identify", {
          nodes,
          edges,
          X: actions,
          Y: [target],
          Z: [],
          conditioning: queryNames("query-conditioning"),
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
            const math = CausalExpectation.render(result, target, actions, nodes, {
              estimand: estimand(),
              members: Object.fromEntries(actions.map((a) => [a, actionMembers(a)])),
            });
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
  estimateButton.onclick = async () => {
    if (running) return;
    showGraphAnalysis(true);
    try {
      validateQuestion();
      $("estimate-options").hidden = false;
      if ($("choose-benchmark").getAttribute("aria-pressed") === "true") {
        await window.CausalBenchmarkUI.estimateSelected();
      } else if (dataSource === "random" && !randomDataReady()) {
        requestData("Generate Data with the current settings before estimating.", $("generate-data"));
      } else if (dataSource === "random" || (dataSource === "csv" && csvTable)) {
        await run.onclick();
        if (!$("easy-result").hidden) $("easy-result").scrollIntoView({ block: "start", behavior: "smooth" });
        else if ($("data-error").textContent) $("data-error").scrollIntoView({ block: "nearest" });
      } else {
        requestData(
          dataSource === "csv" ? "Choose a CSV file to estimate." : "Choose data to estimate.",
          $(dataSource === "csv" ? "csv-file" : "choose-csv")
        );
      }
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
  const mappingIssue = document.createElement("p");
  mappingIssue.id = "csv-mapping-issue";
  mappingIssue.hidden = true;
  mappingIssue.tabIndex = -1;
  columnsDetails.append(mappingIssue, $("csv-mapping"));
  $("easy-graph").append(columnsDetails);
  const analysisHost = $("graph-analysis"),
    querySettings = $("graph-query-settings"),
    queryFields = $("graph-query-fields"),
    queryParts = [
      "estimate-query",
      "query-type",
      "query-x",
      "query-y",
      "query-values",
      "query-reference",
      "query-evidence",
      "query-conditioning",
    ].map((id) => $(id).closest("label")),
    analysisParts = [
      identifyButton.parentElement,
      $("estimate-options"),
      progress,
      $("easy-result"),
      columnsDetails,
      $("dataset-tools"),
      ...queryParts,
    ],
    analysisHomes = analysisParts.map((element) => {
      const marker = document.createComment("Graph analysis home");
      element.before(marker);
      return { element, marker };
    });
  function moveGraphAnalysis(open) {
    if (open) {
      analysisHost.prepend(identifyButton.parentElement);
      queryFields.append(...queryParts);
      analysisHost.append($("estimate-options"), columnsDetails, $("dataset-tools"), progress, $("easy-result"));
      analysisHost.dataset.estimateOpen = "false";
      analysisHost.dataset.analysisOpen = "false";
      querySettings.hidden = true;
      analysisHost.hidden = false;
    } else {
      for (const { element, marker } of analysisHomes) marker.after(element);
      analysisHost.hidden = true;
    }
  }
  function showGraphAnalysis(estimate = false) {
    if (document.body.dataset.view !== "details") return;
    analysisHost.dataset.analysisOpen = "true";
    querySettings.hidden = false;
    if (estimate) analysisHost.dataset.estimateOpen = "true";
  }
  queryFields.addEventListener("input", clearQueryResult);
  queryFields.addEventListener("change", clearQueryResult);
  window.causalEngineActiveBindings = () =>
    (bindingActive && dataSource === "csv") ||
    Object.keys(declaredClusters).length > 0 ||
    queryNames("query-x").some((name) => nodes.find((n) => n.name === name)?.dimension > 1) ||
    (dataSource === "random" && randomCandidates().some((n) => randomSize(n.name) > 1));
  function toggleView(name) {
    ClusterView.toggle(name);
    render();
    [...svg.querySelectorAll("[data-node]")].find((g) => g.dataset.node === name)?.focus();
  }
  function isCluster(name) {
    return Boolean(
      (queryNames("query-x").includes(name) && nodes.find((n) => n.name === name)?.dimension > 1) ||
        (dataSource === "random" && randomSize(name) > 1) ||
        declaredClusters[name] ||
        (bindingActive && dataSource === "csv" && Array.isArray(columnMapping[name]))
    );
  }
  function boundMembers(name) {
    if (
      dataSource === "random" &&
      queryNames("query-x").includes(name) &&
      model?.variables?.[name]?.columns?.length === nodes.find((n) => n.name === name)?.dimension
    )
      return [...model.variables[name].columns];
    if (dataSource === "random" && randomSize(name) > 1) {
      const p = randomSize(name),
        v = model?.variables?.[name];
      return v?.shape?.[0] === p ? [...v.columns] : randomNames(name, p);
    }
    if (!(bindingActive && dataSource === "csv")) {
      const node = nodes.find((n) => n.name === name);
      if (queryNames("query-x").includes(name) && node?.dimension > 1)
        return node.members?.length === node.dimension ? [...node.members] : Array.from({ length: node.dimension }, (_, i) => name + "[" + i + "]");
      return declaredClusters[name] || [];
    }
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
      (roles[name]?.role === "c" || queryNames("query-conditioning").includes(name))
    );
  }

  // Keep this CSV's treatment column editor available after reducing a tuple to one column.
  const treatmentColumnEditors = new Set();
  window.causalEngineNodeRenamed = (from, to) => {
    if (from === to) return;
    for (const dictionary of [roles, declaredClusters, randomSizes, columnMapping])
      if (Object.hasOwn(dictionary, from)) {
        dictionary[to] = dictionary[from];
        delete dictionary[from];
      }
    if (treatmentColumnEditors.delete(from)) treatmentColumnEditors.add(to);
    mappingGraph = "";
    ClusterView.clear();
  };
  const mappingEligible = (name) =>
    clusterEligible(name) ||
    (queryNames("query-x").includes(name) &&
      (nodes.find((n) => n.name === name)?.dimension > 1 || declaredClusters[name] || treatmentColumnEditors.has(name)));
  function updateTreatmentDeclaration(name, members) {
    if (members.length > 1) declaredClusters[name] = [...members];
    else delete declaredClusters[name];
    const inputs = current === "sequential" ? [...document.querySelectorAll('#role-stages input[data-role="a"]')] : [$("role-a")];
    for (const input of inputs) {
      const parsed = ClusterSyntax.parse(input.value);
      if (!parsed.names.includes(name)) continue;
      input.value = parsed.names
        .map((alias) => {
          const list = alias === name ? (members.length > 1 ? members : null) : parsed.clusters[alias];
          return list ? alias + "(" + list.join(", ") + ")" : alias;
        })
        .join(", ");
      if (input.dataset.stage !== undefined) stages[Number(input.dataset.stage)].a = input.value;
    }
  }
  function clearCSV() {
    csvTable = null;
    csvRaw = csvName = csvBindingGraph = mappingGraph = "";
    columnMapping = {};
    treatmentColumnEditors.clear();
    bindingActive = false;
    window.causalEngineDataBindings = null;
    $("csv-mapping").replaceChildren();
    $("csv-status").textContent = "";
    CausalDataPreview.clear();
    clearQueryResult();
    refreshBinding();
  }
  function csvSnapshot() {
    if (csvTable)
      CausalDataPreview.set({ csv: csvRaw, table: csvTable, name: csvName, source: "csv", key: { graph: dataGraphKey(), file: fileGeneration } });
  }
  function acceptCSV(text, name, benchmark = null, table = CausalCSV.parse(text)) {
    window.causalEngineBenchmark = benchmark;
    $("benchmark-analysis-note").replaceChildren();
    clearQueryResult();
    bindingActive = true;
    csvBindingGraph = dataGraphKey();
    csvTable = table;
    treatmentColumnEditors.clear();
    for (const name of queryNames("query-x"))
      if (nodes.find((n) => n.name === name)?.dimension > 1 || declaredClusters[name]) treatmentColumnEditors.add(name);
    csvRaw = text;
    csvName = name;
    mappingGraph = "";
    columnMapping = {};
    renderMapping();
    $("csv-status").textContent = name + " · " + csvTable.rows.length.toLocaleString() + " rows";
    csvSnapshot();
  }
  const csvLoadError = (error, candidate) =>
    "Could not load " + candidate + ": " + error.message + (csvTable ? " Previous " + csvName + " data kept." : "");
  window.causalEngineUseCSV = (text, name, benchmark = null) => {
    if (running) throw Error("Wait for the current operation.");
    const table = CausalCSV.parse(text);
    ++fileGeneration;
    csvReadPending = false;
    chooseSource("csv", Boolean(benchmark));
    $("estimate-options").hidden = false;
    $("csv-file").value = "";
    acceptCSV(text, name, benchmark, table);
    $("easy-result").hidden = true;
  };
  window.causalEngineCancelCSVRead = () => {
    ++fileGeneration;
    csvReadPending = false;
  };
  function chooseSource(source, internalBenchmark = false) {
    if (running) return;
    if (!internalBenchmark) leaveBenchmark();
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
    if (document.body.dataset.view === "details") analysisHost.insertBefore(tools, progress);
    else if (source === "random") $("random-options").append(tools);
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
    if (source === "random" && randomDataReady()) showRandomSnapshot();
    refreshBinding();
    run.disabled = draftDirty || Boolean(temporalIssue()) || (source === "random" && !randomDataReady());
  }
  $("choose-csv").onclick = () => chooseSource("csv");
  $("choose-random").onclick = () => {
    chooseSource("random");
    refreshRandomDimensions();
    refreshRandomTreatments();
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
  function clearMappingIssue() {
    mappingIssue.textContent = "";
    mappingIssue.hidden = true;
  }
  function unassignedCSVColumns() {
    if (!csvTable) return [];
    const used = new Set(nodes.filter((n) => n.observed).flatMap((n) => [columnMapping[n.name]].flat().filter((h) => csvTable.headers.includes(h))));
    return csvTable.headers.filter((h) => !used.has(h));
  }
  function updateColumnActions() {
    const count = unassignedCSVColumns().length;
    for (const button of $("csv-mapping").querySelectorAll("button[data-add-unassigned]")) {
      button.textContent = count ? "Use " + count + " unassigned column" + (count === 1 ? "" : "s") : "No unassigned columns";
      button.disabled = running || count === 0;
    }
  }
  function showMissingCSVMapping(name) {
    const message = "Choose CSV columns for " + name + " in Data columns before estimating.";
    $("data-error").textContent = message;
    mappingIssue.textContent = message;
    mappingIssue.hidden = false;
    columnsDetails.open = true;
    const row = [...$("csv-mapping").children].find((el) => el.dataset.mappingNode === name);
    if (row?.tagName === "DETAILS") row.open = true;
    const target =
      row?.querySelector("button:not(:disabled)") ||
      row?.querySelector('select:not(:disabled):not([aria-hidden="true"]),input:not(:disabled)') ||
      mappingIssue;
    target.setAttribute("aria-describedby", mappingIssue.id);
    requestAnimationFrame(() => {
      target.focus();
      target.scrollIntoView({ block: "center" });
    });
  }
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
        names: nodes.filter((n) => n.observed).map((n) => [n.name, n.dimension, mappingEligible(n.name)]),
        headers: csvTable.headers,
        mapping: columnMapping,
      });
      if (mappingGraph === sig) return;
      mappingGraph = sig;
    }
    const box = $("csv-mapping");
    box.replaceChildren();
    clearMappingIssue();
    if (!csvTable) {
      refreshBinding();
      return;
    }
    for (const n of nodes.filter((n) => n.observed)) {
      if (columnMapping[n.name] === undefined) {
        if (declaredClusters[n.name]) columnMapping[n.name] = [...declaredClusters[n.name]];
        else if (csvTable.headers.includes(n.name)) columnMapping[n.name] = n.name;
      }
      const eligible = mappingEligible(n.name),
        members = boundMembers(n.name);
      if (eligible) {
        const details = document.createElement("details"),
          summary = document.createElement("summary"),
          choices = document.createElement("div");
        details.className = "column-cluster";
        details.dataset.mappingNode = n.name;
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
            const checked = [...choices.querySelectorAll("input:checked")].map((e) => e.value),
              prior = [columnMapping[n.name]].flat().filter(Boolean);
            if (queryNames("query-x").includes(n.name) && checked.length > 8) {
              input.checked = false;
              $("data-error").textContent = "Treatment clusters support at most 8 members.";
              return;
            }
            columnMapping[n.name] = [...prior.filter((h) => checked.includes(h)), ...checked.filter((h) => !prior.includes(h))];
            if (queryNames("query-x").includes(n.name) && checked.length) {
              const next = columnMapping[n.name],
                changed = n.dimension !== next.length || JSON.stringify(n.members || prior) !== JSON.stringify(next);
              if (changed) {
                for (const field of ["query-values", "query-reference"]) {
                  try {
                    const values = assignments(field),
                      old = Array.isArray(values[n.name]) ? values[n.name] : [values[n.name]],
                      fallback = field === "query-values" ? 1 : 0;
                    const tuple = next.map((member) => (prior.includes(member) ? old[prior.indexOf(member)] ?? fallback : fallback));
                    values[n.name] = tuple.length > 1 ? tuple : tuple[0];
                    $(field).value = JSON.stringify(values);
                  } catch {}
                }
                n.dimension = next.length;
                if (next.length > 1) n.members = [...next];
                else delete n.members;
                updateTreatmentDeclaration(n.name, next);
                originalInvalidate();
                retainedRandomSignature = null;
              }
            }

            const count = columnMapping[n.name].length;
            if (queryNames("query-x").includes(n.name) && count === 1) columnMapping[n.name] = columnMapping[n.name][0];
            summary.textContent = n.name + " · " + count + " column" + (count === 1 ? "" : "s");
            mappingChanged();
          };
          label.append(input, document.createTextNode(h));
          choices.append(label);
        }
        details.append(summary);
        if (clusterEligible(n.name)) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.addUnassigned = n.name;
          button.onclick = () => {
            if (running) return;
            const available = unassignedCSVColumns();
            if (!available.length) return;
            columnMapping[n.name] = [...new Set([...boundMembers(n.name), ...available])];
            for (const input of choices.querySelectorAll("input")) input.checked = columnMapping[n.name].includes(input.value);
            const count = columnMapping[n.name].length;
            summary.textContent = n.name + " · " + count + " column" + (count === 1 ? "" : "s");
            mappingChanged();
          };
          details.append(button);
        }
        details.append(choices);
        box.append(details);
      } else {
        const row = document.createElement("div");
        row.className = "mapping-row";
        row.dataset.mappingNode = n.name;
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
    updateColumnActions();
    benchmarkNote();
    refreshBinding();
  }
  function mappingChanged() {
    bindingActive = true;
    benchmarkNote();
    $("easy-result").hidden = true;
    $("data-error").textContent = "";
    clearMappingIssue();
    updateColumnActions();
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    syncAssignmentWidths();
    describe();
    csvBindingGraph = dataGraphKey();
    baseline = structure();
    csvSnapshot();
    refreshBinding();
  }

  $("csv-file").addEventListener("click", () => {
    $("csv-file").value = "";
  });
  $("csv-file").onchange = async () => {
    const file = $("csv-file").files[0];
    if (!file) return; // A cancelled chooser must not clear the loaded CSV.
    const generation = ++fileGeneration;
    csvReadPending = true;
    $("data-error").textContent = "";
    $("easy-result").hidden = true;
    try {
      const text = await file.text();
      if (generation !== fileGeneration) return;
      acceptCSV(text, file.name);
    } catch (e) {
      if (generation === fileGeneration) {
        $("csv-file").value = "";
        $("data-error").textContent = csvLoadError(e, file.name);
      }
    } finally {
      if (generation === fileGeneration) csvReadPending = false;
    }
  };
  async function loadAlternateCSV(text, name, generation = ++fileGeneration) {
    if (running || generation !== fileGeneration) return;
    csvReadPending = true;
    $("easy-result").hidden = true;
    try {
      acceptCSV(text, name);
      $("data-error").textContent = "";
    } catch (error) {
      $("data-error").textContent = csvLoadError(error, name);
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
      if (generation === fileGeneration) $("data-error").textContent = csvLoadError(error, file.name);
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
  function randomTreatments() {
    return nodes.filter((n) => queryNames("query-x").includes(n.name) && n.observed && (n.family === "binary" || n.variable_type === "binary"));
  }
  function randomModelChanged() {
    syncAssignmentWidths();
    baseline = structure();
    invalidate();
    invalidateRandomData();
    clearQueryResult();
    $("data-error").textContent = "";
    refreshBinding();
    describe();
  }
  function refreshRandomTreatments() {
    const box = $("random-treatment-dimensions"),
      wanted = randomTreatments();
    if (box.dataset.names !== wanted.map((n) => n.name).join("|")) {
      box.dataset.names = wanted.map((n) => n.name).join("|");
      box.replaceChildren();
      for (const n of wanted) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        label.textContent = n.name + " dimension";
        input.id = "random-treatment-dimension-" + n.name;
        input.type = "number";
        input.min = "1";
        input.max = "4";
        input.step = "1";
        input.onchange = () => {
          const p = Number(input.value),
            node = nodes.find((v) => v.name === n.name);
          if (input.value === "" || !Number.isSafeInteger(p) || p < 1 || p > 4) {
            $("data-error").textContent = "Use a treatment dimension from 1 to 4.";
            return;
          }
          if (declaredClusters[n.name] && p !== declaredClusters[n.name].length) {
            $("data-error").textContent =
              n.name + " declares " + declaredClusters[n.name].length + " members. Edit Treatment first, or use plain " + n.name + ".";
            input.value = node.dimension;
            return;
          }
          if (node.dimension === p) return;
          node.dimension = p;
          if (p > 1)
            node.members = declaredClusters[n.name]
              ? [...declaredClusters[n.name]]
              : Array.from({ length: p }, (_, i) => (n.name === "A" ? "a" + (i + 1) : n.name + "_" + (i + 1)));
          else delete node.members;
          ClusterView.clear();
          randomModelChanged();
        };
        label.append(input);
        box.append(label);
      }
    }
    for (const n of wanted) {
      const input = $("random-treatment-dimension-" + n.name);
      if (document.activeElement !== input) input.value = n.dimension;
      input.disabled = running;
    }
    const outcomes = nodes.filter((n) => queryNames("query-y").includes(n.name)),
      families = new Set(outcomes.map((n) => n.family));
    const supported = outcomes.length > 0 && outcomes.every((n) => n.dimension === 1 && n.variable_type !== "categorical");
    $("random-outcome-label").hidden = !supported;
    $("random-outcome").value =
      families.size === 1 && ["linear", "binary", "neural_network"].includes(outcomes[0]?.family) ? outcomes[0].family : "custom";
  }
  $("random-outcome").onchange = () => {
    const family = $("random-outcome").value;
    if (running || !["linear", "binary", "neural_network"].includes(family)) return;
    const targets = nodes.filter((n) => queryNames("query-y").includes(n.name));
    const type = family === "binary" ? "binary" : "continuous";
    if (targets.every((n) => n.family === family && n.variable_type === type) && $("noise").value === "normal") return;
    for (const n of targets) {
      n.family = family;
      n.variable_type = type;
    }
    $("noise").value = "normal";
    randomModelChanged();
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
    for (const n of nodes.filter((n) => randomCandidates().includes(n) || (!n.observed && (randomSizes[n.name] || declaredClusters[n.name])))) {
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
  function randomDataReady() {
    return Boolean(model && sample && !dirty && retainedRandomSignature === randomSignature());
  }
  function invalidateRandomData() {
    retainedRandomSignature = null;
    if (dataSource !== "random") return;
    CausalDataPreview.clear();
    if (!running) progress.textContent = "";
    $("easy-result").hidden = true;
    groundTruthSignature = null;
    run.disabled = true;
  }
  document.addEventListener("input", (event) => {
    if (
      event.target.matches(
        "#easy-records,#random-options input,#rows,#model-seed,#data-seed,#noise,#properties input,#properties select,#mechanism input,#mechanism textarea,#mechanism select"
      )
    )
      invalidateRandomData();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("#noise,#properties select,#mechanism select")) invalidateRandomData();
  });
  const originalGenerate = $("generate").onclick;
  $("generate").onclick = async () => {
    if (nodes.some((n) => n.variable_type === "categorical")) {
      message("Random data for categorical variables is not supported; use CSV or Benchmarks.", true);
      return;
    }
    if (running && !window.causalEngineBatch) return;
    const ownsLock = !running,
      previous = sample;
    if (ownsLock) {
      setBusy(true, "Generate");
      clearQueryResult();
      CausalDataPreview.clear();
    }
    try {
      await originalGenerate();
      if (model && sample && sample !== previous) {
        retainedRandomSignature = randomSignature();
        if (dataSource === "random") showRandomSnapshot();
      }
    } finally {
      if (ownsLock) {
        setBusy(false);
        checkChanges();
        if (dataSource === "random" && randomDataReady()) showRandomSnapshot();
      }
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
  function retainedRandomData() {
    if (!randomDataReady()) throw Error("Generate Data with the current settings before estimating.");
    showRandomSnapshot();
    return {
      token,
      sample_id: sample.sample_id,
      n: sample.shape[0],
      ...(window.causalEngineRandomKey ? { random_key: window.causalEngineRandomKey } : {}),
      random_bindings: window.causalEngineRandomBindings,
    };
  }
  async function generateRandomData() {
    const records = Number($("easy-records").value);
    if (!Number.isSafeInteger(records) || records < 1 || records > 5000) throw Error("Records must be a whole number from 1 to 5,000.");
    for (const id of ["random-model-seed", "random-data-seed"]) {
      const v = Number($(id).value);
      if ($(id).value === "" || !Number.isSafeInteger(v) || v < 0 || v > 4294967295) throw Error("Use whole-number seeds from 0 to 4294967295.");
    }
    randomConfig(true);
    for (const n of randomTreatments()) {
      const input = $("random-treatment-dimension-" + n.name),
        p = Number(input?.value);
      if (!Number.isSafeInteger(p) || p < 1 || p > 4 || p !== n.dimension) throw Error("Apply a treatment dimension from 1 to 4 before generating.");
    }
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
      if (!model || !sample || sample === previous) throw Error($("status").textContent || "Random data generation did not finish.");
      if (revision !== version || draftDirty) throw Error("The graph changed. Generate data again.");
      retainedRandomSignature = randomSignature();
    }
    return retainedRandomData();
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
      const source = await generateRandomData();
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
  async function addTruth(
    section,
    target,
    source,
    sourceInfo,
    fullAction,
    fullReference,
    graphNodes,
    graphEdges,
    used,
    intervention,
    reference,
    queryKind
  ) {
    if (queryNames("query-conditioning").length) return;
    const stamp = truthStamp();
    let label = "Ground truth",
      value = null,
      detail = "",
      status = "UNAVAILABLE",
      referenceValues = {},
      referenceErrors = {},
      approximate = false;
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
          estimand: queryKind,
          summary: queryKind === "apo" ? "mean" : "mean_difference",
          targets: [target],
          intervention,
          ...(queryKind === "ate" ? { reference } : {}),
          Z: [],
          n: Math.max(...Object.values(randomConfig().random_cluster_sizes || {}), 1) > 8 ? 512 : 2048,
          max_seconds: 10,
        });
        const ref = result.model_reference;
        value = ref?.values?.[target];
        referenceValues = ref?.values || {};
        referenceErrors = ref?.standard_errors || {};
        approximate = result.reference_kind !== "exact_model_mean";
        status = ref?.status || "UNAVAILABLE";
        label = result.reference_kind === "exact_model_mean" ? "Ground truth (exact)" : "Model reference (Monte Carlo)";
        detail =
          (queryKind === "apo" ? "Interventional mean" : "Mean difference") + " in this fixed simulated model, not an average of the generated rows.";
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
          b = fullReference?.[actions[0]];
        if (![0, 1].includes(a) || (queryKind === "ate" && ![0, 1].includes(b))) return;
        const truth = await (benchmarkTruth ??= fetch("./benchmarks/ground-truth.json").then((r) => {
            if (!r.ok) throw Error("Benchmark reference is unavailable.");
            return r.json();
          })),
          row = truth.datasets[d.id];
        if (!row || (row.factual_sha256 && row.factual_sha256 !== d.sha256)) return;
        if (row.status === "AVAILABLE") {
          const armMean = row.apo?.values?.[String(a)];
          value = queryKind === "apo" ? armMean : (a - b) * row.value;
          status = Number.isFinite(value) ? "OK" : "UNAVAILABLE";
          referenceValues = { [target]: value };
          detail =
            queryKind === "apo"
              ? Number.isFinite(value)
                ? "Mean of supplied expected outcomes under treatment " + a + " across the released rows; not a population mean."
                : "An arm-specific benchmark reference is not available for this APO query."
              : "Mean of supplied expected treatment effects across the " +
                row.n.toLocaleString() +
                " released rows. This is not a population ATE or an average of noisy realized differences.";
        } else detail = row.reason || "This dataset has no supplied unit-level ground truth.";
      }
    } catch (error) {
      detail = "Reference unavailable: " + error.message;
    }
    if (stamp !== truthStamp()) return;
    const table = section.querySelector("[data-estimate-comparison]");
    if (!table) return;
    const heading = table.querySelector("[data-reference-heading]");
    heading.textContent = label;
    CausalMethodHelp.add(heading, source === "random" ? (approximate ? "mcReference" : "exactReference") : "benchmark");
    table.querySelector("[data-error-heading]").textContent = approximate ? "Absolute difference" : "Absolute error";
    for (const row of table.querySelectorAll("tbody tr")) {
      const name = row.dataset.outcome,
        estimate = row.querySelector("[data-estimate-value]"),
        referenceCell = row.querySelector("[data-reference-value]"),
        errorCell = row.querySelector("[data-comparison-error]"),
        referenceValue = referenceValues[name],
        available = status === "OK" && Number.isFinite(referenceValue);
      referenceCell.textContent = available ? referenceValue.toFixed(3) : "N/A";
      referenceCell.dataset.status = available ? "OK" : "UNAVAILABLE";
      referenceCell.dataset.value = available ? referenceValue : "";
      const comparable =
        available && estimate.dataset.status === "OK" && estimate.dataset.value !== "" && Number.isFinite(Number(estimate.dataset.value));
      const difference = comparable ? Math.abs(Number(estimate.dataset.value) - referenceValue) : null;
      errorCell.textContent = comparable ? difference.toFixed(3) : "N/A";
      errorCell.dataset.value = comparable ? difference : "";
      errorCell.dataset.status = comparable ? "OK" : "UNAVAILABLE";
      if (available && approximate && Number.isFinite(referenceErrors[name])) {
        const note = document.createElement("small");
        note.textContent = "MC SE: " + referenceErrors[name].toPrecision(3);
        referenceCell.append(document.createElement("br"), note);
      }
    }
    if (detail) {
      const details = document.createElement("details"),
        summary = document.createElement("summary"),
        p = document.createElement("p");
      details.className = "comparison-definition";
      summary.textContent = "Reference definition";
      p.textContent = detail;
      details.append(summary, p);
      section.append(details);
    }
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
      ...(source === "random"
        ? {
            generation: {
              records: sample.shape[0],
              model_seed: Number($("model-seed").value),
              data_seed: sample.source_seed ?? Number($("data-seed").value),
              noise: $("noise").value,
              variables: graphNodes
                .filter((n) => n.observed)
                .map((n) => ({
                  name: n.name,
                  requested_family: n.family,
                  family: model.variables[n.name].parameters?.family || n.family,
                  dimension: model.variables[n.name].dimension || model.variables[n.name].columns.length,
                  members: [...model.variables[n.name].columns],
                })),
            },
          }
        : {}),
      data_seed: source === "random" ? sample.source_seed ?? Number($("data-seed").value) : 5,
    };
  }
  function estimateRow(outcome, result, used, omitted, context, multiple) {
    const e = result.data_estimate,
      section = document.createElement("section");
    section.className = "outcome-result";
    if (e?.rowwise) {
      const title = document.createElement("h3"),
        note = document.createElement("p"),
        scroll = document.createElement("div"),
        table = document.createElement("table"),
        button = document.createElement("button");
      title.textContent = outcome + " · row-specific " + (e.rowwise.estimand === "ate" ? "conditional mean difference" : "conditional mean");
      const rows = e.rowwise.rows,
        conditions = e.rowwise.conditioning;
      note.textContent =
        e.rowwise.available +
        " of " +
        rows.length +
        " original input rows have predictions. Showing the first 10. Conditioning values are kept per row; no overall average is substituted. Conditional ground truth and confidence intervals are not computed.";
      scroll.className = "scroll";
      table.setAttribute("aria-label", outcome + " row-specific conditional predictions");
      const header = document.createElement("tr");
      const labels = [
        "Input row",
        ...conditions,
        "Intervention mean",
        ...(e.rowwise.estimand === "ate" ? ["Reference mean", "Difference"] : []),
        "Status / reason",
        "Warnings",
      ];
      for (const label of labels) {
        const th = document.createElement("th");
        th.textContent = label;
        th.scope = "col";
        header.append(th);
      }
      const head = document.createElement("thead"),
        body = document.createElement("tbody");
      head.append(header);
      for (const row of rows.slice(0, 10)) {
        const tr = document.createElement("tr");
        tr.dataset.inputRow = row.row_index;
        const cells = [
          row.row_index,
          ...conditions.map((c) => row.conditioning[c]),
          row.intervention,
          ...(e.rowwise.estimand === "ate" ? [row.reference, row.prediction] : []),
          row.status + (row.reason ? ": " + row.reason : ""),
          (row.warnings || []).join("; "),
        ];
        for (const value of cells) {
          const cell = document.createElement("td");
          cell.textContent =
            value === null
              ? "N/A"
              : Array.isArray(value)
                ? JSON.stringify(value)
                : typeof value === "number" && !Number.isInteger(value)
                  ? value.toFixed(5)
                  : String(value);
          tr.append(cell);
        }
        body.append(tr);
      }
      table.append(head, body);
      scroll.append(table);
      button.type = "button";
      button.textContent = "Download all conditional predictions (CSV)";
      button.onclick = () => {
        const quote = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
        const csv =
          [
            [
              "input_row",
              ...conditions.map((c) => "conditioning:" + c),
              "intervention_mean",
              ...(e.rowwise.estimand === "ate" ? ["reference_mean", "conditional_difference"] : []),
              "row_status",
              "row_reason",
              "warnings",
            ],
            ...rows.map((row) => [
              row.row_index,
              ...conditions.map((c) => JSON.stringify(row.conditioning[c])),
              row.intervention,
              ...(e.rowwise.estimand === "ate" ? [row.reference, row.prediction] : []),
              row.status,
              row.reason,
              (row.warnings || []).join("; "),
            ]),
          ]
            .map((row) => row.map(quote).join(","))
            .join("\n") + "\n";
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
          link = document.createElement("a");
        link.href = url;
        link.download = "causalengine-conditional-predictions.csv";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      section.append(title, note, scroll, button);
      const unavailable = rows.filter((row) => row.status !== "OK");
      if (unavailable.length) {
        const summary = document.createElement("p");
        summary.className = "estimate-reason";
        summary.textContent =
          unavailable
            .slice(0, 5)
            .map((row) => "Input row " + row.row_index + ": " + row.reason)
            .join(" ") +
          (unavailable.length > 5 ? " " + (unavailable.length - 5) + " more unavailable rows." : "") +
          " Download all conditional predictions (CSV) for every row and reason.";
        section.append(summary);
      }
      if (omitted.length) {
        const p = document.createElement("p");
        p.textContent =
          omitted.join(", ") + " are not ancestors of the outcome or conditioning variables; their interventions are irrelevant in this graph.";
        section.append(p);
      }
      for (const warning of e.warnings || []) {
        const p = document.createElement("p");
        p.className = "easy-warning";
        p.textContent = warning.message;
        section.append(p);
      }
      CausalEstimationDetails.attach(section, e, context);
      return section;
    }
    const h = document.createElement("h3");
    h.textContent = outcome;
    if (multiple) section.append(h);
    const values = e?.values || {},
      keys = Object.keys(values),
      ok = e?.status === "OK" && keys.some((k) => Number.isFinite(values[k]));
    const scroll = document.createElement("div"),
      table = document.createElement("table"),
      caption = document.createElement("caption"),
      head = document.createElement("thead"),
      header = document.createElement("tr"),
      body = document.createElement("tbody");
    scroll.className = "scroll";
    table.dataset.estimateComparison = "";
    table.setAttribute("aria-label", outcome + " estimate and reference comparison");
    caption.textContent = "Values are rounded; errors use full-precision values.";
    caption.style.fontSize = "12px";
    for (const [label, marker] of [
      ["Outcome", ""],
      ["Estimate", ""],
      ["Ground truth", "referenceHeading"],
      ["Absolute error", "errorHeading"],
    ]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.style.whiteSpace = "normal";
      th.textContent = label;
      if (marker) th.dataset[marker] = "";
      header.append(th);
    }
    head.append(header);
    for (const name of ok ? keys : [outcome]) {
      const row = document.createElement("tr"),
        title = document.createElement("th"),
        estimate = document.createElement("td");
      row.dataset.outcome = name;
      title.scope = "row";
      title.textContent = name;
      estimate.dataset.estimateValue = "";
      estimate.dataset.outcome = name;
      estimate.dataset.status = e?.status || "UNAVAILABLE";
      estimate.dataset.value = ok && Number.isFinite(values[name]) ? values[name] : "";
      estimate.textContent = ok && Number.isFinite(values[name]) ? values[name].toFixed(3) : "N/A";
      row.append(title, estimate);
      for (const marker of ["referenceValue", "comparisonError"]) {
        const cell = document.createElement("td");
        cell.dataset[marker] = "";
        cell.dataset.value = "";
        cell.dataset.status = "UNAVAILABLE";
        cell.textContent = "N/A";
        row.append(cell);
      }
      body.append(row);
    }
    table.append(caption, head, body);
    scroll.append(table);
    section.append(scroll);
    if (!ok) {
      const note = document.createElement("p");
      note.className = "estimate-reason";
      note.textContent = e?.reason || "The estimator returned no finite value (" + (e?.status || "UNAVAILABLE") + ").";
      CausalMethodHelp.add(note, "computationFailure");
      section.append(note);
    }
    const messages = (e?.warnings || []).filter((warning) => warning?.message).map((warning) => warning.message);
    if (!messages.length) messages.push(...[e?.warning, e?.info].filter(Boolean));
    if (messages.length) {
      const warning = document.createElement("div");
      warning.className = "easy-warning";
      const title = document.createElement("p");
      title.textContent = ok ? "Estimate with warnings" : "Computation warnings";
      CausalMethodHelp.add(title, "estimateWarnings");
      const list = document.createElement("ul");
      for (const message of messages) {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      }
      const link = document.createElement("a");
      link.href = "./methods.html#diagnostics";
      link.textContent = "Read the warning definitions";
      warning.append(title, list, link);
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
    if (methodMode === "continuous") continuousMethod = $("estimation-method").value;
    else if (methodMode === "binary") binaryMethod = $("estimation-method").value;
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
    const queryKind = estimand(),
      summary = querySummary();
    try {
      validateQuestion();
      if (methodChoice() === "") throw Error("Select Outcome Regression (Plug-in) for this continuous treatment before running the estimate.");
      for (const input of document.querySelectorAll("#scalar-assignments input,#treatment-components input"))
        if (!input.disabled && !input.closest("[hidden]") && (input.value === "" || !Number.isFinite(Number(input.value))))
          throw Error("Enter finite treatment values.");
      fullAction = actionValues();
      fullReference = queryKind === "ate" ? checkedAssignments("query-reference") : null;
      if (
        ![fullAction, ...(fullReference ? [fullReference] : [])].every((o) =>
          Object.values(o).every((v) => (Array.isArray(v) ? v : [v]).every((x) => typeof x === "number" && Number.isFinite(x)))
        )
      )
        throw Error("Use finite numeric treatment and reference values.");
      if (!dataSource) throw Error("Choose Upload CSV or Random Data.");
      if ($("query-type").value !== "interventional" || Object.keys(queryEvidence()).length)
        throw Error("Estimation supports interventional means and mean differences without factual evidence. Clear factual evidence in settings.");
      if (dataSource === "csv") {
        if (csvReadPending) throw Error("Wait for the selected CSV file to finish reading.");
        if (!csvTable) throw Error("Choose a valid CSV file first.");
        const missing = nodes
          .filter((n) => n.observed)
          .find((n) => {
            const members = [columnMapping[n.name]].flat();
            return !members.length || members.some((h) => !h || !csvTable.headers.includes(h));
          });
        if (missing) {
          showMissingCSVMapping(missing.name);
          return;
        }
        const columnTypes = { ...(window.causalEngineBenchmark?.node_types || {}) };
        for (const action of queryNames("query-x")) {
          const n = nodes.find((n) => n.name === action);
          if (n?.family === "binary" || n?.variable_type === "binary")
            for (const column of [columnMapping[action]].flat().filter(Boolean)) columnTypes[column] = "binary";
        }
        projected = CausalCSV.project(csvTable, columnMapping, nodes, columnTypes);
        if (window.causalEngineBenchmark?.category_levels)
          projected.column_codebooks = Object.fromEntries(
            Object.entries(window.causalEngineBenchmark.category_levels).filter(([name]) => projected.columns.includes(name))
          );
      }
      if (dirty) throw Error("Apply pending node changes in settings first.");
      if (dataSource === "random") retainedRandomData();
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
    resultPanel(
      queryNames("query-conditioning").length
        ? queryKind === "apo"
          ? "Row-specific conditional mean"
          : "Row-specific conditional mean difference"
        : queryKind === "apo"
          ? "APO · E[Y(a)]"
          : "ATE · Mean difference"
    );
    $("data-error").textContent = "";
    progress.textContent = source === "csv" ? "Reading selected data on your device…" : "Estimating the current random records on your device…";
    const results = [];
    let sourceInfo;
    try {
      if (source === "csv") {
        sourceInfo = await request("load_data", { nodes: graphNodes, edges: graphEdges, ...projected, data_seed: 5 });
        if (sourceInfo.status !== "READY") throw Error(sourceInfo.reason || "CSV data could not be loaded.");
      } else {
        sourceInfo = retainedRandomData();
      }
      let replay;
      try {
        replay = replayData(source, projected, graphNodes, graphEdges);
      } catch (error) {
        replay = { error: error.message };
      }
      for (const target of targets) {
        if (revision !== version || draftDirty) throw Error("The graph changed. Estimate again.");
        const ancestors = new Set([target, ...queryNames("query-conditioning")].flatMap((name) => [...ancestorsOf(name)])),
          validKeys = [fullAction, ...(fullReference ? [fullReference] : [])].every(
            (o) => Object.keys(o).length === actions.length && actions.every((n) => n in o)
          ),
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
          estimand: queryKind,
          summary,
          targets: [target],
          intervention: pick(fullAction),
          ...(queryKind === "ate" ? { reference: pick(fullReference) } : {}),
          Z: [],
          conditioning: queryNames("query-conditioning"),
          ...(source === "csv" && window.causalEngineBenchmark?.estimate_options ? window.causalEngineBenchmark.estimate_options : {}),
          max_seconds: 10,
        });
        if (revision !== version || draftDirty) throw Error("The graph changed. Estimate again.");
        results.push({ outcome: target, result, computed_actions: used });
        const context = {
          ...replay,
          query: {
            type: "interventional",
            estimand: queryKind,
            summary,
            targets: [target],
            estimation_method: requestedMethod,
            intervention: pick(fullAction),
            ...(queryKind === "ate" ? { reference: pick(fullReference) } : {}),
            Z: [],
            conditioning: queryNames("query-conditioning"),
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
          fullReference ? pick(fullReference) : undefined,
          queryKind
        );
      }
      window.causalEngineDataResults = results;
      window.causalEngineDataSource = sourceInfo;
      $("batch-regime").textContent =
        Object.entries(fullAction)
          .map(([n, v]) => n + "=" + JSON.stringify(v))
          .join(", ") +
        (queryKind === "ate"
          ? " vs " +
            Object.entries(fullReference)
              .map(([n, v]) => n + "=" + JSON.stringify(v))
              .join(", ")
          : "");
      $("easy-result").hidden = false;
      const computed = results.filter(
        (row) =>
          ["OK", "PARTIAL"].includes(row.result.data_estimate?.status) &&
          (row.result.data_estimate.rowwise?.available > 0 || Object.values(row.result.data_estimate.values || {}).some(Number.isFinite))
      ).length;
      const rowsLabel = sourceInfo.n.toLocaleString() + (source === "csv" ? " CSV rows." : " random records.");
      progress.textContent =
        computed === results.length
          ? "Estimated from " + rowsLabel
          : computed
            ? "Computed " + computed + " of " + results.length + " estimates from " + rowsLabel
            : "Could not compute an estimate from " + rowsLabel;
    } catch (e) {
      $("data-error").textContent = e.message;
      $("easy-result").hidden = true;
      progress.textContent = "";
    } finally {
      window.causalEngineBatch = false;
      if (
        !$("status").classList.contains("error") &&
        [
          "Estimating from observed data…",
          "Calculating model reference…",
          "Validating CSV data…",
          "Preparing calculator…",
          "Preparing identification…",
        ].includes($("status").textContent)
      )
        message("");
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
    "query-conditioning",
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
    choose.value = custom ? "edit-graph" : current;
    $("right-settings-slot").hidden = true;
    editor.hidden = true;
    document.body.dataset.view = "easy";
    moveGraphAnalysis(false);
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
    identifyButton.disabled = estimateButton.disabled = draftDirty;
    run.disabled = draftDirty || (dataSource === "random" && !randomDataReady());
    checkChanges();
  };
  let benchmarkMode = false,
    benchmarkActionState = null;
  function leaveBenchmark() {
    if (!benchmarkMode) return;
    benchmarkMode = false;
    const saved = benchmarkActionState;
    benchmarkActionState = null;
    if (saved && !draftDirty && nodes.includes(saved.node) && dataGraphKey() === saved.guard && $("role-a").value === saved.alias) {
      saved.node.dimension = saved.dimension;
      if (saved.members) saved.node.members = [...saved.members];
      else delete saved.node.members;
      if (saved.declaration) declaredClusters[saved.alias] = [...saved.declaration];
      else delete declaredClusters[saved.alias];
      $("role-a").value = saved.roleText;
      $("query-values").value = saved.values;
      $("query-reference").value = saved.reference;
      baseline = structure();
    }
    originalInvalidate();
    retainedRandomSignature = null;
    groundTruthSignature = null;
    CausalDataPreview.clear();
    $("easy-result").hidden = true;
    syncAssignmentWidths();
    describe();
  }
  window.causalEngineEnterBenchmark = () => {
    if (benchmarkMode) {
      if (
        draftDirty ||
        (benchmarkActionState &&
          nodes.includes(benchmarkActionState.node) &&
          dataGraphKey() === benchmarkActionState.guard &&
          $("role-a").value === benchmarkActionState.alias)
      )
        return;
      // Update graph can replace the treatment schema while the benchmark panel remains open.
      benchmarkActionState = null;
    }
    benchmarkMode = true;
    const previousBindingGraph = dataGraphKey();
    const reusableCSV = bindingActive && dataSource === "csv" && csvTable && window.causalEngineBenchmark && csvBindingGraph === previousBindingGraph;
    const actions = queryNames("query-x"),
      targets = queryNames("query-y"),
      observed = nodes.filter((n) => n.observed);
    const compatible =
      !draftDirty &&
      !["frontdoor", "sequential"].includes(current) &&
      actions.length === 1 &&
      targets.length === 1 &&
      observed.length === 3 &&
      observed.filter((n) => clusterEligible(n.name)).length === 1;
    if (compatible) {
      const node = nodes.find((n) => n.name === actions[0]),
        alias = node.name;
      benchmarkActionState = {
        node,
        alias,
        dimension: node.dimension,
        members: node.members ? [...node.members] : null,
        declaration: declaredClusters[alias] ? [...declaredClusters[alias]] : null,
        roleText: $("role-a").value,
        values: $("query-values").value,
        reference: $("query-reference").value,
      };
      node.dimension = 1;
      delete node.members;
      delete declaredClusters[alias];
      $("role-a").value = alias;
      for (const field of ["query-values", "query-reference"]) {
        try {
          const values = assignments(field);
          if (Array.isArray(values[alias])) values[alias] = values[alias][0];
          $(field).value = JSON.stringify(values);
        } catch {}
      }
      benchmarkActionState.guard = dataGraphKey();
      baseline = structure();
    }
    const dataset = window.causalEngineBenchmark,
      covariate = observed.find((n) => clusterEligible(n.name));
    const keepBinding =
      compatible &&
      reusableCSV &&
      previousBindingGraph === dataGraphKey() &&
      columnMapping[actions[0]] === dataset.treatment &&
      columnMapping[targets[0]] === dataset.outcome &&
      Array.isArray(columnMapping[covariate.name]);
    dataSource = keepBinding ? "csv" : "benchmark";
    bindingActive = Boolean(keepBinding);
    window.causalEngineDataBindings = keepBinding ? structuredClone(columnMapping) : null;
    window.causalEngineDataResults = null;
    window.causalEngineDataSource = null;
    originalInvalidate();
    retainedRandomSignature = null;
    groundTruthSignature = null;
    CausalDataPreview.clear();
    $("easy-result").hidden = true;
    $("data-error").textContent = "";
    refreshBinding();
    describe();
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
      openMenu(name, event.clientX, event.clientY);
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
      }
      openMenu(name, event.clientX, event.clientY);
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
        const bounds = [...svg.querySelectorAll("[data-node]")].find((g) => g.dataset.node === name).getBoundingClientRect();
        openMenu(name, bounds.right, bounds.top, true);
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
