"""CausalPy graph editor API, bundled from the local Python engine."""

import copy
import inspect
import json
import re
import textwrap
from time import perf_counter
from types import CodeType, FunctionType

import networkx as nx
import numpy as np
from scipy.stats._distn_infrastructure import rv_frozen

from SCM import SCM, U, _noise_value
from scm_registry import EQUATION_FAMILIES, NOISE_FAMILIES, _cluster_equation, _make_equation



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


def _estimate_mean(data, graph, schema, payload, seed, deadline):
    """Fit adjustment using only observed data, graph and public column/type metadata.

    Two folds train kNN on one half and standardize over the other half's Z.
    Support cutoffs are engineering diagnostics, not a proof of positivity.
    Finite-sample smoothing bias remains; no data standard error is asserted.
    """
    result = dict(status="UNSUPPORTED", method="2-fold kNN g-computation", n=len(data),
                  diagnostics={"folds": 2, "data_uncertainty": "not estimated",
                               "limitations": "kNN smoothing bias and high-dimensional sparse support",
                               "support_checks": "empirical engineering checks, not a positivity certificate"})

    def fail(status, reason):
        return dict(result, status=status, reason=reason)

    if payload.get("type", "interventional") != "interventional" or payload.get("summary", "mean") != "mean" or payload.get("evidence"):
        return fail("UNSUPPORTED", "Sample estimation currently supports Interventional Mean without evidence.")
    targets, actions = payload.get("targets"), payload.get("intervention", {})
    if (not isinstance(targets, list) or not targets or len(targets) != len(set(targets))
            or any(v not in schema for v in targets) or not isinstance(actions, dict) or any(v not in schema for v in actions)):
        raise ValueError("Use observed whole-node targets and intervention names.")
    if set(targets) & set(actions):
        return fail("UNSUPPORTED", "For Sample estimation, targets must differ from intervention nodes.")
    constants = {v: _array(value, schema[v]["shape"]).reshape(-1) for v, value in actions.items()}
    if any(schema[v]["type"] == "binary" and not np.isin(a, [0, 1]).all() for v, a in constants.items()):
        raise ValueError("Binary intervention values must be 0 or 1.")
    if len(data) < 128:
        return fail("UNKNOWN", "INSUFFICIENT_DATA: generate at least 128 rows (512 recommended).")
    if perf_counter() >= deadline:
        return fail("UNKNOWN", "Sample estimator deadline exhausted.")
    outcomes = [c for v in targets for c in schema[v]["columns"]]
    if not actions:
        return dict(result, status="OK", method="observed sample mean", adjustment=[], criterion="observational",
                    values=dict(zip(outcomes, data[outcomes].mean().to_numpy().tolist())))
    from adjustment import construct_minimum_adjustment_set, check_adjustment_criterion, check_backdoor_criterion
    try:
        adjustment = construct_minimum_adjustment_set(graph, list(actions), targets)
    except ValueError:
        return fail("UNSUPPORTED", "No adjustment witness: this Sample estimator does not implement other identification formulas.")
    if (any(v not in schema for v in adjustment)
            or not check_adjustment_criterion(graph, list(actions), targets, adjustment)):
        return fail("UNSUPPORTED", "No verified adjustment witness for the original query.")
    result.update(adjustment=adjustment, criterion="BD" if check_backdoor_criterion(graph, list(actions), targets, adjustment) else "AC")
    discrete = {v for v in [*actions, *adjustment] if schema[v]["type"] in {"binary", "categorical"}}
    action_columns = [c for v in actions if v not in discrete for c in schema[v]["columns"]]
    features = action_columns + [c for v in adjustment if v not in discrete for c in schema[v]["columns"]]
    finite_covariates = [c for v in adjustment if v in discrete for c in schema[v]["columns"]]
    x, y = data[features].to_numpy(dtype=float), data[outcomes].to_numpy(dtype=float)
    finite_z = data[finite_covariates].to_numpy(dtype=float)
    requested = x.copy()
    offset = 0
    eligible = np.ones(len(data), dtype=bool)
    for v, value in constants.items():
        observed = data[schema[v]["columns"]].to_numpy(dtype=float)
        if v in discrete:
            eligible &= np.all(observed == value, axis=1)
        else:
            if np.any(value < observed.min(axis=0)) or np.any(value > observed.max(axis=0)):
                return fail("UNKNOWN", "INSUFFICIENT_DATA: intervention lies outside the observed action range.")
            requested[:, offset:offset + len(value)] = value
            offset += len(value)
    # Whole finite-valued arms and strata are matched exactly, not by numeric distance.
    groups = np.unique(finite_z, axis=0) if finite_covariates else np.zeros((1, 0))
    fold = np.empty(len(data), dtype=int)
    fold[np.random.default_rng(seed).permutation(len(data))] = np.arange(len(data)) % 2
    predictions = np.empty_like(y)
    sizes, radii, poor_coverage = [], [], 0

    def neighbors(train, test, k):
        distances = np.maximum(0, (test * test).sum(axis=1)[:, None]
                               + (train * train).sum(axis=1)[None, :] - 2 * test @ train.T)
        nearest = np.argpartition(distances, k - 1, axis=1)[:, :k]
        radius = np.take_along_axis(distances, nearest, axis=1).max(axis=1)
        return nearest, radius

    for heldout in (0, 1):
        for group in groups:
            if perf_counter() >= deadline:
                return fail("UNKNOWN", "Sample estimator deadline exhausted.")
            stratum = np.all(finite_z == group, axis=1)
            test = np.flatnonzero((fold == heldout) & stratum)
            if not len(test):
                continue
            train = np.flatnonzero((fold != heldout) & stratum & eligible)
            k = max(8, int(np.sqrt(len(train))))
            if len(train) < 2 * k:
                return fail("UNKNOWN", "INSUFFICIENT_DATA: a requested finite arm or adjustment stratum has too few training rows.")
            if action_columns and (np.any(requested[test, :len(action_columns)] < x[train, :len(action_columns)].min(axis=0))
                                   or np.any(requested[test, :len(action_columns)] > x[train, :len(action_columns)].max(axis=0))):
                return fail("UNKNOWN", "INSUFFICIENT_DATA: intervention lies outside a training stratum's action range.")
            center, scale = x[train].mean(axis=0), x[train].std(axis=0)
            scale = np.where(scale > 0, scale, 1)
            training, query = (x[train] - center) / scale, (requested[test] - center) / scale
            if not features or not np.any(x[train].std(axis=0)):
                if features and not np.all(query == training[0]):
                    return fail("UNKNOWN", "INSUFFICIENT_DATA: constant training features do not cover the query.")
                predictions[test] = y[train].mean(axis=0)
                sizes.append(len(train))
                continue
            nearest, radius = neighbors(training, query, k)
            _, factual_radius = neighbors(training, (x[test] - center) / scale, k)
            baseline = np.maximum(factual_radius, 1e-12)
            poor_coverage += int(np.count_nonzero(radius > 9 * baseline))
            radii.extend((radius / baseline).tolist())
            predictions[test] = y[train[nearest]].mean(axis=1)
            sizes.append(k)
    result["diagnostics"].update(poor_coverage_fraction=poor_coverage / len(data),
                                 max_squared_radius_ratio=max(radii, default=0),
                                 coverage_rule="abstain if >5% rows exceed 3x their factual neighbor radius")
    result["k"] = sorted(set(sizes))
    if poor_coverage > .05 * len(data):
        return fail("UNKNOWN", "INSUFFICIENT_DATA: weak observed neighbor coverage for the intervention; generate more rows or change its value.")
    values = predictions.mean(axis=0)
    if not np.isfinite(values).all():
        return fail("UNKNOWN", "Sample estimator produced nonfinite values.")
    return dict(result, status="OK", values=dict(zip(outcomes, values.tolist())))


