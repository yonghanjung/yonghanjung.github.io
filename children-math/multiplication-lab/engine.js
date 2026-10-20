(function (root) {
  "use strict";
  const MODES = ["two", "one"];
  function split(n) {
    return n < 10 ? [n] : [Math.floor(n / 10) * 10, n % 10];
  }
  function key(a, b) {
    return [a, b].sort((x, y) => x - y).join("x");
  }
  function lesson(a, b, mode = "two") {
    if (!MODES.includes(mode) || !Number.isInteger(a) || a < 1 || a > 99 || !Number.isInteger(b) || b < 1 || b > (mode === "one" ? 9 : 99))
      throw Error("Use whole numbers from 1 to 99, with a one-digit second number in one-digit mode.");
    const x = split(a),
      y = mode === "one" ? [b] : split(b);
    const parts = y.flatMap((height, row) =>
      x.map((width, column) => ({ id: row * 2 + column, width, height, x: column ? x[0] : 0, y: row ? y[0] : 0, value: width * height, row, column }))
    );
    const rows = y.map((height, row) => ({ height, value: a * height, parts: parts.filter((p) => p.row === row) }));
    return { a, b, mode, x, y, parts, rows, total: a * b };
  }
  function freshSeed() {
    try {
      const a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      return a[0];
    } catch (_) {
      return Math.floor(Math.random() * 4294967296);
    }
  }
  function createRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function nextExample(mode, recent = [], random = Math.random) {
    if (!MODES.includes(mode)) throw Error("Unknown mode");
    const seen = new Set(recent.slice(-20));
    const choices = [];
    for (let a = 1; a <= 99; a++) for (let b = 1; b <= (mode === "one" ? 9 : 99); b++) if (!seen.has(key(a, b))) choices.push([a, b]);
    const pair = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    return lesson(pair[0], pair[1], mode);
  }
  const api = { lesson, split, key, freshSeed, createRng, nextExample };
  root.MultiplyLab = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
