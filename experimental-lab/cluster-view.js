/* Cluster declarations and a view-only projection. Logical nodes and edges stay untouched. */
window.ClusterSyntax = {
  parse(text) {
    const parts = [];
    let depth = 0,
      start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      if (text[i] === ")") depth--;
      if (depth < 0 || depth > 1) throw Error("Check the cluster parentheses.");
      if (text[i] === "," && !depth) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    if (depth) throw Error("Close the cluster parentheses.");
    parts.push(text.slice(start));
    const names = [],
      clusters = {};
    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;
      const match = part.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\((.*)\)$/);
      if (!match) {
        if (/[()]/.test(part)) throw Error("Use X (x1, x2, …, x25).");
        names.push(part);
        continue;
      }
      const name = match[1],
        tokens = match[2].split(",").map((s) => s.trim());
      if (!tokens.length || tokens.some((t) => !t)) throw Error("List at least one cluster member.");
      const members = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === "…" || t === "...") {
          const a = members.at(-1)?.match(/^(.*?)([1-9]\d*)$/),
            b = tokens[i + 1]?.match(/^(.*?)([1-9]\d*)$/);
          if (!a || !b || a[1] !== b[1] || Number(b[2]) <= Number(a[2]) || Number(b[2]) > 100)
            throw Error("Use an ascending range with the same prefix, such as x1, …, x25.");
          for (let k = Number(a[2]) + 1; k < Number(b[2]); k++) members.push(a[1] + k);
          continue;
        }
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) throw Error("Use valid variable names inside the cluster.");
        members.push(t);
      }
      if (members.length > 100 || new Set(members).size !== members.length) throw Error("Cluster members must be unique, at most 100.");
      if (clusters[name]) throw Error("The cluster name is repeated: " + name);
      names.push(name);
      clusters[name] = members;
    }
    return { names, clusters };
  },
};
window.ClusterView = (() => {
  const NS = "http://www.w3.org/2000/svg",
    expanded = new Set();
  let base = null,
    lastView = "";
  const el = (tag, attrs = {}, text) => {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    if (text !== undefined) x.textContent = text;
    return x;
  };
  const membersFor = (map, n) => map[n] || [];
  function draw(svg, nodes, edges, bends, members) {
    for (const name of [...expanded]) if (!nodes.some((n) => n.name === name) || !membersFor(members, name).length) expanded.delete(name);
    if (base && svg.getAttribute("viewBox") !== lastView) {
      base = null;
    }
    if (!expanded.size) {
      if (base) {
        svg.setAttribute("viewBox", base.box);
        svg.style.height = base.height;
        svg.style.minWidth = base.minWidth;
      }
      base = null;
      lastView = "";
      window.causalEngineClusterView = { expanded: [], members: [], logicalNodes: nodes.length, logicalEdges: edges.length };
      for (const g of svg.querySelectorAll("[data-node]"))
        if (membersFor(members, g.dataset.node).length) {
          g.setAttribute("aria-expanded", "false");
          g.setAttribute("aria-label", g.getAttribute("aria-label") + "; expand cluster");
        }
      return;
    }
    if (!base) base = { box: svg.getAttribute("viewBox"), height: svg.style.height, minWidth: svg.style.minWidth };
    const boxes = {},
      active = nodes.filter((n) => expanded.has(n.name)),
      padding = 55;
    let x = padding,
      maxH = 0;
    for (const n of active) {
      const list = membersFor(members, n.name),
        cols = Math.min(7, Math.max(2, Math.ceil(Math.sqrt(list.length)))),
        rows = Math.ceil(list.length / cols),
        w = Math.max(240, cols * 92 + 40),
        h = rows * 68 + 95;
      boxes[n.name] = { x: x + w / 2, y: padding + h / 2, w, h, cols };
      x += w + 65;
      maxH = Math.max(maxH, h);
    }
    const shiftY = maxH + 100,
      baseW = Number(base.box.split(/\s+/)[2]),
      display = new Map(nodes.map((n) => [n.name, boxes[n.name] || { x: n.x, y: n.y + shiftY, w: 0, h: 0 }])),
      width = Math.max(baseW, x),
      height = Math.max(shiftY + Number(base.box.split(/\s+/)[3]), padding + maxH + 80);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.minWidth = Math.max(680, width * 0.8) + "px";
    svg.style.height = Math.max(360, height * 0.8) + "px";
    lastView = svg.getAttribute("viewBox");
    const port = (n, t) => {
      const dx = t.x - n.x,
        dy = t.y - n.y;
      if (n.w) {
        const scale = Math.min(n.w / 2 / (Math.abs(dx) || 1e-8), n.h / 2 / (Math.abs(dy) || 1e-8));
        return { x: n.x + dx * scale, y: n.y + dy * scale };
      }
      const len = Math.hypot(dx, dy) || 1;
      return { x: n.x + (dx / len) * 28, y: n.y + (dy / len) * 28 };
    };
    for (const g of svg.querySelectorAll("[data-edge]")) {
      const [a, b] = JSON.parse(g.dataset.edge),
        from = display.get(a),
        to = display.get(b),
        p = port(from, to),
        q = port(to, from);
      let d = "M " + p.x + " " + p.y + " L " + q.x + " " + q.y;
      if (from.w && to.w) {
        const top = Math.min(from.y - from.h / 2, to.y - to.h / 2) - 30;
        d = "M " + p.x + " " + p.y + " Q " + (p.x + q.x) / 2 + " " + top + " " + q.x + " " + q.y;
      }
      for (const path of g.querySelectorAll("path")) path.setAttribute("d", d);
    }
    for (const g of svg.querySelectorAll("[data-node]")) {
      const name = g.dataset.node,
        p = display.get(name);
      g.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
      if (!boxes[name]) continue;
      const list = membersFor(members, name);
      g.replaceChildren();
      g.dataset.clusterBoundary = name;
      g.setAttribute("aria-expanded", "true");
      g.append(
        el("title", {}, "Collapse " + name + "; member circles show columns, not separate causal assumptions."),
        el("rect", { x: -p.w / 2, y: -p.h / 2, width: p.w, height: p.h, rx: 14, fill: "#f7f5ee", stroke: "#193b37", "stroke-width": 2 }),
        el(
          "text",
          { x: 0, y: -p.h / 2 + 29, "text-anchor": "middle", "font-size": 17, "font-weight": 700 },
          name + " · " + list.length + " columns  −"
        )
      );
      list.forEach((member, i) => {
        const px = -p.w / 2 + 66 + (i % p.cols) * 92,
          py = -p.h / 2 + 76 + Math.floor(i / p.cols) * 68,
          child = el("g", { "data-member": member, transform: "translate(" + px + "," + py + ")" });
        child.append(
          el("circle", { r: 24, fill: "#fffdf8", stroke: "#64706b" }),
          el("text", { "text-anchor": "middle", y: 4, "font-size": member.length > 7 ? 10 : 13 }, member)
        );
        g.append(child);
      });
    }
    window.causalEngineClusterView = {
      expanded: [...expanded],
      members: active.flatMap((n) => membersFor(members, n.name)),
      logicalNodes: nodes.length,
      logicalEdges: edges.length,
    };
  }
  return {
    draw,
    has: (name) => expanded.has(name),
    any: () => expanded.size > 0,
    toggle(name) {
      expanded.has(name) ? expanded.delete(name) : expanded.add(name);
    },
    clear() {
      expanded.clear();
    },
  };
})();
