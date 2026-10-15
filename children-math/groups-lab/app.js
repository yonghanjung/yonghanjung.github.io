(() => {
  "use strict";
  const E = GroupsLab,
    app = document.getElementById("app"),
    soundKey = "haydenGroupsLab.sound.v1",
    random = E.createRng(freshSeed());
  let soundEnabled = true,
    audio = null,
    toneToken = 0,
    sessionType = null,
    screen = "home",
    lesson = null,
    recent = [],
    demo = null,
    demoAuto = false,
    demoTimer = null,
    demoPhase = "swap";
  try {
    soundEnabled = localStorage.getItem(soundKey) !== "off";
  } catch (_) {}
  function freshSeed() {
    try {
      const values = new Uint32Array(1);
      if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(values);
        return values[0];
      }
    } catch (_) {}
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
  function audioStatus(text = "") {
    const status = document.getElementById("audioStatus");
    status.textContent = text;
    status.hidden = !text;
  }
  function toneURL() {
    const rate = 44100,
      samples = Math.ceil(rate * 0.25),
      wave = new Float32Array(samples);
    let peak = 0;
    for (let i = 0; i < samples; i++) {
      const time = i / rate;
      [880, 1174.66].forEach((frequency, note) => {
        const t = time - note * 0.07;
        if (t >= 0 && t < 0.18) {
          const envelope = t < 0.01 ? t / 0.01 : Math.exp((-7 * (t - 0.01)) / 0.17);
          wave[i] += Math.sin(2 * Math.PI * frequency * t) * envelope;
        }
      });
      peak = Math.max(peak, Math.abs(wave[i]));
    }
    const bytes = new Uint8Array(44 + samples * 2),
      view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round((wave[i] / peak) * 0.12 * 32767), true);
    return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
  }
  function restoreSession() {
    if (sessionType !== null) {
      try {
        if (navigator.audioSession?.type === "playback") navigator.audioSession.type = sessionType;
      } catch (_) {}
      sessionType = null;
    }
  }
  function stopTone() {
    toneToken++;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch (_) {}
    }
    restoreSession();
  }
  function ding(test = false) {
    if (!soundEnabled || document.hidden) return;
    stopTone();
    const token = toneToken;
    const failed = () => {
      if (token !== toneToken) return;
      restoreSession();
      audioStatus("Sound blocked. Tap Test sound.");
    };
    try {
      if (!audio) {
        audio = new Audio(toneURL());
        audio.preload = "auto";
      }
      try {
        if (navigator.audioSession && navigator.audioSession.type !== "playback") {
          sessionType = navigator.audioSession.type;
          navigator.audioSession.type = "playback";
        }
      } catch (_) {}
      audio.onended = () => {
        if (token === toneToken) restoreSession();
      };
      audio.onerror = failed;
      const playing = audio.play();
      if (playing?.then) {
        playing
          .then(() => {
            if (token !== toneToken) return;
            audioStatus(test ? "If silent, raise media volume." : "");
          })
          .catch(failed);
      }
    } catch (_) {
      failed();
    }
  }
  function updateSound() {
    const button = document.getElementById("sound");
    button.textContent = soundEnabled ? "🔊" : "🔇";
    button.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
    button.setAttribute("aria-pressed", String(soundEnabled));
  }
  function saveSound() {
    try {
      localStorage.setItem(soundKey, soundEnabled ? "on" : "off");
    } catch (_) {}
    updateSound();
  }
  document.getElementById("sound").onclick = () => {
    soundEnabled = !soundEnabled;
    saveSound();
    if (soundEnabled) ding(true);
    else {
      stopTone();
      audioStatus();
    }
  };
  const btn = (text, action, cls = "", extra = "") => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
  const dots = (n, ghost = 0) =>
    Array.from({ length: n }, () => '<span class="dot" aria-hidden="true"></span>').join("") +
    Array.from({ length: ghost }, () => '<span class="dot ghost" aria-hidden="true"></span>').join("");
  function freshState(q) {
    return {
      q,
      draft: { groups: 1, each: 1, value: q.stage === "story" ? null : 0 },
      first: null,
      correct: false,
      hint: 0,
      answerShown: false,
      assisted: false,
      notice: "",
      view: "groups",
    };
  }
  function start(questions) {
    stopDemoAuto();
    const qs = questions || E.generate(recent, random);
    if (!qs.every(E.verify)) return;
    lesson = { questions: qs, states: qs.map(freshState), index: 0, retry: !!questions };
    if (!questions) recent = qs.map((q) => q.signature);
    screen = "play";
    render();
  }
  function model(s) {
    const q = s.q;
    if (s.correct || q.unknown === "total") return { g: q.groups, e: q.each, total: q.total, pool: false };
    if (q.kind === "build") return { g: s.draft.groups, e: s.draft.each, total: q.total, pool: true };
    if (q.stage === "story") {
      return { g: q.unknown === "each" ? q.groups : 0, e: q.unknown === "each" ? (s.hint >= 2 ? 1 : 0) : q.each, total: q.total, pool: true };
    }
    return { g: q.unknown === "each" ? q.groups : s.draft.value, e: q.unknown === "each" ? s.draft.value : q.each, total: q.total, pool: true };
  }
  function board(s) {
    const q = s.q,
      m = model(s),
      used = m.g * m.e,
      assigned = Math.min(q.total, used),
      left = q.total - assigned;
    const facts =
      s.correct || q.kind === "build"
        ? `<span class="fact">Groups ${q.groups}</span><span class="fact">Each ${q.each}</span>`
        : q.unknown === "each"
          ? `<span class="fact">${q.total} ${q.item}</span><span class="fact">${q.groups} ${q.container}</span>`
          : q.unknown === "groups"
            ? `<span class="fact">${q.total} ${q.item}</span><span class="fact">${q.each} per ${
                q.container === "tables" ? "table" : q.container === "packs" ? "pack" : "bag"
              }</span>`
            : `<span class="fact">Groups ${q.groups}</span><span class="fact">Each ${q.each}</span>`;
    let groups = "";
    if (m.g === 0)
      groups = `<div class="group-card"><div class="group-label">One group: ${q.each} spots</div><div class="dots">${dots(0, q.each)}</div></div>`;
    else
      groups = Array.from({ length: m.g }, (_, group) => {
        let fill = 0;
        for (let i = 0; i < m.e; i++) {
          const index = q.unknown === "each" ? i * m.g + group : group * m.e + i;
          if (index < m.total) fill++;
        }
        return `<div class="group-card"><div class="group-label">${
          q.kind === "build" ? "Group" : q.container === "tables" ? "Table" : q.container === "packs" ? "Pack" : "Bag"
        } ${group + 1}</div><div class="dots">${dots(fill, m.e - fill)}</div></div>`;
      }).join("");
    if (s.view === "array" && m.g > 0)
      groups = `<div class="array" style="grid-template-columns:repeat(${Math.max(1, m.e)},18px)">${Array.from(
        { length: used },
        (_, i) => `<span class="dot ${i >= q.total ? "ghost" : ""}" aria-hidden="true"></span>`
      ).join("")}</div>`;
    return `<section class="board" aria-label="Groups model"><div class="facts">${facts}</div><div class="${
      s.view === "array" ? "" : "groups"
    }">${groups}</div>${
      m.pool
        ? `<div class="pool"><div class="pool-label">${left} ${q.item} left${
            used > q.total ? ` · ${used - q.total} empty spots` : ""
          }</div><div class="dots">${dots(left)}</div></div>`
        : ""
    }${q.kind === "build" || s.correct ? btn(s.view === "array" ? "Groups view" : "Array view", "view", "view-toggle soft") : ""}</section>`;
  }
  function control(label, key, value, max, plusLabel, min = 0) {
    return `<div class="control"><span class="control-label">${label}</span><div class="control-input">${btn(
      "−",
      `change:${key}:-1`,
      "",
      `aria-label="Undo ${label}" ${value <= min ? "disabled" : ""}`
    )}<output aria-label="${label}">${value}</output>${btn(
      "+",
      `change:${key}:1`,
      "",
      `aria-label="${plusLabel || "Add " + label}" ${value >= max ? "disabled" : ""}`
    )}</div></div>`;
  }
  function family(q) {
    return `<div class="family"><div>${q.groups} × ${q.each} = ${q.total}</div><div>${q.total} ÷ ${q.groups} = ${q.each}</div><div>${q.total} ÷ ${q.each} = ${q.groups}</div></div>`;
  }
  function play() {
    const s = lesson.states[lesson.index],
      q = s.q;
    const controls =
      q.kind === "build"
        ? control("Groups", "groups", s.draft.groups, Math.min(9, Math.floor(72 / Math.max(1, s.draft.each)))) +
          control("Each", "each", s.draft.each, Math.min(9, Math.floor(72 / Math.max(1, s.draft.groups))))
        : q.stage === "story"
          ? `<div class="choice-grid" role="group" aria-label="Answer choices">${q.options
              .map((n) => btn(n, `choose:${n}`, s.draft.value === n ? "selected" : "", `aria-pressed="${s.draft.value === n}"`))
              .join("")}</div><div class="quiet">${q.label}</div>`
          : control(
              q.unknown === "each" ? "Each" : "Groups",
              "value",
              s.draft.value,
              Math.min(9, Math.floor(72 / (q.unknown === "each" ? q.groups : q.each))),
              q.unknown === "each" ? "Share one each" : "Make group"
            );
    app.innerHTML = `<nav class="steps" aria-label="Learning steps">${["build", "solve", "story"]
      .map((x) =>
        btn(
          x[0].toUpperCase() + x.slice(1),
          `stage:${x}`,
          `step ${q.stage === x ? "active" : ""}`,
          `${q.stage === x ? 'aria-current="step"' : ""} ${lesson.questions.some((item) => item.stage === x) ? "" : "disabled"}`
        )
      )
      .join("")}<span class="counter">${lesson.index + 1} / ${lesson.states.length}</span></nav>${btn(
      lesson.index === lesson.states.length - 1 ? "Finish" : "Next",
      "next",
      "primary check"
    )}<div class="prompt">${q.prompt}</div><div class="stage-layout">${board(s)}<section class="actions" aria-label="Learning controls">${
      s.correct
        ? `<div class="feedback correct"><span class="emoji" aria-hidden="true">🌟</span> <span>Great! ${
            q.kind === "build" ? "Equal groups." : q.answer.value + " " + q.label + "."
          }</span></div>${family(q)}`
        : `${controls}${s.notice ? `<div class="feedback wrong" role="status">${s.notice}</div>` : ""}${btn(
            s.first ? "Check again" : "Check",
            "check",
            "primary check"
          )}<div class="action-row">${btn("Hint", "hint", "soft", s.hint >= 3 ? "disabled" : "")}${btn("Show answer", "answer", "soft")}</div>${
            s.hint ? `<div class="hint">${q.hints.slice(0, s.hint).join("\n")}</div>` : ""
          }${
            s.answerShown
              ? `<div class="hint">${q.kind === "build" ? `${q.groups} groups · ${q.each} each` : q.answer.value + " " + q.label}${family(q)}</div>`
              : ""
          }`
    }</section></div>`;
  }
  function stopDemoAuto() {
    demoAuto = false;
    if (demoTimer !== null) clearTimeout(demoTimer);
    demoTimer = null;
  }
  function swapDemo() {
    [demo.rows, demo.columns] = [demo.columns, demo.rows];
    demo.swapped = true;
  }
  function nextDemo() {
    const candidates = [],
      current = demo ? E.key(demo.rows, demo.columns) : null;
    for (let rows = 2; rows <= 9; rows++)
      for (let columns = 2; columns <= 9; columns++)
        if (rows * columns <= 72 && E.key(rows, columns) !== current) candidates.push({ rows, columns, swapped: false });
    demo = candidates[Math.floor(random() * candidates.length)];
  }
  function scheduleDemo() {
    if (!demoAuto || screen !== "home" || document.hidden) return;
    demoTimer = setTimeout(() => {
      demoTimer = null;
      if (!demoAuto || screen !== "home" || document.hidden) {
        stopDemoAuto();
        return;
      }
      if (demoPhase === "swap") {
        swapDemo();
        demoPhase = "next";
      } else {
        nextDemo();
        demoPhase = "swap";
      }
      render();
      scheduleDemo();
    }, 6000);
  }
  function home() {
    const { rows, columns, swapped } = demo,
      total = rows * columns;
    const controls =
      control("Rows", "rows", rows, Math.min(9, Math.floor(72 / columns)), undefined, 2) +
      control("Columns", "columns", columns, Math.min(9, Math.floor(72 / rows)), undefined, 2);
    app.innerHTML = `<section class="home explorer"><span class="eyebrow">Groups Lab</span><h1>Turn it around.</h1><div class="demo-toolbar">${btn(
      "Next",
      "demoNext",
      "primary"
    )}${btn(
      "↔ Swap",
      "swap",
      "soft"
    )}</div><div class="array-label">${rows} rows · ${columns} columns</div><div class="demo-array" role="img" aria-label="${rows} rows of ${columns} dots, ${total} dots total" style="grid-template-columns:repeat(${columns},18px)">${dots(
      total
    )}</div><div class="demo-equation">${rows} × ${columns} = ${columns} × ${rows}</div><div class="demo-total">${
      swapped ? "Same " : ""
    }${total} dots</div>${btn(demoAuto ? "Pause" : "Auto play", "demoAuto", "soft demo-auto-button", `aria-pressed="${demoAuto}"`)}${
      demoAuto ? '<div class="quiet">6s · Swap → Next</div>' : ""
    }<div class="demo-controls">${controls}</div><div class="optional-actions">${btn("Practice", "start", "soft")}${
      lesson ? btn(lesson.index >= lesson.states.length ? "Results" : "Continue", "continue", "soft") : ""
    }${btn("Test sound", "testSound", "soft")}</div></section>`;
  }
  function complete() {
    const result = E.summary(lesson.states),
      missed = lesson.states.filter((s) => s.first && !s.first.correct);
    app.innerHTML = `<section class="summary"><span class="eyebrow">Groups Lab</span><h1>${result.master ? "Master! 🌟" : "Lesson complete"}</h1>${
      result.total ? `<div class="score">${result.correct}<small> / ${result.total}</small></div>` : ""
    }<div class="quiet">${result.total ? "First answers · " : ""}${result.total} answered · ${result.skipped} skipped${
      result.helped ? " · " + result.helped + " with help" : ""
    }</div><div class="home-actions">${missed.length ? btn("Practice mistakes", "retry", "soft") : ""}${btn("New lesson", "start", "primary")}${btn(
      "Home",
      "home",
      "soft"
    )}</div>${
      missed.length
        ? `<div>${missed
            .map(
              (s) =>
                `<div class="note"><strong>${s.q.prompt}</strong><small>${
                  s.q.kind === "build" ? `${s.q.groups} groups · ${s.q.each} each` : s.q.answer.value + " " + s.q.label
                }</small></div>`
            )
            .join("")}</div>`
        : ""
    }</section>`;
  }
  function render() {
    updateSound();
    document.getElementById("home").hidden = screen === "home";
    if (screen === "home") home();
    else if (lesson.index >= lesson.states.length) complete();
    else play();
  }
  app.addEventListener("click", (event) => {
    const b = event.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action === "swap") {
      stopDemoAuto();
      swapDemo();
      return render();
    }
    if (action === "demoNext") {
      stopDemoAuto();
      nextDemo();
      return render();
    }
    if (action === "demoAuto") {
      if (demoAuto) stopDemoAuto();
      else {
        demoAuto = true;
        demoPhase = "swap";
        scheduleDemo();
      }
      return render();
    }
    if (screen === "home" && action.startsWith("change:")) {
      stopDemoAuto();
      const [, key, amount] = action.split(":"),
        value = demo[key] + Number(amount);
      if (!["rows", "columns"].includes(key) || value < 2 || value > 9) return;
      const other = key === "rows" ? demo.columns : demo.rows;
      if (value * other > 72) return;
      demo[key] = value;
      demo.swapped = false;
      return render();
    }
    if (action === "start") return start();
    if (action === "continue") {
      stopDemoAuto();
      screen = "play";
      return render();
    }
    if (action === "home") {
      stopDemoAuto();
      screen = "home";
      return render();
    }
    if (action === "testSound") {
      soundEnabled = true;
      saveSound();
      return ding(true);
    }
    if (action === "retry") {
      return start(lesson.states.filter((s) => s.first && !s.first.correct).map((s) => s.q));
    }
    const s = lesson.states[lesson.index],
      q = s.q;
    if (action === "next") {
      lesson.index++;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (action.startsWith("stage:")) {
      const index = lesson.questions.findIndex((item) => item.stage === action.slice(6));
      if (index < 0) return;
      lesson.index = index;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "view") {
      s.view = s.view === "array" ? "groups" : "array";
      return render();
    }
    if (s.correct) return;
    if (action.startsWith("change:")) {
      const [, key, amount] = action.split(":"),
        value = s.draft[key] + Number(amount);
      if (value < 0 || value > 9) return;
      const g = key === "groups" ? value : q.kind === "build" ? s.draft.groups : q.unknown === "groups" ? value : q.groups,
        e = key === "each" ? value : q.kind === "build" ? s.draft.each : q.unknown === "each" ? value : q.each;
      if (g * e > 72) return;
      s.draft[key] = value;
      s.notice = "";
      return render();
    }
    if (action.startsWith("choose:")) {
      s.draft.value = Number(action.slice(7));
      s.notice = "";
      return render();
    }
    if (action === "hint") {
      s.hint = Math.min(3, s.hint + 1);
      s.assisted = true;
      return render();
    }
    if (action === "answer") {
      s.answerShown = true;
      s.assisted = true;
      return render();
    }
    if (action === "check") {
      const grade = E.grade(q, s.draft);
      if (!grade.valid) {
        s.notice = "Choose a number first.";
        return render();
      }
      if (!s.first) s.first = { correct: grade.correct, response: { ...s.draft } };
      s.correct = grade.correct;
      if (grade.correct) ding();
      else
        s.notice =
          q.kind === "build"
            ? "Match the groups and each count."
            : q.unknown === "each"
              ? "Use every item. Give each group the same number."
              : q.unknown === "groups"
                ? "Use every item. Keep the group size the same."
                : "Count all the equal groups.";
      render();
    }
  });
  document.getElementById("home").onclick = () => {
    stopDemoAuto();
    screen = "home";
    render();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopDemoAuto();
      if (screen === "home") render();
    }
  });
  window.addEventListener("pagehide", () => {
    stopDemoAuto();
    stopTone();
  });
  nextDemo();
  render();
})();
