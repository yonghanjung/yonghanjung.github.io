(function (root) {
  "use strict";
  function decompose(base, take) {
    if (!Number.isInteger(base) || base < 200 || base > 900 || base % 100 || !Number.isInteger(take) || take < 1 || take > 99) {
      throw new RangeError("Use a whole hundred from 200 to 900 and take 1 to 99.");
    }
    const kept = base - 100,
      subtotal = 100 - take;
    return Object.freeze({ base, take, kept, subtotal, total: kept + subtotal });
  }
  function gradeStep(model, step, input) {
    if (![0, 1].includes(step)) throw new RangeError("Invalid step");
    const text = String(input).trim();
    if (!/^\d+$/.test(text)) return { valid: false, correct: false };
    return { valid: true, correct: Number(text) === (step === 0 ? model.subtotal : model.total) };
  }
  const BASES = Object.freeze(Array.from({ length: 8 }, (_, i) => (i + 2) * 100));
  const TAKES = Object.freeze([...Array.from({ length: 9 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => (i + 1) * 10)]);
  const PAIRS = Object.freeze(BASES.flatMap((base) => TAKES.map((take) => Object.freeze({ base, take }))));
  const pairKey = (model) => `${model.base}:${model.take}`;
  const isPracticePair = (base, take) => BASES.includes(base) && TAKES.includes(take);
  function secureIndex(length) {
    const limit = Math.floor(4294967296 / length) * length,
      values = new Uint32Array(1);
    do {
      root.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % length;
  }
  function next(recent = [], chooseIndex = secureIndex) {
    const excluded = new Set(recent.slice(-20));
    const available = PAIRS.filter((pair) => !excluded.has(pairKey(pair)));
    const index = chooseIndex(available.length);
    if (!Number.isInteger(index) || index < 0 || index >= available.length) throw new RangeError("Invalid selection");
    const pair = available[index];
    return decompose(pair.base, pair.take);
  }
  // Level 2 is additive: the original 144-pair API remains unchanged.
  const PLACES = Object.freeze([1000, 100, 10, 1]);
  const PLACE_NAMES = Object.freeze(["thousand", "hundred", "ten", "one"]);
  const LEVEL2_PAIRS = Object.freeze(
    [100, 1000].flatMap((unit) =>
      Array.from({ length: 9 }, (_, h) => h + 1).flatMap((h) =>
        Array.from({ length: 8 }, (_, r) => r + 1).flatMap((r) =>
          Array.from({ length: 10 }, (_, t) => t).flatMap((t) =>
            Array.from({ length: 9 - r }, (_, u) => Object.freeze({ base: h * unit + r, take: 10 * t + r + 1 + u }))
          )
        )
      )
    )
  );
  function isLevel2Pair(base, take) {
    if (!Number.isInteger(base) || !Number.isInteger(take) || take < 1 || take > 99) return false;
    const unit = base < 1000 ? 100 : 1000,
      h = Math.floor(base / unit),
      r = base % unit;
    return h >= 1 && h <= 9 && r >= 1 && r <= 8 && take % 10 > r;
  }
  const amount = (counts) => counts.reduce((sum, count, i) => sum + count * PLACES[i], 0);
  function regroup(base, take) {
    if (!isLevel2Pair(base, take)) throw new RangeError("Use a Level 2 practice pair.");
    const initial = PLACES.map((place) => Math.floor(base / place) % 10),
      counts = [...initial],
      trades = [];
    let donor = 2;
    while (counts[donor] === 0) donor--;
    for (let from = donor; from < 3; from++) {
      const before = [...counts];
      counts[from]--;
      counts[from + 1] += 10;
      if (amount(counts) !== base) throw new Error("Trade must preserve value.");
      trades.push(Object.freeze({ from, to: from + 1, before: Object.freeze(before), after: Object.freeze([...counts]) }));
    }
    const ones = counts[3] - (take % 10),
      tens = counts[2] * 10 - Math.floor(take / 10) * 10,
      kept = counts[0] * 1000 + counts[1] * 100,
      total = kept + tens + ones;
    const tasks = [{ kind: "ones", prompt: `${counts[3]} − ${take % 10} =`, unit: "ones", answer: ones }];
    if (take >= 10) tasks.push({ kind: "tens", prompt: `${counts[2] * 10} − ${Math.floor(take / 10) * 10} =`, unit: "value in tens", answer: tens });
    const parts = [kept, tens, ones].filter((value) => value > 0);
    tasks.push({ kind: "final", prompt: parts.length > 1 ? `${parts.join(" + ")} =` : `${base} − ${take} =`, unit: "total", answer: total });
    return Object.freeze({
      base,
      take,
      initial: Object.freeze(initial),
      trades: Object.freeze(trades),
      regrouped: Object.freeze([...counts]),
      ones,
      tens,
      kept,
      total,
      tasks: Object.freeze(tasks.map(Object.freeze)),
    });
  }
  function gradeTask(model, index, input) {
    if (!Number.isInteger(index) || index < 0 || index >= model.tasks.length) throw new RangeError("Invalid task.");
    const text = String(input).trim();
    if (!/^\d{1,4}$/.test(text)) return { valid: false, correct: false };
    return { valid: true, correct: Number(text) === model.tasks[index].answer };
  }
  function nextLevel2(recent = [], chooseIndex = secureIndex) {
    const excluded = new Set(recent.slice(-20)),
      available = LEVEL2_PAIRS.filter((pair) => !excluded.has(pairKey(pair)));
    const index = chooseIndex(available.length);
    if (!Number.isInteger(index) || index < 0 || index >= available.length) throw new RangeError("Invalid selection");
    return regroup(available[index].base, available[index].take);
  }
  const api = Object.freeze({
    decompose,
    gradeStep,
    BASES,
    TAKES,
    PAIRS,
    pairKey,
    isPracticePair,
    next,
    PLACES,
    PLACE_NAMES,
    LEVEL2_PAIRS,
    isLevel2Pair,
    amount,
    regroup,
    gradeTask,
    nextLevel2,
  });
  root.CountingSense = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
