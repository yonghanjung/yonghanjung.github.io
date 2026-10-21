/* A retained, browser-local data snapshot. Head and download never calculate or resample. */
(() => {
  let snapshot = null;
  const byId = (id) => document.getElementById(id),
    escapeCSV = (v) => '"' + String(v).replaceAll('"', '""') + '"';
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function head() {
    if (!snapshot) return;
    const n = Number(byId("head-rows").value),
      p = Number(byId("head-columns").value),
      start = Number(byId("head-start").value),
      columns = snapshot.table.headers.slice(start, start + p),
      table = byId("head-table");
    table.replaceChildren();
    const tr = document.createElement("tr");
    for (const name of columns) {
      const th = document.createElement("th");
      th.textContent = name;
      tr.append(th);
    }
    const thead = document.createElement("thead");
    thead.append(tr);
    table.append(thead);
    const tbody = document.createElement("tbody");
    for (const row of snapshot.table.rows.slice(0, n)) {
      const tr = document.createElement("tr");
      for (const v of row.slice(start, start + p)) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    byId("head-caption").textContent =
      "Rows 1–" +
      Math.min(n, snapshot.table.rows.length) +
      " of " +
      snapshot.table.rows.length.toLocaleString() +
      " · Columns " +
      (start + 1) +
      "–" +
      (start + columns.length) +
      " of " +
      snapshot.table.headers.length;
  }
  window.CausalDataPreview = {
    set({ csv, table, name, source, key }) {
      snapshot = { csv, table: table || CausalCSV.parse(csv), name, source, key };
      const select = byId("head-start");
      select.replaceChildren(...snapshot.table.headers.map((h, i) => new Option(h, String(i))));
      byId("dataset-label").textContent =
        name + " · " + snapshot.table.rows.length.toLocaleString() + " rows × " + snapshot.table.headers.length + " columns";
      byId("dataset-tools").hidden = false;
      byId("head-panel").hidden = true;
      byId("head-data").setAttribute("aria-expanded", "false");
      window.causalEnginePreviewSnapshot = { source, key, rows: snapshot.table.rows.length, columns: [...snapshot.table.headers] };
    },
    clear() {
      snapshot = null;
      byId("dataset-tools").hidden = true;
      byId("head-panel").hidden = true;
      byId("head-data").setAttribute("aria-expanded", "false");
      window.causalEnginePreviewSnapshot = null;
    },
    key() {
      return snapshot?.key;
    },
    download,
    csv(table) {
      return [table.headers, ...table.rows].map((row) => row.map(escapeCSV).join(",")).join("\r\n") + "\r\n";
    },
  };
  byId("head-data").setAttribute("aria-controls", "head-panel");
  byId("head-data").setAttribute("aria-expanded", "false");
  byId("head-data").onclick = () => {
    if (!snapshot) return;
    const opening = byId("head-panel").hidden;
    byId("head-panel").hidden = !opening;
    byId("head-data").setAttribute("aria-expanded", String(opening));
    if (opening) head();
  };
  byId("download-data").onclick = () => {
    if (snapshot) download(snapshot.csv, snapshot.name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/\.csv$/i, "") + ".csv");
  };
  for (const id of ["head-rows", "head-columns", "head-start"]) byId(id).onchange = head;
})();
