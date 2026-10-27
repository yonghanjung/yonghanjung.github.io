(() => {
  "use strict";
  const app = document.getElementById("app"),
    E = CountingSense;
  const recent = { 1: [], 2: [] };
  let level = 1,
    model,
    phase,
    tradeIndex,
    taskIndex,
    value,
    wrong,
    shown,
    guess,
    answers;
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "") => {
    const b = node("button", cls, text);
    b.type = "button";
    b.onclick = action;
    return b;
  };
  function nextProblem() {
    model = level === 1 ? E.next(recent[level]) : E.nextLevel2(recent[level]);
    recent[level].push(E.pairKey(model));
    recent[level] = recent[level].slice(-20);
    phase = "guess";
    tradeIndex = 0;
    taskIndex = 0;
    value = "";
    wrong = false;
    shown = false;
    guess = "";
    answers = [];
    render();
    window.scrollTo(0, 0);
  }
  function unitChip(value, cls = "") {
    return node("span", "unit-chip " + cls, String(value));
  }
  function levelOneDiagram() {
    const diagram = node("section", "diagram level-one");
    diagram.setAttribute("aria-label", "Split into kept hundreds and one hundred to work on");
    const keep = node("div", "part kept");
    keep.append(node("small", "", "Keep"), node("strong", "", String(model.kept)));
    const chips = node("div", "chips");
    for (let i = 0; i < model.kept / 100; i++) chips.append(unitChip(100));
    keep.append(chips);
    const work = node("div", "part work");
    work.append(node("small", "", "Work on 100"));
    const grid = node("div", "hundred-grid");
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", `100 ones, ${model.take} crossed out`);
    for (let i = 0; i < 100; i++) {
      const cell = node("span", i >= 100 - model.take ? "removed" : "");
      cell.setAttribute("aria-hidden", "true");
      grid.append(cell);
    }
    work.append(grid, node("p", "small-note", `Cross out ${model.take}.`));
    diagram.append(keep, work);
    return diagram;
  }
  function displayCounts() {
    if (phase === "trade") return tradeIndex === 0 ? model.initial : model.trades[tradeIndex - 1].after;
    const counts = [...model.regrouped];
    for (let i = 0; i < answers.length; i++) {
      if (model.tasks[i].kind === "ones") counts[3] = model.ones;
      if (model.tasks[i].kind === "tens") counts[2] = model.tens / 10;
    }
    return counts;
  }
  function levelTwoDiagram() {
    const counts = displayCounts(),
      diagram = node("section", "diagram place-diagram");
    diagram.setAttribute("aria-label", "Place value counters");
    const names = ["Thousands", "Hundreds", "Tens", "Ones"];
    for (let i = 0; i < 4; i++) {
      const column = node("div", "place-column");
      column.append(node("small", "place-name", names[i]), node("strong", "place-count", `${counts[i]} × ${E.PLACES[i]}`));
      const chips = node("div", "chips");
      for (let j = 0; j < counts[i]; j++) chips.append(unitChip(E.PLACES[i]));
      column.append(chips);
      diagram.append(column);
    }
    const wrap = node("div", "place-wrap");
    wrap.append(diagram);
    const sum = E.amount(counts);
    const caption = phase === "trade" ? `Same value: ${model.base}` : `Value now: ${sum}`;
    // During a final question the remaining counters are the intended visual support,
    // but a numeric total is not printed until the student has entered it.
    if (phase === "trade" || phase === "complete") wrap.append(node("p", "small-note", caption));
    else wrap.append(node("p", "small-note", "Each counter has the value shown."));
    return wrap;
  }
  function tasks() {
    if (level === 2) return model.tasks;
    return [
      { prompt: `100 − ${model.take} =`, answer: model.subtotal, unit: "Work on 100" },
      { prompt: `${model.kept} + ${model.subtotal} =`, answer: model.total, unit: "Add the parts" },
    ];
  }
  function answerForm(card, labelText, action, isGuess = false) {
    const form = node("form"),
      label = node("label", "task", labelText),
      input = node("input");
    label.htmlFor = "answer";
    input.id = "answer";
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.autocomplete = "off";
    input.maxLength = level === 1 ? 3 : 4;
    input.value = value;
    input.setAttribute("aria-label", isGuess ? "Your guess" : "Your answer");
    input.oninput = () => {
      value = input.value.replace(/\D/g, "").slice(0, input.maxLength);
      input.value = value;
    };
    const check = node("button", "primary", isGuess ? "Guess" : "Check");
    check.type = "submit";
    form.append(label, input, check);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!/^\d{1,4}$/.test(value)) {
        input.focus();
        return;
      }
      action();
    };
    card.append(form);
  }
  function render(focusAnswer = false) {
    app.replaceChildren(node("h1", "", "Counting Sense"));
    const levels = node("div", "level-choice");
    levels.setAttribute("role", "group");
    levels.setAttribute("aria-label", "Level");
    for (const n of [1, 2]) {
      const b = button(`Level ${n}`, () => {
        if (level !== n) {
          level = n;
          nextProblem();
        }
      });
      b.setAttribute("aria-pressed", String(n === level));
      levels.append(b);
    }
    const controls = node("div", "practice-controls");
    controls.append(levels);
    app.append(controls, node("p", "problem", `${model.base} − ${model.take} = ?`));
    if (phase === "guess") {
      const card = node("section", "card guess-card");
      answerForm(
        card,
        "Your guess",
        () => {
          guess = value;
          value = "";
          wrong = false;
          shown = false;
          phase = level === 1 ? "task" : "trade";
          render();
        },
        true
      );
      app.append(card);
    } else {
      app.append(node("p", "step reveal-note", "Let’s check your guess."));
      if (level === 1) {
        app.append(node("p", "split-equation", `${model.base} − ${model.take} = ${model.kept} + (100 − ${model.take})`), levelOneDiagram());
      } else app.append(levelTwoDiagram());
      const card = node("section", "card");
      if (phase === "trade") {
        const trade = model.trades[tradeIndex],
          from = E.PLACE_NAMES[trade.from],
          to = E.PLACE_NAMES[trade.to];
        card.append(node("p", "trade-relation", `1 ${from} = 10 ${to === "ten" ? "tens" : to + "s"}`));
        card.append(
          button(
            `Trade 1 ${from}`,
            () => {
              tradeIndex++;
              if (tradeIndex === model.trades.length) phase = "task";
              render();
            },
            "primary trade-button"
          )
        );
      } else if (phase === "complete") {
        card.append(node("p", "success", `${model.base} − ${model.take} = ${model.total}`));
        const work = node("div", "completed-work");
        for (const task of tasks()) work.append(node("p", "", `${task.prompt} ${task.answer}`));
        card.append(work, node("p", "small-note", `Your guess: ${guess}.`));
      } else {
        const task = tasks()[taskIndex];
        card.append(node("p", "step", `${taskIndex + 1} of ${tasks().length} · ${task.unit}`));
        answerForm(card, task.prompt, () => {
          const result = level === 1 ? E.gradeStep(model, taskIndex, value) : E.gradeTask(model, taskIndex, value);
          if (!result.valid) return;
          if (!result.correct) {
            wrong = true;
            render(true);
            return;
          }
          answers[taskIndex] = task.answer;
          taskIndex++;
          value = "";
          wrong = false;
          shown = false;
          if (taskIndex === tasks().length) phase = "complete";
          render();
        });
        if (wrong) {
          const status = node("p", "status wrong", "Try this step again.");
          status.setAttribute("role", "status");
          card.append(status);
        }
        const actions = node("div", "actions");
        if (taskIndex > 0)
          actions.append(
            button("Previous step", () => {
              taskIndex--;
              value = String(answers[taskIndex]);
              answers = answers.slice(0, taskIndex);
              wrong = false;
              shown = false;
              render();
            })
          );
        if (wrong || shown)
          actions.append(
            button(shown ? "Hide steps" : "Show me", () => {
              shown = !shown;
              render();
            })
          );
        if (actions.childNodes.length) card.append(actions);
        if (shown) {
          const help = node("div", "help");
          help.append(node("p", "equation", `${task.prompt} ${task.answer}`));
          card.append(help);
        }
      }
      app.append(card);
    }
    const nav = node("nav", "navigation");
    nav.setAttribute("aria-label", "Practice navigation");
    nav.append(button("Next problem →", nextProblem, "primary"));
    controls.append(nav);
    const bottomNav = node("nav", "navigation bottom-navigation");
    bottomNav.setAttribute("aria-label", "Practice navigation bottom");
    bottomNav.append(button("Next problem →", nextProblem, "primary"));
    app.append(bottomNav);
    if (focusAnswer) document.getElementById("answer")?.focus({ preventScroll: true });
  }
  nextProblem();
})();
