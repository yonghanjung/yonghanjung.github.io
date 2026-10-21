import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs";

const baseURL = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";
let ready, network, identification, scm, pandas;
async function sources(py, names) {
  await Promise.all(
    names.map(async (name) => {
      const response = await fetch(new URL(name, import.meta.url), { cache: "no-cache" });
      if (!response.ok) throw Error(`Could not load ${name}. Please retry.`);
      py.FS.writeFile(name, await response.text());
    })
  );
}
async function initialize(id) {
  postMessage({ id, message: "Preparing calculator…" });
  const py = await loadPyodide({ indexURL: baseURL });
  py.runPython("import json");
  return py;
}
async function prepare(py, action, id) {
  // The same pinned pure-Python wheel needs no optional plotting packages.
  await (network ||= py.loadPackage(baseURL + "networkx-3.4.2-py3-none-any.whl").catch((error) => {
    network = null;
    throw error;
  }));
  if (["identify", "examples", "compare", "load_data", "estimate_data", "sample_reference", "prepare"].includes(action)) {
    if (!identification) postMessage({ id, message: "Preparing identification…" });
    await (identification ||= sources(py, [
      "graph.py",
      "adjustment.py",
      "SBD.py",
      "frontdoor.py",
      "tian.py",
      "identify.py",
      "indexed_identification.py",
      "examples.py",
      "identification_engine.py",
    ])
      .then(() => py.runPython("from identification_engine import analyze, graph_examples"))
      .catch((error) => {
        identification = null;
        throw error;
      }));
  }
  if (action !== "identify" && action !== "examples") {
    if (!scm) postMessage({ id, message: "Preparing calculator…" });
    const preloadPandas = ["build", "prepare"].includes(action);
    await (scm ||= Promise.all([
      py.loadPackage(["numpy", "scipy", ...(preloadPandas ? ["pandas"] : [])]),
      sources(py, ["SCM.py", "scm_registry.py", "editor_engine.py"]),
    ])
      .then(() => {
        py.runPython("from editor_engine import Editor\n_editor = Editor()");
        if (preloadPandas) {
          py.runPython("import pandas");
          pandas ||= Promise.resolve();
        }
      })
      .catch((error) => {
        scm = null;
        throw error;
      }));
    if (["sample", "update", "compare", "load_data", "estimate_data", "sample_reference", "prepare"].includes(action))
      await (pandas ||= py.loadPackage("pandas").catch((error) => {
        pandas = null;
        throw error;
      }));
  }
}

self.onmessage = async ({ data: { id, action, payload } }) => {
  try {
    ready ||= initialize(id).catch((error) => {
      ready = null;
      throw error;
    });
    const py = await ready;
    await prepare(py, action, id);
    if (action === "prepare") {
      postMessage({ id, result: { status: "READY" } });
      return;
    }
    postMessage({
      id,
      message:
        {
          sample: "Sampling…",
          load_data: "Validating CSV data…",
          estimate_data: "Estimating from observed data…",
          sample_reference: "Calculating model reference…",
          compare: "Comparing Sample and SCM…",
          query: "Computing SCM query…",
          identify: "Checking identification…",
          examples: "Loading graph library…",
        }[action] || "Updating SCM…",
    });
    py.globals.set("_action", action);
    py.globals.set("_payload", JSON.stringify(payload));
    const result = py.runPython(
      "json.dumps(analyze(json.loads(_payload)) if _action == 'identify' else graph_examples() if _action == 'examples' else _editor.request(_action, json.loads(_payload)), allow_nan=False)"
    );
    postMessage({ id, result: JSON.parse(result) });
  } catch (error) {
    postMessage({
      id,
      error: error.message
        .trim()
        .split("\n")
        .at(-1)
        .replace(/^\w+Error:\s*/, ""),
    });
  }
};
