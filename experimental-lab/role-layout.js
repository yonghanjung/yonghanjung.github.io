/* Layout changes coordinates and bends only; it never changes nodes or edges. */
window.RoleLayout = (() => {
  const radius = 29,
    point = (a, b, t) => ({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * b.x + t * t * b.to.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * b.y + t * t * b.to.y,
    });
  const distance = (p, a, b) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const cross = (a, b, c, d) => {
    const eps = 1e-7,
      side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
      on = (p, q, r) =>
        Math.abs(side(p, q, r)) <= eps &&
        r.x >= Math.min(p.x, q.x) - eps &&
        r.x <= Math.max(p.x, q.x) + eps &&
        r.y >= Math.min(p.y, q.y) - eps &&
        r.y <= Math.max(p.y, q.y) + eps;
    const x = side(a, b, c),
      y = side(a, b, d),
      z = side(c, d, a),
      w = side(c, d, b);
    return (x * y < -eps && z * w < -eps) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  };
  function path(a, b, bend) {
    const q = { x: (a.x + b.x) / 2 + (bend?.x || 0), y: (a.y + b.y) / 2 + (bend?.y || 0), to: b };
    return Array.from({ length: 25 }, (_, i) => point(a, q, i / 24));
  }
  function metrics(ns, es, bs) {
    const by = Object.fromEntries(ns.map((n) => [n.name, n]));
    const paths = es.map((e) => ({ e, p: path(by[e[0]], by[e[1]], bs.get(JSON.stringify(e))) }));
    let overlaps = 0,
      hits = 0,
      crossings = 0;
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) if (Math.hypot(ns[i].x - ns[j].x, ns[i].y - ns[j].y) < radius * 2 + 8) overlaps++;
    for (const { e, p } of paths) for (const n of ns) if (!e.includes(n.name) && p.some((q, i) => i && distance(n, p[i - 1], q) < radius + 7)) hits++;
    for (let i = 0; i < paths.length; i++)
      for (let j = i + 1; j < paths.length; j++) {
        if (paths[i].e.some((n) => paths[j].e.includes(n))) continue;
        let found = false;
        for (let k = 1; k < 25 && !found; k++)
          for (let l = 1; l < 25; l++)
            if (cross(paths[i].p[k - 1], paths[i].p[k], paths[j].p[l - 1], paths[j].p[l])) {
              found = true;
              break;
            }
        if (found) crossings++;
      }
    return { nodeOverlaps: overlaps, edgeNodeHits: hits, properCrossings: crossings, score: overlaps * 10000 + hits * 1000 + crossings * 30 };
  }
  function arrange(ns, es, roles = {}) {
    const large = ns.length > 24;
    const columns = new Map();
    const fallback = Object.fromEntries(ns.map((n) => [n.name, 0]));
    for (let pass = 0; pass < ns.length; pass++) for (const [a, b] of es) fallback[b] = Math.max(fallback[b], fallback[a] + 1);
    for (const n of ns) {
      const col = roles[n.name]?.column ?? (roles.__sequential ? roles.__columns : fallback[n.name]);
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col).push(n.name);
    }
    const count = roles.__columns || Math.max(1, ...[...columns.keys()].map((k) => k + 1));
    for (let k = 0; k < count; k++) if (!columns.has(k)) columns.set(k, []);
    const referenceMode = !roles.__sequential && roles.__structure && !ns.some((n) => !roles[n.name]),
      groupCount = (key) => ns.filter((n) => roles[n.name]?.role === key).length;
    const keys = [...columns.keys()].sort((a, b) => a - b),
      width = Math.max(900, keys.length * 210 + 120, referenceMode ? groupCount("c") * 135 + 120 : 0),
      height = Math.max(
        large && referenceMode ? width * 0.35 : 0,
        referenceMode ? (roles.__structure === "frontdoor" ? 580 : 500) : 500,
        referenceMode
          ? Math.max(groupCount("a"), groupCount("m"), groupCount("y")) * 110 + (roles.__structure === "frontdoor" ? 360 : 280)
          : (roles.__sequential
              ? Math.max(
                  ["c", "a", "y"].reduce(
                    (sum, key) => sum + Math.max(0, ...[...columns.values()].map((group) => group.filter((n) => roles[n]?.role === key).length)),
                    0
                  ),
                  ...[...columns.values()].map((group) => group.filter((n) => !roles[n]).length)
                )
              : Math.max(0, ...[...columns.values()].map((a) => a.length))) *
              105 +
              270
      );
    let best;
    for (let variant = 0; variant < (large ? 1 : 4); variant++) {
      const placed = ns.map((n) => ({ ...n }));
      const counts = { c: 0, a: 0, y: 0 };
      if (roles.__sequential)
        for (const group of columns.values())
          for (const key of ["c", "a", "y"]) counts[key] = Math.max(counts[key], group.filter((n) => roles[n]?.role === key).length);
      if (referenceMode) {
        const position = (key, x, y, vertical = true) => {
          let names = placed.filter((n) => roles[n.name]?.role === key);
          if (variant === 1 || (variant === 2 && key === "c") || (variant === 3 && key !== "c")) names.reverse();
          names.forEach((n, i) => {
            n.x = vertical ? x : names.length === 1 ? width / 2 : 110 + (i * (width - 220)) / (names.length - 1);
            n.y = vertical ? y + (i - (names.length - 1) / 2) * 110 : y;
          });
        };
        position("c", width / 2, 90, false);
        const cy = roles.__structure === "frontdoor" ? height / 2 : height * 0.65;
        position("a", 150, cy);
        position("m", width / 2, cy);
        position("y", width - 150, cy);
        position("hidden", width / 2, height - 70);
      }
      for (let k = 0; !referenceMode && k < keys.length; k++) {
        let names = [...columns.get(keys[k])];
        const reverse = variant === 1 || (variant === 2 && k % 2) || (variant === 3 && !(k % 2));
        if (roles.__sequential) {
          let offset = 0;
          for (const key of ["c", "a", "y"]) {
            const subset = names.filter((n) => roles[n]?.role === key);
            if (reverse) subset.reverse();
            subset.forEach((name, i) =>
              Object.assign(
                placed.find((n) => n.name === name),
                { x: 90 + (k * (width - 180)) / Math.max(1, keys.length - 1), y: 135 + (offset + i) * 105 }
              )
            );
            offset += counts[key];
          }
          const unknown = names.filter((n) => !roles[n]);
          unknown.forEach((name, i) =>
            Object.assign(
              placed.find((n) => n.name === name),
              { x: 90 + (k * (width - 180)) / Math.max(1, keys.length - 1), y: 135 + i * 105 }
            )
          );
        } else {
          if (reverse) names.reverse();
          names.forEach((name, i) =>
            Object.assign(
              placed.find((n) => n.name === name),
              { x: 90 + (k * (width - 180)) / Math.max(1, keys.length - 1), y: 150 + i * 105 + (height - 270 - names.length * 105) / 2 }
            )
          );
        }
      }
      const by = Object.fromEntries(placed.map((n) => [n.name, n])),
        routes = new Map();
      const routed = [];
      for (const e of [...es].sort((a, b) => by[a[1]].x - by[a[0]].x - (by[b[1]].x - by[b[0]].x))) {
        const a = by[e[0]],
          b = by[e[1]];
        let winner = { x: 0, y: 0 },
          cost = Infinity;
        for (const y of large ? [0, -height * 0.25, height * 0.25, -height * 0.7, height * 0.7] : [0, -100, 100, -220, 220, -360, 360]) {
          const mx = (a.x + b.x) / 2,
            my = (a.y + b.y) / 2,
            length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const bend = {
            x: Math.max(35, Math.min(width - 35, mx - ((b.y - a.y) / length) * y)) - mx,
            y: Math.max(35, Math.min(height - 35, my + ((b.x - a.x) / length) * y)) - my,
          };
          const trial = new Map(routes);
          if (y) trial.set(JSON.stringify(e), bend);
          const curve = path(a, b, trial.get(JSON.stringify(e)));
          let hits = 0,
            crossings = 0;
          for (const n of placed) if (!e.includes(n.name) && curve.some((q, i) => i && distance(n, curve[i - 1], q) < radius + 7)) hits++;
          if (!large)
            for (const other of routed) {
              if (e.some((n) => other.includes(n))) continue;
              const op = path(by[other[0]], by[other[1]], routes.get(JSON.stringify(other)));
              let crossed = false;
              for (let i = 1; i < 25 && !crossed; i++)
                for (let j = 1; j < 25; j++)
                  if (cross(curve[i - 1], curve[i], op[j - 1], op[j])) {
                    crossed = true;
                    break;
                  }
              if (crossed) crossings++;
            }
          const score = hits * 1000 + crossings * 30 + Math.hypot(bend.x, bend.y) * 0.002;
          if (score < cost) {
            cost = score;
            winner = bend;
          }
        }
        if (winner.x || winner.y) routes.set(JSON.stringify(e), winner);
        routed.push(e);
      }
      const m = metrics(placed, es, routes);
      if (!best || m.score < best.metrics.score) best = { nodes: placed, bends: routes, width, height, columnCount: keys.length, metrics: m };
    }
    return best;
  }
  return { arrange, metrics };
})();
