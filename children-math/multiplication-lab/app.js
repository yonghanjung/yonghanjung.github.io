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
  function teachToday() {
    const storageKey = "haydenMath.today.array.v1";
    const lesson = E.lesson(12, 4, "one");
    const challenge = { total: 72, boxes: 4 };
    const steps = ["See", "Build", "Try", "Check"];
    const models = [
      ["array", "Rows"],
      ["bars", "Bars"],
      ["line", "Number line"],
    ];
    const units = [
      ["each", "Tiles in each box"],
      ["boxes", "Boxes"],
      ["total", "Tiles altogether"],
    ];
    const fresh = () => ({
      step: "intro",
      cut: lesson.x[0],
      turned: false,
      model: "",
      notes: {},
      hint: 0,
      answer: "",
      unit: "",
      graded: false,
    });
    const read = () => {
      const base = fresh();
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (!saved || !["intro", "see", "build", "try", "check", "done"].includes(saved.step)) return base;
        const answer = typeof saved.answer === "string" && /^[0-9]{0,2}$/.test(saved.answer) ? saved.answer : "";
        const unit = units.some(([key]) => key === saved.unit) ? saved.unit : "";
        const step = ["check", "done"].includes(saved.step) && (!answer || !unit) ? "try" : saved.step;
        return {
          step,
          cut: Number.isInteger(saved.cut) && saved.cut >= 1 && saved.cut < lesson.a ? saved.cut : base.cut,
          turned: saved.turned === true,
          model: models.some(([key]) => key === saved.model) ? saved.model : "",
          notes: Object.fromEntries(
            models.map(([key]) => [
              key,
              [0, 1].map((i) => {
                const mark = saved.notes?.[key]?.[i];
                return typeof mark === "string" && /^[0-9]{0,2}$/.test(mark) ? mark : "";
              }),
            ])
          ),
          hint: Number.isInteger(saved.hint) && saved.hint >= 0 && saved.hint <= 3 ? saved.hint : 0,
          answer,
          unit,
          graded: step === "check" && saved.graded === true,
        };
      } catch (_) {
        return base;
      }
    };
    let state = read();
    let selectedPart = "";
    let feedback = "";
    let storageAvailable = true;
    document.body.classList.add("today-mode");
    document.title = "One array, two operations · Math by Hayden.J";
    document.querySelector(".brand small").textContent = "Multiply Lab · Today";

    function save() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (_) {
        storageAvailable = false;
        const status = document.getElementById("today-save-status");
        if (status) status.textContent = "Keep this tab open to continue this lesson.";
      }
    }

    function move(step) {
      state.step = step;
      selectedPart = "";
      feedback = "";
      save();
      draw();
      document.getElementById("today-heading").focus();
    }

    function refresh(controlId, message) {
      feedback = message || "";
      save();
      draw();
      const control = document.getElementById(controlId);
      if (control && !control.disabled) control.focus({ preventScroll: true });
      else if (control) control.closest(".today-controls")?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
      else if (controlId === "today-hint") document.getElementById("today-last-hint")?.focus({ preventScroll: true });
    }

    function pane() {
      const layout = node("div", "today-layout");
      const picture = node("div", "today-picture");
      const work = node("div", "today-work");
      layout.append(picture, work);
      return { layout, picture, work };
    }

    function tiles(rows, columns) {
      const board = node("span", "today-tile-grid");
      board.style.setProperty("--columns", columns);
      board.setAttribute("aria-hidden", "true");
      for (let i = 0; i < rows * columns; i++) board.append(node("span", "today-tile"));
      return board;
    }

    function splitBoard(picture, work, cut, interactive) {
      const right = lesson.a - cut;
      const [leftValue, rightValue] = [lesson.b * cut, lesson.b * right];
      const board = node("div", "today-split-board");
      board.style.gridTemplateColumns = `minmax(0, ${cut}fr) minmax(0, ${right}fr)`;
      board.setAttribute("role", "group");
      board.setAttribute("aria-label", `${lesson.b} rows of ${lesson.a} tiles, split after ${cut} tiles in each row`);
      const amounts = [cut, right];
      amounts.forEach((columns, i) => {
        const name = i ? "B" : "A";
        const change = (controlId) => {
          selectedPart = name;
          refresh(controlId, `Part ${name}. ${lesson.b} rows of ${columns} make ${lesson.b * columns} tiles.`);
        };
        const frame = button("", () => change(`today-board-${name}`), `today-part today-part-${name}`);
        frame.id = `today-board-${name}`;
        frame.setAttribute("aria-label", `Part ${name}: ${lesson.b} rows of ${columns} tiles`);
        frame.setAttribute("aria-pressed", String(selectedPart === name));
        frame.append(tiles(lesson.b, columns));
        board.append(frame);
        const item = button(
          `Part ${name} · ${lesson.b} × ${columns} = ${lesson.b * columns}`,
          () => change(`today-equation-${name}`),
          `today-equation today-part-${name}`
        );
        item.id = `today-equation-${name}`;
        item.setAttribute("aria-pressed", String(selectedPart === name));
        work.append(item);
      });
      const labels = node("div", "today-cut-labels");
      labels.style.gridTemplateColumns = board.style.gridTemplateColumns;
      labels.append(node("span", "", `A · ${cut}`), node("span", "", `B · ${right}`));
      picture.append(node("p", "today-model-label", `${lesson.b} rows · ${lesson.a} in each row`), labels, board);
      if (interactive) {
        const controls = node("div", "today-controls");
        const moveCut = (next, controlId) => {
          state.cut = next;
          selectedPart = "";
          refresh(controlId, `Cut: ${state.cut} and ${lesson.a - state.cut}. Still ${lesson.total} tiles.`);
        };
        const slider = node("input", "today-cut-slider");
        slider.id = "today-cut-slider";
        slider.type = "range";
        slider.min = 1;
        slider.max = lesson.a - 1;
        slider.value = cut;
        slider.setAttribute("aria-label", "Cut after this many tiles in every row");
        slider.setAttribute("aria-valuetext", `${cut} and ${right}`);
        const line = node("span", "today-sliding-cut");
        line.setAttribute("aria-hidden", "true");
        board.append(line);
        slider.addEventListener("input", () => {
          const next = Number(slider.value);
          line.style.left = `${(next / lesson.a) * 100}%`;
          line.classList.add("today-sliding-cut-visible");
          slider.setAttribute("aria-valuetext", `${next} and ${lesson.a - next}`);
        });
        slider.addEventListener("change", () => moveCut(Number(slider.value), slider.id));
        picture.append(slider);
        const fewer = button("−", () => moveCut(cut - 1, "today-fewer"));
        fewer.id = "today-fewer";
        fewer.disabled = cut === 1;
        fewer.setAttribute("aria-label", "Move cut left");
        const more = button("+", () => moveCut(cut + 1, "today-more"));
        more.id = "today-more";
        more.disabled = cut === lesson.a - 1;
        more.setAttribute("aria-label", "Move cut right");
        controls.append(fewer, node("strong", "", "Move the cut"), more);
        picture.append(controls);
      }
      work.append(
        node("p", "today-total", `${leftValue} + ${rightValue} = ${lesson.total}`),
        node("p", "quiet", interactive ? "Same tiles. A new cut." : "Tap a part to match it to its equation.")
      );
    }

    function see(article) {
      const { layout, picture, work } = pane();
      splitBoard(picture, work, lesson.x[0], false);
      article.append(layout);
    }

    function build(article) {
      const { layout, picture, work } = pane();
      if (!state.turned) splitBoard(picture, work, state.cut, true);
      else picture.append(node("p", "today-model-label", "12 rows · 4 in each row"));
      const proof = node("section", "today-division");
      const switcher = node("div", "today-selectors");
      [
        [false, "Make 4 rows"],
        [true, "Make groups of 4"],
      ].forEach(([turned, label]) => {
        const b = button(label, () => {
          state.turned = turned;
          selectedPart = "";
          refresh(b.id, turned ? "Turned. Now there are 12 rows with 4 tiles in each." : "There are 4 rows with 12 tiles in each.");
        });
        b.id = turned ? "today-turn" : "today-unturn";
        b.setAttribute("aria-pressed", String(state.turned === turned));
        switcher.append(b);
      });

      const rows = state.turned ? lesson.a : lesson.b;
      const columns = state.turned ? lesson.b : lesson.a;
      if (state.turned) {
        const grouped = node("div", "today-turn-grid");
        grouped.setAttribute("role", "img");
        grouped.setAttribute("aria-label", `${rows} outlined groups of ${columns} tiles`);
        for (let i = 0; i < rows; i++) grouped.append(tiles(1, columns));
        picture.append(grouped);
      }
      proof.append(
        node("p", "today-total", "48 ÷ 4 = 12"),
        node("p", "today-meaning", state.turned ? "Four tiles in a group. The 12 counts groups." : "Four groups. The 12 counts tiles in each group.")
      );
      article.append(switcher, layout);
      if (state.turned) work.append(proof);
      if (!state.turned) article.append(proof);
    }

    function blankModel(kind) {
      const figure = node("div", `today-blank-model today-blank-${kind}`);
      figure.setAttribute("role", "img");
      if (kind === "line") {
        figure.setAttribute("aria-label", "Blank number line from 0 to 72 with four equal jumps");
        const marks = node("div", "today-line-marks");
        marks.append(node("span", "", "0"), node("span", "", "72"));
        const jumps = node("div", "today-jumps");
        for (let i = 0; i < challenge.boxes; i++) jumps.append(node("span", "", "?"));
        figure.append(jumps, marks);
      } else {
        figure.setAttribute("aria-label", `Four blank ${kind === "array" ? "rows" : "equal bars"}`);
        for (let i = 0; i < challenge.boxes; i++) figure.append(node("span", "", kind === "array" ? `Row ${i + 1}` : `Box ${i + 1}`));
      }
      return figure;
    }

    function tryIt(article) {
      const { layout, picture, work } = pane();
      const choices = node("div", "today-selectors");
      const caption = node("p", "today-model-label", "Choose a model if it helps.");
      for (const [key, label] of models) {
        const b = button(label, () => {
          state.model = state.model === key ? "" : key;
          refresh(b.id);
        });
        b.id = `today-model-${key}`;
        b.setAttribute("aria-pressed", String(state.model === key));
        choices.append(b);
      }
      picture.append(caption, choices);
      if (state.model) {
        const marks = state.notes[state.model] || ["", ""];
        state.notes[state.model] = marks;
        const scratch = node("fieldset", "today-scratch today-answer-form");
        scratch.append(node("legend", "", "Label your model (optional)"));
        ["First label", "Second label"].forEach((name, i) => {
          const label = node("label", "", name);
          const field = node("input");
          field.type = "text";
          field.inputMode = "numeric";
          field.maxLength = 2;
          field.autocomplete = "off";
          field.value = marks[i];
          field.addEventListener("input", () => {
            field.value = field.value.replace(/[^0-9]/g, "").slice(0, 2);
            marks[i] = field.value;
            save();
          });
          label.append(field);
          scratch.append(label);
        });
        picture.append(blankModel(state.model), scratch);
      }
      const hints = [
        "The four boxes have the same number. Which number is missing?",
        "Try 40 tiles first. How much is left to share?",
        "Share 40 as 10 in each box. Share the other 32 as 8 in each box. Now put the two parts together.",
      ];
      for (let i = 0; i < state.hint; i++) {
        const line = node("p", "today-hint", hints[i]);
        if (i === hints.length - 1) {
          line.id = "today-last-hint";
          line.tabIndex = -1;
        }
        picture.append(line);
      }
      if (state.hint < hints.length) {
        const hint = button(
          state.hint ? "Next hint" : "Hint",
          () => {
            state.hint++;
            refresh("today-hint", hints[state.hint - 1]);
          },
          "today-hint-button"
        );
        hint.id = "today-hint";
        picture.append(hint);
      }
      const answer = node("input", "today-answer");
      answer.type = "text";
      answer.inputMode = "numeric";
      answer.maxLength = 2;
      answer.pattern = "[0-9]{1,2}";
      answer.autocomplete = "off";
      answer.required = true;
      answer.value = state.answer;
      answer.id = "today-answer";
      answer.addEventListener("input", () => {
        answer.value = answer.value.replace(/[^0-9]/g, "").slice(0, 2);
        state.answer = answer.value;
        save();
      });
      const form = node("form", "today-answer-form");
      const label = node("label", "", "Your number");
      label.htmlFor = answer.id;
      const unit = node("select", "today-answer-unit");
      unit.id = "today-unit";
      unit.required = true;
      const unitLabel = node("label", "", "What does it count?");
      unitLabel.htmlFor = unit.id;
      const none = node("option", "", "Choose one");
      none.value = "";
      unit.append(none);
      units.forEach(([key, text]) => {
        const option = node("option", "", text);
        option.value = key;
        unit.append(option);
      });
      unit.value = state.unit;
      unit.addEventListener("change", () => {
        state.unit = unit.value;
        save();
      });
      const submit = node("button", "today-primary", "Keep my answer");
      submit.type = "submit";
      form.append(label, answer, unitLabel, unit, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        state.answer = answer.value;
        state.unit = unit.value;
        state.graded = false;
        move("check");
      });
      work.append(form);
      article.append(layout);
    }

    function worked(picture, work) {
      const board = node("div", "today-worked");
      board.setAttribute("role", "img");
      board.setAttribute("aria-label", "Four boxes. Each box has 10 tiles from the 40 and 8 from the 32.");
      for (let i = 0; i < challenge.boxes; i++) {
        const box = node("div", "today-worked-row");
        box.append(node("span", "today-part-A", "10"), node("span", "today-part-B", "+ 8"));
        board.append(box);
      }
      picture.append(node("p", "today-model-label", "72 = 40 + 32"), board, node("p", "quiet", "Another split that works: 60 + 12."));
      work.append(node("p", "today-total", "10 + 8 = 18 tiles per box"), node("p", "today-meaning", "4 × 18 = 72. All the tiles are used."));
    }

    function check(article) {
      const { layout, picture, work } = pane();
      const label = units.find(([key]) => state.unit === key)[1].toLowerCase();
      const correctNumber = Number(state.answer) === challenge.total / challenge.boxes;
      const correctUnit = state.unit === "each";
      const correct = correctNumber && correctUnit;
      picture.append(node("p", "today-model-label", "Your answer"), node("p", "today-total", `${state.answer} · ${label}`));
      const edit = button("Edit answer", () => {
        state.graded = false;
        move("try");
      });
      if (!state.graded) {
        work.append(
          node("p", "today-meaning", "Can you get back to 72 with your number? What does the number count?"),
          button(
            "I checked",
            () => {
              state.graded = true;
              refresh("today-result", correct ? "Your number and meaning both match." : "You can make another change.");
            },
            "today-primary"
          ),
          edit
        );
      } else {
        const result = node(
          "p",
          "today-result",
          correct ? "Your number and meaning both match." : correctNumber ? "The number matches. Check what it counts." : "Try sharing all 72 again."
        );
        result.id = "today-result";
        result.tabIndex = -1;
        work.append(result);
        if (correct) {
          worked(picture, work);
          work.append(button("Finish lesson", () => move("done"), "today-primary"));
        } else work.append(edit);
      }
      article.append(layout);
    }

    function parentNotes() {
      const wrap = node("details", "today-parent");
      wrap.append(
        node("summary", "", "For parents"),
        node("p", "", "Ask what each number counts. Pause before showing how to check. Try 84 tiles in 6 equal boxes on another day."),
        node("p", "quiet", "Progress stays in this browser.")
      );
      const links = node("div", "today-links");
      for (const [name, url] of [
        ["Division Practice", "/children-math/groups-lab/"],
        ["Counting Sense", "/children-math/counting-sense/"],
        ["Math Lab", "/misc/hayden-math/"],
        ["Quick Math", "/misc/math-by-hayden-j/"],
      ]) {
        const a = node("a", "", name);
        a.href = url;
        links.append(a);
      }
      wrap.append(links);
      return wrap;
    }

    function draw() {
      const stages = {
        intro: ["One array, two operations", "Split, turn, and share the same tiles."],
        see: ["See the parts", "Four rows. Twelve tiles in each row."],
        build: ["Move the cut. Turn the array.", "Split the same 48 tiles. Change what the groups mean."],
        try: ["Share 72 tiles", "Put all 72 tiles into 4 boxes. Each box gets the same number. How many go in each box?"],
        check: ["Check your work", "Think it through before you look at the answer."],
        done: ["Lesson complete", "You used one model for multiplication and division."],
      };
      const [title, description] = stages[state.step];
      const intro = node("section", "today-intro");
      const heading = node("h1", "", title);
      heading.id = "today-heading";
      heading.tabIndex = -1;
      const rail = node("ol", "today-rail");
      const activeStep = steps.findIndex((step) => step.toLowerCase() === state.step);
      steps.forEach((name, i) => {
        const item = node("li", "", name);
        if (i === activeStep) item.setAttribute("aria-current", "step");
        if (i < activeStep || state.step === "done") item.className = "today-passed";
        rail.append(item);
      });
      const article = node("section", "today-card");
      intro.append(heading, node("p", "", description));
      if (state.step === "intro") {
        const board = node("div", "today-picture today-intro-board");
        board.setAttribute("role", "img");
        board.setAttribute("aria-label", "A tile rectangle with four rows and twelve columns");
        board.append(tiles(lesson.b, lesson.a));
        article.append(
          board,
          button("Start lesson", () => move("see"), "today-primary")
        );
      } else if (state.step === "see") {
        see(article);
      } else if (state.step === "build") {
        build(article);
      } else if (state.step === "try") {
        tryIt(article);
      } else if (state.step === "check") {
        check(article);
      } else {
        const { layout, picture, work } = pane();
        worked(picture, work);
        const home = node("a", "today-primary", "Children Contents");
        home.href = "/children-contents/";
        work.append(
          home,
          button("Replay lesson", () => {
            state = fresh();
            move("see");
          })
        );
        article.append(layout);
      }
      const nav = node("nav", "today-nav");
      nav.setAttribute("aria-label", "Lesson navigation");
      if (state.step === "see") nav.append(button("Next: Build", () => move("build"), "today-primary"));
      if (state.step === "build")
        nav.append(
          button("Back", () => move("see")),
          button("Next: Try", () => move("try"), "today-primary")
        );
      if (state.step === "try") nav.append(button("Back", () => move("build")));
      if (nav.childElementCount) article.append(nav);
      const announcement = node("p", "sr-only", feedback);
      announcement.setAttribute("role", "status");
      const saveStatus = node("p", "quiet", storageAvailable ? "" : "Keep this tab open to continue this lesson.");
      saveStatus.id = "today-save-status";
      const notesWereOpen = app.querySelector(".today-parent")?.open;
      const notes = parentNotes();
      notes.open = Boolean(notesWereOpen);
      app.replaceChildren(intro, rail, article, announcement, saveStatus, notes);
    }
    if (state.step === "intro" && new URLSearchParams(window.location.search).get("start") === "1") {
      move("see");
    } else {
      draw();
    }
  }

  if (new URLSearchParams(window.location.search).get("lesson") === "today") teachToday();
  else nextExample();
})();
