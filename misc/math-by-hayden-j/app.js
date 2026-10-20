(() => {
  "use strict";
  const D = Drill,
    app = document.getElementById("app");
  let state = D.initial(),
    screen = "home",
    entry = "",
    frame = null,
    advance = null,
    notice = "",
    customDraft = null,
    soundEnabled = true,
    audio = null,
    toneToken = 0,
    sessionType = null;
  const soundKey = `${D.KEY}.sound`,
    celebrations = ["🌟", "🎉", "🚀", "🏅"];
  try {
    soundEnabled = localStorage.getItem(soundKey) !== "off";
  } catch (_) {}
  try {
    state = D.hydrate(JSON.parse(localStorage.getItem(D.KEY)));
  } catch (_) {}
  const now = () => performance.now();
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
  function save() {
    try {
      const snap = JSON.parse(JSON.stringify(state));
      if (snap.active?.phase === "running") snap.active.remaining = D.remaining(state.active, now());
      localStorage.setItem(D.KEY, JSON.stringify(snap));
    } catch (_) {
      notice = "Not saved";
    }
  }
  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(advance);
    frame = null;
    advance = null;
  }
  function button(text, action, cls = "", attrs = "") {
    return `<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
  }
  function render() {
    stop();
    updateSound();
    document.getElementById("home").hidden = screen === "home";
    if (screen === "home") home();
    else if (state.active?.phase === "complete") complete();
    else if (state.active) play();
    else {
      screen = "home";
      home();
    }
  }
  function home() {
    const s = state.settings,
      r = state.active,
      canResume = r && r.phase !== "complete",
      custom = s.count === "custom";
    app.innerHTML = `<section class="setup"><div><span class="label">Math</span><div class="choices operations" role="group" aria-label="Operations">${D.OPS.map(
      (op) =>
        button(
          op,
          `op:${op}`,
          s.ops.includes(op) ? "selected" : "",
          `aria-label="${
            op === "+" ? "Addition" : op === "−" ? "Subtraction" : op === "×" ? "Multiplication" : "Division"
          }" aria-pressed="${s.ops.includes(op)}"`
        )
    ).join(
      ""
    )}</div></div><div><span class="label">Time</span><div class="choices time" role="group" aria-label="Seconds per question">${D.DURATIONS.map(
      (sec) => button(`${sec}s`, `seconds:${sec}`, s.seconds === sec ? "selected" : "", `aria-pressed="${s.seconds === sec}"`)
    ).join("")}</div></div>${
      s.ops.some((op) => ["+", "−"].includes(op))
        ? `<div class="difficulty"><span class="label">${D.operationLabel(
            s.ops.filter((op) => ["+", "−"].includes(op))
          )} Level</span><div class="choices levels" role="group" aria-label="${
            s.ops.includes("+") && s.ops.includes("−") ? "Addition and subtraction" : s.ops.includes("+") ? "Addition" : "Subtraction"
          } difficulty">${D.LEVELS.map((level) =>
            button(
              `${level[0].toUpperCase() + level.slice(1)}<small>≤ ${level === "easy" ? 10 : level === "medium" ? 20 : s.difficultLimit}</small>`,
              `level:${level}`,
              s.difficulty === level ? "selected" : "",
              `aria-label="${level[0].toUpperCase() + level.slice(1)}" aria-pressed="${s.difficulty === level}"`
            )
          ).join("")}</div>${
            s.difficulty === "difficult"
              ? `<div class="limit-row"><label for="sumLimit">Range ≤</label><select id="sumLimit" aria-label="Difficult range limit">${[
                  30, 40, 50, 60, 70, 80, 90, 100,
                ]
                  .map((n) => `<option value="${n}" ${s.difficultLimit === n ? "selected" : ""}>${n}</option>`)
                  .join("")}</select></div>`
              : ""
          }</div>`
        : ""
    }<div class="count-section"><span class="label">Questions</span><div class="choices counts" role="group" aria-label="Round length">${[
      10,
      15,
      20,
      "custom",
      "unlimited",
    ]
      .map((n) =>
        button(
          n === "custom" ? "Custom" : n === "unlimited" ? "∞" : n,
          `count:${n}`,
          s.count === n ? "selected" : "",
          `aria-label="${n === "unlimited" ? "Unlimited" : n === "custom" ? "Custom" : n + " questions"}" aria-pressed="${s.count === n}"`
        )
      )
      .join("")}</div>${
      custom
        ? `<div class="custom-row"><input id="customCount" type="text" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="Custom question count"><span>1–999</span></div>`
        : ""
    }</div><div class="start-buttons">${
      canResume ? button("Resume", "continue", "soft") : r?.phase === "complete" ? button("Results", "continue", "soft") : ""
    }${button("Start", "start", "primary")}</div>${button("Test sound", "testSound", "soft")}${
      notice ? `<div class="small-info" role="alert">${notice}</div>` : ""
    }</section>`;
    if (custom) {
      const input = document.getElementById("customCount");
      input.value = customDraft ?? String(s.customCount);
      input.addEventListener("input", () => {
        customDraft = input.value;
        notice = "";
      });
    }
    const limit = document.getElementById("sumLimit");
    if (limit)
      limit.addEventListener("change", () => {
        s.difficultLimit = Number(limit.value);
        save();
        render();
      });
  }
  function play() {
    const r = state.active,
      p = D.record(r).problem,
      paused = r.phase === "paused",
      feedback = r.phase === "feedback",
      result = D.record(r).result;
    app.innerHTML = `<section class="game ${feedback ? "feedback" : ""}"><div class="game-bar"><span class="counter">${r.index + 1} / ${
      r.unlimited ? "∞" : r.records.length
    }</span><span class="badge">${p.op} · ${r.seconds}s</span>${r.unlimited ? button("Finish", "finish", "finish soft") : ""}${button(
      paused ? "Resume" : "Pause",
      paused ? "resume" : "pause",
      "pause soft",
      feedback ? "disabled" : ""
    )}</div><div class="question" aria-live="polite">${
      paused
        ? `<div class="paused-label">Paused</div>${button("Resume", "resume", "primary")}`
        : feedback
          ? `<div class="result ${result.status === "correct" ? "" : "wrong"}">${
              result.status === "correct"
                ? `<span aria-hidden="true">${celebrations[r.index % celebrations.length]}</span><span class="sr-only">Correct</span>`
                : result.status === "timeout"
                  ? "Time"
                  : "Try again"
            }</div><div class="answer-line">${p.a} ${p.op} ${p.b} = ${p.answer}</div>`
          : `<div class="timer-track" role="progressbar" aria-label="Time remaining" aria-valuemin="0" aria-valuemax="${
              r.seconds
            }"><div id="timerFill" class="timer-fill"></div></div><span id="timerLabel" class="timer-label">${(D.remaining(r, now()) / 1000).toFixed(
              1
            )}s</span><div class="expression">${p.a} ${p.op} ${p.b} =</div><div id="answer" class="answer" role="status" aria-label="Answer">${
              entry || "?"
            }</div><div id="notice" class="toast">${notice}</div>`
    }</div><div class="pad" role="group" aria-label="Answer keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"]
      .map((x) =>
        button(
          x,
          `key:${x}`,
          x === "✓" ? "primary action" : x === "⌫" ? "soft action" : "",
          `${paused || feedback ? "disabled" : ""} ${
            x === "✓" ? 'aria-label="Check answer"' : x === "⌫" ? 'aria-label="Delete"' : `aria-label="${x}"`
          }`
        )
      )
      .join("")}</div></section>`;
    if (r.phase === "ready") {
      const id = r.id,
        index = r.index;
      frame = requestAnimationFrame(() => {
        if (screen !== "play" || document.hidden || state.active?.id !== id || r.index !== index) return;
        if (D.begin(r, now())) {
          save();
          tick();
        }
      });
    } else if (r.phase === "running") tick();
    else if (feedback) {
      const id = r.id,
        index = r.index;
      advance = setTimeout(
        () => {
          if (screen !== "play" || document.hidden || state.active?.id !== id || r.index !== index) return;
          D.next(state);
          entry = "";
          notice = "";
          save();
          render();
        },
        result.status === "correct" ? 500 : 1100
      );
    }
  }
  function tick() {
    const r = state.active;
    if (screen !== "play" || !r || r.phase !== "running") return;
    const ms = D.remaining(r, now());
    if (ms <= 0) {
      D.grade(r, entry, now(), r.index);
      save();
      render();
      return;
    }
    const fill = document.getElementById("timerFill"),
      label = document.getElementById("timerLabel");
    if (fill) {
      fill.style.transform = `scaleX(${ms / (r.seconds * 1000)})`;
      fill.classList.toggle("urgent", ms < 1000);
      fill.parentElement.setAttribute("aria-valuenow", (ms / 1000).toFixed(1));
    }
    if (label) label.textContent = `${(ms / 1000).toFixed(1)}s`;
    frame = requestAnimationFrame(tick);
  }
  function complete() {
    const r = state.active,
      m = D.summary(r),
      wrong = r.records.filter((x) => x.result && x.result.status !== "correct");
    app.innerHTML = `<section class="summary"><span class="label">${D.operationLabel(r.ops)} · ${r.seconds}s${
      r.ops.some((op) => ["+", "−"].includes(op)) ? ` · ${D.operationLabel(r.ops.filter((op) => ["+", "−"].includes(op)))} ≤ ${r.sumLimit}` : ""
    }</span>${m.master ? '<div class="master">Master! ✦</div>' : ""}<div class="summary-score">${m.correct}<small> / ${
      m.total
    }</small></div><div class="summary-actions">${D.retryProblems(r).length ? button("Practice mistakes", "retry", "soft") : ""}${button(
      "New round",
      "start",
      "primary"
    )}</div>${
      wrong.length
        ? `<div class="notes"><span class="label">Wrong answers · ${wrong.length}</span>${wrong
            .map(
              (x) =>
                `<div class="note-row"><strong>${x.problem.a} ${x.problem.op} ${x.problem.b}</strong><span><b class="miss">${
                  x.result.status === "timeout" ? "Time" : x.result.answer
                }</b><span class="note-arrow">→</span><b class="correct">${x.problem.answer}</b></span></div>`
            )
            .join("")}</div>`
        : ""
    }${button("Math & time", "home", "soft")}</section>`;
  }
  function pause() {
    const r = state.active;
    if (r?.phase === "running") {
      D.pause(r, now());
      save();
    } else if (r?.phase === "ready") {
      r.phase = "paused";
      save();
    }
  }
  function submit() {
    const r = state.active;
    if (!r) return;
    const out = D.grade(r, entry, now(), r.index);
    if (out.invalid) {
      notice = "?";
      document.getElementById("notice").textContent = notice;
      return;
    }
    if (out.ignored) return;
    if (out.status === "correct") ding();
    save();
    notice = "";
    render();
  }
  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const a = b.dataset.action;
    if (a.startsWith("op:")) {
      const op = a.slice(3),
        selected = state.settings.ops;
      if (selected.includes(op) && selected.length === 1) {
        notice = "Choose at least one.";
      } else {
        state.settings.ops = D.operations(selected.includes(op) ? selected.filter((value) => value !== op) : [...selected, op]);
        notice = "";
      }
      save();
      render();
    } else if (a.startsWith("seconds:")) {
      state.settings.seconds = Number(a.slice(8));
      save();
      render();
    } else if (a.startsWith("level:")) {
      state.settings.difficulty = a.slice(6);
      notice = "";
      save();
      render();
    } else if (a.startsWith("count:")) {
      const value = a.slice(6);
      state.settings.count = ["custom", "unlimited"].includes(value) ? value : Number(value);
      notice = "";
      save();
      render();
    } else if (a === "testSound") {
      soundEnabled = true;
      saveSound();
      ding(true);
    } else if (a === "start") {
      if (state.settings.count === "custom") {
        const value = D.customCount(customDraft ?? state.settings.customCount);
        if (value === null) {
          notice = "1–999";
          return render();
        }
        state.settings.customCount = value;
      }
      if (!D.start(state)) return;
      screen = "play";
      entry = "";
      notice = "";
      save();
      render();
    } else if (a === "continue") {
      screen = "play";
      entry = "";
      notice = "";
      render();
    } else if (a === "resume") {
      if (D.resume(state.active, now())) {
        screen = "play";
        entry = "";
        notice = "";
        save();
        render();
      }
    } else if (a === "pause") {
      pause();
      render();
    } else if (a === "home") {
      pause();
      screen = "home";
      render();
    } else if (a === "finish") {
      if (D.finish(state, now(), entry)) {
        entry = "";
        notice = "";
        save();
        render();
      }
    } else if (a === "retry") {
      if (D.retry(state)) {
        screen = "play";
        entry = "";
        notice = "";
        save();
        render();
      }
    } else if (a.startsWith("key:")) {
      if (state.active?.phase !== "running") return;
      const key = a.slice(4);
      if (key === "✓") return submit();
      if (D.remaining(state.active, now()) <= 0) {
        D.grade(state.active, entry, now());
        save();
        return render();
      }
      if (key === "⌫") entry = entry.slice(0, -1);
      else if (entry.length < 3) entry += key;
      notice = "";
      document.getElementById("answer").textContent = entry || "?";
      document.getElementById("notice").textContent = "";
      save();
    }
  });
  document.getElementById("home").onclick = () => {
    pause();
    screen = "home";
    render();
  };
  document.addEventListener("keydown", (e) => {
    if (screen !== "play" || state.active?.phase !== "running") return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      app.querySelector(`[data-action="key:${e.key}"]`)?.click();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      app.querySelector('[data-action="key:⌫"]')?.click();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pause();
      stop();
    } else render();
  });
  window.addEventListener("pagehide", () => {
    stopTone();
    pause();
    save();
    stop();
  });
  render();
})();
