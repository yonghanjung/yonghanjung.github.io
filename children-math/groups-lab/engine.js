(function (root) {
  "use strict";
  const ITEMS = ["dots", "beads", "pencils", "cards"];
  const PAIRS = [];
  for (let groups = 2; groups <= 9; groups++)
    for (let each = groups + 1; each <= 9; each++) if (groups * each >= 12 && groups * each <= 72) PAIRS.push([groups, each]);
  const key = (g, e) => [Math.min(g, e), Math.max(g, e)].join(":");
  const pick = (a, rng) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
  function question(stage, kind, groups, each, item = "dots") {
    const total = groups * each,
      unknown = kind === "build" ? "both" : kind === "share" ? "each" : kind === "pack" ? "groups" : "total";
    const container = item === "pencils" ? "tables" : item === "cards" ? "packs" : "bags";
    const label =
      unknown === "each"
        ? `${item} per ${container === "tables" ? "table" : container === "packs" ? "pack" : "bag"}`
        : unknown === "groups"
          ? container
          : item;
    let prompt =
      kind === "build"
        ? `Build ${groups} groups. Put ${each} ${item} in each.`
        : kind === "share"
          ? `Share all ${total} ${item} equally among ${groups} ${container}. How many ${item} are in each?`
          : kind === "pack"
            ? `Put all ${total} ${item} into ${container} of ${each}. How many full ${container} can you make?`
            : `There are ${groups} ${container} with ${each} ${item} in each. How many ${item} altogether?`;
    const answer = unknown === "both" ? { groups, each } : { value: unknown === "each" ? each : unknown === "groups" ? groups : total };
    const relation = unknown === "each" ? `${groups} × □ = ${total}` : unknown === "groups" ? `□ × ${each} = ${total}` : `${groups} × ${each} = □`;
    const hints =
      kind === "build"
        ? [`Count the groups, then the ${item} in each.`, `Every group needs the same number.`, `Groups × Each = Total.`]
        : [
            unknown === "each"
              ? `We need ${item} in ONE ${container === "tables" ? "table" : container === "packs" ? "pack" : "bag"}.`
              : unknown === "groups"
                ? `We need the NUMBER of ${container}.`
                : `We need ALL the ${item}.`,
            unknown === "each"
              ? `Give one to each group. Repeat.`
              : unknown === "groups"
                ? `Make one group of ${each}. Repeat.`
                : `Add equal groups of ${each}.`,
            relation,
          ];
    const values = [answer.value, groups, each, total, groups + each, Math.max(1, (answer.value || total) - 1), (answer.value || total) + 1];
    const options = [...new Set(values.filter((n) => Number.isInteger(n) && n > 0 && n <= 72))].slice(0, 4);
    for (let n = 1; options.length < 4; n++) if (!options.includes(n)) options.push(n);
    return {
      id: `${stage}-${kind}-${groups}-${each}-${item}`,
      stage,
      kind,
      groups,
      each,
      total,
      item,
      container,
      unknown,
      label,
      prompt,
      answer,
      hints,
      options,
      signature: key(groups, each),
    };
  }
  function generate(recent = [], rng = Math.random) {
    let pool = PAIRS.filter((p) => !recent.includes(key(...p)));
    if (pool.length < 6) pool = [...PAIRS];
    const types = [
      ["build", "build"],
      ["build", "build"],
      ["solve", "share"],
      ["solve", "pack"],
      ["story", "total"],
      ["story", rng() < 0.5 ? "share" : "pack"],
    ];
    return types.map(([stage, kind], i) => {
      const pair = pick(pool, rng);
      pool = pool.filter((p) => key(...p) !== key(...pair));
      const [g, e] = rng() < 0.5 ? pair : [pair[1], pair[0]];
      const q = question(stage, kind, g, e, stage === "story" ? (i === 4 ? "cards" : "beads") : ITEMS[i % ITEMS.length]);
      q.options = q.options
        .map((v) => ({ v, r: rng() }))
        .sort((a, b) => a.r - b.r)
        .map((x) => x.v);
      return q;
    });
  }
  function verify(q) {
    return !!(
      q &&
      ["build", "solve", "story"].includes(q.stage) &&
      ["build", "share", "pack", "total"].includes(q.kind) &&
      Number.isInteger(q.groups) &&
      q.groups >= 2 &&
      q.groups <= 9 &&
      Number.isInteger(q.each) &&
      q.each >= 2 &&
      q.each <= 9 &&
      q.total === q.groups * q.each &&
      q.total >= 12 &&
      q.total <= 72 &&
      q.total / q.groups === q.each &&
      q.total / q.each === q.groups &&
      q.signature === key(q.groups, q.each) &&
      q.unknown === (q.kind === "build" ? "both" : q.kind === "share" ? "each" : q.kind === "pack" ? "groups" : "total") &&
      JSON.stringify(q.answer) ===
        JSON.stringify(
          q.unknown === "both"
            ? { groups: q.groups, each: q.each }
            : { value: q.unknown === "each" ? q.each : q.unknown === "groups" ? q.groups : q.total }
        )
    );
  }
  function grade(q, draft) {
    if (!verify(q)) return { valid: false, correct: false };
    if (q.kind === "build") {
      const valid =
        Number.isInteger(draft.groups) && draft.groups > 0 && draft.groups <= 9 && Number.isInteger(draft.each) && draft.each > 0 && draft.each <= 9;
      return { valid, correct: valid && draft.groups === q.groups && draft.each === q.each };
    }
    const valid = Number.isInteger(draft.value) && draft.value > 0 && draft.value <= 72;
    return { valid, correct: valid && draft.value === q.answer.value };
  }
  function createRng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function summary(states) {
    const graded = states.filter((s) => s.first);
    return {
      total: graded.length,
      skipped: states.length - graded.length,
      correct: graded.filter((s) => s.first.correct).length,
      helped: graded.filter((s) => s.assisted).length,
      master: graded.length > 0 && graded.length === states.length && graded.every((s) => s.first.correct && !s.assisted),
    };
  }
  const api = { generate, question, verify, grade, summary, createRng, PAIRS, key };
  root.GroupsLab = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
