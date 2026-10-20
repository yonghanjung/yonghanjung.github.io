(() => {
  "use strict";
  const E = MultiplyLab,
    app = document.getElementById("app"),
    random = E.createRng(E.freshSeed());
  const phases = ["Split", "Multiply", "Add", "Stack"],
    colors = ["#c9e4df", "#f7d9a6", "#cbdcf0", "#e7cce5"];
  let mode = "two",
    model,
    phase = 0,
    selected = -1,
    revealed = new Set(),
    recent = [];
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function button(text, action, cls = "") {
    const b = node("button", cls, text);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  }
  function reset(m) {
    model = m;
    phase = 0;
    selected = -1;
    revealed = new Set();
    recent.push(E.key(m.a, m.b));
    recent = recent.slice(-20);
    render();
    window.scrollTo(0, 0);
  }
  function showStage() {
    const heading = document.querySelector(".stage-heading");
    if (heading.getBoundingClientRect().top < 0) heading.scrollIntoView({ block: "start" });
  }
  function nextExample() {
    reset(E.nextExample(mode, recent, random));
  }
  function area(parent) {
    const wrap = node("section", "area-block");
    wrap.setAttribute("aria-label", "Area model");
    wrap.append(node("div", "dimension", `Width: ${model.a}${model.x.length > 1 ? " = " + model.x.join(" + ") : ""}`));
    const image = node("div", "area-frame"),
      ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${model.a} ${model.b}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `A rectangle ${model.a} units wide and ${model.b} units high. Each colored part matches an equation below.`);
    for (const part of model.parts) {
      if (part.width === 0 || part.height === 0) continue;
      const rect = document.createElementNS(ns, "rect");
      for (const [k, v] of Object.entries({
        x: part.x,
        y: part.y,
        width: part.width,
        height: part.height,
        fill: colors[part.id],
        stroke: part.id === selected ? "#183b3f" : "#fff",
        "stroke-width": part.id === selected ? "3" : "1.5",
        "vector-effect": "non-scaling-stroke",
      }))
        rect.setAttribute(k, v);
      if (selected >= 0 && selected !== part.id) rect.setAttribute("opacity", ".42");
      svg.append(rect);
    }
    image.append(svg);
    wrap.append(image, node("div", "dimension", `Height: ${model.b}${model.y.length > 1 ? " = " + model.y.join(" + ") : ""}`));
    if (model.x.includes(0) || model.y.includes(0))
      wrap.append(node("p", "quiet zero-note", "A zero-width or zero-height part has area 0. It is not drawn."));
    parent.append(wrap);
  }
  function parts(parent) {
    const list = node("div", "parts");
    list.setAttribute("aria-label", "Partial products");
    for (const p of model.parts) {
      const show = phase >= 2 || revealed.has(p.id),
        b = button(
          `${p.width} × ${p.height}${show ? " = " + p.value : " = ?"}`,
          () => {
            selected = p.id;
            revealed.add(p.id);
            if (phase === 0) phase = 1;
            render();
            showStage();
          },
          "part" + (selected === p.id ? " selected" : "")
        );
      b.style.setProperty("--part", colors[p.id]);
      b.setAttribute("aria-pressed", String(selected === p.id));
      b.setAttribute("aria-label", `${p.width} times ${p.height}${show ? " equals " + p.value : ": reveal product"}`);
      list.append(b);
    }
    parent.append(list);
  }
  function addView(parent) {
    const box = node("section", "calculation");
    box.setAttribute("aria-label", "Add partial products");
    for (const row of model.rows) box.append(node("div", "row-sum", `${row.parts.map((p) => p.value).join(" + ")} = ${row.value}`));
    box.append(node("div", "total", `${model.rows.map((r) => r.value).join(" + ")} = ${model.total}`));
    parent.append(box);
  }
  function stack(parent) {
    const box = node("section", "stack-card");
    box.setAttribute("aria-label", "Written multiplication");
    const table = node("div", "stack");
    const line = (value, label, cls = "") => {
      const r = node("div", "stack-line " + cls);
      r.append(node("span", "stack-number", value), node("span", "stack-label", label));
      table.append(r);
    };
    line(String(model.a), "");
    line("× " + model.b, "", "rule");
    if (model.rows.length > 1) {
      line(String(model.rows[1].value), `${model.a} × ${model.y[1]}`);
      line("+ " + model.rows[0].value, `${model.a} × ${model.y[0]}`, "rule");
    }
    line(String(model.total), "Total", "stack-total");
    box.append(table);
    parent.append(box);
  }
  function render() {
    app.replaceChildren();
    const title = node("div", "intro");
    title.append(node("h1", "", "Split. Multiply. Add."));
    app.append(title);
    const edit = node("details", "number-editor"),
      summary = node("summary", "", `${model.a} × ${model.b} · Change numbers`);
    edit.append(summary);
    const form = node("form", "settings"),
      label = node("label", "mode-label");
    const select = node("select");
    select.setAttribute("aria-label", "Multiplication type");
    [
      ["two", "1–2 digits × 1–2 digits"],
      ["one", "1–2 digits × 1 digit"],
    ].forEach(([value, text]) => {
      const option = node("option", "", text);
      option.value = value;
      select.append(option);
    });
    select.value = mode;
    select.addEventListener("change", () => {
      mode = select.value;
      nextExample();
    });
    label.append(select);
    form.append(label);
    const fields = node("div", "operands");
    const input = (name, value, min, max) => {
      const lab = node("label", "operand");
      lab.append(node("span", "sr-only", name));
      const n = node("input");
      n.type = "number";
      n.inputMode = "numeric";
      n.min = min;
      n.max = max;
      n.required = true;
      n.value = value;
      n.setAttribute("aria-label", name);
      lab.append(n);
      return [lab, n];
    };
    const [la, a] = input("First number", model.a, 1, 99),
      [lb, b] = input("Second number", model.b, 1, mode === "one" ? 9 : 99);
    const apply = node("button", "apply", "Use");
    apply.type = "submit";
    fields.append(la, node("span", "times", "×"), lb, apply);
    form.append(fields);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity()) reset(E.lesson(Number(a.value), Number(b.value), mode));
    });
    edit.append(form);
    app.append(edit);
    const stage = node("nav", "phases");
    stage.setAttribute("aria-label", "Learning steps");
    phases.forEach((name, i) => {
      const b = button(
        `${i + 1}. ${name}`,
        () => {
          phase = i;
          selected = -1;
          render();
          showStage();
        },
        i === phase ? "active" : ""
      );
      if (i === phase) b.setAttribute("aria-current", "step");
      stage.append(b);
    });
    app.append(stage);
    const heading = node("section", "stage-heading");
    heading.setAttribute("aria-live", "polite");
    const titles = ["Split the rectangle", "Tap each part", "Put the parts together", "Write the same multiplication"];
    const notes = [
      `${model.a} × ${model.b} uses the same area, split into smaller rectangles.`,
      "Each small rectangle has width × height units of area.",
      "Add across each row, then add the row totals.",
      "The row totals line up by place value.",
    ];
    heading.append(node("h2", "", titles[phase]), node("p", "quiet", notes[phase]));
    app.append(heading);
    const content = node("div", "content" + (phase >= 2 ? " compact" : ""));
    if (phase < 3) {
      area(content);
      parts(content);
      if (phase === 2) addView(content);
    } else stack(content);
    app.append(content);
    const nav = node("nav", "controls");
    nav.setAttribute("aria-label", "Example navigation");
    const previous = button("← Previous", () => {
      phase--;
      selected = -1;
      render();
      showStage();
    });
    previous.disabled = phase === 0;
    const next = button(
      "Next →",
      () => {
        phase++;
        selected = -1;
        render();
        showStage();
      },
      "primary"
    );
    next.disabled = phase === phases.length - 1;
    nav.append(previous, next, button("New example", nextExample, "new-example"));
    app.append(nav);
  }
  nextExample();
})();