def _reference(model, payload, n, seed, seconds):
    """Analytic scalar linear Mean when verified; otherwise use existing simulation."""
    started = perf_counter()
    options = dict(query_type=payload.get("type", "interventional"),
                   intervention=payload.get("intervention", {}), evidence=payload.get("evidence", {}),
                   reference=payload.get("reference"), summary=payload.get("summary", "mean"),
                   event=payload.get("event"), n=n, seed=seed)
    if seconds > 0 and options["query_type"] == "interventional" and options["summary"] == "mean" and not options["evidence"]:
        # The first deadline check precedes every draw: reuse validation, not MC.
        template = model.query(payload.get("targets"), **options, max_seconds=0)
        query = template["query"]
        actions, needed = query["intervention"], set(query["targets"])
        order = list(nx.topological_sort(model.graph))
        for v in reversed(order):
            if v in needed and v not in actions:
                needed.update(model.graph.predecessors(v))
        linear_code = next(c for c in _make_equation.__code__.co_consts
                           if isinstance(c, CodeType) and c.co_name == "equation")
        means = {}
        for v in (v for v in order if v in needed):
            if perf_counter() - started >= seconds or model._variables[v]["shape"] != ():
                break
            if v in actions:
                means[v] = float(actions[v])
                continue
            function = model.equations[v]
            if model._uses_legacy_rng(v):
                break
            noise = model.noise_distributions.get(v)
            noise = noise.distribution if isinstance(noise, U) else noise
            if noise is not None and (not isinstance(noise, rv_frozen) or noise.dist.name not in {"norm", "uniform"}
                    or getattr(noise.rvs, "__func__", None) is not rv_frozen.rvs
                    or getattr(noise.mean, "__func__", None) is not rv_frozen.mean):
                break
            mean_noise = np.asarray(0 if noise is None else noise.mean())
            if mean_noise.shape or not np.isfinite(mean_noise):
                break
            if function is _noise_value and not model._variables[v]["observed"] and not model.graph.in_degree(v):
                means[v] = float(mean_noise)
            elif getattr(function, "__code__", None) is linear_code:
                bindings = dict(zip(function.__code__.co_freevars, (c.cell_contents for c in function.__closure__)))
                coefficients, intercept = bindings["coefficients"], bindings["intercept"]
                if (bindings["kind"] != "linear" or set(coefficients) != set(model.graph.predecessors(v))
                        or not np.isfinite([intercept, *coefficients.values()]).all()):
                    break
                means[v] = float(intercept + sum(c * means[p] for p, c in coefficients.items()) + mean_noise)
            else:
                break
            if not np.isfinite(means[v]):
                break
        else:
            if perf_counter() - started < seconds:
                return dict(status="OK", approximate=False, query=query,
                            values={model._variables[v].get("columns", [v])[0]: means[v] for v in query["targets"]},
                            diagnostics={"method": "analytic linear expectation", "n": 0,
                                         "conditioning": "none", "elapsed_seconds": perf_counter() - started})
    return model.query(payload.get("targets"), **options, max_seconds=max(0, seconds - (perf_counter() - started)))


