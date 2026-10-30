/* Render only certified, fully observational identification trees. */
window.CausalExpectation = (() => {
  const el = (tag, ...children) => {
    const n = document.createElementNS("http://www.w3.org/1998/Math/MathML", tag);
    n.append(...children.map((v) => (v instanceof Node ? v : document.createTextNode(String(v)))));
    return n;
  };
  const list = (xs) => el("mrow", ...xs.flatMap((x, i) => (i ? [el("mo", ","), x] : [x])));
  const fence = (x, l = "(", r = ")") => el("mrow", el("mo", l), x, el("mo", r));
  const withNotes = (math, notes) => {
    if (notes.size) {
      math.dataset.integrationNotes = JSON.stringify([...notes]);
      math.dataset.integrationNote = [...notes].join(" ");
    }
    return math;
  };
  function integrateVariable(variable, alias, expression, notes) {
    if (!variable) throw Error("An observational integration variable is absent from the graph.");
    const continuous = ["linear", "quadratic", "bounded", "neural_network", "decision_tree"],
      kind = variable.variable_type || (variable.family === "binary" ? "binary" : continuous.includes(variable.family) ? "continuous" : null),
      support = () => el("mrow", el("mi", "supp"), fence(el("mi", variable.name)));
    let domain = null;
    if (kind === "binary" && variable.dimension === 1) domain = [0, 1];
    if (kind === "categorical" && variable.dimension === 1) {
      const raw = variable.category_levels;
      if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length) {
        const levels = Object.keys(raw).map(Number);
        if (levels.every(Number.isFinite) && new Set(levels).size === levels.length) domain = levels;
      }
    }
    if (kind === "binary" || kind === "categorical") {
      if (!domain) notes.add("supp(V) denotes the support of V; this display does not assign category codes.");
      return el(
        "mrow",
        el(
          "munder",
          el("mo", "∑"),
          el("mrow", el("mi", alias), el("mo", "∈"), domain ? fence(list(domain.map((x) => el("mn", x))), "{", "}") : support())
        ),
        fence(expression)
      );
    }
    if (kind === "continuous" && variable.dimension === 1) return el("mrow", el("mo", "∫"), fence(expression), el("mo", "d"), el("mi", alias));
    notes.add(
      "p denotes an observed probability mass or density. μ denotes the variable-specific reference measure, not the marginal P(V). The general integral covers discrete, continuous and mixed types. Means assume numeric outcomes."
    );
    return el(
      "mrow",
      el("munder", el("mo", "∫"), el("mrow", el("mi", alias), el("mo", "∈"), support())),
      fence(expression),
      el("mo", "d"),
      el("msub", el("mi", "μ"), el("mi", variable.name)),
      fence(el("mi", alias))
    );
  }
  function conditionalMean(result, target, actions, graphNodes, options) {
    const notes = new Set();
    const conditions = result.conditioning.variables,
      alias = options.reference ? "a₀" : "a";
    const assignments = actions.map((v, i) => el("mrow", el("mi", v), el("mo", "="), el("mi", actions.length === 1 ? alias : alias + (i + 1))));
    const cases = conditions.map((v) => el("mrow", el("mi", v), el("mo", "="), el("msub", el("mi", v.toLowerCase()), el("mi", "i"))));
    const observationalAssignments = assignments.filter((_, i) => (result.query?.actions || actions).includes(actions[i]));
    const expectation = (intervene) =>
      el(
        "mrow",
        el("mi", "E"),
        fence(
          el(
            "mrow",
            el("mi", target),
            el("mo", "|"),
            list([
              ...((intervene ? assignments : observationalAssignments).length
                ? [
                    intervene
                      ? el("mrow", el("mi", "do"), fence(list((intervene ? assignments : observationalAssignments).map((n) => n.cloneNode(true)))))
                      : list((intervene ? assignments : observationalAssignments).map((n) => n.cloneNode(true))),
                  ]
                : []),
              ...cases.map((n) => n.cloneNode(true)),
            ])
          ),
          "[",
          "]"
        )
      );
    let right;
    if (result.conditioning.route === "do_calculus_rule_2") right = expectation(false);
    else {
      const density = renderMean(result.conditioning.joint_result, target, actions, graphNodes, {
        ...options,
        densityOnly: true,
        conditioningNames: conditions,
      });
      const node = graphNodes.find((n) => n.name === target),
        y = target.toLowerCase();
      for (const note of JSON.parse(density.dataset.integrationNotes || "[]")) notes.add(note);
      const integrate = (weighted) => {
        const expression = el("mrow", ...(weighted ? [el("mi", y), el("mo", "·")] : []), density.firstChild.cloneNode(true));
        return integrateVariable(node, y, expression, notes);
      };
      right = el("mfrac", integrate(true), integrate(false));
    }
    const math = el("math", expectation(true), el("mo", "="), right);
    math.setAttribute("display", "block");
    math.setAttribute("aria-label", "Identified row-specific conditional mean for " + target);
    return withNotes(math, notes);
  }
  function renderMean(result, target, actions, graphNodes, options = {}) {
    if (result.identification.status !== "IDENTIFIABLE") return null;
    if (result.conditioning) return conditionalMean(result, target, actions, graphNodes, options);
    const candidate = formulaSource(result),
      source = ["BD", "AC", "FD", "SBD"].includes(candidate)
        ? candidate
        : result.identification.observational_formula_status === "COMPLETE"
          ? "Observational"
          : null,
      tree =
        source === "Observational"
          ? result.identification.observational_formula_tree
          : source === "Indexed"
            ? result.indexed.literal_formula_tree
            : source
              ? result.criteria[source].formula_tree
              : null;
    if (!tree || !completeFormula(tree)) throw Error("A fully expanded observational formula is not available for this graph.");
    const node = graphNodes.find((n) => n.name === target);
    if (!node || node.dimension !== 1) throw Error("Expectation display currently requires a scalar outcome.");
    const notes = new Set();
    const used = new Set(graphNodes.map((n) => n.name)),
      names = new Map(graphNodes.map((n) => [n.name, n])),
      symbols = new Map();
    let coordinate = 0;
    const totalCoordinates = actions.reduce((n, a) => n + (Number(names.get(a)?.dimension) || 1), 0);
    for (const action of actions) {
      const width = Number(names.get(action)?.dimension) || 1,
        aliases = Array.from({ length: width }, () => {
          coordinate++;
          return options.reference ? (totalCoordinates === 1 ? "a₀" : "a₀," + coordinate) : totalCoordinates === 1 ? "a" : "a" + coordinate;
        });
      symbols.set(action, width > 1 ? aliases : aliases[0]);
    }
    for (const v of options.conditioningNames || []) symbols.set(v, v.toLowerCase() + "ᵢ");
    if (options.densityOnly) symbols.set(target, target.toLowerCase());
    for (const symbol of [...symbols.values()].flat()) used.add(symbol);
    const fresh = (name) => {
      let x = name.toLowerCase();
      while (used.has(x)) x += "′";
      used.add(x);
      return x;
    };
    const name = (x) => (Array.isArray(x) ? fence(list(x.map((v) => el("mi", v)))) : el("mi", x)),
      assign = (v, x) => el("mrow", name(v), el("mo", "="), name(x));
    let count = 0;
    function arg(a, scope) {
      if (Object.hasOwn(a, "value")) return el("mrow", name(a.variable), el("mo", "="), el("mn", a.value));
      if (scope.has(a.label)) return assign(a.variable, scope.get(a.label));
      if (a.label === a.variable && symbols.has(a.variable)) return assign(a.variable, symbols.get(a.variable));
      if (a.label !== a.variable) {
        const suffix = /@([0-9]+)$/.exec(a.label || "");
        return assign(a.variable, suffix ? a.variable.toLowerCase() + "′".repeat(Number(suffix[1]) + 1) : a.label);
      }
      return name(a.variable);
    }
    function integrate(variables, body, scope) {
      let current = new Map(scope),
        bindings = [];
      for (const v of variables) {
        const alias = fresh(v.variable);
        current.set(v.label, alias);
        bindings.push({ variable: v.variable, alias });
      }
      let rendered = body(current);
      for (const b of bindings.reverse()) {
        rendered = integrateVariable(names.get(b.variable), b.alias, rendered, notes);
      }
      return rendered;
    }
    function walk(t, scope = new Map(), depth = 0) {
      if (++count > 12000 || depth > 96) throw Error("The observational expression is too large to display.");
      const child = (x) => walk(x, scope, depth + 1);
      if (t.type === "number") return el("mn", t.value);
      if (t.type === "probability" || t.type === "expectation") {
        if (t.source && t.source !== "P") throw Error("The expression contains a nonobservational source.");
        return el(
          "mrow",
          name(t.type === "expectation" ? "E" : "p"),
          fence(
            el(
              "mrow",
              list(t.outcomes.map((a) => arg(a, scope))),
              ...(t.given.length ? [el("mo", "|"), list(t.given.map((a) => arg(a, scope)))] : [])
            ),
            t.type === "expectation" ? "[" : "(",
            t.type === "expectation" ? "]" : ")"
          )
        );
      }
      if (t.type === "sum") return integrate(t.variables, (s) => walk(t.body, s, depth + 1), scope);
      if (t.type === "product")
        return t.factors.length
          ? el("mrow", ...t.factors.flatMap((x, i) => [...(i ? [el("mo", "·")] : []), ["sum", "add"].includes(x.type) ? fence(child(x)) : child(x)]))
          : el("mn", 1);
      if (t.type === "ratio") return el("mfrac", child(t.numerator), child(t.denominator));
      if (t.type === "add") return el("mrow", child(t.left), el("mo", "+"), child(t.right));
      throw Error("The expression still contains an unexpanded kernel.");
    }
    if (options.densityOnly) return withNotes(el("math", walk(tree)), notes);
    const sourceRow = result.criteria[source],
      adjustment =
        ["BD", "AC"].includes(source) && sourceRow?.status === "ACCEPT" && Array.isArray(sourceRow.witness?.Z) ? sourceRow.witness.Z : null,
      retained = result.query?.actions || actions;
    const compact = summaryTree(tree, target, "expectation");
    let right;
    if (adjustment) {
      const vector = () => {
          const n = el("mi", "C");
          n.setAttribute("mathvariant", "bold");
          return n;
        },
        given = [
          ...retained.map((a) => assign(a, symbols.get(a) || a.toLowerCase())),
          ...(adjustment.length ? [adjustment.length === 1 ? name(adjustment[0]) : vector()] : []),
        ],
        inner = el("mrow", name("E"), fence(el("mrow", name(target), ...(given.length ? [el("mo", "|"), list(given)] : [])), "[", "]"));
      right = adjustment.length
        ? el("mrow", el("msub", name("E"), adjustment.length === 1 ? name(adjustment[0]) : vector()), fence(inner, "[", "]"))
        : inner;
    } else if (compact) right = walk(compact);
    else
      right = integrate(
        [{ variable: target, label: target }],
        (scope) => el("mrow", name(scope.get(target)), el("mo", "·"), fence(walk(tree, scope))),
        new Map()
      );
    const left = el(
      "mrow",
      name("E"),
      fence(
        el(
          "mrow",
          name(target),
          ...(actions.length ? [el("mo", "|"), el("mi", "do"), fence(list(actions.map((a) => assign(a, symbols.get(a)))))] : [])
        ),
        "[",
        "]"
      )
    );
    const math = el("math", left, el("mo", "="), right);
    math.setAttribute("display", "block");
    math.setAttribute("aria-label", "Identified expectation for " + target);
    if (adjustment?.length > 1) math.dataset.adjustmentVariables = JSON.stringify(adjustment);
    return withNotes(math, notes);
  }
  function render(result, target, actions, graphNodes, options = {}) {
    const primary = renderMean(result, target, actions, graphNodes, options);
    const outcome = graphNodes.find((node) => node.name === target);
    if (primary && outcome?.variable_type === "categorical" && (!outcome.category_levels || !Object.keys(outcome.category_levels).length)) {
      const notes = new Set(JSON.parse(primary.dataset.integrationNotes || "[]"));
      notes.add("Mean uses numeric outcome values; no category coding is chosen here.");
      withNotes(primary, notes);
    }
    if (!primary || options.estimand !== "ate") return primary;
    const reference = renderMean(result, target, actions, graphNodes, { ...options, reference: true });
    const [left, , right] = [...primary.childNodes],
      [left0, , right0] = [...reference.childNodes];
    primary.replaceChildren(left, el("mo", "−"), left0, el("mo", "="), fence(right), el("mo", "−"), fence(right0));
    primary.setAttribute("aria-label", "Identified mean difference for " + target);
    return primary;
  }
  return { render };
})();
