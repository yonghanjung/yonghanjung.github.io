import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs";

let ready;
async function initialize(id) {
  postMessage({ id, message: "Loading Python 3.13 and scientific packages…" });
  const py = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/" });
  await py.loadPackage(["numpy", "scipy", "pandas", "networkx"]);
  await Promise.all(
    [
      "SCM.py",
      "scm_registry.py",
      "editor_engine.py",
      "graph.py",
      "adjustment.py",
      "SBD.py",
      "frontdoor.py",
      "tian.py",
      "identify.py",
      "indexed_identification.py",
      "examples.py",
      "identification_engine.py",
    ].map(async (name) => {
      const response = await fetch(new URL(name, import.meta.url), { cache: "no-cache" });
      if (!response.ok) throw Error(`Could not load ${name}. Please retry.`);
      py.FS.writeFile(name, await response.text());
    })
  );
  py.runPython("import json\nfrom editor_engine import Editor\nfrom identification_engine import analyze, graph_examples\n_editor = Editor()");
  return py;
}

self.onmessage = async ({ data: { id, action, payload } }) => {
  try {
    ready ||= initialize(id).catch((error) => {
      ready = null;
      throw error;
    });
    const py = await ready;
    postMessage({
      id,
      message:
        { sample: "Sampling…", query: "Computing SCM query…", identify: "Checking identification…", examples: "Loading graph library…" }[action] ||
        "Updating SCM…",
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