class Editor:
    """One browser session owns one fixed SCM; sampling never rebuilds it."""

    def __init__(self):
        self.model = None
        self.token = 0
        self.sample_id = 0
        self._sample = None
        self._sample_seed = None

    def request(self, action, payload):
        if action == "build":
            candidate = build_scm(payload)
            self.model, self.token = candidate, self.token + 1
            self._sample, self._sample_seed = None, None
            return {"token": self.token, "model": self.model.describe()}
        if self.model is None or payload.get("token") != self.token:
            raise ValueError("SCM expired. Reopen SCM mode.")
        if action in {"query", "compare"}:
            n = _integer(payload.get("n", 2048), "draws", 10000)
            seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
            seconds = payload.get("max_seconds", 10)
            if n < 256 or type(seconds) not in (int, float) or not np.isfinite(seconds) or not 0 <= seconds <= 30:
                raise ValueError("Use 256 to 10000 draws and a query budget from 0 to 30 seconds.")
            if action == "compare":
                if self._sample is None or type(payload.get("sample_id")) is not int or payload["sample_id"] != self.sample_id:
                    raise ValueError("Sample expired. Generate Sample again.")
                # Domain separation: reference draws never share the observational seed.
                seed ^= 0xA5A5A5A5
                if seed == self._sample_seed:
                    seed = (seed + 1) % 2**32
                started = perf_counter()
                schema = {v: {"shape": d["shape"], "columns": list(d.get("columns", [v] if not d["shape"] else [f"{v}{i+1}" for i in range(d["shape"][0])])),
                              "type": d["variable_type"]} for v, d in self.model._variables.items() if d["observed"]}
                estimate = _estimate_mean(self._sample, self.model.graph, schema, payload, self._sample_seed ^ 0x5A5A5A5A, started + seconds)
                seconds = max(0, seconds - (perf_counter() - started))
            result = _reference(self.model, payload, n, seed, seconds)
            if action == "compare":
                response = dict(token=self.token, sample_id=self.sample_id, query=result["query"],
                                data_estimate=estimate, scm_reference=result)
                if estimate["status"] == result["status"] == "OK":
                    response["difference"] = {c: value - result["values"][c] for c, value in estimate["values"].items()}
                return response
            return dict(result, token=self.token)
        if action == "sample":
            n = _integer(payload.get("n", 10), "rows", 1000)
            seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
            data = self.model.sample_observational(n, seed=seed)
            if not np.isfinite(data.to_numpy(dtype=float)).all():
                raise ValueError("The sample contains NaN/Inf. Change the function settings.")
            self._sample, self._sample_seed = data.copy(deep=True), seed
            self.sample_id += 1
            return {"columns": list(data.columns), "rows": data.head(10).to_numpy().tolist(), "shape": list(data.shape),
                    "csv": data.to_csv(index=False, float_format="%.17g"), "token": self.token,
                    "sample_id": self.sample_id, "source_seed": seed}
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
            self._sample, self._sample_seed = None, None
        elif action != "inspect":
            raise ValueError("Unknown editor action.")
        return {"token": self.token, "model": self.model.describe(), "node": name,
                "function": _function_info(self.model.equations[name])}
