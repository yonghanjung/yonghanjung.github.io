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
  const api = Object.freeze({ decompose, gradeStep, BASES, TAKES, PAIRS, pairKey, isPracticePair, next });
  root.CountingSense = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
