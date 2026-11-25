(() => {
  "use strict";
  const E = window.HaydenMath;
  const app = document.getElementById("app");
  const toolbar = document.getElementById("toolbar");
  const STORAGE = "haydenMathLab.v1";
  const TOPICS = {
    mix: "Mixed topics",
    arithmetic: "Arithmetic Challenge",
    measurement: "Measurement",
    geometry: "Geometry",
    narrative: "Narrative",
    brain: "Brain Teaser",
    addsub: "Add & Subtract",
    findfix: "Find & Fix",
    decimal: "Decimal division",
  };
  const TOPIC_EXAMPLES = {
    mix: "A little of each topic",
    arithmetic: "Missing numbers · compare products",
    measurement: "Clocks · coins · units",
    geometry: "Area · fences · angles",
    narrative: "Compare plans · scale recipes",
    brain: "Patterns · balance puzzles",
    addsub: "Regroup · subtract across zeros",
    findfix: "Find the wrong step · fix it",
    decimal: "Share · compare · find leftovers",
  };
  const TODAY_GOAL = "Use the same rows to multiply and divide.";
  const defaults = {
    domains: [...E.DOMAINS],
    section: "mix",
    count: 10,
    customCount: 10,
    addsubOps: ["+", "−"],
    findfixOps: ["+", "−", "×", "÷"],
    maxDigits: 4,
  };
  const isPractice = (section) => ["addsub", "findfix"].includes(section);
  const sectionFor = (domains) => (domains.length === 1 ? domains[0] : JSON.stringify(domains) === JSON.stringify(E.DOMAINS) ? "mix" : "selected");
  let prefs = { ...defaults },
    summaries = [],
    screen = "contents",
    problemScreen = "home",
    round = null,
    notice = "",
    seedDraft = "",
    bankDraft = "expanded",
    sessionRecentVisible = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (saved?.version === 1) {
      if (Object.hasOwn(TOPICS, saved.prefs?.section)) prefs.section = saved.prefs.section;
      if ([10, 15, 20, "custom", "unlimited"].includes(saved.prefs?.count)) prefs.count = saved.prefs.count;
      if (Number.isInteger(saved.prefs?.customCount) && saved.prefs.customCount >= 1 && saved.prefs.customCount <= 999)
        prefs.customCount = saved.prefs.customCount;
      if (Number.isInteger(saved.prefs?.maxDigits) && saved.prefs.maxDigits >= 1 && saved.prefs.maxDigits <= 4)
        prefs.maxDigits = saved.prefs.maxDigits;
      for (const key of ["addsubOps", "findfixOps"]) {
        const allowed = defaults[key],
          selected = Array.isArray(saved.prefs?.[key]) ? allowed.filter((op) => saved.prefs[key].includes(op)) : [];
        if (selected.length) prefs[key] = selected;
      }
      try {
        prefs.domains = saved.prefs?.domains ? E.normalizeDomains(saved.prefs.domains) : prefs.section === "mix" ? [...E.DOMAINS] : [prefs.section];
      } catch {
        prefs.domains = [...E.DOMAINS];
      }
      prefs.section = sectionFor(prefs.domains);
      if (Array.isArray(saved.summaries))
        summaries = saved.summaries
          .filter(
            (s) => s && Number.isInteger(s.answered) && s.answered >= 0 && Number.isInteger(s.correct) && s.correct >= 0 && s.correct <= s.answered
          )
          .slice(-12);
    }
  } catch {}
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  };
  function button(text, action, cls = "", label) {
    const b = el("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", action);
    return b;
  }
  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ version: 1, prefs, summaries: summaries.slice(-12) }));
    } catch {}
  }
  function valid(q) {
    try {
      return Boolean(E && E.verifyQuestion(q).ok);
    } catch {
      return false;
    }
  }
  function fetchQuestion() {
    if (round.queue) return round.queue[round.index];
    if (!round.cycle.length) {
      const batch = isPractice(round.config.section) || round.config.section === "selected" ? 20 : 10;
      const count = round.total === null ? batch : Math.min(batch, round.total - round.index);
      const baselineFingerprints = round.config.seed ? [] : round.baselineVisible,
        recentFingerprints = round.config.seed ? [] : round.recent;
      const questions = E.generateRound({
        section: round.config.section,
        count,
        seed: round.config.seed,
        offset: round.index,
        ops: round.config.ops,
        maxDigits: round.config.maxDigits,
        domains: round.config.domains,
        addsubOps: round.config.addsubOps,
        findfixOps: round.config.findfixOps,
        roundKey: round.config.roundKey,
        bank: round.config.bank,
        baselineFingerprints,
        recentFingerprints,
      });
      if (!Array.isArray(questions) || questions.length !== count || !questions.every(valid)) throw new Error("Questions unavailable");
      round.cycle = questions;
    }
    const q = round.cycle.shift();
    if (!valid(q)) throw new Error("Invalid question");
    return q;
  }
  function resetQuestion(q) {
    round.current = q;
    round.first = null;
    round.response = {};
    round.grade = null;
    round.hintShown = false;
    round.answerShown = false;
    round.activeField = 0;
    const fingerprint = E.questionFingerprint(q);
    round.recent.push(fingerprint);
    round.recent = round.recent.slice(-20);
    sessionRecentVisible.push(fingerprint);
    sessionRecentVisible = sessionRecentVisible.slice(-20);
  }
  function rememberQuestion() {
    round.visited[round.index] = {
      current: round.current,
      response: { ...round.response },
      first: round.first,
      grade: round.grade,
      hintShown: round.hintShown,
      answerShown: round.answerShown,
      activeField: round.activeField,
    };
  }
  function restoreQuestion(index) {
    const saved = round.visited[index];
    round.index = index;
    Object.assign(round, saved, { response: { ...saved.response } });
  }
  function start(config = { ...prefs, seed: seedDraft }, retry = null) {
    const domains = E.normalizeDomains(config.domains ?? (config.section === "mix" ? E.DOMAINS : [config.section]));
    config = { ...config, domains, section: sectionFor(domains) };
    if (isPractice(config.section)) config.ops = config.section === "addsub" ? config.addsubOps : config.findfixOps;
    notice = "";
    const count = config.count === "custom" ? config.customCount : config.count;
    if (count !== "unlimited" && (!Number.isInteger(count) || count < 1 || count > 999)) {
      notice = "Choose 1–999 questions.";
      return render();
    }
    let seed;
    try {
      seed = E.normalizeSeed(config.seed ?? "");
    } catch {
      notice = "Enter a valid date: YYYYMMDD.";
      return render();
    }
    const priorRound = round;
    try {
      const queue = retry || null;
      if (queue && (!Array.isArray(queue) || !queue.length || queue.some((q) => !valid(q)))) throw new Error("Invalid question set");
      round = {
        config: {
          ...config,
          seed,
          bank: seed && config.bank === "original" ? "original" : "expanded",
          roundKey: seed ? null : Array.from(crypto.getRandomValues(new Uint32Array(2))).join(":"),
        },
        queue,
        total: queue ? queue.length : count === "unlimited" ? null : count,
        index: 0,
        visited: [],
        cycle: [],
        baselineVisible: seed ? [] : sessionRecentVisible.slice(),
        recent: [],
        answered: 0,
        correct: 0,
        mistakes: [],
        current: null,
        finished: false,
      };
      resetQuestion(fetchQuestion());
      rememberQuestion();
      screen = "play";
      save();
      render();
      window.scrollTo(0, 0);
    } catch {
      round = priorRound;
      notice = "Questions are unavailable. Please try again.";
      screen = "home";
      render();
    }
  }
  function home() {
    toolbar.replaceChildren();
    if (round && !round.finished)
      toolbar.append(
        button("Continue", () => {
          screen = "play";
          notice = "";
          render();
        })
      );
    const card = el("section", "card setup");
    const topicRow = el("div", "setup-row");
    topicRow.append(el("span", "label", "Topics"));
    const topics = el("div", "topic-grid");
    topics.setAttribute("role", "group");
    topics.setAttribute("aria-label", "Topics");
    for (const [key, topicLabel] of Object.entries(TOPICS)) {
      const label = key === "mix" ? "All topics" : topicLabel;
      const selected = key === "mix" ? prefs.domains.length === E.SELECTABLE_DOMAINS.length : prefs.domains.includes(key);
      const b = button(
        label,
        () => {
          if (key === "mix") prefs.domains = [...E.SELECTABLE_DOMAINS];
          else {
            if (selected && prefs.domains.length === 1) return;
            prefs.domains = E.normalizeDomains(selected ? prefs.domains.filter((s) => s !== key) : [...prefs.domains, key]);
          }
          prefs.section = sectionFor(prefs.domains);
          notice = "";
          save();
          render();
        },
        selected ? "selected" : ""
      );
      b.replaceChildren(el("span", "topic-name", label), el("small", "topic-example", TOPIC_EXAMPLES[key]));
      b.setAttribute("aria-label", label);
      b.lastChild.id = "topic-example-" + key;
      b.setAttribute("aria-describedby", b.lastChild.id);
      if (key === "mix") b.setAttribute("aria-pressed", String(selected));
      else {
        b.setAttribute("role", "checkbox");
        b.setAttribute("aria-checked", String(selected));
      }
      topics.append(b);
    }
    topicRow.append(topics);
    card.append(topicRow);
    let digitsShown = false;
    for (const practiceSection of prefs.domains.filter(isPractice)) {
      const opRow = el("div", "setup-row"),
        controls = el("div", "practice-options");
      opRow.append(el("span", "label", prefs.domains.length === 1 ? "Operations" : TOPICS[practiceSection] + " operations"));
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", prefs.domains.length === 1 ? "Operations" : TOPICS[practiceSection] + " operations");
      const key = practiceSection === "addsub" ? "addsubOps" : "findfixOps";
      for (const op of defaults[key]) {
        const selected = prefs[key].includes(op),
          b = button(
            op,
            () => {
              if (selected && prefs[key].length === 1) return;
              prefs[key] = selected ? prefs[key].filter((x) => x !== op) : defaults[key].filter((x) => prefs[key].includes(x) || x === op);
              save();
              render();
            },
            selected ? "selected" : "",
            { "+": "Addition", "−": "Subtraction", "×": "Multiplication", "÷": "Division" }[op]
          );
        b.setAttribute("aria-pressed", String(selected));
        controls.append(b);
      }
      opRow.append(controls);
      card.append(opRow);
      if (!digitsShown && prefs[key].some((op) => ["+", "−"].includes(op))) {
        digitsShown = true;
        const row = el("div", "setup-row"),
          digits = el("div", "practice-options");
        row.append(el("span", "label", prefs.domains.includes("findfix") ? "+ / − max digits" : "Max digits"));
        digits.setAttribute("role", "group");
        digits.setAttribute("aria-label", "Maximum digits");
        for (const n of [1, 2, 3, 4]) {
          const b = button(
            String(n),
            () => {
              prefs.maxDigits = n;
              save();
              render();
            },
            prefs.maxDigits === n ? "selected" : "",
            n + " digit maximum"
          );
          b.setAttribute("aria-pressed", String(prefs.maxDigits === n));
          digits.append(b);
        }
        row.append(digits);
        card.append(row);
      }
    }
    const countRow = el("div", "setup-row");
    countRow.append(el("span", "label", "Questions"));
    const counts = el("div", "count-grid");
    counts.setAttribute("role", "group");
    counts.setAttribute("aria-label", "Round length");
    for (const count of [10, 15, 20, "custom", "unlimited"]) {
      const label = count === "custom" ? "Custom" : count === "unlimited" ? "∞" : String(count);
      const b = button(
        label,
        () => {
          prefs.count = count;
          notice = "";
          save();
          render();
        },
        prefs.count === count ? "selected" : "",
        count === "unlimited" ? "Unlimited" : count === "custom" ? "Custom question count" : count + " questions"
      );
      b.setAttribute("aria-pressed", String(prefs.count === count));
      counts.append(b);
    }
    countRow.append(counts);
    if (prefs.count === "custom") {
      const custom = el("div", "custom-count");
      const input = el("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 3;
      input.value = String(prefs.customCount);
      input.setAttribute("aria-label", "Number of questions");
      input.addEventListener("input", () => {
        prefs.customCount = /^\d+$/.test(input.value) ? Number(input.value) : null;
      });
      custom.append(input, el("span", "", "1–999"));
      countRow.append(custom);
    }
    card.append(countRow);
    const seedRow = el("div", "setup-row");
    seedRow.append(el("label", "label", "Date (optional)"));
    const bankRow = el("div", "problem-bank");
    bankRow.hidden = !seedDraft.trim();
    const bankLabel = el("label", "", "Question bank");
    bankLabel.htmlFor = "question-bank";
    const bank = el("select");
    bank.id = "question-bank";
    bank.append(new Option("Expanded", "expanded"), new Option("Earlier sets", "original"));
    bank.value = bankDraft;
    bank.addEventListener("change", () => {
      bankDraft = bank.value;
    });
    bankRow.append(bankLabel, bank);
    const seedControls = el("div", "seed-controls"),
      seedInput = el("input");
    seedInput.id = "seed-date";
    seedRow.firstChild.htmlFor = "seed-date";
    seedInput.type = "text";
    seedInput.inputMode = "numeric";
    seedInput.maxLength = 8;
    seedInput.placeholder = "YYYYMMDD";
    seedInput.value = seedDraft;
    seedInput.setAttribute("aria-label", "Date YYYYMMDD");
    seedInput.addEventListener("input", () => {
      seedDraft = seedInput.value;
      bankRow.hidden = !seedDraft.trim();
      if (bankRow.hidden) bank.value = bankDraft = "expanded";
      notice = "";
      card.querySelector(".notice")?.remove();
    });
    seedControls.append(
      seedInput,
      button("Random", () => {
        seedDraft = "";
        bankDraft = "expanded";
        notice = "";
        render();
      })
    );
    seedRow.append(seedControls, bankRow);
    card.append(
      seedRow,
      button("Start", () => start({ ...prefs, seed: seedDraft, bank: bankDraft }), "primary start")
    );
    if (!E) {
      card.lastChild.disabled = true;
      card.append(el("p", "notice", "Questions are unavailable."));
    }
    if (notice) {
      const n = el("p", "notice", notice);
      n.setAttribute("role", "alert");
      card.append(n);
    }
    app.append(card);
  }
  function visual(q, parent) {
    const v = q.visual;
    if (v?.kind === "worked_solution") {
      const lines = el("div", "worked-lines");
      lines.setAttribute("role", "group");
      lines.setAttribute("aria-label", "Worked solution");
      v.lines.forEach((line, index) => {
        const number = index + 1,
          text = `${line.a} ${line.op} ${line.b} = ${line.value}`;
        const b = button(
          `${number}. ${text}`,
          () => {
            if (round.grade?.correct) return;
            round.response.Line = String(number);
            round.activeField = 1;
            notice = "";
            render();
          },
          "worked-line" + (Number(round.response.Line) === number ? " selected" : ""),
          `Line ${number}: ${text}`
        );
        b.setAttribute("aria-pressed", String(Number(round.response.Line) === number));
        b.disabled = Boolean(round.grade?.correct);
        lines.append(b);
      });
      parent.append(lines);
      return;
    }
    if (v?.kind === "hundred_split") {
      const split = el("div", "hundred-split");
      split.append(el("p", "", `${v.base} = ${v.kept} + 100`), el("p", "", `Keep ${v.kept}. Work on 100 − ${v.take}.`));
      parent.append(split);
      return;
    }
    if (v?.kind === "data_table") {
      const table = el("table", "problem-data");
      const head = el("thead"),
        labels = el("tr");
      for (const label of v.headers) {
        const th = el("th", "", label);
        th.scope = "col";
        labels.append(th);
      }
      head.append(labels);
      const body = el("tbody");
      for (const values of v.rows) {
        const row = el("tr");
        for (const value of values) row.append(el("td", "", value));
        body.append(row);
      }
      table.append(el("caption", "", v.caption), head, body);
      parent.append(table);
      return;
    }
    if (v?.kind === "tile_frame") {
      const grid = el("div", "problem-frame");
      grid.setAttribute("role", "img");
      grid.setAttribute("aria-label", `${v.rows} rows and ${v.cols} columns with just the outside tiles colored`);
      grid.style.setProperty("--columns", v.cols);
      for (let y = 0; y < v.rows; y++) {
        for (let x = 0; x < v.cols; x++) grid.append(el("i", y === 0 || x === 0 || y === v.rows - 1 || x === v.cols - 1 ? "frame-tile" : ""));
      }
      parent.append(grid);
      return;
    }
    if (
      !v ||
      !["perimeter", "ruler", "rectangle", "clock", "coins", "angle", "lines", "symmetry", "partition", "composite", "bar_model"].includes(v.kind)
    )
      return;
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "math-visual" + (v.kind === "ruler" ? " ruler-visual" : ""));
    svg.setAttribute("role", "img");
    const node = (tag, attrs) => {
      const n = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
      svg.append(n);
      return n;
    };
    const text = (content, x, y, anchor = "middle") => {
      if (content === undefined || content === null || content === "") return;
      const t = node("text", { x, y, "text-anchor": anchor, "font-size": 15, fill: "#173e43" });
      t.textContent = String(content);
      return t;
    };
    if (v.kind === "bar_model") {
      svg.classList.add("bar-visual");
      svg.setAttribute("viewBox", `0 0 360 ${v.rows.length * 76}`);
      svg.setAttribute(
        "aria-label",
        "Bar model. " + v.rows.map((row) => row.label + ": " + row.segments.map((part) => part.text).join(", ")).join(". ")
      );
      const maxSegments = Math.max(...v.rows.map((row) => row.segments.length));
      const width = (336 - (maxSegments - 1) * 4) / maxSegments;
      v.rows.forEach((row, index) => {
        const top = index * 76;
        text(row.label, 12, top + 20, "start");
        row.segments.forEach((part, i) => {
          const left = 12 + i * (width + 4);
          node("rect", {
            x: left,
            y: top + 30,
            width,
            height: 32,
            rx: 3,
            fill: part.role === "extra" ? "#f4d8a5" : part.role === "known" ? "#c3e2dc" : "#edf4f0",
            stroke: "#267c74",
            "stroke-width": 1.5,
          });
          text(part.text, left + width / 2, top + 52);
        });
      });
      parent.append(svg);
      if (v.note) parent.append(el("p", "diagram-note", v.note));
      return;
    }
    if (v.kind === "clock") {
      svg.setAttribute("viewBox", "0 0 230 230");
      svg.setAttribute("aria-label", "Analog clock");
      node("circle", { cx: 115, cy: 115, r: 94, fill: "#fffefa", stroke: "#267c74", "stroke-width": 3 });
      const point = (degrees, r) => ({ x: 115 + r * Math.sin((degrees * Math.PI) / 180), y: 115 - r * Math.cos((degrees * Math.PI) / 180) });
      for (let i = 0; i < 60; i++) {
        const a = point(i * 6, i % 5 === 0 ? 84 : 90),
          b = point(i * 6, 94);
        node("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#173e43", "stroke-width": i % 5 === 0 ? 2 : 1 });
      }
      for (let n = 1; n <= 12; n++) {
        const p = point(n * 30, 71);
        const t = text(n, p.x, p.y + 5);
        t.setAttribute("font-size", "17");
      }
      const hour = point((v.hour % 12) * 30 + v.minute * 0.5, 54),
        minute = point(v.minute * 6, 79);
      node("line", { x1: 115, y1: 115, x2: hour.x, y2: hour.y, stroke: "#173e43", "stroke-width": 6, "stroke-linecap": "round" });
      node("line", { x1: 115, y1: 115, x2: minute.x, y2: minute.y, stroke: "#19776e", "stroke-width": 3.5, "stroke-linecap": "round" });
      node("circle", { cx: 115, cy: 115, r: 5, fill: "#173e43" });
      parent.append(svg);
      return;
    }
    if (v.kind === "coins") {
      svg.setAttribute("aria-label", "Coin groups with each coin denomination labeled");
      let y = 25;
      for (const group of v.groups || []) {
        text(group.name, 15, y, "start");
        y += 30;
        const count = group.count === null ? 1 : group.count;
        if (!Number.isInteger(count) || count < 0 || count > 40) return;
        if (group.count === null) text("? ×", 18, y + 5, "start");
        if (count === 0) text("0", 30, y + 5);
        for (let i = 0; i < count; i++) {
          const cx = (group.count === null ? 90 : 30) + (i % 6) * 44,
            cy = y + Math.floor(i / 6) * 44;
          node("circle", { cx, cy, r: 18, fill: group.value === 5 ? "#e0e7e5" : "#e8f0ef", stroke: "#728b87", "stroke-width": 1.5 });
          const t = text(group.value + "¢", cx, cy + 5);
          t.setAttribute("font-size", "14");
        }
        y += Math.max(1, Math.ceil(count / 6)) * 44 + 15;
      }
      svg.setAttribute("viewBox", `0 0 280 ${y}`);
      svg.setAttribute("class", "math-visual coins-visual");
      parent.append(svg);
      return;
    }
    if (v.kind === "angle") {
      svg.setAttribute("viewBox", "0 0 240 200");
      svg.setAttribute("aria-label", "Angle formed by two rays");
      const theta = (v.degrees * Math.PI) / 180,
        x = 120 + 85 * Math.cos(theta),
        y = 155 - 85 * Math.sin(theta);
      node("path", { d: `M 205 155 L 120 155 L ${x} ${y}`, fill: "none", stroke: "#267c74", "stroke-width": 4, "stroke-linecap": "round" });
      node("path", {
        d: `M 145 155 A 25 25 0 0 0 ${120 + 25 * Math.cos(theta)} ${155 - 25 * Math.sin(theta)}`,
        fill: "none",
        stroke: "#7eaaa0",
        "stroke-width": 2,
      });
      parent.append(svg);
      return;
    }
    if (v.kind === "lines") {
      svg.setAttribute("viewBox", "0 0 200 200");
      svg.setAttribute("aria-label", "Two line segments");
      for (const segment of v.segments || []) node("line", { ...segment, stroke: "#267c74", "stroke-width": 3.5, "stroke-linecap": "round" });
      parent.append(svg);
      return;
    }
    if (v.kind === "symmetry") {
      svg.setAttribute("viewBox", "0 0 230 190");
      svg.setAttribute("aria-label", v.shape + " shape");
      const points = {
        square: "55,25 175,25 175,145 55,145",
        rectangle: "40,40 190,40 190,130 40,130",
        equilateral: `35,155 195,155 115,${155 - 80 * Math.sqrt(3)}`,
        isosceles: "40,155 190,155 115,40",
        scalene: "40,155 195,155 80,35",
      }[v.shape];
      if (!points) return;
      node("polygon", { points, fill: "#edf4ea", stroke: "#267c74", "stroke-width": 3 });
      parent.append(svg);
      return;
    }
    if (v.kind === "partition") {
      svg.setAttribute("viewBox", "0 0 230 140");
      svg.setAttribute("aria-label", "Whole divided into equal parts with one part shaded");
      const width = 180 / v.cols,
        height = 80 / v.rows;
      for (let row = 0; row < v.rows; row++)
        for (let col = 0; col < v.cols; col++)
          node("rect", {
            x: 25 + col * width,
            y: 25 + row * height,
            width,
            height,
            fill: row * v.cols + col < v.shaded ? "#8ebbad" : "#fffefa",
            stroke: "#267c74",
            "stroke-width": 2,
          });
      parent.append(svg);
      return;
    }
    if (v.kind === "composite") {
      const rects = v.rectangles || [];
      if (rects.length !== 2) return;
      const minX = Math.min(...rects.map((r) => r.x)),
        minY = Math.min(...rects.map((r) => r.y));
      const width = Math.max(...rects.map((r) => r.x + r.width)) - minX,
        height = Math.max(...rects.map((r) => r.y + r.height)) - minY,
        scale = Math.min(190 / width, 110 / height);
      svg.setAttribute("viewBox", "0 0 260 220");
      svg.setAttribute("class", "math-visual composite-visual");
      svg.setAttribute("aria-label", "Two adjoining rectangles with labeled dimensions");
      rects.forEach((r, i) => {
        const x = 30 + (r.x - minX) * scale,
          y = 25 + (r.y - minY) * scale,
          w = r.width * scale,
          h = r.height * scale;
        node("rect", { x, y, width: w, height: h, fill: i ? "#deece6" : "#eff4e9", stroke: "#267c74", "stroke-width": 2 });
        text(i + 1, x + w / 2, y + h / 2 + 5);
        text(i + 1 + ": " + r.widthLabel + " × " + r.heightLabel, 130, 165 + i * 25);
      });
      parent.append(svg);
      return;
    }
    if (v.kind === "ruler") {
      if (
        !Number.isInteger(v.max) ||
        v.max < 1 ||
        v.max > 50 ||
        !Number.isInteger(v.start) ||
        !Number.isInteger(v.end) ||
        v.start < 0 ||
        v.end <= v.start ||
        v.end > v.max
      )
        return;
      svg.setAttribute("viewBox", "0 0 330 175");
      svg.setAttribute("aria-label", `Ruler in ${v.unit}. Object starts at ${v.start} and ends at ${v.end}.`);
      const x = (value) => 20 + (290 * value) / v.max;
      node("line", { x1: 20, y1: 105, x2: 310, y2: 105, stroke: "#173e43", "stroke-width": 2 });
      for (let i = 0; i <= v.max; i++) {
        node("line", { x1: x(i), y1: 105, x2: x(i), y2: i % 5 === 0 ? 123 : 116, stroke: "#173e43", "stroke-width": 1.5 });
        if (v.max <= 15 || i % 2 === 0 || i === v.max) text(i, x(i), 143);
      }
      node("line", { x1: x(v.start), y1: 72, x2: x(v.end), y2: 72, stroke: "#19776e", "stroke-width": 10, "stroke-linecap": "butt" });
      for (const value of [v.start, v.end]) node("line", { x1: x(value), y1: 64, x2: x(value), y2: 105, stroke: "#19776e", "stroke-width": 2 });
      text("Start: " + v.start, x(v.start), 32, v.start < v.max / 4 ? "start" : "middle");
      text("End: " + v.end, x(v.end), 53, v.end > (v.max * 3) / 4 ? "end" : "middle");
      text(v.unit, 165, 169);
      parent.append(svg);
      return;
    }
    svg.setAttribute("viewBox", "0 0 230 220");
    if (v.kind === "rectangle") {
      svg.setAttribute("aria-label", `Rectangle. Width ${v.widthLabel}. Height ${v.heightLabel}. Not to scale.`);
      node("rect", { x: 25, y: 25, width: 165, height: 100, fill: "#edf4ea", stroke: "#267c74", "stroke-width": 3 });
      text(v.widthLabel, 107, 151);
      const heightLabel = text(v.heightLabel, 210, 75);
      if (heightLabel) heightLabel.setAttribute("transform", "rotate(90 210 75)");
    } else {
      if (!["square", "triangle"].includes(v.shape)) return;
      svg.setAttribute("aria-label", v.shape + " perimeter diagram");
      node("polygon", {
        points: v.shape === "square" ? "55,20 175,20 175,140 55,140" : "115,15 40,140 190,140",
        fill: "#edf4ea",
        stroke: "#267c74",
        "stroke-width": 3,
      });
      text(v.sideLabel, 115, 166);
      text(v.totalLabel, 115, 190);
    }
    parent.append(svg);
    if (v.notToScale) parent.append(el("p", "diagram-note", "Not to scale"));
  }
  function prompt(q, parent) {
    const box = el("div", "prompt");
    const paragraphs = Array.isArray(q.prompt) ? q.prompt : String(q.prompt).split("\n").filter(Boolean);
    for (const text of paragraphs) box.append(el("p", "", text));
    parent.append(box);
    visual(q, parent);
  }
  function renderFields(q, parent) {
    const fields = el("div", "response-fields" + (q.response.kind === "pair" ? " pair-fields" : ""));
    q.response.fields.forEach((field, index) => {
      const wrapper = el("div", q.response.kind === "matching" ? "matching-field" : "numeric-field");
      const label = el("label", "", field.label);
      label.htmlFor = "answer-" + index;
      wrapper.append(label);
      if (q.response.kind === "choice") {
        label.removeAttribute("for");
        const choices = el("div", "choice-options");
        choices.setAttribute("role", "group");
        choices.setAttribute("aria-label", field.label);
        for (const option of field.options || []) {
          const b = button(
            option,
            () => {
              round.response[field.key] = option;
              notice = "";
              render();
            },
            round.response[field.key] === option ? "selected" : ""
          );
          b.setAttribute("aria-pressed", String(round.response[field.key] === option));
          b.disabled = Boolean(round.grade?.correct);
          choices.append(b);
        }
        wrapper.append(choices);
      } else if (q.response.kind === "matching") {
        const select = el("select");
        select.id = "answer-" + index;
        select.setAttribute("aria-label", field.label);
        select.append(new Option("Choose…", ""));
        for (const option of field.options || []) {
          const value = typeof option === "object" ? option.value : option;
          const title = typeof option === "object" ? option.label : option;
          select.append(new Option(String(title), String(value)));
        }
        select.value = round.response[field.key] || "";
        select.disabled = Boolean(round.grade?.correct);
        select.addEventListener("change", () => {
          round.response[field.key] = select.value;
          notice = "";
        });
        wrapper.append(select);
      } else {
        const value = round.response[field.key] ?? "";
        const b = button(
          "",
          () => {
            round.activeField = index;
            notice = "";
            render();
          },
          "field-value" + (round.activeField === index ? " active-field" : ""),
          field.label + " answer"
        );
        b.id = "answer-" + index;
        b.setAttribute("aria-pressed", String(round.activeField === index));
        b.append(el("span", "", value === "" ? "?" : value));
        if (field.unit) b.append(el("small", "", field.unit));
        b.disabled = Boolean(round.grade?.correct);
        wrapper.append(b);
      }
      fields.append(wrapper);
    });
    parent.append(fields);
  }
  function digit(key) {
    if (screen !== "play" || round.grade?.correct) return;
    const field = round.current.response.fields[round.activeField],
      current = String(round.response[field.key] ?? "");
    if (key === ".") {
      if (round.current.response.kind !== "decimal" || current.includes(".")) return;
    }
    round.response[field.key] = key === "delete" ? current.slice(0, -1) : current.length < (field.maxDigits ?? 3) ? current + key : current;
    notice = "";
    render();
  }
  function check() {
    if (screen !== "play" || round.grade?.correct) return;
    const q = round.current,
      response = {};
    for (let i = 0; i < q.response.fields.length; i++) {
      const f = q.response.fields[i],
        raw = String(round.response[f.key] ?? "").trim();
      if (!raw) {
        round.activeField = i;
        notice = "Complete each answer.";
        return render();
      }
      if (q.response.kind === "decimal") {
        if (E.parseDecimal(raw) === null) {
          notice = "Use a number with up to two decimal places.";
          return render();
        }
        response[f.key] = raw;
      } else if (["matching", "choice"].includes(q.response.kind)) response[f.key] = raw;
      else if (/^\d+$/.test(raw)) response[f.key] = Number(raw);
      else {
        notice = "Enter a whole number.";
        return render();
      }
    }
    let result;
    try {
      result = E.gradeAnswer(q, response);
    } catch {
      notice = "Please check your answers.";
      return render();
    }
    if (!result.valid) {
      notice = "Please check your answers.";
      return render();
    }
    round.response = { ...response };
    round.grade = result;
    notice = "";
    if (!round.first) {
      round.first = { response: { ...response }, correct: Boolean(result.correct) };
      round.answered++;
      if (result.correct) round.correct++;
      else round.mistakes.push({ question: q, response: { ...response } });
    }
    render();
  }
  function previous() {
    if (!round || round.index === 0) return;
    rememberQuestion();
    restoreQuestion(round.index - 1);
    notice = "";
    render();
    window.scrollTo(0, 0);
  }
  function next() {
    if (!round) return;
    const prior = round.index;
    if (round.visited[prior + 1]) {
      rememberQuestion();
      restoreQuestion(prior + 1);
      notice = "";
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (!round.first && !isPractice(round.current.section)) return;
    if (round.total !== null && prior + 1 >= round.total) return finish();
    rememberQuestion();
    round.index = prior + 1;
    try {
      resetQuestion(fetchQuestion());
      rememberQuestion();
      notice = "";
      render();
      window.scrollTo(0, 0);
    } catch {
      restoreQuestion(prior);
      notice = "Could not load the next question.";
      render();
    }
  }
  function finish() {
    if (!round || round.finished) return;
    round.finished = true;
    summaries.push({ section: round.config.section, answered: round.answered, correct: round.correct, date: new Date().toISOString() });
    summaries = summaries.slice(-12);
    save();
    screen = "summary";
    notice = "";
    render();
    window.scrollTo(0, 0);
  }
  function play() {
    toolbar.replaceChildren(
      button("Home", () => {
        screen = "home";
        notice = "";
        render();
      }),
      button("Finish", finish)
    );
    const box = el("section", "card problem");
    const bar = el("div", "round-bar");
    bar.append(
      el("span", "counter", round.index + 1 + " / " + (round.total === null ? "∞" : round.total)),
      el("span", "", TOPICS[round.current.section] || TOPICS[round.config.section])
    );
    if (round.config.seed) {
      const bankName = round.config.bank === "original" ? " · Earlier sets" : "";
      bar.append(el("span", "seed-badge", round.config.seed + bankName));
    }
    box.append(bar);
    prompt(round.current, box);
    renderFields(round.current, box);
    if (["matching", "choice"].includes(round.current.response.kind)) {
      const b = button("Check", check, "primary match-check");
      b.disabled = Boolean(round.grade?.correct);
      box.append(b);
    } else {
      const pad = el("div", "pad");
      pad.setAttribute("role", "group");
      pad.setAttribute("aria-label", "Answer keypad");
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const b = button(String(n), () => digit(String(n)), "", String(n));
        b.disabled = Boolean(round.grade?.correct);
        pad.append(b);
      }
      pad.append(
        button("⌫", () => digit("delete"), "", "Delete"),
        button("0", () => digit("0"), "", "0"),
        round.current.response.kind === "decimal"
          ? button(".", () => digit("."), "", "Decimal point")
          : button(
              "Clear",
              () => {
                const f = round.current.response.fields[round.activeField];
                if (round.grade?.correct) return;
                round.response[f.key] = "";
                notice = "";
                render();
              },
              "",
              "Clear answer"
            )
      );
      const b = button("Check", check, "primary check");
      b.disabled = Boolean(round.grade?.correct);
      pad.append(b);
      box.append(pad);
    }
    if (notice) {
      const n = el("p", "notice", notice);
      n.setAttribute("role", "alert");
      box.append(n);
    }
    if (round.grade) {
      const result = el("div", "result " + (round.grade.correct ? "correct" : "wrong"), round.grade.correct ? "Correct!" : "Try again.");
      result.setAttribute("role", "status");
      box.append(result);
      const follow = el("div", "followup");
      follow.append(
        button("Hint", () => {
          round.hintShown = !round.hintShown;
          render();
        })
      );
      if (round.current.section !== "findfix")
        follow.append(
          button("Answer", () => {
            round.answerShown = !round.answerShown;
            render();
          })
        );
      box.append(follow);
      if (round.hintShown) box.append(el("div", "help", round.current.hint));
      if (round.answerShown) box.append(el("div", "help", E.formatAnswer(round.current) + "\n" + round.current.explanation));
      if (round.current.section === "findfix" && round.grade.correct) {
        const work = el("div", "help corrected-work");
        work.append(el("strong", "", "Corrected work"));
        for (const text of round.current.explanation.split("\n")) work.append(el("p", "", text));
        box.append(work);
      }
    }
    const navigation = el("div", "question-navigation");
    const back = button("Previous", previous);
    back.disabled = round.index === 0;
    const forward = button("Next", next, "primary");
    forward.disabled = !isPractice(round.current.section) && !round.first && !round.visited[round.index + 1];
    navigation.append(back, forward);
    box.append(navigation);
    app.append(box);
  }
  function summary() {
    toolbar.replaceChildren(
      button("Home", () => {
        screen = "home";
        notice = "";
        render();
      })
    );
    const box = el("section", "card summary"),
      top = el("div", "summary-top");
    if (!isPractice(round.config.section) && round.config.section !== "selected" && round.answered > 0 && round.correct === round.answered)
      top.append(el("div", "master", "Master!"));
    const score = el("div", "score", round.correct);
    score.append(el("small", "", " / " + round.answered));
    top.append(score, el("p", "summary-subtitle", round.answered ? "First answers" : "No answers yet."));
    if (isPractice(round.config.section) || round.config.section === "selected") {
      const seen = round.visited.filter(Boolean).length;
      top.append(el("p", "summary-subtitle", `Answered: ${round.answered} · Skipped: ${Math.max(0, seen - round.answered)}`));
    }
    const actions = el("div", "summary-actions");
    if (round.mistakes.length)
      actions.append(
        button(
          "Practice mistakes",
          () => {
            const qs = round.mistakes.map((m) => m.question).filter(valid);
            if (qs.length) start({ ...round.config }, qs);
            else {
              notice = "Those questions are unavailable.";
              render();
            }
          },
          "primary"
        )
      );
    actions.append(button(round.config.seed ? "Replay set" : "New round", () => start({ ...round.config }), round.mistakes.length ? "" : "primary"));
    top.append(actions);
    box.append(top);
    if (round.mistakes.length) {
      const notebook = el("section", "notebook");
      notebook.append(el("span", "label", "Mistakes · " + round.mistakes.length));
      for (const m of round.mistakes) {
        const row = el("article", "mistake");
        const p = Array.isArray(m.question.prompt) ? m.question.prompt.join(" ") : m.question.prompt;
        row.append(el("p", "", p));
        const answers = el("div", "answers");
        answers.append(
          el("span", "given", "Your answer: " + E.formatAnswer(m.question, m.response)),
          el("span", "expected", "Answer: " + E.formatAnswer(m.question))
        );
        row.append(answers);
        notebook.append(row);
      }
      box.append(notebook);
    }
    if (notice) box.append(el("p", "notice", notice));
    app.append(box);
  }
  const TODAY_KEY = "haydenMathLab.today.array.v1";
  const TODAY_STEPS = ["See", "Build", "Try", "Check"];
  const TODAY_MODELS = ["Rows", "Bars", "Number line"];
  const freshLesson = () => ({
    step: "",
    cut: 10,
    turned: false,
    examplePart: "",
    model: "",
    notes: {},
    hint: 0,
    answer: "",
    unit: "",
    checked: false,
  });
  const digitsOnly = (value) =>
    String(value ?? "")
      .replace(/[^0-9]/g, "")
      .slice(0, 2);
  function readLesson() {
    const initial = freshLesson();
    try {
      const saved = JSON.parse(localStorage.getItem(TODAY_KEY));
      if (!saved || !["see", "build", "try", "check", "done"].includes(saved.step)) return initial;
      const answer = digitsOnly(saved.answer);
      const unit = ["each", "boxes", "all"].includes(saved.unit) ? saved.unit : "";
      const step = ["check", "done"].includes(saved.step) && (!answer || !unit) ? "try" : saved.step;
      return {
        step,
        cut: Number.isInteger(saved.cut) && saved.cut > 0 && saved.cut < 12 ? saved.cut : 10,
        turned: saved.turned === true,
        examplePart: ["A", "B"].includes(saved.examplePart) ? saved.examplePart : "",
        model: TODAY_MODELS.includes(saved.model) ? saved.model : "",
        notes: Object.fromEntries(TODAY_MODELS.map((model) => [model, [0, 1].map((i) => digitsOnly(saved.notes?.[model]?.[i]))])),
        hint: Number.isInteger(saved.hint) && saved.hint >= 0 && saved.hint <= 3 ? saved.hint : 0,
        answer,
        unit,
        checked: step === "check" && saved.checked === true,
      };
    } catch {
      return initial;
    }
  }
  let lesson = readLesson();
  function saveLesson() {
    try {
      localStorage.setItem(TODAY_KEY, JSON.stringify(lesson));
    } catch {}
  }
  function lessonEntry() {
    const entry = el("section", "today-entry");
    entry.setAttribute("aria-label", "Today’s visual lesson");
    const copy = el("div");
    copy.append(el("h2", "", "Today: arrays"), el("p", "", TODAY_GOAL));
    const label = lesson.step === "done" ? "Review lesson" : lesson.step ? "Continue lesson" : "Start lesson";
    const actions = el("div", "path-entry-actions");
    actions.append(button(label, openLesson, "today-entry-action"));
    entry.append(copy, actions);
    return entry;
  }
  function openLesson() {
    screen = "today";
    if (!lesson.step) lesson.step = "see";
    saveLesson();
    render();
    lessonHeading();
  }
  function clearTodayUrl() {
    const url = new URL(location.href);
    if (url.searchParams.get("lesson") === "today") {
      url.searchParams.delete("lesson");
      history.replaceState(history.state, "", url);
    }
  }
  function closeLesson() {
    clearTodayUrl();
    screen = "contents";
    render();
    window.scrollTo(0, 0);
    app.querySelector(".today-entry-action")?.focus({ preventScroll: true });
  }
  function lessonHeading() {
    window.scrollTo(0, 0);
    app.querySelector(".today-heading")?.focus({ preventScroll: true });
  }
  function lessonStep(step) {
    lesson.step = step;
    saveLesson();
    render();
    lessonHeading();
  }
  function tileArray(rows, width, cut = 0, active = "") {
    const board = el("div", "today-array" + (cut ? "" : " today-array-grouped"));
    board.style.setProperty("--columns", width);
    board.setAttribute("role", "img");
    board.setAttribute(
      "aria-label",
      `${rows} rows of ${width} tiles${cut ? `, with ${cut} in part A and ${width - cut} in part B in each row` : ""}`
    );
    for (let r = 0; r < rows; r++) {
      const row = el("span", "today-array-row");
      for (let c = 0; c < width; c++) {
        const part = cut && c >= cut ? "B" : "A";
        const cls = `today-tile today-part-${part}${active && active !== part ? " today-faded" : ""}${cut && c === cut ? " today-cut" : ""}`;
        row.append(el("span", cls));
      }
      board.append(row);
    }
    return board;
  }
  function lessonPane(card) {
    const stack = el("div", "today-layout");
    const picture = el("div", "today-picture");
    const work = el("div", "today-work");
    stack.append(picture, work);
    card.append(stack);
    return [picture, work];
  }
  function lessonActions(card, next, action, previous) {
    const row = el("div", "today-actions");
    if (previous) row.append(button("Back", () => lessonStep(previous)));
    row.append(button(next, action, "primary"));
    card.append(row);
  }
  function paintSplit(picture, work, cut, active = "") {
    picture.replaceChildren(el("p", "today-dimension", "4 rows · 12 tiles in each"), tileArray(4, 12, cut, active));
    work.replaceChildren();
    for (const [part, cols] of [
      ["A", cut],
      ["B", 12 - cut],
    ]) {
      const equation = `Part ${part} · 4 × ${cols} = ${4 * cols}`;
      if (!active) work.append(el("p", `today-equation today-part-${part}`, equation));
      else work.append(el("p", `today-equation today-part-${part}${part === active ? " today-focus" : ""}`, equation));
    }
    work.append(el("p", "today-total", `${4 * cut} + ${4 * (12 - cut)} = 48`));
  }
  function lessonSee(card) {
    const [picture, work] = lessonPane(card);
    const picks = el("div", "today-picks");
    picks.setAttribute("aria-label", "Highlight a part of the array");
    const controls = ["A", "B"].map((part) =>
      button(
        `Part ${part}`,
        () => {
          lesson.examplePart = part;
          saveLesson();
          update();
        },
        `today-part-${part}`
      )
    );
    function update() {
      paintSplit(picture, work, 10, lesson.examplePart);
      controls.forEach((control, i) => control.setAttribute("aria-pressed", String(lesson.examplePart === ["A", "B"][i])));
    }
    picks.append(...controls);
    card.append(picks);
    update();
    lessonActions(card, "Next: Build", () => lessonStep("build"));
  }
  function lessonBuild(card) {
    const [picture, work] = lessonPane(card);
    const group = el("div", "today-picks");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "What does 48 divided by 4 mean?");
    const choices = [false, true].map((turned) =>
      button(turned ? "4 tiles per group" : "Make 4 rows", () => {
        lesson.turned = turned;
        saveLesson();
        update();
      })
    );
    group.append(...choices);
    card.insertBefore(group, picture.parentElement);
    const ruler = el("div", "today-tools");
    const cutLabel = el("label", "today-dimension", "Move the cut");
    cutLabel.htmlFor = "today-cut";
    const slider = el("input", "today-range");
    Object.assign(slider, { id: "today-cut", type: "range", min: "1", max: "11", step: "1" });
    const changeCut = (cut) => {
      lesson.cut = cut;
      saveLesson();
      update();
    };
    slider.addEventListener("input", () => changeCut(Number(slider.value)));
    const minus = button("−", () => changeCut(lesson.cut - 1), "", "Move cut left");
    const plus = button("+", () => changeCut(lesson.cut + 1), "", "Move cut right");
    const cutControls = el("div", "today-cut-controls");
    cutControls.append(minus, slider, plus);
    ruler.append(cutLabel, cutControls);
    const meaning = el("div", "today-note");
    meaning.setAttribute("aria-live", "polite");
    card.append(ruler, meaning);
    function update() {
      if (lesson.turned) {
        picture.replaceChildren(el("p", "today-dimension", "12 rows · 4 tiles in each"), tileArray(12, 4));
        work.replaceChildren(el("p", "today-total", "Still 48 tiles"));
      } else {
        paintSplit(picture, work, lesson.cut);
      }
      choices.forEach((choice, i) => choice.setAttribute("aria-pressed", String(lesson.turned === Boolean(i))));
      ruler.hidden = lesson.turned;
      slider.value = lesson.cut;
      slider.setAttribute("aria-valuetext", `${lesson.cut} and ${12 - lesson.cut} tiles in each row`);
      minus.disabled = lesson.cut <= 1;
      plus.disabled = lesson.cut >= 11;
      meaning.replaceChildren(
        el("p", "today-equation", "48 ÷ 4 = 12"),
        el("p", "", lesson.turned ? "4 tiles per group. The 12 counts groups." : "4 groups. The 12 counts tiles in each group.")
      );
    }
    update();
    lessonActions(card, "Next: Try", () => lessonStep("try"), "see");
  }
  function lessonModel(picture) {
    const target = el("div", "today-model-preview");
    const models = el("div", "today-picks");
    models.setAttribute("role", "group");
    models.setAttribute("aria-label", "Optional drawing model");
    const buttons = TODAY_MODELS.map((model) =>
      button(model, () => {
        lesson.model = lesson.model === model ? "" : model;
        saveLesson();
        show();
      })
    );
    models.append(...buttons);
    picture.append(el("p", "today-dimension", "Pick a model if it helps."), models, target);
    function show() {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(lesson.model === TODAY_MODELS[i])));
      target.replaceChildren();
      if (!lesson.model) return;
      const kind = lesson.model;
      const model = el("div", `today-model${kind === "Number line" ? " today-line" : kind === "Bars" ? " today-bars" : ""}`);
      model.setAttribute("role", "img");
      model.setAttribute(
        "aria-label",
        kind === "Number line" ? "Number line from zero to 72 with four equal jumps" : `Four blank ${kind.toLowerCase()}`
      );
      for (let i = 0; i < 4; i++) model.append(el("span", "", kind === "Number line" ? "?" : `Box ${i + 1}`));
      target.append(model);
      if (kind === "Number line") {
        const ends = el("div", "today-line-ends");
        ends.append(el("span", "", "0"), el("span", "", "72"));
        target.append(ends);
      }
      const notes = el("fieldset", "today-notes");
      notes.append(el("legend", "", "Add labels (optional)"));
      const values = lesson.notes[kind] ?? ["", ""];
      values.forEach((value, i) => {
        const field = el("label", "", `Label ${i + 1}`);
        const input = el("input");
        Object.assign(input, { type: "text", inputMode: "numeric", maxLength: 2, autocomplete: "off", value });
        input.addEventListener("input", () => {
          values[i] = input.value = digitsOnly(input.value);
          lesson.notes[kind] = values;
          saveLesson();
        });
        field.append(input);
        notes.append(field);
      });
      target.append(notes);
    }
    show();
  }
  const lessonUnits = { each: "Tiles in each box", boxes: "Boxes", all: "Tiles altogether" };
  function lessonTry(card) {
    const [picture, work] = lessonPane(card);
    lessonModel(picture);
    const hints = [
      "All four boxes must have the same number of tiles.",
      "Share 40 tiles first. How many are left to share?",
      "The 40 give each box 10 tiles. The other 32 give each box 8 more. Put the two amounts together.",
    ];
    const hintList = el("div", "today-hints");
    hintList.setAttribute("aria-live", "polite");
    const hintButton = button("Hint", () => {
      lesson.hint++;
      saveLesson();
      updateHints();
      if (hintButton.hidden) hintList.lastElementChild?.focus();
    });
    function updateHints() {
      hintList.replaceChildren(
        ...hints.slice(0, lesson.hint).map((hint) => {
          const line = el("p", "today-note", hint);
          line.tabIndex = -1;
          return line;
        })
      );
      hintButton.textContent = lesson.hint ? "Next hint" : "Hint";
      hintButton.hidden = lesson.hint >= hints.length;
    }
    picture.append(hintList, hintButton);
    updateHints();
    const form = el("form", "today-form");
    const number = el("input");
    Object.assign(number, {
      id: "today-answer",
      type: "text",
      inputMode: "numeric",
      maxLength: 2,
      pattern: "[0-9]{1,2}",
      required: true,
      autocomplete: "off",
      value: lesson.answer,
    });
    const numberLabel = el("label", "", "Your number");
    numberLabel.htmlFor = number.id;
    number.addEventListener("input", () => {
      lesson.answer = number.value = digitsOnly(number.value);
      saveLesson();
    });
    const unit = el("select");
    Object.assign(unit, { id: "today-unit", required: true });
    const unitLabel = el("label", "", "What does it count?");
    unitLabel.htmlFor = unit.id;
    for (const [key, text] of [["", "Choose one"], ...Object.entries(lessonUnits)]) {
      const option = el("option", "", text);
      option.value = key;
      unit.append(option);
    }
    unit.value = lesson.unit;
    unit.addEventListener("change", () => {
      lesson.unit = unit.value;
      saveLesson();
    });
    const submit = el("button", "primary", "Keep my answer");
    submit.type = "submit";
    form.append(numberLabel, number, unitLabel, unit, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      lesson.checked = false;
      lessonStep("check");
    });
    work.append(form);
    card.append(button("Back", () => lessonStep("build")));
  }
  function lessonProof(picture, work) {
    const model = el("div", "today-proof");
    model.setAttribute("role", "img");
    model.setAttribute("aria-label", "Four boxes, each with 10 tiles from the first part and 8 from the second part");
    for (let i = 0; i < 4; i++) {
      const row = el("div", "today-proof-row");
      row.append(el("span", "today-part-A", "10"), el("span", "today-part-B", "+ 8"));
      model.append(row);
    }
    picture.append(el("p", "today-dimension", "72 = 40 + 32"), model, el("p", "", "60 + 12 works too."));
    work.append(el("p", "today-total", "10 + 8 = 18 per box"), el("p", "", "4 × 18 = 72. All 72 tiles are used."));
  }
  function lessonCheck(card) {
    const [picture, work] = lessonPane(card);
    const correctNumber = Number(lesson.answer) === 18;
    const correctUnit = lesson.unit === "each";
    const edit = () => {
      lesson.checked = false;
      lessonStep("try");
    };
    picture.append(el("p", "today-dimension", "Your answer"), el("p", "today-total", `${lesson.answer} · ${lessonUnits[lesson.unit].toLowerCase()}`));
    if (!lesson.checked) {
      work.append(el("p", "today-note", "Can you multiply your number by 4 to get back to 72? What does your number count?"));
      lessonActions(card, "I checked", () => {
        lesson.checked = true;
        lessonStep("check");
        app.querySelector(".today-feedback")?.focus({ preventScroll: true });
      });
      card.append(button("Edit answer", edit));
      return;
    }
    const message =
      correctNumber && correctUnit
        ? "Your number and its meaning match."
        : correctNumber
          ? "The number matches. Check what it counts."
          : "Multiply your number by 4. Do the boxes hold all 72 tiles?";
    const feedback = el("p", "today-note today-feedback", message);
    feedback.tabIndex = -1;
    feedback.setAttribute("role", "status");
    work.append(feedback);
    if (correctNumber && correctUnit) {
      lessonProof(picture, work);
      lessonActions(card, "Finish lesson", () => lessonStep("done"));
    } else {
      card.append(button("Edit answer", edit, "primary"));
    }
  }
  function today() {
    toolbar.replaceChildren(button("Back to contents", closeLesson));
    const title = {
      see: "See the parts",
      build: "Split and turn the array",
      try: "Share 72 tiles",
      check: "Check your answer",
      done: "Lesson complete",
    }[lesson.step];
    const prompt = {
      see: "Four rows. Twelve tiles in each. Tap a part to see what it counts.",
      build: "Move the cut. Then change how the same 48 tiles are grouped.",
      try: "Put all 72 tiles into 4 boxes. Each box gets the same number. How many go in each box?",
      check: "Check your thinking before you see the answer.",
      done: "You used one picture for multiplication and division.",
    }[lesson.step];
    const surface = el("section", "today-surface");
    const heading = el("h1", "today-heading", title);
    heading.tabIndex = -1;
    const rail = el("ol", "today-rail");
    rail.setAttribute("aria-label", "Lesson steps");
    const stepIndex = TODAY_STEPS.findIndex((step) => step.toLowerCase() === lesson.step);
    TODAY_STEPS.forEach((step, i) => {
      const item = el("li", i < stepIndex || lesson.step === "done" ? "today-passed" : "", step);
      if (i === stepIndex) item.setAttribute("aria-current", "step");
      rail.append(item);
    });
    const card = el("div", "card today-card");
    surface.append(heading, el("p", "path-goal", TODAY_GOAL), el("p", "today-prompt", prompt), rail, card);
    if (lesson.step === "see") lessonSee(card);
    else if (lesson.step === "build") lessonBuild(card);
    else if (lesson.step === "try") lessonTry(card);
    else if (lesson.step === "check") lessonCheck(card);
    else {
      const [picture, work] = lessonPane(card);
      lessonProof(picture, work);
      lessonActions(card, "Back to practice", closeLesson);
      card.append(
        button("Replay lesson", () => {
          lesson = freshLesson();
          lessonStep("see");
        })
      );
    }
    const parents = el("details", "today-parents");
    parents.append(
      el("summary", "", "For parents"),
      el("p", "", "Ask what each number counts. On another day, try 84 tiles shared equally among 6 boxes without showing a split.")
    );
    surface.append(parents);
    app.append(surface);
  }
  const PATHS_KEY = "haydenMathLab.paths.v2";
  const numberField = (name, label, max = 9999) => ({ name, label, max });
  const checkOK = (ok, message = "Try the numbers again, then check what they count.") => (ok ? "" : message);
  const countList = (n) => Array.from({ length: n }, (_, i) => i);
  const sameSet = (a, b) => a.length === b.length && b.every((key) => a.includes(key));
  const pairKey = (a, b) => `${Math.min(a, b)}×${Math.max(a, b)}`;
  const fmt = (n) => n.toLocaleString("en-US");
  const clockText = (h, m) => `${h}:${String(m).padStart(2, "0")}`;
  const PATHS = [
    ["exchange", "Subtract across zeros", "Trade tens, hundreds, or thousands to subtract.", exchangeModel],
    ["area", "Multiply two-digit numbers", "Split both numbers into tens and ones.", areaModel],
    ["fractions", "Equivalent fractions", "Show why 1/2 and 2/4 cover the same amount.", fractionModel],
    ["remainder", "Divide with leftovers", "Decide if the leftovers need another box.", packingModel],
    ["measure", "Measure length and time", "Count ruler spaces and minutes across an hour.", measureModel],
    ["transfer", "Multiply and divide by splitting", "Split big numbers into easier pieces.", transferModel],
    ["decimal", "Divide decimals", "Share tenths and hundredths, or count equal lengths.", decimalModel],
    ["tape", "Area and perimeter", "Build shapes with the same area and compare their borders.", tapeModel, true],
    ["trays", "Find two unknown amounts", "Use the total and the extra tiles to find both amounts.", traysModel, true],
    ["garden", "Find every rectangle", "Use the fence, area, and side length rules.", gardenModel, true],
  ].map(([id, title, note, model, challenge = false]) => ({ id, title, note, model, challenge }));

  const OLD_PATHS = {
    exchange: { from: 503, take: 278 },
    area: { rows: 13, cols: 12 },
    fractions: { base: 4, shaded: 3, factor: 2 },
    remainder: { full: 23, capacity: 4, left: 3 },
    measure: { start: 5, end: 12, hour: 3, before: 10, after: 5 },
    transfer: { rows: 4, cols: 17, groups: 6, each: 14 },
    tape: { tiles: 12 },
    trays: { reds: 2, blues: 3, base: 12, extra: 6 },
    garden: { half: 26, gap: 5, area: 150 },
  };

  const areaParts = ({ rows, cols }) => [
    [10, 10],
    [10, cols - 10],
    [rows - 10, 10],
    [rows - 10, cols - 10],
  ];
  const factors = (n) =>
    countList(Math.floor(Math.sqrt(n)))
      .map((i) => i + 1)
      .filter((a) => n % a === 0)
      .map((a) => [a, n / a]);
  const gardenPairs = ({ half, gap }) => countList(Math.floor((half - gap) / 2)).map((i) => [i + 1, half - i - 1]);
  const gardenFits = (p) => gardenPairs(p).filter(([a, b]) => a * b > p.area);
  const placeDigits = (n) => [1000, 100, 10, 1].map((unit) => Math.floor(n / unit) % 10);
  const placeNames = ["thousands", "hundreds", "tens", "ones"];
  const placeWeights = [1000, 100, 10, 1];
  const piecesOf = (counts) =>
    counts
      .map((digit, i) => digit * placeWeights[i])
      .filter(Boolean)
      .join(" + ") || "0";
  const digitsText = (counts) => counts.map((digit, i) => `${digit} ${placeNames[i]}`).join(", ");
  function subtractionTrades({ from, take }) {
    const counts = placeDigits(from),
      need = placeDigits(take);
    const steps = [{ counts: [...counts], say: `Start with ${digitsText(counts)}.` }];
    for (let target = 3; target > 0; target--) {
      if (counts[target] >= need[target]) continue;
      let donor = target - 1;
      while (!counts[donor]) donor--;
      while (donor < target) {
        counts[donor]--;
        counts[donor + 1] += 10;
        steps.push({
          counts: [...counts],
          say: `Trade one from ${placeNames[donor]} for 10 in ${placeNames[donor + 1]}. The total is still ${fmt(from)}.`,
        });
        donor++;
      }
    }
    return steps;
  }
  function pathExercise(id, p) {
    if (id === "exchange") {
      const { from, take } = p,
        result = from - take,
        steps = subtractionTrades(p);
      const last = steps.at(-1).counts;
      return {
        prompt: `Trade place-value pieces to solve ${fmt(from)} − ${fmt(take)}.`,
        fields: [numberField("result", "Difference")],
        hints: [
          `Start with ${digitsText(steps[0].counts)}.`,
          "If a place has too few pieces, trade from the place to its left.",
          `After trading, ${fmt(from)} = ${piecesOf(last)}.`,
        ],
        check: ({ result: n }) => checkOK(n === result),
        proof: [
          `${fmt(from)} = ${piecesOf(last)}. Take away ${piecesOf(placeDigits(take))}.`,
          `${piecesOf(placeDigits(result))} = ${fmt(result)}. Check: ${fmt(result)} + ${fmt(take)} = ${fmt(from)}.`,
        ],
      };
    }
    if (id === "area") {
      const { rows, cols } = p,
        parts = areaParts(p),
        products = parts.map(([a, b]) => a * b),
        total = rows * cols;
      return {
        prompt: `Mia counts only ${products[0]} + ${products[3]} in this ${rows} × ${cols} rectangle. Tap the two pieces she missed. How many tiles are there in all?`,
        fields: [numberField("total", "Tiles altogether")],
        hints: ["Each piece has a height and a width.", `Find ${parts[1].join(" × ")} and ${parts[2].join(" × ")}.`, `Add ${products.join(" + ")}.`],
        check: ({ total: n }, s) =>
          sameSet(s.picks, [1, 2])
            ? checkOK(n === total, "You found both pieces. Add all four tile counts.")
            : "Choose exactly the two pieces Mia missed.",
        proof: [
          `The missing pieces have ${products[1]} and ${products[2]} tiles. ${products.join(" + ")} = ${total}.`,
          `Check by columns: ${rows} × 10 + ${rows} × ${cols - 10} = ${rows * 10} + ${rows * (cols - 10)} = ${total}.`,
        ],
      };
    }
    if (id === "fractions") {
      const { base, shaded, factor } = p,
        pieces = base * factor,
        answer = shaded * factor;
      return {
        prompt: `Shade the bottom strip to match ${shaded}/${base} on the top strip. The bottom strip has ${pieces} equal parts.`,
        fields: [],
        hints: [
          "Both strips represent the same whole.",
          `One part of the top strip covers ${factor} bottom parts.`,
          `Count ${factor} bottom parts for each of the ${shaded} shaded top parts.`,
        ],
        check: (_, s) => checkOK(s.count === answer, "Do the two shaded ends line up?"),
        proof: [
          `${shaded}/${base} and ${answer}/${pieces} are the same fraction. Each top part covers ${factor} bottom parts.`,
          "Check both shaded ends. They line up because the strips show the same whole.",
        ],
      };
    }
    if (id === "remainder") {
      const { capacity, full, left } = p,
        total = capacity * full + left;
      return {
        prompt: `Pack ${total} tiles. Each box can hold ${capacity}. How many full boxes, how many leftover tiles, and how many boxes for all the tiles?`,
        fields: [numberField("full", "Full boxes"), numberField("left", "Leftover tiles"), numberField("all", "Boxes for all the tiles")],
        hints: [
          "Use as many full boxes as you can first.",
          `Five boxes use ${5 * capacity} tiles. Keep packing in groups of ${capacity}.`,
          `${full} full boxes use ${full * capacity} tiles. The leftovers need a box.`,
        ],
        check: ({ full: n, left: r, all }) =>
          n !== full || r !== left
            ? `Check that ${capacity} times your full boxes plus your leftovers equals ${total}, and that fewer than ${capacity} are left.`
            : checkOK(all === full + 1, `Where will the ${left} leftover tiles go?`),
        proof: [
          `${capacity} × ${full} + ${left} = ${total}. The leftover is less than ${capacity}.`,
          `Use ${full + 1} boxes for all the tiles. The last box holds ${left}.`,
        ],
      };
    }
    if (id === "measure") {
      const { start, end, hour, before, after } = p,
        from = clockText(hour, 60 - before),
        mid = clockText(hour + 1, 0),
        to = clockText(hour + 1, after);
      return {
        prompt: `A line starts at ${start} cm and ends at ${end} cm. How long is it? How much time passes from ${from} to ${to}?`,
        fields: [numberField("length", "Length in cm"), numberField("time", "Elapsed minutes")],
        hints: [
          "Count spaces between the ruler marks.",
          `Move to ${mid} first, then past it.`,
          `It takes ${before} minutes to reach ${mid}, then ${after} more.`,
        ],
        check: ({ length, time }) =>
          length !== end - start
            ? "Read from the starting mark to the ending mark."
            : checkOK(time === before + after, "Add the time on both sides of the hour."),
        proof: [
          `${end} − ${start} = ${end - start} cm. The line covers ${end - start} spaces.`,
          `${from} → ${mid} is ${before} minutes. ${mid} → ${to} is ${after} more. Check: ${before} + ${after} = ${before + after} minutes.`,
        ],
      };
    }
    if (id === "transfer") {
      const { rows, cols, groups, each } = p,
        tens = 10 * Math.floor(cols / 10),
        groupTens = 10 * Math.floor(each / 10),
        share = groups * each;
      return {
        prompt: `How many tiles fill ${rows} rows of ${cols}? Then share ${share} tiles equally among ${groups} boxes. How many go in each?`,
        fields: [numberField("total", "Tiles in the rows"), numberField("each", "Tiles in each box")],
        hints: [
          "Cut each row into tens and ones.",
          `Split ${share} into two parts that can each be shared among ${groups} boxes.`,
          `Try ${cols} = ${tens} + ${cols - tens} and ${share} = ${groups * groupTens} + ${groups * (each - groupTens)}.`,
        ],
        check: ({ total, each: n }) =>
          total !== rows * cols ? "Check both parts of each row." : checkOK(n === each, `Multiply your amount in one box by ${groups}.`),
        proof: [
          `${rows} × ${cols} = ${rows * tens} + ${rows * (cols - tens)} = ${rows * cols}.`,
          `Each box gets ${groupTens} + ${each - groupTens} = ${each}. Check: ${groups} × ${each} = ${share}.`,
        ],
      };
    }
    if (id === "decimal") {
      const { mode, total, part, groups } = p,
        target = E.decimalQuotient(p),
        display = E.formatDecimal;
      const dividend = display(total),
        divisor = mode === "measure" ? display(part) : groups;
      return {
        prompt:
          mode === "measure"
            ? `A ribbon is ${dividend} m long. How many pieces of ${divisor} m fit?`
            : `Share ${dividend} liters equally among ${groups} cups. How many liters go into each cup?`,
        fields: [{ ...numberField("result", mode === "measure" ? "Number of pieces" : "Liters in each cup", 800), decimal: true }],
        hints:
          mode === "measure"
            ? [
                "Every piece has the same length.",
                `Count how many ${divisor} m pieces make ${dividend} m.`,
                "Multiply the length of one piece by the number of pieces.",
              ]
            : [
                "Share the whole units first.",
                "Trade 1 whole for 10 tenths if needed. Trade 1 tenth for 10 hundredths if needed.",
                "How many whole units, tenths, and hundredths go in a single cup?",
              ],
        check: ({ result }) => checkOK(result === target, "Multiply your answer by the divisor. Do you get the starting amount?"),
        proof: [`${dividend} ÷ ${divisor} = ${display(target)}.`, `Check: ${divisor} × ${display(target)} = ${dividend}.`],
      };
    }
    if (id === "tape") {
      const { tiles } = p,
        pairs = factors(tiles),
        perimeters = pairs.map(([a, b]) => 2 * (a + b)),
        least = Math.min(...perimeters);
      return {
        prompt: `Build two different rectangles with exactly ${tiles} one-inch square tiles each. Mia says their outside borders use the same amount of tape. Find the tape needed for each.`,
        fields: [
          numberField("oneTape", "Tape for rectangle 1 (in)"),
          numberField("twoTape", "Tape for rectangle 2 (in)"),
          { ...numberField("least", "Least tape for any rectangle (in)"), optional: true },
        ],
        hints: [
          "Tiles fill the inside. Tape goes around the outside.",
          "Turning a rectangle does not make a different rectangle.",
          `Try row sizes that divide ${tiles}. Count the edges around each result.`,
        ],
        check: (answers, state) => tapeCheck(answers, state, tiles, least),
        proof: [
          `${pairs.map(([a, b], i) => `${a} × ${b} uses ${perimeters[i]} in`).join("; ")}.`,
          `The tape amounts differ even though each rectangle uses ${tiles} tiles. The shortest border is ${least} in.`,
        ],
      };
    }
    if (id === "trays") {
      const { reds, blues, base, extra } = p,
        all = reds + blues,
        excess = reds * extra,
        total = all * base + excess;
      return {
        prompt: `Hayden puts all ${total} tiles on ${reds} red trays and ${blues} blue trays. Trays of the same color hold equal amounts. A red tray holds ${extra} more tiles than a blue tray. How many are on one tray of each color?`,
        fields: [numberField("red", "Tiles on one red tray"), numberField("blue", "Tiles on one blue tray")],
        hints: [
          "Match one part of each red tray to one blue tray.",
          `Set aside ${extra} tiles from each of the ${reds} red trays.`,
          `Share the remaining ${total - excess} tiles among ${all} equal parts.`,
        ],
        check: ({ red, blue }) =>
          red - blue !== extra
            ? `Each red tray has ${extra} more.`
            : checkOK(red === base + extra && blue === base, `Do all the trays add up to ${total}?`),
        proof: [
          `${total} − ${excess} = ${total - excess}. The ${all} matching parts each have ${base} tiles.`,
          `Blue gets ${base}. Red gets ${base + extra}. Check: ${reds} × ${base + extra} + ${blues} × ${base} = ${total}.`,
        ],
      };
    }
    const pairs = gardenFits(p);
    return {
      prompt: `A rectangular garden is ${2 * p.half} m around. Both side lengths are whole meters. The area is more than ${
        p.area
      } m². The longer side is at least ${p.gap} m longer than the shorter side. Find every pair.`,
      fields: [],
      hints: [
        "The two neighboring sides add to half the perimeter.",
        `The shorter side can run from 1 to ${gardenPairs(p).length} m.`,
        `Subtract each possible shorter side from ${p.half}, then check its area.`,
      ],
      check: (values, state) => gardenCheck(values, state, p),
      proof: [
        `Short side + long side = ${p.half} m. The difference rule gives ${gardenPairs(p).length} shorter sides to test.`,
        `${pairs.map(([a, b]) => `${a} × ${b} = ${a * b} m²`).join("; ")}. Check the perimeter and difference of each pair.`,
        "The table shows every pair that meets the perimeter and difference rules. Only the highlighted rows meet the area rule.",
      ],
    };
  }
  function pathInstance(id, date = null, nonce = null, exclude = []) {
    if (!date && nonce === "legacy") {
      const p = OLD_PATHS[id];
      if (!p) throw Error("Unknown old lesson");
      return { date: null, nonce, signature: JSON.stringify(p), p };
    }
    return E.generateLesson(id, { date, nonce, exclude });
  }
  function boundPath(task, instance) {
    return { ...task, ...pathExercise(task.id, instance.p), p: instance.p };
  }

  function pathSlot(id, date) {
    return `${id}:${date || "random"}`;
  }
  function blankPath(instance, recent = []) {
    return { ...instance, recent, mode: "try", hint: 0, move: 0, count: 0, tape: [0, 0], picks: [], candidates: [], values: {}, observation: "" };
  }
  function readPaths() {
    const initial = { date: null, progress: {} };
    try {
      const current = JSON.parse(localStorage.getItem(PATHS_KEY));
      const old = current ? null : JSON.parse(localStorage.getItem("haydenMathLab.paths.v1"));
      try {
        initial.date = E.normalizeSeed(current?.date);
      } catch {}
      const entries =
        current?.progress && typeof current.progress === "object"
          ? Object.entries(current.progress).slice(-72)
          : PATHS.filter((task) => old?.[task.id]).map((task) => [pathSlot(task.id, null), { ...old[task.id], nonce: "legacy" }]);
      for (const [slot, v] of entries) {
        const id = slot.split(":")[0],
          task = PATHS.find((entry) => entry.id === id);
        if (!task || !v || typeof v !== "object") continue;
        let instance;
        try {
          const date = E.normalizeSeed(v.date);
          if (slot !== pathSlot(id, date) || (!date && !/^(?:legacy|[a-z0-9]+-[a-z0-9]+)$/.test(v.nonce))) continue;
          instance = pathInstance(id, date, v.nonce);
        } catch {
          continue;
        }
        const exercise = boundPath(task, instance),
          p = instance.p;
        const recent = Array.isArray(v.recent) ? v.recent.filter((sig) => typeof sig === "string" && sig.length < 200).slice(-5) : [];
        const state = blankPath(instance, recent);
        const moveMax = id === "exchange" ? subtractionTrades(p).length - 1 : 12;
        for (const [key, limit] of [
          ["hint", exercise.hints.length],
          ["move", moveMax],
          ["count", id === "fractions" ? p.base * p.factor : 0],
        ]) {
          if (Number.isInteger(v[key]) && v[key] >= 0 && v[key] <= limit) state[key] = key === "move" && !current && id === "exchange" ? 0 : v[key];
        }
        if (["try", "review", "done"].includes(v.mode)) state.mode = v.mode;
        const tapeMax = id === "tape" ? Math.min(12, p.tiles) : 0;
        if (Array.isArray(v.tape) && v.tape.length === 2 && v.tape.every((n) => Number.isInteger(n) && n >= 0 && n <= tapeMax)) state.tape = v.tape;
        if (Array.isArray(v.picks)) state.picks = [...new Set(v.picks.filter((n) => Number.isInteger(n) && n >= 0 && n < 4))];
        if (Array.isArray(v.candidates))
          state.candidates = v.candidates
            .slice(0, 16)
            .filter((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((side) => typeof side === "string" && side.length <= 8));
        if (["alone", "asked", "hint"].includes(v.observation)) state.observation = v.observation;
        for (const f of exercise.fields)
          if (typeof v.values?.[f.name] === "string" && v.values[f.name].length <= 8) state.values[f.name] = v.values[f.name];
        if (state.mode === "done") {
          const result = pathValues(exercise, state);
          if (!result || exercise.check(result, state)) state.mode = "try";
        }
        initial.progress[slot] = state;
      }
    } catch {}
    return initial;
  }
  const savedPaths = readPaths(),
    pathProgress = savedPaths.progress;
  let pathDate = savedPaths.date,
    pathDateDraft = pathDate || "",
    dateError = "";
  let currentPath = null,
    currentPathSlot = null,
    pathFeedback = "";
  function savePaths() {
    try {
      const entries = Object.entries(pathProgress);
      const stored = entries.filter(([, v]) => !v.date).concat(entries.filter(([, v]) => v.date).slice(-60));
      const progress = Object.fromEntries(stored.map(([slot, { p, signature, ...state }]) => [slot, state]));
      localStorage.setItem(PATHS_KEY, JSON.stringify({ date: pathDate, progress }));
    } catch {}
  }
  function openLibrary() {
    screen = "contents";
    render();
    pathFocus();
  }
  function applyPathDate() {
    try {
      pathDate = E.normalizeSeed(pathDateDraft);
      pathDateDraft = pathDate || "";
      dateError = "";
      savePaths();
      return true;
    } catch {
      dateError = "Enter a valid date as YYYYMMDD.";
      render();
      document.getElementById("lesson-date")?.focus();
      return false;
    }
  }
  function openPath(task, restart = false) {
    if (screen === "contents" && !applyPathDate()) return;
    const date = screen === "path" ? pathProgress[currentPathSlot].date : pathDate;
    const slot = pathSlot(task.id, date),
      prior = pathProgress[slot];
    if (restart || !prior) {
      const recent = prior && !date ? [...prior.recent, prior.signature].slice(-5) : [];
      try {
        const state = blankPath(pathInstance(task.id, date, null, recent), recent);
        delete pathProgress[slot];
        pathProgress[slot] = state;
      } catch {
        if (screen === "path") pathFeedback = "Could not load another example. Try again.";
        else dateError = "Could not start this lesson. Try again.";
        render();
        return;
      }
    }
    currentPathSlot = slot;
    currentPath = boundPath(task, pathProgress[slot]);
    pathFeedback = "";
    screen = "path";
    savePaths();
    render();
    pathFocus();
  }
  function pathFocus() {
    window.scrollTo(0, 0);
    app.querySelector(".today-heading")?.focus({ preventScroll: true });
  }
  function pathDateControls() {
    const form = el("form", "lesson-date");
    const label = el("label", "label", "Lesson date");
    label.htmlFor = "lesson-date";
    const controls = el("div", "seed-controls");
    const input = el("input");
    Object.assign(input, {
      id: "lesson-date",
      type: "text",
      inputMode: "numeric",
      maxLength: 8,
      placeholder: "YYYYMMDD",
      value: pathDateDraft,
      autocomplete: "off",
    });
    input.setAttribute("aria-describedby", "lesson-date-hint");
    if (dateError) input.setAttribute("aria-invalid", "true");
    input.addEventListener("input", () => {
      pathDateDraft = input.value;
      dateError = "";
      form.querySelector("[role=alert]")?.remove();
      input.removeAttribute("aria-invalid");
    });
    const submit = el("button", "", "Use date");
    submit.type = "submit";
    controls.append(
      input,
      submit,
      button("Random", () => {
        pathDateDraft = "";
        if (applyPathDate()) render();
        document.getElementById("lesson-date")?.focus();
      })
    );
    const note = el(
      "p",
      "path-caption",
      pathDate ? `Using ${pathDate}. Tap Random for new numbers.` : "Blank for new numbers. Use YYYYMMDD to replay."
    );
    note.id = "lesson-date-hint";
    form.append(label, controls, note);
    if (dateError) {
      const error = el("p", "notice", dateError);
      error.setAttribute("role", "alert");
      form.append(error);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (applyPathDate()) {
        render();
        document.getElementById("lesson-date")?.focus();
      }
    });
    return form;
  }

  function pathHeader(title, intro, goal) {
    const section = el("section", "today-surface");
    const h = el("h1", "today-heading", title);
    h.tabIndex = -1;
    section.append(h);
    if (goal) section.append(el("p", "path-goal", goal));
    if (intro) section.append(el("p", "today-prompt", intro));
    app.append(section);
    return section;
  }
  function pathLibrary() {
    toolbar.replaceChildren();
    const page = pathHeader("Contents");
    page.append(lessonEntry(), el("h2", "path-explore-heading", "Explore lessons"), pathDateControls());
    for (const [challenge, label] of [
      [false, "Picture lessons"],
      [true, "Hwangso challenges"],
    ]) {
      const group = el("section", "path-library-group");
      group.setAttribute("aria-label", label);
      group.append(el("h2", "", label));
      const grid = el("div", "path-library-grid");
      for (const task of PATHS.filter((t) => Boolean(t.challenge) === challenge)) {
        const status = pathProgress[pathSlot(task.id, pathDate)]?.mode;
        const action = status === "done" ? "Review" : status ? "Continue" : "Start";
        const card = el("div", "card path-tile");
        const actions = el("div", "path-tile-actions");
        if (status === "done" && !pathDate)
          actions.append(button("New problem", () => openPath(task, true), "primary", "New problem: " + task.title));
        actions.append(button(action, () => openPath(task), "", `${action}: ${task.title}`));
        card.append(el("h3", "", task.title), el("p", "", task.note), actions);
        grid.append(card);
      }
      group.append(grid);
      page.append(group);
    }
    page.append(parentRoadmap());
  }
  function parentRoadmap() {
    const details = el("details", "today-parents path-parent-guide");
    details.append(el("summary", "", "For parents"));
    const bullets = el("ul");
    for (const text of [
      "Try 5 min of familiar facts, 8 min of measurement or algebra, 12 min with a picture, and 5 min checking an answer. No timer is needed for a new lesson or challenge.",
      "Grade 2: place value through 1,000, addition and subtraction, equal groups, clocks, rulers, coins, and picture graphs.",
      "Grade 3: multiplication and division, two-step problems, fractions on a number line, area and perimeter, and elapsed time.",
      "Grade 4: larger whole numbers, multi-digit multiplication, one-digit divisors and remainders, factors, fractions and decimals, units and angles. Use regular Topics practice for skills beyond these selected lessons, including measurement and coins.",
      "Give a new problem on another day. Ask what the picture parts count and how the child checked. Note whether that happened independently, after a question, or after a hint.",
    ])
      bullets.append(el("li", "", text));
    details.append(bullets);
    const standards = el("a", "", "Illinois math standards");
    standards.href = "https://www.isbe.net/Documents/Math_common_core_standards.pdf";
    details.append(standards);
    return details;
  }
  function pathDraw(focusId) {
    savePaths();
    render();
    if (!focusId) return;
    const control = document.getElementById(focusId);
    (control && !control.disabled ? control : app.querySelector(".today-heading"))?.focus({ preventScroll: true });
  }
  function pathValues(task, state) {
    const values = {};
    for (const field of task.fields) {
      const raw = (state.values[field.name] || "").trim();
      if (!raw && field.optional) continue;
      const value = field.decimal ? E.parseDecimal(raw) : /^[0-9]+$/.test(raw) ? Number(raw) : null;
      if (value === null || value > field.max) return null;
      values[field.name] = value;
    }
    return values;
  }
  function pathAnswerFields(work, task, state) {
    const form = el("form", "today-form path-answer-form");
    form.noValidate = true;
    for (const field of task.fields) {
      const label = el("label", "", field.label + (field.optional ? " (optional)" : ""));
      const input = el("input");
      Object.assign(input, {
        type: "text",
        inputMode: field.decimal ? "decimal" : "numeric",
        maxLength: 8,
        autocomplete: "off",
        value: state.values[field.name] || "",
      });
      input.addEventListener("input", () => {
        state.values[field.name] = input.value;
        savePaths();
      });
      label.append(input);
      form.append(label);
    }
    const next = el("button", "primary", "Keep my answer");
    next.type = "submit";
    form.append(next);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!pathValues(task, state)) {
        pathFeedback = task.id === "decimal" ? "Enter your answer, using up to two decimal places." : "Enter a whole number in each required box.";
        pathDraw("path-feedback");
        return;
      }
      pathFeedback = "";
      state.mode = "review";
      pathDraw("path-check");
      app.querySelector(".today-heading")?.scrollIntoView({ block: "start" });
    });
    work.append(form);
  }
  function pathFeedbackLine(work) {
    if (!pathFeedback) return;
    const p = el("p", "today-note", pathFeedback);
    p.id = "path-feedback";
    p.tabIndex = -1;
    p.setAttribute("role", "status");
    work.append(p);
  }
  function pathLesson() {
    const task = currentPath;
    const state = pathProgress[currentPathSlot];
    toolbar.replaceChildren(button("Back to contents", openLibrary));
    const page = pathHeader(task.title, task.prompt, task.note);
    if (state.date) page.append(el("p", "path-date-badge", "Date " + state.date));
    const card = el("div", "card today-card");
    page.append(card);
    const [picture, work] = lessonPane(card);
    task.model(picture, state, task);
    pathFeedbackLine(work);
    if (state.mode === "done") {
      work.append(el("p", "today-total", "Here’s why"));
      task.proof.forEach((point) => work.append(el("p", "today-note", point)));
      const details = el("details", "today-parents");
      details.append(el("summary", "", "For parents: How did it go?"));
      const input = el("select");
      input.setAttribute("aria-label", "Parent observation");
      for (const [value, label] of [
        ["", "Choose an observation"],
        ["alone", "Explained independently"],
        ["asked", "Explained after a question"],
        ["hint", "Explained after a hint"],
      ]) {
        const option = el("option", "", label);
        option.value = value;
        input.append(option);
      }
      input.value = state.observation;
      input.addEventListener("change", () => {
        state.observation = input.value;
        savePaths();
      });
      details.append(input);
      work.append(details);
      lessonActions(card, "Back to lessons", openLibrary);
      card.append(button(state.date ? "Restart this problem" : "New problem", () => openPath(task, true)));
      return;
    }
    if (state.mode === "review") {
      const list = el("ul", "path-response-review");
      for (const field of task.fields) {
        const raw = state.values[field.name];
        if (raw?.trim()) list.append(el("li", "", `${field.label}: ${raw.trim()}`));
      }
      work.append(el("p", "today-total", "Check your own work"));
      if (list.children.length) work.append(list);
      work.append(el("p", "today-note", "Read the question again. Use the picture to check each part."));
      const submit = button(
        "I checked",
        () => {
          const values = pathValues(task, state);
          pathFeedback = values ? task.check(values, state) : "Go back and enter a whole number in each required box.";
          if (!pathFeedback) state.mode = "done";
          pathDraw(pathFeedback ? "path-feedback" : undefined);
          if (!pathFeedback) pathFocus();
        },
        "primary"
      );
      submit.id = "path-check";
      const edit = button("Edit answer", () => {
        state.mode = "try";
        pathFeedback = "";
        pathDraw();
        pathFocus();
      });
      work.append(submit, edit);
      return;
    }
    if (state.hint) {
      const hints = el("div", "today-hints");
      hints.setAttribute("aria-live", "polite");
      task.hints.slice(0, state.hint).forEach((hint, i) => {
        const p = el("p", "today-note", hint);
        p.id = `path-hint-${i}`;
        p.tabIndex = -1;
        hints.append(p);
      });
      picture.append(hints);
    }
    if (state.hint < task.hints.length) {
      const nextHint = button(state.hint ? "Next hint" : "Hint", () => {
        state.hint++;
        pathDraw(`path-hint-${state.hint - 1}`);
      });
      picture.append(nextHint);
    }
    pathAnswerFields(work, task, state);
    work.append(button(state.date ? "Restart this problem" : "New problem", () => openPath(task, true), "path-restart"));
  }
  function pathModelAction(label, id, action, pressed) {
    const control = button(label, () => {
      pathFeedback = "";
      action();
      pathDraw(id);
    });
    control.id = id;
    if (pressed !== undefined) control.setAttribute("aria-pressed", String(pressed));
    return control;
  }
  function modelNote(parent, sentence) {
    parent.append(el("p", "today-note", sentence));
  }
  function placeChips(parent, counts) {
    const grid = el("div", "path-places");
    const names = ["Thousands", "Hundreds", "Tens", "Ones"];
    counts.forEach((n, i) => {
      const stack = el("div", `path-place path-place-${i}`);
      stack.append(el("strong", "", n), el("span", "", names[i]));
      const pieces = el("div", "path-place-pieces");
      pieces.setAttribute("aria-hidden", "true");
      for (const _ of countList(n)) pieces.append(el("i"));
      stack.append(pieces);
      grid.append(stack);
    });
    parent.append(grid);
  }
  function exchangeModel(picture, state, { p }) {
    const { from, take } = p,
      steps = subtractionTrades(p),
      last = steps.length - 1,
      done = state.mode === "done";
    const { counts, say } = steps[Math.min(state.move, last)];
    picture.append(el("p", "today-dimension", `${fmt(from)} − ${fmt(take)}`));
    if (from % 100 === 0 && take < 10 && (state.move > 0 || done)) {
      const flat = el("div", "path-hundred");
      flat.setAttribute("role", "img");
      flat.setAttribute("aria-label", done ? `One hundred board with ${take} cells crossed out` : "One hundred in ten rows of ten");
      for (const i of countList(100)) flat.append(el("span", done && i >= 100 - take ? "path-crossed" : i >= 90 ? "today-part-B" : "today-part-A"));
      picture.append(flat);
    }
    placeChips(picture, done ? placeDigits(from - take) : counts);
    modelNote(picture, done ? `After taking away ${fmt(take)}, ${fmt(from - take)} remains.` : say);
    if (state.mode !== "try") return;
    const row = el("div", "today-picks");
    if (state.move > 0) row.append(pathModelAction("Previous step", "path-move-back", () => state.move--));
    if (state.move < last) row.append(pathModelAction("Make the next trade", "path-move-next", () => state.move++));
    else if (!done) modelNote(picture, `Now take away ${piecesOf(placeDigits(take))}.`);
    picture.append(row);
  }
  function areaModel(picture, state, { p }) {
    const { rows, cols } = p,
      grid = el("div", "path-area");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", `Four pieces of the ${rows} by ${cols} rectangle`);
    grid.style.setProperty("--part-width", `${cols - 10}fr`);
    grid.style.setProperty("--part-height", `${rows - 10}fr`);
    areaParts(p).forEach(([a, b], i) => {
      const picked = state.picks.includes(i);
      const control = pathModelAction(
        `${a} × ${b}`,
        `path-area-${i}`,
        () => {
          state.picks = picked ? state.picks.filter((n) => n !== i) : [...state.picks, i];
        },
        picked
      );
      control.classList.add("path-area-piece", `path-area-piece-${i}`);
      if (state.mode !== "try") control.disabled = true;
      grid.append(control);
    });
    picture.append(grid);
    modelNote(picture, state.mode === "done" ? "All four parts fit with no gaps or overlaps." : "Each piece gives rows × columns.");
  }
  function strip(parent, pieces, filled, caption, width = 100) {
    const row = el("div", "path-fraction-strip");
    row.style.setProperty("--segments", pieces);
    row.style.width = `${width}%`;
    row.setAttribute("role", "img");
    row.setAttribute("aria-label", caption);
    for (const i of countList(pieces)) row.append(el("span", i < filled ? "path-shaded" : ""));
    parent.append(row, el("p", "path-caption", caption));
  }
  function pathDial(value, min, max, label, id, update) {
    const controls = el("div", "path-dial");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", label);
    const down = pathModelAction("−", `${id}-minus`, () => update(value - 1));
    const up = pathModelAction("+", `${id}-plus`, () => update(value + 1));
    down.setAttribute("aria-label", `Fewer: ${label}`);
    up.setAttribute("aria-label", `More: ${label}`);
    down.disabled = value <= min;
    up.disabled = value >= max;
    controls.append(down, el("strong", "", value), up);
    return controls;
  }
  function fractionModel(picture, state, { p }) {
    const { base, shaded, factor } = p,
      pieces = base * factor;
    if (state.mode === "try") {
      const controls = el("div", "today-picks");
      controls.append(
        pathModelAction("See an example", "path-halves", () => (state.move = 1), state.move === 1),
        pathModelAction("Shade the bottom strip", "path-eighths", () => (state.move = 0), state.move === 0)
      );
      picture.append(controls);
    }
    if (state.move === 1 && state.mode === "try") {
      strip(picture, 2, 1, "1 of 2 equal parts");
      strip(picture, 4, 2, "2 of 4 equal parts");
      modelNote(picture, "Both shaded ends line up.");
      return;
    }
    strip(picture, base, shaded, `${shaded} of ${base} equal parts`);
    strip(picture, pieces, state.count, `${state.count} of ${pieces} equal parts`);
    if (state.mode === "try") picture.append(pathDial(state.count, 0, pieces, "Bottom parts shaded", "path-shade", (n) => (state.count = n)));
    if (state.mode === "done") {
      modelNote(picture, "Same fraction, different wholes");
      strip(picture, 2, 1, "4 cm shaded out of 8 cm", (100 * 8) / 12);
      strip(picture, 2, 1, "6 cm shaded out of 12 cm");
    }
  }
  function packingModel(picture, state, { p }) {
    const { full, capacity, left } = p,
      total = full * capacity + left,
      done = state.mode === "done";
    const boxCount = done ? full : Math.min(5 * state.move, full);
    const remaining = total - boxCount * capacity;
    const boxes = el("div", "path-packing");
    boxes.setAttribute("role", "img");
    boxes.setAttribute(
      "aria-label",
      `${boxCount} full boxes with ${capacity} tiles in each, ${remaining} loose tiles${done ? " in one last box" : ""}`
    );
    const makeBox = (n, extra = "") => {
      const box = el("span", "path-pack-box" + extra);
      for (const _ of countList(n)) box.append(el("i"));
      boxes.append(box);
    };
    for (const _ of countList(boxCount)) makeBox(capacity);
    if (done) makeBox(left, " path-pack-last");
    picture.append(el("p", "today-dimension", `${boxCount} full · ${remaining} loose tiles`), boxes);
    if (!done) {
      const rest = el("div", "path-loose");
      rest.setAttribute("aria-hidden", "true");
      for (const _ of countList(remaining)) rest.append(el("i"));
      picture.append(rest);
      if (state.mode === "try" && full - boxCount > 5) picture.append(pathModelAction("Pack 5 boxes", "path-pack", () => state.move++));
    }
  }
  function measureModel(picture, state, { p }) {
    const { start, end, hour, before, after } = p,
      showing = state.move === 1 && state.mode === "try";
    const a = showing ? 1 : start,
      b = showing ? 8 : end;
    picture.append(el("p", "today-dimension", `${showing ? "Example" : "Your line"}: from ${a} cm to ${b} cm`));
    visual({ visual: { kind: "ruler", start: a, end: b, max: Math.max(12, b), unit: "cm" } }, picture);
    if (showing) modelNote(picture, "7 spaces, each 1 cm long.");
    if (state.mode === "try")
      picture.append(pathModelAction(showing ? "See your line" : "See a ruler example", "path-ruler", () => (state.move = showing ? 0 : 1)));
    const time = el("div", "path-time-line");
    const done = state.mode === "done";
    for (const label of [
      clockText(hour, 60 - before),
      done ? `+${before} min` : "→",
      clockText(hour + 1, 0),
      done ? `+${after} min` : "→",
      clockText(hour + 1, after),
    ])
      time.append(el("span", "", label));
    picture.append(time);
  }
  function transferModel(picture, state, { p }) {
    const { rows, cols, groups, each } = p,
      tens = 10 * Math.floor(cols / 10),
      eachTens = 10 * Math.floor(each / 10),
      done = state.mode === "done";
    picture.append(el("p", "today-dimension", `${rows} rows of ${cols}`));
    if (done || state.move === 1) picture.append(tileArray(rows, cols, tens), el("p", "path-caption", `Each row has ${tens} + ${cols - tens}.`));
    else if (state.mode === "try") picture.append(pathModelAction("Draw the array", "path-show-array", () => (state.move = 1)));
    const boxes = el("div", "path-transfer-boxes");
    boxes.setAttribute("role", "img");
    boxes.setAttribute("aria-label", done ? `${groups} boxes with ${eachTens} plus ${each - eachTens} in each` : `${groups} empty boxes`);
    for (const _ of countList(groups)) boxes.append(el("span", "", done ? `${eachTens} + ${each - eachTens}` : "?"));
    picture.append(boxes);
  }
  function decimalModel(picture, state, { p }) {
    const { mode, total, part, groups } = p,
      display = E.formatDecimal,
      done = state.mode === "done";
    picture.append(el("p", "today-dimension", `${display(total)} ÷ ${mode === "measure" ? display(part) : groups}`));
    if (mode === "measure") {
      const visible = state.move || done,
        pieces = total / part;
      const row = el("div", "path-decimal-bar");
      row.style.setProperty("--pieces", visible ? pieces : 1);
      row.setAttribute("role", "img");
      row.setAttribute("aria-label", visible ? `${pieces} parts of ${display(part)} meters each` : `${display(total)} meters of ribbon`);
      for (const _ of countList(visible ? pieces : 1)) row.append(el("span", "", visible ? display(part) : display(total) + " m"));
      picture.append(row);
      if (state.mode === "try" && !visible) picture.append(pathModelAction("Draw equal pieces", "path-decimal-pieces", () => (state.move = 1)));
      return;
    }
    const digits = [Math.floor(total / 100), Math.floor(total / 10) % 10, total % 10];
    const names = ["Whole units", "Tenths", "Hundredths"],
      labels = ["1", "0.1", "0.01"];
    const makePieces = (counts, caption) => {
      const board = el("div", "path-decimal-board");
      board.setAttribute("role", "group");
      board.setAttribute("aria-label", caption);
      for (const [i, n] of counts.entries()) {
        const group = el("div", `path-decimal-place path-decimal-place-${i}`);
        group.append(el("b", "", names[i]), el("span", "", n));
        const pieces = el("div", "path-decimal-pieces");
        pieces.setAttribute("aria-hidden", "true");
        for (const _ of countList(n)) pieces.append(el("i", "", labels[i]));
        group.append(pieces);
        board.append(group);
      }
      picture.append(el("p", "path-caption", caption), board);
    };
    makePieces(digits, "Starting amount");
    const show = done ? 3 : state.move;
    const units = ["whole unit", "tenth", "hundredth"];
    const amount = (n, i) => `${n} ${units[i]}${n === 1 ? "" : "s"}`;
    let carry = 0;
    const perCup = digits.map((n, i) => {
      const available = carry * 10 + n,
        each = Math.floor(available / groups);
      carry = available % groups;
      if (i < show)
        modelNote(
          picture,
          `${amount(available, i)} shared across ${groups} cups: ${each} per cup.${
            carry && i < 2 ? ` Trade ${amount(carry, i)} for ${amount(carry * 10, i + 1)}.` : ""
          }`
        );
      return i < show ? each : 0;
    });
    if (show) makePieces(perCup, "Shared so far, per cup");
    if (state.mode === "try" && show < 3)
      picture.append(pathModelAction(`Share ${names[show].toLowerCase()}`, "path-decimal-share", () => state.move++));
  }
  function tapeShape(cols, tiles) {
    if (!cols) return el("p", "path-caption", "Choose how many tiles go in a row.");
    if (tiles % cols) return el("p", "today-note", `${cols} in a row leaves ${tiles % cols} ${tiles % cols === 1 ? "tile" : "tiles"} outside.`);
    const board = tileArray(tiles / cols, cols);
    board.classList.remove("today-array-grouped");
    board.classList.add("path-tape-grid");
    board.style.width = `min(100%,${cols * 1.1}rem)`;
    return board;
  }
  function tapeModel(picture, state, { p: { tiles } }) {
    for (const i of [0, 1]) {
      const cols = state.tape[i],
        area = el("div", "path-tape");
      const label = `Tiles across, rectangle ${i + 1}`;
      area.append(el("p", "today-dimension", `Rectangle ${i + 1}`), tapeShape(cols, tiles));
      if (state.mode === "try") area.append(pathDial(cols, 0, Math.min(12, tiles), label, `path-tape-${i}`, (n) => (state.tape[i] = n)));
      if (cols && tiles % cols === 0) area.append(el("p", "path-caption", `${tiles / cols} rows of ${cols} tiles`));
      picture.append(area);
    }
    if (state.mode === "done") modelNote(picture, "Follow the border to count tape. The tiles measure the inside.");
  }
  function tapeCheck({ oneTape, twoTape, least }, state, tiles, minimum) {
    const [one, two] = state.tape;
    if (!one || !two || tiles % one || tiles % two) return `Build two rectangles that each use exactly ${tiles} tiles.`;
    if (pairKey(one, tiles / one) === pairKey(two, tiles / two)) return "A turned rectangle is still the same rectangle. Build a different one.";
    if (oneTape !== 2 * (one + tiles / one) || twoTape !== 2 * (two + tiles / two))
      return "Follow the outside edges of each rectangle to count its tape.";
    return checkOK(least === undefined || least === minimum, "Look for the rectangle with the shortest border.");
  }
  function traysModel(picture, state, { p: { reds, blues, base, extra } }) {
    const revealed = state.hint || state.mode === "done",
      parent = el("div", "path-trays");
    parent.setAttribute("role", "img");
    parent.setAttribute(
      "aria-label",
      revealed
        ? `${reds} red trays with ${extra} extra tiles each and ${blues} matching blue trays`
        : `${reds} red trays and ${blues} blue trays with unknown amounts`
    );
    for (const kind of [...countList(reds).map(() => "R"), ...countList(blues).map(() => "B")]) {
      const row = el("div", `path-tray path-tray-${kind}`);
      row.append(el("b", "", kind), el("span", "path-tray-base", state.mode === "done" ? base : "?"));
      if (kind === "R" && revealed) row.append(el("span", "path-tray-extra", `+ ${extra}`));
      parent.append(row);
    }
    picture.append(parent);
    if (revealed) picture.append(el("p", "path-caption", `The ${reds + blues} main pieces match.`));
  }
  function rawSides(pair) {
    const values = pair.map((v) => (/^[0-9]+$/.test(v.trim()) ? Number(v) : NaN));
    return values.every((n) => Number.isInteger(n) && n >= 1 && n <= 51) ? values : null;
  }
  function gardenModel(picture, state, { p }) {
    const list = state.candidates;
    picture.append(el("p", "today-dimension", 2 * p.half + " meters around"));
    const shapes = el("div", "path-gardens");
    const outline = (parent, pair) => {
      const size = rawSides(pair);
      const shape = el("div", "path-garden-outline", size ? `${size[0]} × ${size[1]} m` : "? × ?");
      if (size) {
        const ratio = size[0] / size[1];
        shape.style.setProperty("--shape-ratio", Math.min(4, Math.max(1 / 4, ratio)));
      }
      parent.replaceChildren(shape);
    };
    if (!list.length) {
      const empty = el("div", "path-garden");
      outline(empty, ["", ""]);
      shapes.append(empty);
    }
    list.forEach((pair, index) => {
      const card = el("div", "path-garden");
      const drawn = el("div");
      outline(drawn, pair);
      card.append(el("p", "path-caption", `Garden ${index + 1}`), drawn);
      if (state.mode === "try") {
        const fields = el("div", "path-garden-fields today-form");
        pair.forEach((value, i) => {
          const label = el("label", "", `Side ${i + 1} (m)`);
          const input = el("input");
          Object.assign(input, { type: "text", inputMode: "numeric", autocomplete: "off", maxLength: 8, value });
          input.setAttribute("aria-label", `Garden ${index + 1} side ${i + 1} in meters`);
          input.addEventListener("input", () => {
            pair[i] = input.value;
            outline(drawn, pair);
            savePaths();
          });
          label.append(input);
          fields.append(label);
        });
        const remove = pathModelAction("Remove pair", "path-add-pair", () => list.splice(index, 1));
        remove.id = `path-remove-pair-${index}`;
        remove.setAttribute("aria-label", `Remove garden ${index + 1}`);
        card.append(fields, remove);
      }
      shapes.append(card);
    });
    picture.append(shapes);
    if (state.mode === "done") {
      const table = el("table", "path-candidates");
      const head = el("thead"),
        labels = el("tr");
      for (const label of ["Short (m)", "Long (m)", "Area (m²)"]) labels.append(el("th", "", label));
      head.append(labels);
      const body = el("tbody");
      for (const [short, long] of gardenPairs(p)) {
        const row = el("tr", short * long > p.area ? "path-fits" : "");
        for (const value of [short, long, short * long]) row.append(el("td", "", value));
        body.append(row);
      }
      table.append(el("caption", "", "Every pair that meets the perimeter and difference rules"), head, body);
      picture.append(table);
    }
    if (state.mode === "try" && list.length < 16) {
      picture.append(pathModelAction("Add a pair of sides", "path-add-pair", () => list.push(["", ""])));
    }
  }
  function gardenCheck(_, state, p) {
    if (!state.candidates.length) return "Add the dimensions for every garden that fits.";
    const pairs = state.candidates.map(rawSides);
    if (pairs.some((pair) => !pair)) return "Use positive whole numbers for both sides of each garden.";
    const keys = pairs.map(([a, b]) => pairKey(a, b));
    if (new Set(keys).size !== keys.length) return "A turned garden is still the same garden. Remove the duplicate.";
    if (pairs.some(([a, b]) => a + b !== p.half)) return `Check the perimeter. Every garden must be ${2 * p.half} meters around.`;
    if (pairs.some(([a, b]) => a * b <= p.area)) return `Every garden needs more than ${p.area} square meters.`;
    if (pairs.some(([a, b]) => Math.abs(a - b) < p.gap)) return `The side lengths must differ by at least ${p.gap} meters.`;
    return checkOK(
      sameSet(
        keys,
        gardenFits(p).map(([a, b]) => pairKey(a, b))
      ),
      "You found a garden that fits. Make sure you found every possible pair."
    );
  }
  const contentsTab = document.getElementById("contents-tab"),
    problemsTab = document.getElementById("problems-tab");
  function inContents() {
    return ["contents", "today", "path"].includes(screen);
  }
  function showSection(contents) {
    if (screen === "today") clearTodayUrl();
    if (!inContents()) problemScreen = screen;
    screen = contents ? "contents" : problemScreen;
    notice = "";
    render();
    window.scrollTo(0, 0);
  }
  contentsTab.addEventListener("click", () => showSection(true));
  problemsTab.addEventListener("click", () => showSection(false));
  function render() {
    if (inContents()) {
      contentsTab.setAttribute("aria-current", "page");
      problemsTab.removeAttribute("aria-current");
    } else {
      contentsTab.removeAttribute("aria-current");
      problemsTab.setAttribute("aria-current", "page");
    }
    app.replaceChildren();
    if (screen === "home") home();
    else if (screen === "summary") summary();
    else if (screen === "today") today();
    else if (screen === "contents") pathLibrary();
    else if (screen === "path") pathLesson();
    else play();
  }
  document.addEventListener("keydown", (event) => {
    if (screen !== "play" || ["matching", "choice"].includes(round.current.response.kind) || event.target.closest("select,input")) return;
    if (/^\d$/.test(event.key) || (event.key === "." && round.current.response.kind === "decimal")) {
      event.preventDefault();
      digit(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      digit("delete");
    } else if (event.key === "Enter" && !event.target.closest("button,a")) {
      event.preventDefault();
      check();
    }
  });
  document.querySelector(".brand").addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showSection(true);
  });
  if (new URLSearchParams(location.search).get("lesson") === "today") openLesson();
  else render();
})();
