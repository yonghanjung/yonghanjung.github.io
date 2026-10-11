import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs";

let ready;
async function initialize(id) {
  postMessage({ id, message: "Loading Python 3.13 and scientific packages…" });
  const py = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/" });
  await py.loadPackage(["numpy", "scipy", "pandas", "networkx"]);
  await Promise.all(
    ["SCM.py", "scm_registry.py", "editor_engine.py"].map(async (name) => {
      const response = await fetch(new URL(name, import.meta.url));
      if (!response.ok) throw Error(`Could not load ${name}. Please retry.`);
      py.FS.writeFile(name, await response.text());
    })
  );
  py.runPython("import json\nfrom editor_engine import Editor\n_editor = Editor()");
  return py;
}

self.onmessage = async ({ data: { id, action, payload } }) => {
  try {
    ready ||= initialize(id).catch((error) => {
      ready = null;
      throw error;
    });
    const py = await ready;
    postMessage({ id, message: action === "sample" ? "Sampling…" : "Updating SCM…" });
    py.globals.set("_action", action);
    py.globals.set("_payload", JSON.stringify(payload));
    const result = py.runPython("json.dumps(_editor.request(_action, json.loads(_payload)), allow_nan=False)");
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
