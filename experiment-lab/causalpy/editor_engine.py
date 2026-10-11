"""CausalPy graph editor API, bundled from the local Python engine."""

import copy
import inspect
import json
import re
import textwrap
from types import FunctionType

import networkx as nx
import numpy as np

from SCM import SCM
from scm_registry import EQUATION_FAMILIES, NOISE_FAMILIES, _cluster_equation



def _integer(value, name, upper):
    if type(value) is not int or not 0 <= value <= upper:
        raise ValueError(f"{name}: an integer from 0 to {upper} is required.")
    return value


def build_scm(payload):
    """Draw model parameters once, independently of sample settings."""
    if not isinstance(payload, dict):
        raise ValueError("A JSON object is required.")
    nodes, edges = payload.get("nodes"), payload.get("edges", [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 50:
        raise ValueError("Use 1 to 50 nodes.")
    if not isinstance(edges, list) or len(edges) > 2500:
        raise ValueError("Use a list of at most 2500 edges.")
    model_seed = _integer(payload.get("model_seed", 7), "model seed", 2**32 - 1)
    noise = payload.get("noise", "random")
    if noise not in {*NOISE_FAMILIES, "random"}:
        raise ValueError("Unknown noise family")
    graph, families = nx.DiGraph(), {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Each node must be a JSON object.")
        name = node.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            raise ValueError("Names must start with a letter and contain letters, numbers or underscores.")
        if name in graph:
            raise ValueError("Node names must be unique.")
        dimension = _integer(node.get("dimension", 1), "dimension", 8)
        observed = node.get("observed", True)
        if not dimension or type(observed) is not bool:
            raise ValueError("Dimension must be 1 to 8; observed must be boolean.")
        graph.add_node(name, observed=observed, dimension=dimension,
                       shape=() if dimension == 1 else (dimension,),
                       columns=[name] if dimension == 1 else [f"{name}[{i}]" for i in range(dimension)],
                       pos=(node.get("x", 0), node.get("y", 0)))
        if observed:
            family = node.get("family") or "random"
            if family not in {*EQUATION_FAMILIES, "random"}:
                raise ValueError("Unknown equation family")
            families[name] = list(EQUATION_FAMILIES) if family == "random" else family
    for edge in edges:
        if not isinstance(edge, list) or len(edge) != 2 or any(name not in graph for name in edge):
            raise ValueError("Each edge must connect two existing nodes.")
        graph.add_edge(*edge)
    return SCM(model_seed=model_seed).build_from_graph(
        graph, equation_families=families,
        noise_distributions=list(NOISE_FAMILIES) if noise == "random" else noise)


def _clone(function, bindings, parameters):
    """Keep the built-in algorithm; replace copied closure values, never its source."""
    names = function.__code__.co_freevars
    if set(bindings) - set(names):
        raise ValueError("Unsupported function bindings.")
    cells = tuple((lambda value: lambda: value)(bindings.get(name, cell.cell_contents)).__closure__[0]
                  for name, cell in zip(names, function.__closure__ or ()))
    result = FunctionType(function.__code__, function.__globals__, function.__name__, function.__defaults__, cells or None)
    result.__kwdefaults__ = function.__kwdefaults__
    result._scm_parameters = copy.deepcopy(parameters)
    return result


def _array(value, shape):
    result = np.asarray(value, dtype=float)
    if not result.size and not np.prod(shape):
        result = result.reshape(shape)
    if result.shape != shape or not np.isfinite(result).all():
        raise ValueError(f"Expected finite numbers with shape {shape}.")
    return result.copy()


def _edit(function, parameters):
    """Validate the complete parameter set before cloning a fixed mechanism."""
    old = function._scm_parameters
    p = copy.deepcopy(parameters)
    if not isinstance(p, dict) or set(p) != set(old):
        raise ValueError("Keep the parameter fields shown in the editor.")
    for key in ("kind", "parents", "parent_shapes", "weight_scale"):
        if key in old:
            if json.loads(json.dumps(p[key])) != json.loads(json.dumps(old[key])):
                raise ValueError(f"{key} is read-only.")
            p[key] = copy.deepcopy(old[key])
    closure = dict(zip(function.__code__.co_freevars, (c.cell_contents for c in function.__closure__ or ())))
    if "coordinates" in old:
        if not isinstance(p["coordinates"], list) or len(p["coordinates"]) != len(old["coordinates"]):
            raise ValueError("Keep one function per output coordinate.")
        functions = [_edit(f, values) for f, values in zip(closure["equations"], p["coordinates"])]
        p["coordinates"] = [f._scm_parameters for f in functions]
        return _clone(function, {"equations": functions, "signatures": [inspect.signature(f) for f in functions]}, p)
    kind = p["kind"]
    if kind in {"linear", "quadratic", "bounded", "binary"}:
        if not isinstance(p["coefficients"], dict) or set(p["coefficients"]) != set(old["coefficients"]):
            raise ValueError("Keep the parent coefficient names.")
        values = _array([p["intercept"], *p["coefficients"].values()], (1 + len(p["coefficients"]),))
        p["intercept"] = float(values[0])
        p["coefficients"] = dict(zip(p["coefficients"], values[1:].tolist()))
        bindings = {"intercept": p["intercept"], "coefficients": p["coefficients"]}
    elif kind == "neural_network":
        depth, width = _integer(p["depth"], "depth", 6), _integer(p["width"], "width", 64)
        if not depth or not width or p["activation"] not in {"tanh", "relu"}:
            raise ValueError("Use positive depth/width and tanh or relu.")
        if len(p["hidden_weights"]) != depth - 1 or len(p["hidden_biases"]) != depth - 1:
            raise ValueError("Layer arrays must match depth.")
        weights = [_array(p["input_weights"], (len(p["parents"]), width))] + [_array(w, (width, width)) for w in p["hidden_weights"]]
        biases = [_array(p["bias"], (width,))] + [_array(b, (width,)) for b in p["hidden_biases"]]
        bindings = {"weights": weights, "biases": biases, "output_weights": _array(p["output_weights"], (width,)),
                    "intercept": float(_array([p["intercept"]], (1,))[0]), "activation": p["activation"]}
        p.update(input_weights=weights[0].tolist(), hidden_weights=[w.tolist() for w in weights[1:]],
                 bias=biases[0].tolist(), hidden_biases=[b.tolist() for b in biases[1:]],
                 output_weights=bindings["output_weights"].tolist(), intercept=bindings["intercept"])
    elif kind == "decision_tree":
        depth = _integer(p["depth"], "depth", 6)
        count = 2**depth - 1
        features = p["features"]
        if not isinstance(features, list) or len(features) != count or any(type(f) is not int or not 0 <= f < len(p["parents"]) for f in features):
            raise ValueError("Tree features must be valid parent indices and match depth.")
        p["used_parents"] = [p["parents"][i] for i in sorted(set(features))]
        bindings = {"depth": depth, "n_splits": count, "features": np.array(features, dtype=int),
                    "thresholds": _array(p["thresholds"], (count,)), "leaves": _array(p["leaves"], (2**depth,))}
        p.update(thresholds=bindings["thresholds"].tolist(), leaves=bindings["leaves"].tolist())
    else:
        raise ValueError("Unsupported equation family.")
    return _clone(function, bindings, p)


def _function_info(function):
    def value(item):
        if isinstance(item, np.ndarray):
            return item.tolist()
        if callable(item):
            return _function_info(item)
        if isinstance(item, inspect.Signature):
            return str(item)
        if isinstance(item, dict):
            return {key: value(v) for key, v in item.items()}
        if isinstance(item, (list, tuple)):
            return [value(v) for v in item]
        return item
    return {"source": textwrap.dedent(inspect.getsource(function)).strip(),
            "bindings": {name: value(cell.cell_contents) for name, cell in zip(function.__code__.co_freevars, function.__closure__ or ())}}


class Editor:
    """One browser session owns one fixed SCM; sampling never rebuilds it."""

    def __init__(self):
        self.model = None
        self.token = 0

    def request(self, action, payload):
        if action == "build":
            candidate = build_scm(payload)
            self.model, self.token = candidate, self.token + 1
            return {"token": self.token, "model": self.model.describe()}
        if self.model is None or payload.get("token") != self.token:
            raise ValueError("SCM expired. Reopen SCM mode.")
        if action == "sample":
            n = _integer(payload.get("n", 10), "rows", 1000)
            seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
            data = self.model.sample_observational(n, seed=seed)
            if not np.isfinite(data.to_numpy(dtype=float)).all():
                raise ValueError("The sample contains NaN/Inf. Change the function settings.")
            return {"columns": list(data.columns), "rows": data.head(10).to_numpy().tolist(), "shape": list(data.shape),
                    "csv": data.to_csv(index=False, float_format="%.17g"), "token": self.token}
        name = payload.get("name")
        if name not in self.model.equations:
            raise ValueError("Select an existing node.")
        if action == "update":
            old = self.model
            details = old._variables[name]
            if not details["observed"]:
                raise ValueError("Hidden roots use their noise law.")
            candidate = old._copy_model()
            family = payload.get("family")
            if family is not None:
                if family not in EQUATION_FAMILIES:
                    raise ValueError("Unknown equation family.")
                parents = {p: old._variables[p]["shape"] for p in old.graph.predecessors(name)}
                equation = (_cluster_equation(parents, details["shape"], family, candidate._model_rng)
                            if details["shape"] or any(parents.values()) else EQUATION_FAMILIES[family](list(parents), candidate._model_rng))
            else:
                equation = _edit(old.equations[name], payload.get("parameters"))
                family = equation._scm_parameters["kind"]
            candidate = candidate.replace_mechanism(name, equation, list(old.graph.predecessors(name)),
                parameters={**details["parameters"], "family": family})
            candidate._variables[name]["variable_type"] = "binary" if family == "binary" else "continuous"
            probe = candidate.generate_samples(4, seed=0)
            if not np.isfinite(probe.to_numpy(dtype=float)).all():
                raise ValueError("Parameters produced NaN/Inf. The SCM was kept.")
            candidate.sample_dict = {}
            self.model, self.token = candidate, self.token + 1
        elif action != "inspect":
            raise ValueError("Unknown editor action.")
        return {"token": self.token, "model": self.model.describe(), "node": name,
                "function": _function_info(self.model.equations[name])}
