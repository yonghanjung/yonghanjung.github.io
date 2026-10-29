(() => {
  "use strict";
  const app = document.getElementById("app"),
    E = CountingSense;
  let recent = [],
    used = new Set(),
    screen = "setup",
    count = "10",
    index = 0,
    outcomes = [],
    setupNotice = "";
  let model, phase, taskIndex, value, wrong, shown, guess, answers;
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
  function loadProblem() {
    const excluded = new Set([...used, ...recent]),
      pool = E.PAIRS.filter((pair) => !excluded.has(E.pairKey(pair)));
    if (!pool.length) throw Error("No fresh questions available");
    const values = new Uint32Array(1),
      limit = Math.floor(4294967296 / pool.length) * pool.length;
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    const pair = pool[values[0] % pool.length];
    model = E.decompose(pair.base, pair.take);
    const key = E.pairKey(model);
    used.add(key);
    recent.push(key);
    recent = recent.slice(-20);
    phase = "guess";
    taskIndex = 0;
    value = "";
    wrong = false;
    shown = false;
    guess = "";
    answers = [];
    render();
    window.scrollTo(0, 0);
  }
  function startRound() {
    if (!/^\d{1,2}$/.test(count) || Number(count) < 1 || Number(count) > 99) {
      setupNotice = "Choose 1–99 questions.";
      return render();
    }
    index = 0;
    outcomes = [];
    used = new Set();
    screen = "play";
    setupNotice = "";
    loadProblem();
  }
  function settle() {
    outcomes[index] = phase === "complete" ? "completed" : "skipped";
  }
  function nextProblem() {
    settle();
    if (index + 1 === Number(count)) {
      screen = "summary";
      render();
      window.scrollTo(0, 0);
    } else {
      index++;
      loadProblem();
    }
  }
  function finishRound() {
    settle();
    screen = "summary";
    render();
    window.scrollTo(0, 0);
  }
  function setup() {
    const card = node("section", "card round-setup"),
      form = node("form"),
      label = node("label", "count-setting", "Questions"),
      input = node("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.maxLength = 2;
    input.value = count;
    input.setAttribute("aria-label", "Number of questions");
    input.oninput = () => {
      count = input.value.replace(/\D/g, "").slice(0, 2);
      input.value = count;
    };
    label.append(input);
    const start = node("button", "primary", "Start");
    start.type = "submit";
    form.append(label, node("p", "small-note", "1–99 questions"), start);
    form.onsubmit = (event) => {
      event.preventDefault();
      startRound();
    };
    card.append(form);
    if (setupNotice) {
      const notice = node("p", "status wrong", setupNotice);
      notice.setAttribute("role", "alert");
      card.append(notice);
    }
    app.append(card);
  }
  function summary() {
    const completed = outcomes.filter((x) => x === "completed").length,
      skipped = outcomes.filter((x) => x === "skipped").length;
    const card = node("section", "card round-summary");
    card.append(
      node("h2", "", "Round finished"),
      node("p", "", `Completed: ${completed}`),
      node("p", "", `Skipped: ${skipped}`),
      node("p", "", `Not reached: ${Number(count) - completed - skipped}`),
      node("p", "small-note", `${Number(count)} questions planned`)
    );
    const actions = node("div", "actions");
    actions.append(
      button("New round", startRound, "primary"),
      button("Settings", () => {
        screen = "setup";
        render();
      })
    );
    card.append(actions);
    app.append(card);
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
  function tasks() {
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
    input.maxLength = 3;
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
      if (!/^\d{1,3}$/.test(value)) {
        input.focus();
        return;
      }
      action();
    };
    card.append(form);
  }
  function render(focusAnswer = false) {
    app.replaceChildren(node("h1", "", "Counting Sense"));
    if (screen === "setup") return setup();
    if (screen === "summary") return summary();
    const controls = node("div", "practice-controls"),
      progress = node("strong", "round-progress", `${index + 1} / ${Number(count)}`);
    controls.append(progress);
    if (index + 1 < Number(count)) controls.append(button("End early", finishRound, "finish-button"));
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
          phase = "task";
          render();
        },
        true
      );
      app.append(card);
    } else {
      app.append(node("p", "step reveal-note", "Let’s check your guess."));
      app.append(node("p", "split-equation", `${model.base} − ${model.take} = ${model.kept} + (100 − ${model.take})`), levelOneDiagram());
      const card = node("section", "card");
      if (phase === "complete") {
        card.append(node("p", "success", `${model.base} − ${model.take} = ${model.total}`));
        const work = node("div", "completed-work");
        for (const task of tasks()) work.append(node("p", "", `${task.prompt} ${task.answer}`));
        card.append(work, node("p", "small-note", `Your guess: ${guess}.`));
      } else {
        const task = tasks()[taskIndex];
        card.append(node("p", "step", `${taskIndex + 1} of ${tasks().length} · ${task.unit}`));
        answerForm(card, task.prompt, () => {
          const result = E.gradeStep(model, taskIndex, value);
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
    nav.append(button(index + 1 === Number(count) ? "Finish round" : "Next problem →", nextProblem, "primary"));
    controls.append(nav);
    const bottomNav = node("nav", "navigation bottom-navigation");
    bottomNav.setAttribute("aria-label", "Practice navigation bottom");
    bottomNav.append(button(index + 1 === Number(count) ? "Finish round" : "Next problem →", nextProblem, "primary"));
    app.append(bottomNav);
    if (focusAnswer) document.getElementById("answer")?.focus({ preventScroll: true });
  }
  render();
})();
