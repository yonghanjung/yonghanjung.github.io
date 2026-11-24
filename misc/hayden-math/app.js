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
  };
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
    screen = "home",
    round = null,
    notice = "",
    seedDraft = "",
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
        config: { ...config, seed, roundKey: seed ? null : Array.from(crypto.getRandomValues(new Uint32Array(2))).join(":") },
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
    card.append(lessonEntry());
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
      b.setAttribute("aria-label", label);
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
      notice = "";
      card.querySelector(".notice")?.remove();
    });
    seedControls.append(
      seedInput,
      button("Random", () => {
        seedDraft = "";
        notice = "";
        render();
      })
    );
    seedRow.append(seedControls);
    card.append(
      seedRow,
      button("Start", () => start({ ...prefs, seed: seedDraft }), "primary start")
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
      if (["matching", "choice"].includes(q.response.kind)) response[f.key] = raw;
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
    if (round.config.seed) bar.append(el("span", "seed-badge", round.config.seed));
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
        button(
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
    copy.append(el("h2", "", "Today"), el("p", "", "Split and turn an array."));
    const label = lesson.step === "done" ? "Review lesson" : lesson.step ? "Continue lesson" : "Start lesson";
    const actions = el("div", "path-entry-actions");
    actions.append(
      button(label, () => openLesson(), "today-entry-action"),
      button("Explore lessons", openLibrary, "path-entry-action")
    );
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
  function closeLesson() {
    screen = "home";
    const url = new URL(location.href);
    if (url.searchParams.get("lesson") === "today") {
      url.searchParams.delete("lesson");
      history.replaceState(history.state, "", url);
    }
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
    toolbar.replaceChildren(button("Math Lab", closeLesson, "", "Back to Math Lab"));
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
    surface.append(heading, el("p", "today-prompt", prompt), rail, card);
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
  const PATHS_KEY = "haydenMathLab.paths.v1";
  const numberField = (name, label, max = 9999) => ({ name, label, max });
  const checkOK = (ok, message = "Try the numbers again, then check what they count.") => (ok ? "" : message);
  const countList = (n) => Array.from({ length: n }, (_, i) => i);
  const sameSet = (a, b) => a.length === b.length && b.every((key) => a.includes(key));
  const pairKey = (a, b) => `${Math.min(a, b)}×${Math.max(a, b)}`;
  const PATHS = [
    {
      id: "exchange",
      title: "Trade a hundred",
      note: "See what stays the same when you regroup.",
      prompt: "Watch the trades. Then find 503 − 278.",
      fields: [numberField("result", "503 − 278")],
      hints: [
        "Start with 5 hundreds, no tens, and 3 ones.",
        "Can you trade one hundred for 10 tens?",
        "Write 503 as 4 hundreds, 9 tens, and 13 ones.",
      ],
      check: ({ result }) => checkOK(result === 225),
      model: exchangeModel,
      proof: ["503 = 400 + 90 + 13. Take away 200 + 70 + 8.", "200 + 20 + 5 = 225. Check: 225 + 278 = 503."],
    },
    {
      id: "area",
      title: "Find the missing pieces",
      note: "Make four parts of one rectangle.",
      prompt: "Mia counts only 100 + 6 in this 13 × 12 rectangle. Tap the two pieces she missed. How many tiles are there in all?",
      fields: [numberField("total", "Tiles altogether", 1560)],
      hints: [
        "Each piece has a height and a width.",
        "Find the piece with 10 rows and 2 columns, and the piece with 3 rows and 10 columns.",
        "Add the four products: 100, 20, 30, and 6.",
      ],
      check: ({ total }, p) =>
        sameSet(p.picks, [1, 2])
          ? checkOK(total === 156, "You found both pieces. Add all four tile counts.")
          : "Choose exactly the two pieces Mia missed.",
      model: areaModel,
      proof: ["The missing pieces are 10 × 2 = 20 and 3 × 10 = 30.", "100 + 20 + 30 + 6 = 156. Check by columns: 13 × 10 + 13 × 2 = 130 + 26 = 156."],
    },
    {
      id: "fractions",
      title: "Match the fractions",
      note: "Line up two strips of the same length.",
      prompt: "Compare halves and quarters, then shade enough eighths to reach 3/4 on the strips.",
      fields: [],
      hints: [
        "Both strips represent the same whole.",
        "One quarter covers the same length as two eighths.",
        "Match three quarters, using two eighths for each quarter.",
      ],
      check: (_, p) => checkOK(p.count === 6, "Line up the shaded ends. Does the bottom strip stop at the same place?"),
      model: fractionModel,
      proof: [
        "The same-length strips end at the same place when 3 quarters and 6 eighths are shaded.",
        "With different-sized wholes, half can be a different length. Half of 8 cm is 4 cm. Half of 12 cm is 6 cm.",
      ],
    },
    {
      id: "remainder",
      title: "Pack the leftovers",
      note: "See what a remainder tells you.",
      prompt:
        "Pack 95 tiles. Each box can hold up to 4 tiles. How many boxes can you fill completely? How many tiles are left? How many boxes do you need for all the tiles?",
      fields: [numberField("full", "Full boxes", 95), numberField("left", "Leftover tiles", 95), numberField("all", "Boxes for all the tiles", 95)],
      hints: [
        "Use as many full boxes as you can first.",
        "20 boxes use 80 tiles. How many complete boxes can you make with the rest?",
        "23 boxes use 92 tiles. Any tiles left need a box of their own.",
      ],
      check: ({ full, left, all }) =>
        full !== 23 || left !== 3
          ? "Each full box holds 4. Check that 4 times your full boxes plus your leftover tiles equals 95, and that fewer than 4 are left."
          : checkOK(all === 24, "Where will the 3 leftover tiles go?"),
      model: packingModel,
      proof: [
        "23 full boxes hold 92 tiles. Three tiles remain, so 4 × 23 + 3 = 95.",
        "To pack all 95 tiles, use 24 boxes. The last box holds the 3 leftovers.",
      ],
    },
    {
      id: "measure",
      title: "Count the spaces",
      note: "Find lengths and elapsed time.",
      prompt: "A line starts at 5 cm and ends at 12 cm. How long is it? How much time passes from 3:50 to 4:05?",
      fields: [numberField("length", "Length in cm", 99), numberField("time", "Elapsed minutes", 99)],
      hints: [
        "Count the spaces between marks on the ruler.",
        "For time, first move to 4:00, then move past it.",
        "Ten minutes to 4:00 and five more minutes reach 4:05.",
      ],
      check: ({ length, time }) =>
        length !== 7
          ? "Read from the starting mark to the ending mark."
          : checkOK(time === 15, "Join the time before 4:00 with the time after 4:00."),
      model: measureModel,
      proof: [
        "The line covers 12 − 5 = 7 cm. Count the 7 spaces from 5 to 12.",
        "3:50 → 4:00 is 10 minutes. 4:00 → 4:05 is 5 more. 10 + 5 = 15 minutes.",
      ],
    },
    {
      id: "transfer",
      title: "Try a new array",
      note: "Use an idea on fresh numbers.",
      prompt: "How many tiles fill 4 rows of 17? Then share 84 tiles equally among 6 boxes. How many go in each box?",
      fields: [numberField("total", "Tiles in the 4 rows", 999), numberField("each", "Tiles in each box", 84)],
      hints: [
        "For the array, try a cut in the same place on every row.",
        "For sharing, choose two parts of 84 that can both be shared among 6 boxes.",
        "Try 17 = 10 + 7 and 84 = 60 + 24.",
      ],
      check: ({ total, each }) =>
        total !== 68 ? "Check both parts of each of the four rows." : checkOK(each === 14, "Check your tiles per box by multiplying by 6."),
      model: transferModel,
      proof: ["4 × 17 = 4 × 10 + 4 × 7 = 40 + 28 = 68.", "84 = 60 + 24. Each box gets 10 + 4 = 14 tiles. Check: 6 × 14 = 84."],
    },
    {
      id: "tape",
      title: "Tiles and tape",
      note: "Build a counterexample.",
      challenge: true,
      prompt:
        "Use exactly 12 one-inch square tiles to build a rectangle with no gaps or overlaps. Mia says every rectangle needs the same length of tape around the outside. Build two different rectangles to check. How many inches of tape does each rectangle need?",
      fields: [
        numberField("oneTape", "Tape for rectangle 1 (in)", 99),
        numberField("twoTape", "Tape for rectangle 2 (in)", 99),
        { ...numberField("least", "Least tape for any rectangle (in)", 99), optional: true },
      ],
      hints: [
        "Tiles fill the inside. Tape goes around the outside.",
        "Turning the same rectangle does not make a new one.",
        "Try row sizes that divide 12. Count the outside edges of each rectangle.",
      ],
      check: tapeCheck,
      model: tapeModel,
      proof: [
        "The rectangles are 1 × 12, 2 × 6, and 3 × 4. They use 26, 16, and 14 inches of tape.",
        "For example, 3 × 4 and 2 × 6 both use 12 tiles, but 14 ≠ 16. The least tape is 14 inches.",
      ],
    },
    {
      id: "trays",
      title: "Red and blue trays",
      note: "Use the same-size parts.",
      challenge: true,
      prompt:
        "Hayden puts all 72 tiles on two red trays and three blue trays. Trays of the same color hold equal amounts. Each red tray holds six more tiles than each blue tray. How many tiles are on one tray of each color?",
      fields: [numberField("red", "Tiles on one red tray", 72), numberField("blue", "Tiles on one blue tray", 72)],
      hints: [
        "Red has a blue-sized part plus 6 more.",
        "There are two red trays, so set aside 6 + 6 tiles.",
        "Share the remaining 60 tiles among the five equal parts.",
      ],
      check: ({ red, blue }) =>
        red - blue !== 6
          ? "Each red tray needs 6 more tiles than a blue tray."
          : checkOK(red > 0 && blue > 0 && 2 * red + 3 * blue === 72, "Count both red trays and all three blue trays. Do they use all 72 tiles?"),
      model: traysModel,
      proof: [
        "Set aside 6 tiles on each red tray: 72 − 12 = 60. The five matching parts have 60 ÷ 5 = 12 tiles each.",
        "Blue gets 12, and red gets 12 + 6 = 18. Check: 2 × 18 + 3 × 12 = 72.",
      ],
    },
    {
      id: "garden",
      title: "Design a garden",
      note: "Find every rectangle that fits.",
      challenge: true,
      prompt:
        "A rectangular garden has a perimeter of 52 meters. Its sides are whole numbers of meters. Its area is more than 150 square meters. The longer side is at least 5 meters longer than the shorter side. Find every possible pair of side lengths.",
      fields: [],
      hints: [
        "The two neighboring sides add to half the perimeter.",
        "The shorter side can be 1 to 10 meters if the sides differ by at least 5 meters.",
        "List the short sides. Use 26 minus each short side to find its partner. Check the areas.",
      ],
      check: gardenCheck,
      model: gardenModel,
      proof: [
        "Short side + long side = 26 m. The difference rule makes 1–10 m the only short sides to test.",
        "9 × 17 = 153 m² and 10 × 16 = 160 m². Both have a 52 m perimeter; the side differences are 8 m and 6 m.",
        "At 8 × 18 the area is 144 m², and all smaller short sides give even less. 11 × 15 fails the difference rule.",
      ],
    },
  ];

  function blankPath() {
    return { mode: "try", hint: 0, move: 0, count: 0, tape: [0, 0], picks: [], candidates: [], values: {}, observation: "" };
  }
  function readPaths() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(PATHS_KEY));
    } catch {
      return {};
    }
    const saved = {};
    for (const task of PATHS) {
      const v = raw?.[task.id];
      if (!v || typeof v !== "object") continue;
      const state = blankPath();
      for (const [key, limit] of [
        ["hint", task.hints.length],
        ["move", 12],
        ["count", 8],
      ]) {
        if (Number.isInteger(v[key]) && v[key] >= 0 && v[key] <= limit) state[key] = v[key];
      }
      if (["try", "review", "done"].includes(v.mode)) state.mode = v.mode;
      if (Array.isArray(v.tape) && v.tape.length === 2 && v.tape.every((n) => Number.isInteger(n) && n >= 0 && n <= 12)) state.tape = v.tape;
      if (Array.isArray(v.picks)) state.picks = [...new Set(v.picks.filter((n) => Number.isInteger(n) && n >= 0 && n < 4))];
      if (Array.isArray(v.candidates))
        state.candidates = v.candidates
          .slice(0, 12)
          .filter((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((side) => typeof side === "string" && side.length <= 8));
      if (["alone", "asked", "hint"].includes(v.observation)) state.observation = v.observation;
      for (const f of task.fields)
        if (typeof v.values?.[f.name] === "string" && v.values[f.name].length <= 8) state.values[f.name] = v.values[f.name];
      if (state.mode === "done") {
        const result = pathValues(task, state);
        if (!result || task.check(result, state)) state.mode = "try";
      }
      saved[task.id] = state;
    }
    return saved;
  }
  let pathProgress = readPaths(),
    currentPath = null,
    pathFeedback = "";
  function savePaths() {
    try {
      localStorage.setItem(PATHS_KEY, JSON.stringify(pathProgress));
    } catch {}
  }
  function openLibrary() {
    screen = "library";
    render();
    pathFocus();
  }
  function openPath(task) {
    currentPath = task;
    pathProgress[task.id] ??= blankPath();
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
  function pathReturn() {
    screen = "home";
    render();
    window.scrollTo(0, 0);
    app.querySelector(".path-entry-action")?.focus({ preventScroll: true });
  }
  function pathHeader(title, intro) {
    const section = el("section", "today-surface");
    const h = el("h1", "today-heading", title);
    h.tabIndex = -1;
    section.append(h, el("p", "today-prompt", intro));
    app.append(section);
    return section;
  }
  function pathLibrary() {
    toolbar.replaceChildren(button("Math Lab", pathReturn, "", "Back to Math Lab"));
    const page = pathHeader("Explore lessons", "Choose a picture lesson or a thinking challenge.");
    for (const [challenge, label] of [
      [false, "Picture lessons"],
      [true, "Hwangso challenges"],
    ]) {
      const group = el("section", "path-library-group");
      group.setAttribute("aria-label", label);
      group.append(el("h2", "", label));
      const grid = el("div", "path-library-grid");
      for (const task of PATHS.filter((t) => Boolean(t.challenge) === challenge)) {
        const status = pathProgress[task.id]?.mode;
        const action = status === "done" ? "Review" : status ? "Continue" : "Start";
        const card = el("div", "card path-tile");
        card.append(
          el("h3", "", task.title),
          el("p", "", task.note),
          button(action, () => openPath(task), "", `${action}: ${task.title}`)
        );
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
      if (!/^[0-9]+$/.test(raw) || Number(raw) > field.max) return null;
      values[field.name] = Number(raw);
    }
    return values;
  }
  function pathAnswerFields(work, task, state) {
    const form = el("form", "today-form path-answer-form");
    form.noValidate = true;
    for (const field of task.fields) {
      const label = el("label", "", field.label + (field.optional ? " (optional)" : ""));
      const input = el("input");
      Object.assign(input, { type: "text", inputMode: "numeric", maxLength: 8, autocomplete: "off", value: state.values[field.name] || "" });
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
        pathFeedback = "Enter a whole number in each required box.";
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
    const state = pathProgress[task.id];
    toolbar.replaceChildren(button("Lessons", openLibrary), button("Math Lab", pathReturn, "", "Back to Math Lab"));
    const page = pathHeader(task.title, task.prompt);
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
      card.append(
        button("Try again", () => {
          pathProgress[task.id] = blankPath();
          pathFeedback = "";
          pathDraw();
          pathFocus();
        })
      );
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
  function exchangeModel(picture, state) {
    const small = [
      [[0, 5, 0, 0], "500 stays 500. Set aside 4 hundreds."],
      [[0, 4, 10, 0], "Trade 1 hundred for 10 tens. The total is still 500."],
      [[0, 4, 9, 10], "Trade 1 ten for 10 ones. The total is still 500."],
      [[0, 4, 9, 7], "Take away 3 ones. 400 + 90 + 7 = 497."],
    ];
    const big = [
      [[1, 0, 2, 3], "Start with 1 thousand, 0 hundreds, 2 tens, and 3 ones."],
      [[1, 0, 1, 13], "Trade 1 ten for 10 ones. The total is still 1,023."],
      [[0, 10, 1, 13], "Trade 1 thousand for 10 hundreds. The total is still 1,023."],
      [[0, 9, 11, 13], "Trade 1 hundred for 10 tens. The total is still 1,023."],
      [[0, 9, 3, 6], "Take away 8 tens and 7 ones. This leaves 936. Check: 936 + 87 = 1,023."],
    ];
    const page = state.move >= 4 ? big : small;
    const index = state.move < 4 ? state.move : Math.min(4, state.move - 4);
    const [counts, explanation] = page[index];
    picture.append(el("p", "today-dimension", page === small ? "500 − 3" : "1,023 − 87"));
    if (page === small && index > 0) {
      const flat = el("div", "path-hundred");
      flat.setAttribute("role", "img");
      flat.setAttribute("aria-label", index === 3 ? "Hundred board with the last three cells crossed out" : "One hundred in ten rows of ten");
      for (const i of countList(100))
        flat.append(el("span", i >= 97 && index === 3 ? "path-crossed" : i >= 90 && index >= 2 ? "today-part-B" : "today-part-A"));
      picture.append(flat);
    }
    placeChips(picture, counts);
    modelNote(picture, explanation);
    const row = el("div", "today-picks");
    if (state.move > 0) row.append(pathModelAction("Previous step", "path-move-back", () => state.move--));
    if (state.move < 8)
      row.append(
        pathModelAction(
          state.move === 3 ? "Try a bigger trade" : state.move === 2 || state.move === 7 ? "Take away" : "Make the next trade",
          "path-move-next",
          () => state.move++
        )
      );
    picture.append(row);
  }
  function areaModel(picture, state) {
    const grid = el("div", "path-area");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Four pieces of the 13 by 12 rectangle");
    const parts = [
      [10, 10],
      [10, 2],
      [3, 10],
      [3, 2],
    ];
    parts.forEach(([rows, cols], i) => {
      const picked = state.picks.includes(i);
      const label = `${rows} × ${cols}`;
      const control = pathModelAction(
        label,
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
  function fractionModel(picture, state) {
    if (state.mode === "try") {
      const controls = el("div", "today-picks");
      controls.append(
        pathModelAction("See ½ = 2/4", "path-halves", () => (state.move = 1), state.move === 1),
        pathModelAction("Shade eighths", "path-eighths", () => (state.move = 0), state.move === 0)
      );
      picture.append(controls);
    }
    if (state.move === 1 && state.mode === "try") {
      strip(picture, 2, 1, "1 of 2 equal parts");
      strip(picture, 4, 2, "2 of 4 equal parts");
      modelNote(picture, "The wholes are the same length. Both shaded ends line up.");
      return;
    }
    strip(picture, 4, 3, "3 of 4 equal parts");
    strip(picture, 8, state.count, `${state.count} of 8 equal parts`);
    if (state.mode === "try") picture.append(pathDial(state.count, 0, 8, "Eighths shaded", "path-shade", (n) => (state.count = n)));
    if (state.mode !== "done") return;
    modelNote(picture, "Same fraction, different wholes");
    strip(picture, 2, 1, "4 cm shaded out of 8 cm", (8 / 12) * 100);
    strip(picture, 2, 1, "6 cm shaded out of 12 cm");
  }
  function packingModel(picture, state) {
    const done = state.mode === "done";
    const boxCount = done ? 23 : Math.min(state.move, 3) * 5;
    const boxes = el("div", "path-packing");
    boxes.setAttribute("role", "img");
    boxes.setAttribute(
      "aria-label",
      `${boxCount} full boxes with four tiles in each, ${95 - 4 * boxCount} loose tiles${done ? " in one last box" : ""}`
    );
    for (const _ of countList(boxCount)) {
      const box = el("span", "path-pack-box");
      for (const __ of countList(4)) box.append(el("i"));
      boxes.append(box);
    }
    if (done) {
      const last = el("span", "path-pack-box path-pack-last");
      for (const _ of countList(3)) last.append(el("i"));
      boxes.append(last);
    }
    picture.append(el("p", "today-dimension", `${boxCount} full · ${95 - 4 * boxCount} loose tiles`), boxes);
    if (!done) {
      const rest = el("div", "path-loose");
      rest.setAttribute("aria-hidden", "true");
      for (const _ of countList(95 - 4 * boxCount)) rest.append(el("i"));
      picture.append(rest);
      if (state.mode === "try" && state.move < 3) picture.append(pathModelAction("Pack 5 boxes", "path-pack", () => state.move++));
    }
  }
  function measureModel(picture, state) {
    const showing = state.move === 1 && state.mode === "try";
    picture.append(el("p", "today-dimension", showing ? "Example: from 3 cm to 11 cm" : "Your line: from 5 cm to 12 cm"));
    visual({ visual: { kind: "ruler", start: showing ? 3 : 5, end: showing ? 11 : 12, max: 12, unit: "cm" } }, picture);
    if (showing) modelNote(picture, "8 spaces, each 1 cm long.");
    if (state.mode === "try")
      picture.append(pathModelAction(showing ? "See your line" : "See a ruler example", "path-ruler", () => (state.move = showing ? 0 : 1)));
    const time = el("div", "path-time-line");
    const labels = state.mode === "done" ? ["3:50", "+10 min", "4:00", "+5 min", "4:05"] : ["3:50", "→", "4:00", "→", "4:05"];
    for (const label of labels) time.append(el("span", "", label));
    picture.append(time);
  }
  function transferModel(picture, state) {
    if (state.mode === "done") {
      picture.append(el("p", "today-dimension", "4 rows of 17"), tileArray(4, 17, 10), el("p", "path-caption", "Each row has 10 + 7."));
    } else {
      picture.append(el("p", "today-dimension", "Sketch an idea on paper."));
    }
    const groups = el("div", "path-transfer-boxes");
    groups.setAttribute("role", "img");
    groups.setAttribute("aria-label", state.mode === "done" ? "Six boxes with 10 plus 4 in each" : "Six empty boxes");
    for (const _ of countList(6)) groups.append(el("span", "", state.mode === "done" ? "10 + 4" : "?"));
    picture.append(groups);
  }
  function tapeShape(rows) {
    if (!rows) return el("p", "path-caption", "Choose how many tiles go in a row.");
    if (12 % rows) return el("p", "today-note", `${rows} in a row leaves ${12 % rows} ${12 % rows === 1 ? "tile" : "tiles"} outside.`);
    const board = tileArray(12 / rows, rows);
    board.classList.remove("today-array-grouped");
    board.classList.add("path-tape-grid");
    board.style.width = `${rows * 1.1}rem`;
    return board;
  }
  function tapeModel(picture, state) {
    for (const i of [0, 1]) {
      const cols = state.tape[i];
      const area = el("div", "path-tape");
      const label = `Tiles across, rectangle ${i + 1}`;
      area.append(el("p", "today-dimension", `Rectangle ${i + 1}`), tapeShape(cols));
      if (state.mode === "try") area.append(pathDial(cols, 0, 12, label, `path-tape-${i}`, (n) => (state.tape[i] = n)));
      if (cols && 12 % cols === 0) area.append(el("p", "path-caption", `${12 / cols} rows of ${cols} tiles`));
      picture.append(area);
    }
    if (state.mode === "done") modelNote(picture, "Follow the border to count tape. The tiles measure the inside.");
  }
  function tapeCheck({ oneTape, twoTape, least }, state) {
    const [one, two] = state.tape;
    if (!one || !two || 12 % one || 12 % two) return "Build two rectangles that each use exactly 12 tiles.";
    if (pairKey(one, 12 / one) === pairKey(two, 12 / two)) return "A turned rectangle is still the same rectangle. Build a different one.";
    if (oneTape !== 2 * (one + 12 / one) || twoTape !== 2 * (two + 12 / two)) return "Follow the outside edges of each rectangle to count its tape.";
    return checkOK(least === undefined || least === 14, "Look for the rectangle with the shortest border.");
  }
  function traysModel(picture, state) {
    const revealed = state.hint || state.mode === "done";
    const parent = el("div", "path-trays");
    parent.setAttribute("role", "img");
    parent.setAttribute(
      "aria-label",
      revealed
        ? "Two red trays with six extra tiles each, and three blue trays of the same base size"
        : "Two red trays and three blue trays with unknown amounts"
    );
    ["R", "R", "B", "B", "B"].forEach((kind) => {
      const row = el("div", `path-tray path-tray-${kind}`);
      row.append(el("b", "", kind), el("span", "path-tray-base", state.mode === "done" ? "12" : "?"));
      if (kind === "R" && revealed) row.append(el("span", "path-tray-extra", "+ 6"));
      parent.append(row);
    });
    picture.append(parent);
    if (revealed) picture.append(el("p", "path-caption", "The five main pieces match."));
  }
  function rawSides(pair) {
    const values = pair.map((v) => (/^[0-9]+$/.test(v.trim()) ? Number(v) : NaN));
    return values.every((n) => Number.isInteger(n) && n >= 1 && n <= 51) ? values : null;
  }
  function gardenModel(picture, state) {
    const list = state.candidates;
    picture.append(el("p", "today-dimension", "52 meters around"));
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
      for (const i of countList(10)) {
        const short = i + 1,
          long = 26 - short;
        const row = el("tr", short * long > 150 ? "path-fits" : "");
        for (const value of [short, long, short * long]) row.append(el("td", "", value));
        body.append(row);
      }
      table.append(el("caption", "", "Every pair that meets the perimeter and difference rules"), head, body);
      picture.append(table);
    }
    if (state.mode === "try" && list.length < 12) {
      picture.append(pathModelAction("Add a pair of sides", "path-add-pair", () => list.push(["", ""])));
    }
  }
  function gardenCheck(_, state) {
    if (!state.candidates.length) return "Add the dimensions for every garden that fits.";
    const pairs = state.candidates.map(rawSides);
    if (pairs.some((pair) => !pair)) return "Use positive whole numbers for both sides of each garden.";
    const keys = pairs.map(([a, b]) => pairKey(a, b));
    if (new Set(keys).size !== keys.length) return "A turned garden is still the same garden. Remove the duplicate.";
    if (pairs.some(([a, b]) => 2 * (a + b) !== 52)) return "Check the perimeter. Every garden must be 52 meters around.";
    if (pairs.some(([a, b]) => a * b <= 150)) return "Check the area. Every garden needs more than 150 square meters.";
    if (pairs.some(([a, b]) => Math.abs(a - b) < 5)) return "Check the difference between the sides. It must be at least 5 meters.";
    return checkOK(sameSet(keys, ["9×17", "10×16"]), "You found a garden that fits. Make sure you found every possible pair.");
  }
  function render() {
    app.replaceChildren();
    if (screen === "home") home();
    else if (screen === "summary") summary();
    else if (screen === "today") today();
    else if (screen === "library") pathLibrary();
    else if (screen === "path") pathLesson();
    else play();
  }
  document.addEventListener("keydown", (event) => {
    if (screen !== "play" || ["matching", "choice"].includes(round.current.response.kind) || event.target.closest("select,input")) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      digit(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      digit("delete");
    } else if (event.key === "Enter") {
      event.preventDefault();
      check();
    }
  });
  document.querySelector(".brand").addEventListener("click", (event) => {
    if (!["today", "path", "library"].includes(screen) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (screen === "today") closeLesson();
    else pathReturn();
  });
  if (new URLSearchParams(location.search).get("lesson") === "today") openLesson();
  else render();
})();
