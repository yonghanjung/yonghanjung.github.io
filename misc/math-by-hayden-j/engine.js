(function (root) {
  "use strict";
  const KEY = "haydenTouchDrill.v1",
    OPS = ["+", "−", "×", "÷"],
    DURATIONS = [3, 6, 9],
    LEVELS = ["easy", "medium", "difficult"];
  const integer = (low, high, rng = Math.random) => low + Math.floor(Math.min(0.999999, Math.max(0, rng())) * (high - low + 1));
  function operations(value) {
    if (typeof value === "string") {
      if (["+−", "+-", "mix", "addsub"].includes(value)) return ["+", "−"];
      value = [value === "-" ? "−" : value];
    }
    return Array.isArray(value) ? OPS.filter((op) => value.includes(op)) : [];
  }
  function operationLabel(value) {
    return operations(value).join(" ");
  }
  function shuffle(values, rng) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = integer(0, i, rng);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }
  function balancedOperations(ops, count, rng) {
    const order = shuffle([...ops], rng);
    return shuffle(
      Array.from({ length: count }, (_, i) => order[i % order.length]),
      rng
    );
  }
  function nextOperation(round, rng) {
    const counts = round.ops.map((op) => round.records.filter((x) => x.problem.op === op).length);
    const minimum = Math.min(...counts);
    const choices = round.ops.filter((_, i) => counts[i] === minimum);
    return choices[integer(0, choices.length - 1, rng)];
  }
  const regroupPools = new Map();
  function regroupPair(op, sumLimit, regroup, rng) {
    const key = `${op}:${sumLimit}`;
    if (!regroupPools.has(key)) {
      const pools = [[], []];
      for (let a = 1; a <= sumLimit; a++) {
        for (let b = op === "+" ? 1 : 0; b <= (op === "+" ? sumLimit - a : a - 1); b++) {
          const crosses = op === "+" ? (a % 10) + (b % 10) >= 10 : a % 10 < b % 10;
          pools[Number(crosses)].push([a, b]);
        }
      }
      regroupPools.set(key, pools);
    }
    const pool = regroupPools.get(key)[Number(regroup)];
    const [a, b] = pool[integer(0, pool.length - 1, rng)];
    return { a, b, op, answer: op === "+" ? a + b : a - b };
  }
  function problem(op, rng = Math.random, sumLimit = 10, difficulty = "easy") {
    if (!OPS.includes(op)) throw new Error("Invalid operation");
    if (op === "+" && ["medium", "difficult"].includes(difficulty)) {
      return regroupPair(op, sumLimit, rng() < 0.95, rng);
    }
    if (op === "+") {
      const sum = integer(2, sumLimit, rng),
        a = integer(1, sum - 1, rng);
      return { a, b: sum - a, op, answer: sum };
    }
    if (op === "−") {
      const roll = rng();
      if (roll < 0.05) {
        const a = integer(1, sumLimit, rng);
        return { a, b: a, op, answer: 0 };
      }
      if (["medium", "difficult"].includes(difficulty)) {
        return regroupPair(op, sumLimit, true, rng);
      }
      let index = integer(0, (sumLimit * (sumLimit + 1)) / 2 - 1, rng),
        a = 1;
      while (index >= a) {
        index -= a;
        a++;
      }
      return { a, b: index, op, answer: a - index };
    }
    const a = op === "÷" ? integer(1, 9, rng) : integer(2, 9, rng),
      b = integer(2, 9, rng);
    return op === "×" ? { a, b, op, answer: a * b } : { a: a * b, b, op, answer: a };
  }
  function initial() {
    return {
      version: 1,
      settings: { ops: ["×"], seconds: 6, difficulty: "easy", difficultLimit: 100, count: 10, customCount: 10 },
      active: null,
      history: [],
    };
  }
  function sumLimit(settings) {
    return settings.difficulty === "easy" ? 10 : settings.difficulty === "medium" ? 20 : settings.difficultLimit;
  }
  function customCount(value) {
    const s = String(value).trim();
    return /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 999 ? Number(s) : null;
  }
  function makeRound(ops, seconds, problems, options = {}) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      op: ops.join(""),
      ops: [...ops],
      seconds,
      difficulty: options.difficulty || "none",
      sumLimit: options.sumLimit ?? null,
      unlimited: Boolean(options.unlimited),
      length: options.unlimited ? null : problems.length,
      index: 0,
      phase: "ready",
      remaining: seconds * 1000,
      deadline: null,
      started: new Date().toISOString(),
      records: problems.map((p) => ({ problem: { ...p }, result: null })),
    };
  }
  function start(state, rng = Math.random) {
    const s = state.settings,
      unlimited = s.count === "unlimited",
      count = s.count === "custom" ? customCount(s.customCount) : s.count;
    if (!unlimited && (!Number.isInteger(count) || count < 1 || count > 999)) return false;
    const ops = operations(s.ops),
      limit = sumLimit(s),
      hasAddSub = ops.some((op) => ["+", "−"].includes(op));
    if (!ops.length) return false;
    state.active = makeRound(
      ops,
      s.seconds,
      balancedOperations(ops, unlimited ? 1 : count, rng).map((op) => problem(op, rng, limit, s.difficulty)),
      {
        unlimited,
        difficulty: hasAddSub ? s.difficulty : "none",
        sumLimit: hasAddSub ? limit : null,
      }
    );
    return state.active;
  }
  function record(round) {
    return round && round.records[round.index];
  }
  function begin(round, now) {
    if (!round || round.phase !== "ready") return false;
    round.deadline = now + round.remaining;
    round.phase = "running";
    return true;
  }
  function resume(round, now) {
    if (!round || round.phase !== "paused") return false;
    round.deadline = now + round.remaining;
    round.phase = "running";
    return true;
  }
  function remaining(round, now) {
    return round && round.phase === "running" ? Math.max(0, round.deadline - now) : round ? round.remaining : 0;
  }
  function grade(round, input, now, questionIndex = round ? round.index : -1) {
    if (!round || round.phase !== "running" || round.index !== questionIndex || record(round).result) return { ignored: true };
    const expired = now >= round.deadline,
      text = String(input).trim();
    if (!expired && !/^\d+$/.test(text)) return { invalid: true };
    const answer = /^\d+$/.test(text) ? Number(text) : null;
    const result = {
      status: expired ? "timeout" : answer === record(round).problem.answer ? "correct" : "wrong",
      answer,
      expected: record(round).problem.answer,
      elapsed: Math.max(0, Math.min(round.seconds * 1000, round.seconds * 1000 - remaining(round, now))),
    };
    record(round).result = result;
    round.phase = "feedback";
    round.remaining = 0;
    round.deadline = null;
    return result;
  }
  function pause(round, now) {
    if (!round || round.phase !== "running") return false;
    if (now >= round.deadline) return grade(round, "", now);
    round.remaining = remaining(round, now);
    round.deadline = null;
    round.phase = "paused";
    return true;
  }
  function close(state) {
    const r = state.active;
    if (!r || r.phase === "complete") return false;
    r.phase = "complete";
    r.deadline = null;
    r.remaining = 0;
    r.finished = new Date().toISOString();
    r.index = Math.max(0, r.records.length - 1);
    r.length = r.records.length;
    state.history.push(JSON.parse(JSON.stringify(r)));
    state.history = state.history.slice(-40);
    return true;
  }
  function next(state, rng = Math.random) {
    const r = state.active;
    if (!r || r.phase !== "feedback") return false;
    if (!r.unlimited && r.index === r.records.length - 1) return close(state);
    if (r.unlimited) r.records.push({ problem: problem(nextOperation(r, rng), rng, r.sumLimit || 10, r.difficulty), result: null });
    r.index++;
    r.phase = "ready";
    r.remaining = r.seconds * 1000;
    r.deadline = null;
    return true;
  }
  function finish(state, now, input = "") {
    const r = state.active;
    if (!r || !r.unlimited || r.phase === "complete") return false;
    if (r.phase === "running" && Number.isFinite(now) && now >= r.deadline) grade(r, input, now);
    r.records = r.records.filter((x) => x.result !== null);
    return close(state);
  }
  function isDrillProblem(p) {
    if (!validProblem(p)) return false;
    if (p.op === "×") return p.a >= 2 && p.a <= 9 && p.b >= 2 && p.b <= 9;
    if (p.op === "÷") return p.b >= 2 && p.b <= 9 && p.answer >= 1 && p.answer <= 9;
    return true;
  }
  function retryProblems(round) {
    return (round?.records || []).filter((x) => x.result && x.result.status !== "correct" && isDrillProblem(x.problem)).map((x) => x.problem);
  }
  function retry(state) {
    const r = state.active;
    if (!r || r.phase !== "complete") return false;
    const missed = retryProblems(r);
    if (!missed.length) return false;
    state.active = makeRound(r.ops, r.seconds, missed, {
      difficulty: r.difficulty,
      sumLimit: r.sumLimit,
    });
    return true;
  }
  function summary(r) {
    const graded = r.records.filter((x) => x.result);
    const correct = graded.filter((x) => x.result.status === "correct").length,
      wrong = graded.filter((x) => x.result.status === "wrong").length,
      timeout = graded.filter((x) => x.result.status === "timeout").length;
    return { correct, wrong, timeout, total: graded.length, master: graded.length > 0 && correct === graded.length && wrong === 0 && timeout === 0 };
  }
  function validProblem(p) {
    if (!p || !["+", "−", "×", "÷"].includes(p.op) || !Number.isInteger(p.a) || !Number.isInteger(p.b) || !Number.isInteger(p.answer)) return false;
    if (p.op === "−") return p.a >= p.b && p.b >= 0 && p.answer === p.a - p.b;
    return (
      p.a > 0 && p.b > 0 && p.answer > 0 && (p.op === "+" ? p.a + p.b === p.answer : p.op === "×" ? p.a * p.b === p.answer : p.a === p.b * p.answer)
    );
  }
  function validRound(r) {
    const ops = operations(r?.ops ?? r?.op);
    return (
      r &&
      typeof r.id === "string" &&
      ops.length > 0 &&
      DURATIONS.includes(r.seconds) &&
      Array.isArray(r.records) &&
      Number.isInteger(r.index) &&
      r.index >= 0 &&
      ["ready", "running", "paused", "feedback", "complete"].includes(r.phase) &&
      (r.records.length === 0 ? r.phase === "complete" && r.index === 0 : r.index < r.records.length) &&
      r.records.every(
        (x) =>
          x &&
          validProblem(x.problem) &&
          ops.includes(x.problem.op) &&
          (x.result === null || (x.result && ["correct", "wrong", "timeout"].includes(x.result.status) && x.result.expected === x.problem.answer))
      ) &&
      r.records.slice(0, r.index).every((x) => x.result !== null) &&
      (r.phase === "complete"
        ? r.records.every((x) => x.result !== null)
        : r.phase === "feedback"
          ? r.records[r.index].result !== null
          : r.records[r.index].result === null)
    );
  }
  function normalizeRound(raw) {
    const r = JSON.parse(JSON.stringify(raw));
    r.ops = operations(r.ops ?? r.op);
    r.op = r.ops.join("");
    delete r.multiplication;
    r.unlimited = Boolean(r.unlimited);
    const hasAddSub = r.ops.some((op) => ["+", "−"].includes(op));
    if (!r.difficulty) r.difficulty = hasAddSub ? "legacy" : "none";
    if (!Number.isInteger(r.sumLimit)) r.sumLimit = hasAddSub ? 40 : null;
    r.length = r.unlimited && r.phase !== "complete" ? null : r.records.length;
    return r;
  }
  function hydrate(raw) {
    const s = initial();
    if (!raw || raw.version !== 1) return s;
    const set = raw.settings || {};
    const ops = operations(set.ops ?? set.op ?? set.mode);
    if (ops.length) s.settings.ops = ops;
    if (DURATIONS.includes(set.seconds)) s.settings.seconds = set.seconds;
    if (LEVELS.includes(set.difficulty)) s.settings.difficulty = set.difficulty;
    if (Number.isInteger(set.difficultLimit) && set.difficultLimit >= 30 && set.difficultLimit <= 100 && set.difficultLimit % 10 === 0)
      s.settings.difficultLimit = set.difficultLimit;
    if ([10, 15, 20, "custom", "unlimited"].includes(set.count)) s.settings.count = set.count;
    const custom = customCount(set.customCount);
    if (custom) s.settings.customCount = custom;
    if (Array.isArray(raw.history))
      s.history = raw.history
        .filter((r) => validRound(r) && r.phase === "complete")
        .slice(-40)
        .map(normalizeRound);
    if (validRound(raw.active)) {
      s.active = normalizeRound(raw.active);
      const r = s.active;
      r.records.forEach((x, index) => {
        if (x.result === null && !isDrillProblem(x.problem)) {
          x.problem = problem(x.problem.op);
          if (index === r.index) r.remaining = r.seconds * 1000;
        }
      });
      if (["running", "ready", "paused"].includes(r.phase)) {
        r.phase = "paused";
        r.remaining = Number.isFinite(r.remaining) ? Math.max(0, Math.min(r.seconds * 1000, r.remaining)) : 0;
        r.deadline = null;
      }
    }
    return s;
  }
  const api = {
    KEY,
    OPS,
    DURATIONS,
    LEVELS,
    operations,
    operationLabel,
    problem,
    initial,
    sumLimit,
    customCount,
    start,
    record,
    begin,
    resume,
    remaining,
    grade,
    pause,
    next,
    finish,
    retry,
    retryProblems,
    isDrillProblem,
    summary,
    hydrate,
  };
  root.Drill = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
