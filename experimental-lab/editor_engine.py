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


def build_scm(payload, *, _random_clusters=None):
    """Draw model parameters once, independently of sample settings."""
    if not isinstance(payload, dict):
        raise ValueError("A JSON object is required.")
    nodes, edges = payload.get("nodes"), payload.get("edges", [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 100:
        raise ValueError("Use 1 to 100 nodes.")
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
    # Public node validation remains capped at eight. Only the validated local
    # Random Data adapter injects a larger, private baseline vector here.
    for name, spec in (_random_clusters or {}).items():
        size = spec["dimension"]
        graph.nodes[name].update(dimension=size, shape=() if size == 1 else (size,), columns=list(spec["members"]))
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


def _uca_schedule(tree, schema, actions, targets, deadline):
    """Freshen lexical sums, then require a normalized observational kernel DAG."""
    kernels, bound, suppliers = [], set(), {}
    remaining, serial = [2000], [0]

    def visit(node, env, depth=0):
        if perf_counter() >= deadline:
            raise TimeoutError("Sample estimator deadline exhausted.")
        remaining[0] -= 1
        if depth > 96 or remaining[0] < 0:
            raise NotImplementedError("UCA compiler size limit.")
        kind = node.get("type")
        if kind == "sum":
            local = dict(env)
            for argument in node["variables"]:
                serial[0] += 1
                key = "sum:" + str(serial[0])
                local[argument["label"]] = (argument["variable"], key)
                bound.add(key)
            visit(node["body"], local, depth + 1)
        elif kind == "product":
            for factor in node["factors"]:
                visit(factor, env, depth + 1)
        elif kind == "number" and float(node["value"]) == 1:
            return
        elif kind == "probability" and node.get("source") == "P":
            names = [a["variable"] for a in node["outcomes"] + node["given"]]
            if not node["outcomes"] or len(set(names)) != len(names) or any(v not in schema for v in names):
                raise NotImplementedError("UCA needs distinct observed source variables in each kernel.")

            def argument(a):
                name, label = a["variable"], a["label"]
                if label in env:
                    variable, key = env[label]
                    if variable != name:
                        raise NotImplementedError("UCA slot/source mismatch.")
                    return (name, key, None)
                if "value" in a or (label == name and name in actions):
                    value = a["value"] if "value" in a else actions[name]
                    return (name, None, _array(value, schema[name]["shape"]).reshape(-1))
                if label != name:
                    raise NotImplementedError("UCA has an unresolved bound copy.")
                return (name, "free:" + name, None)

            head, context = [argument(a) for a in node["outcomes"]], [argument(a) for a in node["given"]]
            keys = [key for _, key, _ in head + context if key is not None]
            if len(keys) != len(set(keys)) or any(key is None or key in suppliers for _, key, _ in head):
                raise NotImplementedError("UCA needs one distinct supplier per generated slot.")
            for _, key, _ in head:
                suppliers[key] = len(kernels)
            kernels.append((head, context))
        else:
            raise NotImplementedError("UCA Sample estimation supports complete P Sum/Product kernels, not ratio/Q/extract/add.")

    visit(tree, {})
    required = bound | {"free:" + v for v in targets}
    if set(suppliers) != required or len(kernels) > 64:
        raise NotImplementedError("UCA has unresolved slots or exceeds the kernel limit.")
    ordered, ready, pending = [], set(), list(kernels)
    while pending:
        index = next((i for i, (_, context) in enumerate(pending) if all(key is None or key in ready for _, key, _ in context)), None)
        if index is None:
            raise NotImplementedError("UCA kernel contexts have a cycle or no supplier.")
        head, context = pending.pop(index)
        ordered.append((head, context))
        ready.update(key for _, key, _ in head)
    return ordered


_EVENT_OPERATIONS = {"==": np.equal, "!=": np.not_equal, "<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal}


def _sample_event(payload, schema, targets):
    if payload.get("summary", "mean") != "probability":
        return None
    event = payload.get("event")
    columns = {column: v for v in targets for column in schema[v]["columns"]}
    if not isinstance(event, dict) or not event:
        raise ValueError("Probability requires an event on selected target columns.")
    for column, condition in event.items():
        if (column not in columns or not isinstance(condition, dict) or condition.get("op") not in _EVENT_OPERATIONS
                or type(condition.get("value")) not in (int, float) or not np.isfinite(condition["value"])):
            raise ValueError("Each event needs a selected target column, comparison operator and finite threshold.")
        if condition["op"] in {"==", "!="} and schema[columns[column]]["type"] not in {"binary", "categorical"}:
            raise NotImplementedError("Sample Probability supports continuous inequalities; equality requires a discrete target.")
    return event


def _event_hits(values, columns, event):
    hits = np.ones(len(values), dtype=bool)
    for column, condition in event.items():
        hits &= _EVENT_OPERATIONS[condition["op"]](values[:, columns.index(column)], condition["value"])
    return hits


def _estimate_uca_mean(data, graph, schema, payload, seed, deadline):
    """Approximate a certified UCA functional with normalized, observed-only kNN kernels."""
    extrapolate = payload.get("allow_continuous_extrapolation", True)
    if type(extrapolate) is not bool:
        raise ValueError("Allow continuous extrapolation must be true or false.")
    result = dict(status="UNSUPPORTED", method="UCA plug-in (normalized kNN kernels)", n=len(data), approximate=True,
                  diagnostics={"folds": 2, "data_uncertainty": "not estimated",
                               "limitations": "finite-sample kernel smoothing and integration error; sparse support",
                                "support_checks": "per-kernel/fold engineering checks, not a positivity certificate",
                                "allow_continuous_extrapolation": extrapolate})

    def fail(status, reason):
        return dict(result, status=status, reason=reason)

    try:
        event = _sample_event(payload, schema, payload["targets"])
    except NotImplementedError as error:
        return fail("UNSUPPORTED", str(error))
    from identification_engine import analyze
    actions, targets = payload["intervention"], payload["targets"]
    certificate = analyze(dict(nodes=[dict(name=v, observed=graph.nodes[v].get("observed", True),
        dimension=len(schema[v]["columns"]) if v in schema else graph.nodes[v].get("dimension", 1)) for v in graph],
        edges=[list(e) for e in graph.edges], X=list(actions), Y=targets, max_seconds=min(2, max(0, deadline-perf_counter())),
        max_orders=256, max_mc_unions=256))
    if certificate["identification"]["status"] != "IDENTIFIABLE":
        return fail("UNSUPPORTED", "No certified observable UCA formula for this query.")
    reason, schedule = "No accepted complete UCA producer for this query.", None
    for name in ("Tian", "WMC", "MC"):
        row = certificate["criteria"][name]
        if row["status"] != "ACCEPT" or not row.get("formula_tree"):
            continue
        if name == "MC" and certificate["indexed"].get("formula_status") != "COMPLETE":
            continue
        try:
            schedule = _uca_schedule(row["formula_tree"], schema, actions, targets, deadline)
            result.update(criterion=name, witness=row.get("witness"))
            break
        except NotImplementedError as error:
            reason = str(error)
        except TimeoutError as error:
            return fail("UNKNOWN", str(error))
    if schedule is None:
        if (perf_counter() >= deadline or any(certificate["criteria"][name]["status"] == "UNKNOWN" for name in ("Tian", "WMC", "MC"))
                or certificate["indexed"].get("formula_status") == "UNKNOWN"):
            return fail("UNKNOWN", "UCA search or formula expansion is unfinished.")
        return fail("UNSUPPORTED", reason)
    columns = [c for v in schema for c in schema[v]["columns"]]
    matrix, positions = data[columns].to_numpy(dtype=float), {c: i for i, c in enumerate(columns)}
    if not np.isfinite(matrix).all() or np.max(np.abs(matrix), initial=0) > 1e150:
        return fail("UNKNOWN", "UCA data exceeds the supported numerical range.")
    indices = lambda variables: [positions[c] for v in variables for c in schema[v]["columns"]]
    rng = np.random.default_rng(seed)
    fold = np.empty(len(data), dtype=int)
    fold[rng.permutation(len(data))] = np.arange(len(data)) % 2
    predictions, diagnostics = [], []

    def nearest(train, query, k):
        distance = np.maximum(0, (query*query).sum(axis=1)[:, None] + (train*train).sum(axis=1)[None, :] - 2*query@train.T)
        chosen = np.argpartition(distance, k-1, axis=1)[:, :k]
        return chosen, np.take_along_axis(distance, chosen, axis=1).max(axis=1)

    for heldout in (0, 1):
        training, evaluation = matrix[fold != heldout], matrix[fold == heldout]
        values = {}
        for stage, (head, context) in enumerate(schedule):
            if perf_counter() >= deadline:
                return fail("UNKNOWN", "Sample estimator deadline exhausted.")
            read_later = {key for _, given in schedule[stage+1:] for _, key, _ in given}
            terminal = event is None and not any(key in read_later for _, key, _ in head)
            h = indices(v for v, _, _ in head)
            output = np.empty((len(evaluation), len(h)))
            diagnostic = dict(fold=heldout, stage=stage, head=[v for v, _, _ in head], context=[v for v, _, _ in context],
                              terminal_mean=terminal, weak_rows=0, off_range_rows=0, k=[])
            if not context:
                source = evaluation[:, h]
                output[:] = source.mean(axis=0) if terminal else source[rng.integers(len(source), size=len(evaluation))]
            else:
                q = np.concatenate([np.broadcast_to(fixed, (len(evaluation), len(fixed))) if key is None else values[key]
                                    for _, key, fixed in context], axis=1)
                x = training[:, indices(v for v, _, _ in context)]
                factual = evaluation[:, indices(v for v, _, _ in context)]
                discrete = np.array([schema[v]["type"] in {"binary", "categorical"} for v, _, _ in context
                                     for _ in schema[v]["columns"]])
                fixed = np.array([key is None for v, key, _ in context for _ in schema[v]["columns"]])
                groups = np.unique(q[:, discrete], axis=0) if discrete.any() else np.zeros((1, 0))
                for group in groups:
                    test = np.flatnonzero(np.all(q[:, discrete] == group, axis=1))
                    eligible = np.all(x[:, discrete] == group, axis=1)
                    source, observed = training[eligible][:, h], x[eligible][:, ~discrete]
                    k = max(8, int(np.sqrt(len(source))))
                    if len(source) < 2*k:
                        return fail("UNKNOWN", "INSUFFICIENT_DATA: a UCA context has too few exact-match source rows.")
                    query = q[test][:, ~discrete]
                    constant = observed.std(axis=0) <= 1e-12
                    if np.any(query[:, constant] != observed[0, constant]):
                        return fail("UNKNOWN", "INSUFFICIENT_DATA: a constant UCA context does not match the query.")
                    outside = (query < observed.min(axis=0)) | (query > observed.max(axis=0))
                    violated = np.flatnonzero(fixed[~discrete] & outside.any(axis=0))
                    if len(violated):
                        context_columns = [c for v, _, _ in context for c in schema[v]["columns"]]
                        continuous_columns = np.asarray(context_columns)[~discrete]
                        result["diagnostics"].setdefault("fixed_range_violations", []).extend(
                            dict(fold=heldout, stage=stage, head=[v for v, _, _ in head],
                                 context=[v for v, _, _ in context], column=str(continuous_columns[i]),
                                 value=float(query[0, i]), observed_min=float(observed[:, i].min()),
                                 observed_max=float(observed[:, i].max()), discrete_group=group.tolist(), source_rows=len(source))
                            for i in violated)
                        if not extrapolate:
                            first = result["diagnostics"]["fixed_range_violations"][0]
                            return fail("UNKNOWN", f"INSUFFICIENT_DATA: {first['column']}={first['value']:.8g} is outside the observed training range "
                                        f"[{first['observed_min']:.8g}, {first['observed_max']:.8g}]. "
                                        "Select UCA extrapolation in Query options to compute an approximation.")
                    if not np.any(~constant):
                        output[test] = source.mean(axis=0) if terminal else source[rng.integers(len(source), size=len(test))]
                        diagnostic["k"].append(len(source))
                        continue
                    center, scale = observed.mean(axis=0), np.where(constant, 1, observed.std(axis=0))
                    normalized = (observed-center)/scale
                    matched = factual[np.all(factual[:, discrete] == group, axis=1)][:, ~discrete]
                    baseline_source = (matched-center)/scale if len(matched) else normalized
                    normalized_query = (query-center)/scale
                    if any(not np.isfinite(a).all() or np.max(np.abs(a), initial=0) > 1e150
                           for a in (normalized, baseline_source, normalized_query)):
                        return fail("UNKNOWN", "UCA context distances exceed the supported numerical range.")
                    radii = [nearest(normalized, baseline_source[start:start+64], k)[1]
                             for start in range(0, len(baseline_source), 64)]
                    baseline = max(float(np.median(np.concatenate(radii))), 1e-12)
                    for start in range(0, len(test), 64):
                        if perf_counter() >= deadline:
                            return fail("UNKNOWN", "Sample estimator deadline exhausted.")
                        chosen, radius = nearest(normalized, normalized_query[start:start+64], k)
                        off_range = outside[start:start+64].any(axis=1)
                        diagnostic["off_range_rows"] += int(off_range.sum())
                        diagnostic["weak_rows"] += int(np.count_nonzero(off_range | (radius > 9*baseline)))
                        rows = test[start:start+64]
                        output[rows] = source[chosen].mean(axis=1) if terminal else source[chosen[np.arange(len(rows)), rng.integers(k, size=len(rows))]]
                    diagnostic["k"].append(k)
            diagnostic["weak_fraction"] = diagnostic["weak_rows"]/len(evaluation)
            diagnostics.append(diagnostic)
            result["diagnostics"].update(kernels=diagnostics, worst_weak_fraction=max(d["weak_fraction"] for d in diagnostics),
                integration_rows=len(data), coverage_rule="warning if any kernel/fold has >5% off-range or >3x factual-radius queries")
            offset = 0
            for v, key, _ in head:
                width = len(schema[v]["columns"])
                values[key] = output[:, offset:offset+width]
                offset += width
        predictions.append(np.concatenate([values["free:"+v] for v in targets], axis=1))
    draws = np.concatenate(predictions)
    if not np.isfinite(draws).all():
        return fail("UNKNOWN", "UCA kernels produced nonfinite values.")
    outcomes = [c for v in targets for c in schema[v]["columns"]]
    mean = _event_hits(draws, outcomes, event).mean(keepdims=True) if event is not None else draws.mean(axis=0)
    if not np.isfinite(mean).all():
        return fail("UNKNOWN", "UCA kernels produced nonfinite values.")
    if perf_counter() >= deadline:
        return fail("UNKNOWN", "Sample estimator deadline exhausted.")
    if result["diagnostics"].get("fixed_range_violations"):
        result["extrapolated"] = True
        result["info"] = "Approximate estimate; continuous extrapolation used."
    elif result["diagnostics"]["worst_weak_fraction"] > .05:
        result["warning"] = "Approximate estimate; weak empirical coverage may make it unreliable."
    return dict(result, status="OK", values=dict(zip(["Probability"] if event is not None else outcomes, mean.tolist())))


def _estimate_mean(data, graph, schema, payload, seed, deadline):
    """Fit adjustment using only observed data, graph and public column/type metadata.

    Two folds train kNN on one half and standardize over the other half's Z.
    Support cutoffs are engineering diagnostics, not a proof of positivity.
    Finite-sample smoothing bias remains; no data standard error is asserted.
    """
    result = dict(status="UNSUPPORTED", method="2-fold kNN g-computation", n=len(data), approximate=True,
                  diagnostics={"folds": 2, "data_uncertainty": "not estimated",
                               "limitations": "kNN smoothing bias and high-dimensional sparse support",
                               "support_checks": "empirical engineering checks, not a positivity certificate"})

    def fail(status, reason):
        return dict(result, status=status, reason=reason)

    if payload.get("summary") == "mean_difference":
        result.update(method="difference of two interventional Sample means", approximate=True)
        if payload.get("type", "interventional") not in {"interventional", "counterfactual"} or payload.get("evidence"):
            return fail("UNSUPPORTED", "Sample Mean difference requires no factual evidence.")
        targets = payload.get("targets")
        if (not isinstance(targets, list) or not targets or len(targets) != len(set(targets))
                or any(v not in schema for v in targets)):
            raise ValueError("Use observed whole-node targets.")
        if len(targets) != 1:
            return fail("UNSUPPORTED", "Use one outcome node for Mean difference; choose Probability for joint events.")
        actions = [("Intervention", payload.get("intervention", {})), ("Reference", payload.get("reference"))]
        for label, values in actions:
            if not isinstance(values, dict) or any(v not in schema for v in values):
                raise ValueError(f"{label} must contain observed whole-node values.")
            for v, value in values.items():
                value = _array(value, schema[v]["shape"])
                if schema[v]["type"] == "binary" and not np.isin(value, [0, 1]).all():
                    raise ValueError(f"{label}: binary intervention values must be 0 or 1.")
        started = perf_counter()
        arms = {}
        result["diagnostics"]["arms"] = arms
        for i, (label, values) in enumerate(actions):
            arm_deadline = started + max(0, deadline - started) / 2 if i == 0 else deadline
            arms[label] = _estimate_mean(data, graph, schema,
                dict(payload, type="interventional", summary="mean", intervention=values, evidence={}), seed, arm_deadline)
            if arms[label]["status"] != "OK":
                return fail(arms[label]["status"], f"{label} mean: {arms[label].get('reason', arms[label]['status'])}")
        outcomes = [c for v in targets for c in schema[v]["columns"]]
        first, second = (arm.get("values", {}) for arm in arms.values())
        if (set(first) != set(outcomes) or set(second) != set(outcomes)
                or not np.isfinite([*first.values(), *second.values()]).all()):
            return fail("UNKNOWN", "The two Sample means must have matching finite target coordinates.")
        difference = {c: first[c] - second[c] for c in outcomes}
        if not np.isfinite(list(difference.values())).all():
            return fail("UNKNOWN", "Sample Mean difference produced nonfinite values.")
        if perf_counter() >= deadline:
            return fail("UNKNOWN", "Sample estimator deadline exhausted.")
        messages = list(dict.fromkeys(arm[field] for arm in arms.values()
                                     for field in ("info", "warning") if arm.get(field)))
        if messages:
            result["info"] = " ".join(messages)
        if any(arm.get("extrapolated") for arm in arms.values()):
            result["extrapolated"] = True
        return dict(result, status="OK", values=difference)

    if payload.get("type", "interventional") != "interventional" or payload.get("summary", "mean") not in {"mean", "probability"} or payload.get("evidence"):
        return fail("UNSUPPORTED", "Sample estimation supports Interventional Mean or Probability without evidence.")
    targets, actions = payload.get("targets"), payload.get("intervention", {})
    if (not isinstance(targets, list) or not targets or len(targets) != len(set(targets))
            or any(v not in schema for v in targets) or not isinstance(actions, dict) or any(v not in schema for v in actions)):
        raise ValueError("Use observed whole-node targets and intervention names.")
    if set(targets) & set(actions):
        return fail("UNSUPPORTED", "For Sample estimation, targets must differ from intervention nodes.")
    try:
        event = _sample_event(payload, schema, targets)
    except NotImplementedError as error:
        return fail("UNSUPPORTED", str(error))
    constants = {v: _array(value, schema[v]["shape"]).reshape(-1) for v, value in actions.items()}
    if any(schema[v]["type"] == "binary" and not np.isin(a, [0, 1]).all() for v, a in constants.items()):
        raise ValueError("Binary intervention values must be 0 or 1.")
    if len(data) < 128:
        return fail("UNKNOWN", "INSUFFICIENT_DATA: generate at least 128 rows (512 recommended).")
    if perf_counter() >= deadline:
        return fail("UNKNOWN", "Sample estimator deadline exhausted.")
    outcomes = [c for v in targets for c in schema[v]["columns"]]
    if not actions:
        if event is not None:
            raw = data[outcomes].to_numpy(dtype=float)
            if not np.isfinite(raw).all():
                return fail("UNKNOWN", "Sample targets contain nonfinite values.")
            values = {"Probability": float(_event_hits(raw, outcomes, event).mean())}
        else:
            values = dict(zip(outcomes, data[outcomes].mean().to_numpy().tolist()))
        if perf_counter() >= deadline:
            return fail("UNKNOWN", "Sample estimator deadline exhausted.")
        return dict(result, status="OK", method="observed sample joint-event rate" if event is not None else "observed sample mean",
                    adjustment=[], criterion="observational", values=values)
    from adjustment import construct_minimum_adjustment_set, check_adjustment_criterion, check_backdoor_criterion
    try:
        adjustment = construct_minimum_adjustment_set(graph, list(actions), targets)
    except ValueError:
        return _estimate_uca_mean(data, graph, schema, payload, seed, deadline)
    if (any(v not in schema for v in adjustment)
            or not check_adjustment_criterion(graph, list(actions), targets, adjustment)):
        return fail("UNSUPPORTED", "No verified adjustment witness for the original query.")
    result.update(adjustment=adjustment, criterion="BD" if check_backdoor_criterion(graph, list(actions), targets, adjustment) else "AC")
    discrete = {v for v in [*actions, *adjustment] if schema[v]["type"] in {"binary", "categorical"}}
    action_columns = [c for v in actions if v not in discrete for c in schema[v]["columns"]]
    features = action_columns + [c for v in adjustment if v not in discrete for c in schema[v]["columns"]]
    finite_covariates = [c for v in adjustment if v in discrete for c in schema[v]["columns"]]
    x, y = data[features].to_numpy(dtype=float), data[outcomes].to_numpy(dtype=float)
    if event is not None:
        if not np.isfinite(y).all():
            return fail("UNKNOWN", "Sample targets contain nonfinite values.")
        y = _event_hits(y, outcomes, event).astype(float)[:, None]
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
        indices, radii = [], []
        for start in range(0, len(test), 64):
            if perf_counter() >= deadline:
                raise TimeoutError
            block = test[start:start+64]
            distances = np.maximum(0, (block * block).sum(axis=1)[:, None]
                                   + (train * train).sum(axis=1)[None, :] - 2 * block @ train.T)
            if not np.isfinite(distances).all():
                raise FloatingPointError
            nearest = np.argpartition(distances, k - 1, axis=1)[:, :k]
            indices.append(nearest)
            radii.append(np.take_along_axis(distances, nearest, axis=1).max(axis=1))
        return np.concatenate(indices), np.concatenate(radii)

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
            if not np.isfinite(center).all() or not np.isfinite(scale).all():
                return fail("UNKNOWN", "Sample estimator produced nonfinite feature scales.")
            scale = np.where(scale > 0, scale, 1)
            training, query = (x[train] - center) / scale, (requested[test] - center) / scale
            if not features or not np.any(x[train].std(axis=0)):
                if features and not np.all(query == training[0]):
                    return fail("UNKNOWN", "INSUFFICIENT_DATA: constant training features do not cover the query.")
                predictions[test] = y[train].mean(axis=0)
                sizes.append(len(train))
                continue
            try:
                nearest, radius = neighbors(training, query, k)
                _, factual_radius = neighbors(training, (x[test] - center) / scale, k)
            except TimeoutError:
                return fail("UNKNOWN", "Sample estimator deadline exhausted.")
            except FloatingPointError:
                return fail("UNKNOWN", "Sample estimator produced nonfinite distances.")
            baseline = np.maximum(factual_radius, 1e-12)
            poor_coverage += int(np.count_nonzero(radius > 9 * baseline))
            radii.extend((radius / baseline).tolist())
            predictions[test] = y[train[nearest]].mean(axis=1)
            sizes.append(k)
    result["diagnostics"].update(poor_coverage_fraction=poor_coverage / len(data),
                                 max_squared_radius_ratio=max(radii, default=0),
                                 coverage_rule="warn if >5% rows exceed 3x their factual neighbor radius")
    result["k"] = sorted(set(sizes))
    values = predictions.mean(axis=0)
    if not np.isfinite(values).all():
        return fail("UNKNOWN", "Sample estimator produced nonfinite values.")
    if perf_counter() >= deadline:
        return fail("UNKNOWN", "Sample estimator deadline exhausted.")
    if poor_coverage > .05 * len(data):
        result["info"] = "Approximate estimate; weak empirical coverage."
    return dict(result, status="OK", values=dict(zip(["Probability"] if event is not None else outcomes, values.tolist())))


def _reference(model, payload, n, seed, seconds):
    """Verified scalar linear means/contrasts; otherwise existing paired simulation."""
    started = perf_counter()
    options = dict(query_type=payload.get("type", "interventional"),
                   intervention=payload.get("intervention", {}), evidence=payload.get("evidence", {}),
                   reference=payload.get("reference"), summary=payload.get("summary", "mean"),
                   event=payload.get("event"), n=n, seed=seed)
    contrast = options["summary"] == "mean_difference"
    if (seconds > 0 and not options["evidence"] and options["summary"] in {"mean", "mean_difference"}
            and (options["query_type"] == "interventional" or contrast and options["query_type"] == "counterfactual")):
        # Zero-budget validation draws nothing and preserves the original query metadata.
        query = model.query(payload.get("targets"), **options, max_seconds=0)["query"]
        order = list(nx.topological_sort(model.graph))
        linear_code = next(c for c in _make_equation.__code__.co_consts
                           if isinstance(c, CodeType) and c.co_name == "equation")

        def linear_means(actions):
            needed = set(query["targets"])
            for v in reversed(order):
                if v in needed and v not in actions:
                    needed.update(model.graph.predecessors(v))
            means = {}
            for v in (v for v in order if v in needed):
                if perf_counter() - started >= seconds or model._variables[v]["shape"] != ():
                    return None
                if v in actions:
                    means[v] = float(actions[v])
                    continue
                function = model.equations[v]
                if model._uses_legacy_rng(v):
                    return None
                noise = model.noise_distributions.get(v)
                noise = noise.distribution if isinstance(noise, U) else noise
                if noise is not None and (not isinstance(noise, rv_frozen) or noise.dist.name not in {"norm", "uniform"}
                        or getattr(noise.rvs, "__func__", None) is not rv_frozen.rvs
                        or getattr(noise.mean, "__func__", None) is not rv_frozen.mean):
                    return None
                mean_noise = np.asarray(0 if noise is None else noise.mean())
                if mean_noise.shape or not np.isfinite(mean_noise):
                    return None
                if function is _noise_value and not model._variables[v]["observed"] and not model.graph.in_degree(v):
                    means[v] = float(mean_noise)
                elif getattr(function, "__code__", None) is linear_code:
                    bindings = dict(zip(function.__code__.co_freevars, (c.cell_contents for c in function.__closure__)))
                    coefficients, intercept = bindings["coefficients"], bindings["intercept"]
                    if (bindings["kind"] != "linear" or set(coefficients) != set(model.graph.predecessors(v))
                            or not np.isfinite([intercept, *coefficients.values()]).all()):
                        return None
                    means[v] = float(intercept + sum(c * means[p] for p, c in coefficients.items()) + mean_noise)
                else:
                    return None
                if not np.isfinite(means[v]):
                    return None
            return {model._variables[v].get("columns", [v])[0]: means[v] for v in query["targets"]}

        worlds = [linear_means(query["intervention"])]
        if contrast and worlds[0] is not None:
            worlds.append(linear_means(query["reference"]))
        if all(world is not None for world in worlds) and (not contrast or len(worlds) == 2):
            values = {c: value - worlds[1][c] if contrast else value for c, value in worlds[0].items()}
            if perf_counter() - started < seconds and np.isfinite(list(values.values())).all():
                result = dict(status="OK", approximate=False, query=query, values=values,
                              diagnostics={"method": "analytic linear expectation", "n": 0,
                                           "conditioning": "none", "elapsed_seconds": perf_counter() - started})
                if contrast:
                    result.update(intervention_values=worlds[0], reference_values=worlds[1])
                return result
    return model.query(payload.get("targets"), **options, max_seconds=max(0, seconds - (perf_counter() - started)))


def _data_graph(payload):
    """Validate public graph metadata without constructing a simulated SCM."""
    from identification_engine import _graph
    graph = _graph(payload)
    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("The data graph must be acyclic.")
    schema = {}
    for node in payload["nodes"]:
        name = node["name"]
        dimension = node.get("dimension", 1)
        graph.nodes[name].update(shape=() if dimension == 1 else (dimension,), columns=[name])
        if node.get("observed", True):
            kind = node.get("variable_type") or ("binary" if node.get("family") == "binary" else "continuous")
            if node.get("family") == "binary" and kind != "binary":
                raise ValueError("A binary family cannot be declared as a continuous variable type.")
            if kind not in {"binary", "continuous", "categorical"}:
                raise ValueError("Data-only estimation supports binary, continuous, or numeric-coded categorical variables only.")
            schema[name] = {"shape": () if dimension == 1 else (dimension,), "columns": [name], "type": kind}
    if not schema:
        raise ValueError("The graph must contain an observed variable.")
    return graph, schema


def _data_graph_key(graph, schema, include_types=True):
    # Positions and display metadata do not change an observational dataset.
    import hashlib
    nodes = [(name, bool(attrs.get("observed", True)), attrs.get("dimension", 1),
              schema.get(name, {}).get("type") if include_types else None)
             for name, attrs in sorted(graph.nodes(data=True))]
    value = [nodes, sorted(graph.edges())]
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()


def _data_query(payload, schema):
    if payload.get("type", "interventional") != "interventional" or payload.get("summary", "mean_difference") != "mean_difference" or payload.get("evidence"):
        return "Data-only estimation supports interventional Mean difference without factual evidence."
    targets = payload.get("targets")
    if not isinstance(targets, list) or len(targets) != 1 or targets[0] not in schema:
        return "Select one observed scalar outcome per data-only estimate."
    if schema[targets[0]]["shape"]:
        return "Data-only estimation currently requires a scalar outcome; clusters are covariates only."
    if schema[targets[0]]["type"] == "categorical":
        return "Categorical outcomes are not supported by data-only mean estimation."
    actions, reference = payload.get("intervention"), payload.get("reference")
    if not isinstance(actions, dict) or not isinstance(reference, dict) or set(actions) != set(reference):
        raise ValueError("Intervention and reference must contain the same observed action names.")
    if any(name in schema and schema[name]["shape"] for name in actions):
        return "Data-only estimation currently requires scalar actions; clusters are covariates only."
    if any(name in schema and schema[name]["type"] == "categorical" for name in actions):
        return "Categorical actions are not supported by this data-only adapter."
    for label, values in (("Intervention", actions), ("Reference", reference)):
        for name, value in values.items():
            if name not in schema or type(value) not in (int, float) or not np.isfinite(value):
                raise ValueError(f"{label}: use finite numeric values for observed scalar actions.")
            if schema[name]["type"] == "binary" and value not in (0, 1):
                raise ValueError(f"{label}: binary action values must be 0 or 1.")
    if targets[0] in actions:
        return "The outcome must differ from the intervention nodes."
    return None


def _bound_columns(data, public_schema, mapping, column_types, codebooks):
    """Bind ordered source columns to whole logical nodes without graph edits."""
    if not isinstance(mapping, dict) or set(mapping) != set(public_schema):
        raise ValueError("Map every observed variable to an existing CSV column or ordered column list.")
    if not isinstance(column_types, dict) or any(c not in data.columns or t not in {"binary", "continuous", "categorical"} for c, t in column_types.items()):
        raise ValueError("column_types must name existing columns and binary, continuous or categorical types.")
    if not isinstance(codebooks, dict) or any(c not in data.columns or not isinstance(book, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in book.items()) for c, book in codebooks.items()):
        raise ValueError("Codebooks must map numeric-code strings to labels for existing columns.")
    for source, book in codebooks.items():
        try:
            codes = [float(k) for k in book]
        except (ValueError, TypeError):
            raise ValueError("Codebook keys must be finite numeric-code strings.") from None
        if not all(np.isfinite(codes)) or len(set(codes)) != len(codes):
            raise ValueError("Codebook codes must be finite and numerically unique.")
        if not set(np.unique(data[source].to_numpy(dtype=float))) <= set(codes):
            raise ValueError("The codebook must label every observed code in its CSV column.")
    used_sources, used_names = set(), set(public_schema) | set(data.columns)
    selected, schema, bindings = {}, {}, {}
    for name, spec in public_schema.items():
        value = mapping[name]
        cluster = isinstance(value, list)
        members = value if cluster else [value]
        if (not members or any(not isinstance(c, str) or c not in data.columns for c in members)
                or len(members) != len(set(members)) or used_sources.intersection(members)):
            raise ValueError("Every scalar or cluster member needs a distinct existing CSV column; columns cannot be reused.")
        if not cluster and spec["shape"]:
            raise ValueError("Use an ordered column list to bind a vector-valued covariate.")
        used_sources.update(members)
        physical, components = [], []
        for i, source in enumerate(members):
            kind = column_types.get(source, spec["type"])
            if not cluster and kind != spec["type"]:
                raise ValueError("A scalar column type must agree with the unchanged graph variable type.")
            if spec["type"] == "binary" and kind != "binary":
                raise ValueError("A binary variable cannot be rebound as a nonbinary column.")
            values = data[source].to_numpy(dtype=float)
            if kind == "binary" and not np.isin(values, [0, 1]).all():
                raise ValueError(f"CSV column {source} mapped to {name}: binary values must be 0 or 1.")
            column = name if not cluster else f"__binding__{name}_{i}"
            if cluster:
                while column in used_names:
                    column += "_"
            used_names.add(column)
            selected[column] = values.copy()
            physical.append(column)
            component = dict(column=source, type=kind)
            if kind in {"binary", "categorical"}:
                component["codes"] = np.unique(values).tolist()
            if source in codebooks:
                component["codebook"] = copy.deepcopy(codebooks[source])
            components.append(component)
        kind = "continuous" if cluster else components[0]["type"]
        schema[name] = dict(shape=(len(physical),) if cluster else (), columns=physical, type=kind,
                            cluster=cluster, source_columns=list(members),
                            component_types=[c["type"] for c in components])
        bindings[name] = dict(members=list(members), dimension=len(members),
            kind="covariate_cluster" if cluster else "scalar", components=components)
    import pandas as pd
    return pd.DataFrame(selected), schema, bindings


def _cluster_adjustment_guard(graph, schema, payload):
    clusters = [v for v, spec in schema.items() if spec.get("cluster")]
    if not clusters:
        return None, None
    actions, targets = list(payload.get("intervention", {})), payload["targets"]
    if any(c in actions or c in targets or any(c in nx.descendants(graph, a) for a in actions) for c in clusters):
        return "Covariate clusters must be separate baseline variables, not actions, outcomes or descendants of treatment.", None
    from adjustment import construct_minimum_adjustment_set, check_adjustment_criterion, check_backdoor_criterion
    try:
        witness = construct_minimum_adjustment_set(graph, actions, targets)
    except ValueError:
        return "The current graph has no verified BD/AC adjustment witness for this covariate-cluster binding.", None
    if not set(clusters) <= set(witness) or not check_adjustment_criterion(graph, actions, targets, witness):
        return "Every covariate cluster must belong to the verified BD/AC adjustment witness for the unchanged graph.", None
    return None, dict(criterion="BD" if check_backdoor_criterion(graph, actions, targets, witness) else "AC",
                      adjustment=list(witness), clusters=clusters)


def _categorical_feature_view(data, schema, payload):
    """Lossless covariate-only feature view; the original graph/data stay intact."""
    mode = payload.get("categorical_encoding", "exact")
    if mode not in {"exact", "one_hot"}:
        raise ValueError("categorical_encoding must be exact or one_hot.")
    categorical = []
    for name, spec in schema.items():
        types = spec.get("component_types", [spec["type"]] * len(spec["columns"]))
        if len(types) != len(spec["columns"]):
            raise ValueError("Every bound coordinate must retain its component type.")
        for i, (column, kind) in enumerate(zip(spec["columns"], types)):
            if kind == "categorical":
                categorical.append((name, i, column))
    if mode == "exact":
        if any(schema[name].get("cluster") for name, _, _ in categorical):
            raise ValueError("Categorical cluster components require the explicit one_hot feature view; ordinal codes are not used as distances.")
        return data, schema, None
    actions = set(payload.get("intervention", {})) | set(payload.get("reference", {}))
    if {name for name, _, _ in categorical} & (actions | set(payload.get("targets", []))):
        raise ValueError("One-hot feature views are for categorical covariates only.")
    levels_by_column = {column: np.unique(data[column].to_numpy(dtype=float)) for _, _, column in categorical}
    temporary_columns = len(data.columns) + sum(len(levels) for levels in levels_by_column.values())
    if temporary_columns > 100 or len(data) * temporary_columns > 500000:
        raise ValueError("The full one-hot feature view exceeds 100 temporary columns or 500000 cells; no categories were dropped.")
    view, metadata = data.copy(deep=True), copy.deepcopy(schema)
    encodings, replacement, used_columns = {}, {}, set(data.columns)
    for name, index, source in categorical:
        levels = levels_by_column[source]
        columns = []
        for i in range(len(levels)):
            column = f"__onehot__{name}_{index}_{i}"
            # Preserve legacy scalar names while avoiding every existing column.
            if not schema[name].get("cluster"):
                column = f"__onehot__{name}_{i}"
            while column in used_columns:
                column += "_"
            used_columns.add(column)
            columns.append(column)
        values = data[source].to_numpy(dtype=float)
        for code, column in zip(levels, columns):
            view[column] = (values == code).astype(float)
        replacement[source] = columns
        encodings[source] = dict(codes=levels.tolist(), columns=columns, logical_node=name,
            member=schema[name].get("source_columns", schema[name]["columns"])[index])
    for name in {name for name, _, _ in categorical}:
        columns = [new for old in schema[name]["columns"] for new in replacement.get(old, [old])]
        metadata[name].update(shape=(len(columns),), columns=columns, type="continuous",
                              component_types=["continuous"] * len(columns))
    return view, metadata, dict(mode="full_one_hot_covariates", original_rows=len(data),
        logical_categorical_variables=sorted({name for name, _, _ in categorical}), encodings=encodings,
        information="All categories and cluster coordinates retained; temporary feature vectors only. The causal graph and original dataset are unchanged.",
        limitations="Existing kNN standardizes features; no equal-distance or encoding-invariant estimate is asserted.")


def _random_cluster_specs(payload):
    sizes, members = payload.get("random_cluster_sizes", {}), payload.get("random_cluster_members", {})
    if not isinstance(sizes, dict) or not isinstance(members, dict) or set(members) - set(sizes):
        raise ValueError("Random cluster sizes and ordered members must be variable-name dictionaries.")
    graph, schema = _data_graph(payload)
    nodes = {node["name"]: node for node in payload["nodes"]}
    specs = {}
    continuous = {"linear", "quadratic", "bounded", "neural_network", "decision_tree"}
    for name, size in sizes.items():
        if name not in schema or schema[name]["type"] != "continuous" or nodes[name].get("dimension", 1) != 1:
            raise ValueError("Random clusters require an observed continuous node with public dimension 1.")
        if nodes[name].get("family") not in continuous:
            raise ValueError("Choose an explicit continuous mechanism family for each Random covariate cluster.")
        size = _integer(size, "Random covariate dimension", 50)
        if size < 1:
            raise ValueError("Random covariate dimension must be 1 to 50.")
        default = [name] if size == 1 else ([f"x{i+1}" for i in range(size)] if name == "X" else [f"{name}_{i+1}" for i in range(size)])
        columns = members.get(name, default)
        if (not isinstance(columns, list) or len(columns) != size
                or any(not isinstance(c, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", c) for c in columns)
                or len(set(columns)) != len(columns)):
            raise ValueError("The declared member list must contain exactly dimension unique valid column names.")
        specs[name] = dict(dimension=size, members=list(columns))
    columns = [c for name in schema for c in (specs[name]["members"] if name in specs else
               ([name] if not schema[name]["shape"] else [f"{name}[{i}]" for i in range(schema[name]["shape"][0])]))]
    if len(columns) > 100 or len(columns) != len(set(columns)):
        raise ValueError("Random Data requires at most 100 distinct physical output columns; member names cannot collide.")
    return specs


def _random_public_graph_key(payload, model):
    graph, schema = _data_graph(payload)
    for node in payload["nodes"]:
        name = node["name"]
        if name in schema and name in model._variables and node.get("family", "random") == "random" and not node.get("variable_type"):
            schema[name]["type"] = model._variables[name]["variable_type"]
    return _data_graph_key(graph, schema)


def _random_config_key(public_key, specs, payload):
    if not specs:
        return None
    import hashlib
    families = sorted((node["name"], node.get("family"), node.get("variable_type")) for node in payload["nodes"])
    return hashlib.sha256(json.dumps([public_key, specs, payload.get("model_seed", 7), payload.get("noise", "random"), families],
                                    sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _random_schema(model, specs):
    schema, bindings = {}, {}
    for name, details in model._variables.items():
        if not details["observed"]:
            continue
        columns = list(details.get("columns", [name]))
        spec = dict(shape=details["shape"], columns=columns, type=details["variable_type"])
        if name in specs:
            size = specs[name]["dimension"]
            if (len(columns) != size or columns != specs[name]["members"]
                    or details["shape"] != (() if size == 1 else (size,)) or details["variable_type"] != "continuous"):
                raise ValueError("Random cluster shape, type and generated columns disagree.")
            spec.update(cluster=True, source_columns=columns, component_types=[spec["type"]] * len(columns))
            bindings[name] = dict(kind="random_covariate_cluster", dimension=len(columns), members=columns,
                                 components=[dict(column=c, type=spec["type"]) for c in columns])
        schema[name] = spec
    return schema, bindings


def _paired_vector_reference(model, schema, payload, n, seed, seconds):
    """Bounded no-evidence reference using the existing interventional sampler."""
    started = perf_counter()
    result = dict(status="UNKNOWN", approximate=True,
                  query=dict(type="interventional", summary="mean_difference", targets=list(payload["targets"]),
                             intervention=payload["intervention"], reference=payload["reference"], evidence={}, n=n, data_seed=seed),
                  diagnostics=dict(method="paired interventional sampling", n=n, conditioning="none",
                                   binary_coupling="shared per-variable random streams", max_physical_cells=500000))
    columns = [c for spec in schema.values() for c in spec["columns"]]
    if len(columns) > 100 or 2 * n * len(columns) > 500000:
        return dict(result, status="UNSUPPORTED", reason="The two reference frames exceed 100 physical columns or 500000 combined cells.")
    targets = [c for name in payload["targets"] for c in schema[name]["columns"]]
    worlds = []
    for action in (payload["intervention"], payload["reference"]):
        if perf_counter() - started >= seconds:
            return dict(result, reason="Model reference deadline exhausted; no partial reference value is returned.")
        try:
            frame = model.sample_interventional(action, n, seed=seed)
        except (ValueError, FloatingPointError, OverflowError) as error:
            return dict(result, reason="Model reference sampling failed: " + str(error))
        if list(frame.columns) != columns or len(frame) != n or not np.isfinite(frame.to_numpy(dtype=float)).all():
            return dict(result, reason="Model reference sampling produced inconsistent or nonfinite rows.")
        worlds.append(frame[targets].to_numpy(dtype=float))
    if perf_counter() - started >= seconds:
        return dict(result, reason="Model reference deadline exhausted; no partial reference value is returned.")
    difference = worlds[0] - worlds[1]
    values, errors = difference.mean(axis=0), difference.std(axis=0, ddof=1) / np.sqrt(n)
    if not np.isfinite(values).all() or not np.isfinite(errors).all():
        return dict(result, reason="Model reference mean or Monte Carlo standard error is nonfinite.")
    primary_mean, baseline_mean = worlds[0].mean(axis=0), worlds[1].mean(axis=0)
    if not np.isfinite(primary_mean).all() or not np.isfinite(baseline_mean).all():
        return dict(result, reason="Model reference arm means are nonfinite.")
    elapsed = perf_counter() - started
    if elapsed >= seconds:
        return dict(result, reason="Model reference deadline exhausted; no partial reference value is returned.")
    result["diagnostics"]["elapsed_seconds"] = elapsed
    return dict(result, status="OK", values=dict(zip(targets, values.tolist())), standard_errors=dict(zip(targets, errors.tolist())),
                intervention_values=dict(zip(targets, primary_mean.tolist())),
                reference_values=dict(zip(targets, baseline_mean.tolist())))


class Editor:
    """One browser session owns one fixed SCM; sampling never rebuilds it."""

    def __init__(self):
        self.model = None
        self.token = 0
        self.sample_id = 0
        self._sample = None
        self._sample_seed = None
        self.data_id = 0
        self._uploaded = None
        self._random_key = None
        self._random_public_key = None
        self._random_public_payload = None
        self._random_specs = {}
        self._random_bindings = {}

    def request(self, action, payload):
        if not isinstance(payload, dict):
            raise ValueError("A JSON object is required.")
        if action == "load_data":
            # A failed replacement invalidates the previous dataset as well.
            self.data_id += 1
            self._uploaded = None
            graph, schema = _data_graph(payload)
            columns, rows, mapping = payload.get("columns"), payload.get("rows"), payload.get("mapping")
            if (not isinstance(columns, list) or not 1 <= len(columns) <= 100
                    or any(not isinstance(c, str) or not c.strip() for c in columns)
                    or len(set(columns)) != len(columns)):
                raise ValueError("Use 1 to 100 unique, nonblank CSV column headers.")
            if not isinstance(rows, list) or not 1 <= len(rows) <= 5000 or len(rows) * len(columns) > 500000:
                raise ValueError("Use 1 to 5000 numeric rows and at most 500000 selected cells.")
            for i, row in enumerate(rows, 1):
                if not isinstance(row, list) or len(row) != len(columns):
                    raise ValueError(f"CSV row {i}: the number of cells must match the headers.")
                for j, value in enumerate(row):
                    if type(value) not in (int, float) or not np.isfinite(value):
                        raise ValueError(f"CSV row {i}, column {columns[j]}: a finite number is required.")
            import pandas as pd
            key = _data_graph_key(graph, schema)
            frame, schema, bindings = _bound_columns(pd.DataFrame(rows, columns=columns), schema, mapping,
                payload.get("column_types", {}), payload.get("column_codebooks", {}))
            seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
            import hashlib
            binding_key = hashlib.sha256(json.dumps([key, bindings], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            self._uploaded = dict(data=frame, graph=graph, schema=schema, seed=seed, graph_key=key,
                                 binding_key=binding_key, bindings=bindings)
            return dict(status="READY", source="csv", data_id=self.data_id, graph_key=key, binding_key=binding_key,
                        n=len(rows), columns=list(schema), data_columns=list(columns), bindings=bindings)
        if action == "estimate_data":
            source = payload.get("source")
            requested_graph, requested_schema = _data_graph(payload)
            if source == "csv":
                if self._uploaded is None or type(payload.get("data_id")) is not int or payload["data_id"] != self.data_id:
                    raise ValueError("CSV data expired. Load and map the CSV again.")
                state = self._uploaded
                if _data_graph_key(requested_graph, requested_schema) != state["graph_key"]:
                    raise ValueError("The graph or variable types changed. Load and map the CSV again.")
                if (any(spec.get("cluster") for spec in state["schema"].values()) or "binding_key" in payload) and payload.get("binding_key") != state["binding_key"]:
                    raise ValueError("Column binding expired. Load the current scalar/cluster mapping again.")
                data, graph, schema, seed = (state[k] for k in ("data", "graph", "schema", "seed"))
                response = dict(source=source, data_id=self.data_id, graph_key=state["graph_key"],
                                binding_key=state["binding_key"], bindings=state["bindings"])
            elif source == "random":
                if self.model is None or type(payload.get("token")) is not int or payload["token"] != self.token:
                    raise ValueError("Random Data model expired. Generate Random Data again.")
                if self._sample is None or type(payload.get("sample_id")) is not int or payload["sample_id"] != self.sample_id:
                    raise ValueError("Random Data sample expired. Generate Random Data again.")
                data, graph, seed = self._sample, self.model.graph, self._sample_seed
                if self._random_key is not None and payload.get("random_key") != self._random_key:
                    raise ValueError("Random cluster configuration expired. Generate Random Data again.")
                schema, bindings = _random_schema(self.model, self._random_specs)
                if any(d["shape"] and not d.get("cluster") for d in schema.values()):
                    raise ValueError("Vector Random estimation requires the explicit baseline covariate-cluster adapter.")
                if _random_public_graph_key(payload, self.model) != self._random_public_key:
                    raise ValueError("The graph changed. Generate Random Data again.")
                response = dict(source=source, token=self.token, sample_id=self.sample_id,
                                random_key=self._random_key, random_bindings=bindings)
            else:
                raise ValueError("Choose CSV or Random Data as the estimate source.")
            seconds = payload.get("max_seconds", 10)
            if type(seconds) not in (int, float) or not np.isfinite(seconds) or not 0 < seconds <= 30:
                raise ValueError("Use an estimate budget greater than 0 and at most 30 seconds.")
            reason = _data_query(payload, schema)
            certificate = None
            if reason is None:
                reason, certificate = _cluster_adjustment_guard(graph, schema, payload)
            if certificate is not None:
                response["cluster_adjustment"] = certificate
            if reason:
                estimate = dict(status="UNSUPPORTED", reason=reason, n=len(data))
                feature_view = None
            else:
                fitting_data, fitting_schema, feature_view = _categorical_feature_view(data, schema, payload)
                estimate = _estimate_mean(fitting_data, graph, fitting_schema,
                    dict(payload, type="interventional", summary="mean_difference"), seed ^ 0x5A5A5A5A, perf_counter() + seconds)
            if feature_view is not None:
                response["feature_view"] = feature_view
            return dict(response, n=len(data), data_estimate=estimate)
        if action == "sample_reference":
            # A separate model reference, never an observed-data estimator or CSV truth.
            if payload.get("source") != "random":
                raise ValueError("Model references are available only for Random Data.")
            if self.model is None or type(payload.get("token")) is not int or payload["token"] != self.token:
                raise ValueError("Random Data model expired. Generate Random Data again.")
            if self._sample is None or type(payload.get("sample_id")) is not int or payload["sample_id"] != self.sample_id:
                raise ValueError("Random Data sample expired. Generate Random Data again.")
            if self._random_key is not None and payload.get("random_key") != self._random_key:
                raise ValueError("Random cluster configuration expired. Generate Random Data again.")
            schema, bindings = _random_schema(self.model, self._random_specs)
            if _random_public_graph_key(payload, self.model) != self._random_public_key:
                raise ValueError("The graph or variable types changed. Generate Random Data again.")
            vector = any(spec["dimension"] > 1 for spec in self._random_specs.values())
            default_draws = 512 if any(spec["dimension"] > 8 for spec in self._random_specs.values()) else max(2048, len(self._sample))
            n = _integer(payload.get("n", default_draws), "reference draws", 10000)
            seconds = payload.get("max_seconds", 10)
            if n < 256 or type(seconds) not in (int, float) or not np.isfinite(seconds) or not 0 < seconds <= 30:
                raise ValueError("Use 256 to 10000 reference draws and a budget greater than 0 and at most 30 seconds.")
            reason = _data_query(payload, schema)
            if reason is None:
                reason, _ = _cluster_adjustment_guard(self.model.graph, schema, payload)
            seed = self._sample_seed ^ 0xA5A5A5A5
            result = (dict(status="UNSUPPORTED", reason=reason) if reason else
                      _paired_vector_reference(self.model, schema, payload, n, seed, seconds) if vector else
                      _reference(self.model, payload, n, seed, seconds))
            kind = ("monte_carlo_model_mean" if result.get("approximate", True) else "exact_model_mean") if result["status"] == "OK" else "unavailable"
            return dict(source="random", token=self.token, sample_id=self.sample_id, source_seed=self._sample_seed,
                        reference_seed=seed, reference_draws=result.get("diagnostics", {}).get("n", 0),
                        reference_requested_draws=n, reference_kind=kind, model_reference=result,
                        random_key=self._random_key, random_bindings=bindings)
        if action == "build":
            specs = _random_cluster_specs(payload)
            candidate = build_scm(payload, _random_clusters=specs)
            public_key = _random_public_graph_key(payload, candidate)
            key = _random_config_key(public_key, specs, payload)
            _, bindings = _random_schema(candidate, specs)
            self.model, self.token = candidate, self.token + 1
            self._random_key, self._random_public_key = key, public_key
            self._random_public_payload = copy.deepcopy(payload)
            self._random_specs, self._random_bindings = specs, bindings
            self._sample, self._sample_seed = None, None
            return {"token": self.token, "model": self.model.describe(), "random_key": key, "random_bindings": bindings}
        if self.model is None or payload.get("token") != self.token:
            raise ValueError("SCM expired. Generate Sample again.")
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
                reserve = min(2, seconds / 2)
                estimate = _estimate_mean(self._sample, self.model.graph, schema, payload, self._sample_seed ^ 0x5A5A5A5A, started + seconds - reserve)
                seconds = max(0, seconds - (perf_counter() - started))
            result = _reference(self.model, payload, n, seed, seconds)
            if action == "compare":
                response = dict(token=self.token, sample_id=self.sample_id, query=result["query"],
                                data_estimate=estimate, scm_reference=result)
                if estimate["status"] == result["status"] == "OK":
                    reference_values = result.get("values", {"Probability": result.get("value")})
                    response["difference"] = {c: value - reference_values[c] for c, value in estimate["values"].items()}
                return response
            return dict(result, token=self.token)
        if action == "sample":
            n = _integer(payload.get("n", 10), "rows", 5000)
            seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
            if self._random_key is not None and payload.get("random_key") != self._random_key:
                raise ValueError("Random cluster configuration expired. Generate Random Data again.")
            physical = sum(len(d.get("columns", [v])) for v, d in self.model._variables.items() if d["observed"])
            if self._random_specs and (n < 1 or physical > 100 or n * physical > 500000):
                raise ValueError("Random Data requires 1 to 5000 rows, at most 100 physical columns and 500000 cells.")
            data = self.model.sample_observational(n, seed=seed)
            if not np.isfinite(data.to_numpy(dtype=float)).all():
                raise ValueError("The sample contains NaN/Inf. Change the function settings.")
            self._sample, self._sample_seed = data.copy(deep=True), seed
            self.sample_id += 1
            return {"columns": list(data.columns), "rows": data.head(10).to_numpy().tolist(), "shape": list(data.shape),
                    "csv": data.to_csv(index=False, float_format="%.17g"), "token": self.token,
                    "sample_id": self.sample_id, "source_seed": seed,
                    "random_key": self._random_key, "random_bindings": self._random_bindings}
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
            if name in self._random_specs and family == "binary":
                raise ValueError("Random baseline clusters require a continuous mechanism family.")
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
            public_payload = copy.deepcopy(self._random_public_payload)
            for node in public_payload["nodes"]:
                if node["name"] == name:
                    node.update(family=family, variable_type=candidate._variables[name]["variable_type"])
            public_key = _random_public_graph_key(public_payload, candidate)
            config_key = _random_config_key(public_key, self._random_specs, public_payload)
            _, bindings = _random_schema(candidate, self._random_specs)
            # Commit only after the mechanism, finite probe, schema and keys pass.
            self.model, self.token = candidate, self.token + 1
            self._random_public_payload, self._random_public_key = public_payload, public_key
            self._random_key, self._random_bindings = config_key, bindings
            self._sample, self._sample_seed = None, None
        elif action != "inspect":
            raise ValueError("Unknown editor action.")
        return {"token": self.token, "model": self.model.describe(), "node": name,
                "function": _function_info(self.model.equations[name]),
                "random_key": self._random_key, "random_bindings": self._random_bindings}
