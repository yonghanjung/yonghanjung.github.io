/* CSV is parsed and mapped entirely in this browser. */
window.CausalCSV = {
  parse(text) {
    text = text.replace(/^\uFEFF/, "");
    const records = [];
    let row = [],
      value = "",
      quoted = false,
      afterQuote = false;
    const field = () => {
      row.push(value);
      value = "";
      afterQuote = false;
    };
    const record = () => {
      field();
      records.push(row);
      row = [];
      if (records.length > 5001) throw Error("CSV supports at most 5,000 data rows.");
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            quoted = false;
            afterQuote = true;
          }
        } else value += ch;
      } else if (ch === ",") field();
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        record();
      } else if (afterQuote) {
        if (!/[ \t]/.test(ch)) throw Error("Unexpected text after a quoted field near CSV row " + (records.length + 1) + ".");
      } else if (ch === '"') {
        if (value.length) throw Error("Unexpected quotation mark near CSV row " + (records.length + 1) + ".");
        quoted = true;
      } else value += ch;
    }
    if (quoted) throw Error("A quoted CSV field is not closed.");
    if (value.length || row.length || afterQuote) record();
    if (!records.length) throw Error("The CSV file is empty.");
    const headers = records.shift().map((h) => h.trim());
    if (headers.some((h) => !h)) throw Error("Every CSV column needs a nonblank header.");
    if (new Set(headers).size !== headers.length) throw Error("CSV headers must be unique.");
    if (!records.length) throw Error("The CSV needs at least one data row.");
    records.forEach((r, i) => {
      if (r.length !== headers.length) throw Error("CSV row " + (i + 2) + " has " + r.length + " cells; the header has " + headers.length + ".");
    });
    return { headers, rows: records };
  },
  project(table, mapping, graphNodes, columnTypes = {}) {
    const observed = graphNodes.filter((n) => n.observed),
      selected = [],
      owners = [],
      normalized = {};
    for (const n of observed) {
      const raw = mapping[n.name],
        members = Array.isArray(raw) ? raw : [raw];
      if (!members.length || members.some((h) => !h || !table.headers.includes(h))) throw Error("Choose CSV columns for " + n.name + ".");
      normalized[n.name] = Array.isArray(raw) ? [...members] : members[0];
      for (const header of members) {
        selected.push(header);
        owners.push(n);
      }
    }
    if (new Set(selected).size !== selected.length) throw Error("Each CSV column can be assigned only once, including cluster members.");
    if (selected.length > 100 || table.rows.length * selected.length > 500000)
      throw Error("Selected data supports at most 100 columns and 500,000 cells.");
    const indices = selected.map((h) => table.headers.indexOf(h)),
      types = {};
    selected.forEach((h, k) => {
      types[h] = columnTypes[h] || owners[k].variable_type || (owners[k].family === "binary" ? "binary" : "continuous");
    });
    const rows = table.rows.map((row, i) =>
      indices.map((j, k) => {
        const raw = row[j].trim(),
          column = selected[k];
        if (!raw) throw Error("CSV row " + (i + 2) + ", column “" + column + "”: a value is missing.");
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))
          throw Error("CSV row " + (i + 2) + ", column “" + column + "”: enter a finite numeric value.");
        const value = Number(raw);
        if (types[column] === "binary" && value !== 0 && value !== 1)
          throw Error("CSV row " + (i + 2) + ", column “" + column + "”: binary values must be 0 or 1.");
        return value;
      })
    );
    return { columns: selected, rows, mapping: normalized, column_types: types };
  },
};
