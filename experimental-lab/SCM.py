"""A fixed structural causal model with explicit functions and local randomness.

An equation receives its named parent arrays. It can also request ``noise``,
``rng`` (a numpy Generator), and ``num_sample``. It returns one value per row.
Use ``intervene`` for constants. Use ``replace_mechanism`` for Python functions.
"""

from contextlib import contextmanager
import copy
import hashlib
import inspect
import random
import threading
from time import perf_counter

import networkx as nx
import numpy as np
from scipy import stats
from scipy.special import log_expit, logit, logsumexp

from scm_registry import EQUATION_FAMILIES, NOISE_FAMILIES, _select_family, _cluster_equation


_KEEP = object()
_RESERVED = {"noise", "rng", "num_sample"}
_LEGACY_RANDOM_LOCK = threading.RLock()


def _integer(value, label):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
        raise TypeError(f"{label} must be a non-negative integer")
    if value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return int(value)


@contextmanager
def _legacy_random_state(seed):
    """Contain old equations that use numpy.random or random directly.

    This lock coordinates this adapter only. Unrelated threads that use global
    RNGs do not acquire it. New equations must use the supplied local rng.
    """
    with _LEGACY_RANDOM_LOCK:
        numpy_state, python_state = np.random.get_state(), random.getstate()
        try:
            np.random.seed(seed)
            random.seed(seed)
            yield
        finally:
            np.random.set_state(numpy_state)
            random.setstate(python_state)


def _noise_value(noise):
    return noise


def _callable_description(function):
    description = {
        "module": getattr(function, "__module__", type(function).__module__),
        "qualname": getattr(function, "__qualname__", type(function).__qualname__),
        "serialization_guaranteed": False,
    }
    if hasattr(function, "_scm_parameters"):
        description["parameters"] = copy.deepcopy(function._scm_parameters)
    return description


def _noise_description(distribution):
    if isinstance(distribution, U):
        return distribution.describe()
    if distribution is None:
        return {"kind": "none"}
    if hasattr(distribution, "dist") and hasattr(distribution.dist, "name"):
        return {
            "kind": "scipy_distribution",
            "distribution": distribution.dist.name,
            "args": copy.deepcopy(distribution.args),
            "keywords": copy.deepcopy(distribution.kwds),
        }
    if type(distribution).__name__ == "multivariate_normal_frozen":
        return {"kind": "scipy_distribution", "distribution": "multivariate_normal",
                "mean": distribution.mean.tolist(), "cov": distribution.cov.tolist()}
    if type(distribution).__name__ == "multivariate_t_frozen":
        return {"kind": "scipy_distribution", "distribution": "multivariate_t",
                "loc": distribution.loc.tolist(), "shape": distribution.shape.tolist(),
                "df": distribution.df}
    description = _callable_description(distribution)
    description["kind"] = "rvs_object" if hasattr(distribution, "rvs") else "callable"
    return description


class U:
    """An exogenous noise law. Reusing a law does not share sampled values."""

    def __init__(self, distribution=None):
        if distribution is not None and not (callable(distribution) or callable(getattr(distribution, "rvs", None))):
            raise TypeError("noise_distribution must have rvs or be callable(rng, size)")
        self.distribution = distribution

    def sample(self, n, rng):
        """Draw n rows with a local numpy Generator; None produces zeros."""
        n = _integer(n, "n")
        if not isinstance(rng, np.random.Generator):
            raise TypeError("rng must be a local numpy Generator")
        distribution = self.distribution
        if distribution is None:
            return np.zeros(n)
        if callable(getattr(distribution, "rvs", None)):
            values = distribution.rvs(size=n, random_state=rng)
        else:
            values = distribution(rng=rng, size=n)
        values = np.asarray(values)
        # SciPy squeezes singleton axes, independently of equation output shape.
        if type(distribution).__name__ == "multivariate_normal_frozen":
            values = values.reshape(n, np.atleast_1d(distribution.mean).size)
        elif type(distribution).__name__ == "multivariate_t_frozen":
            values = values.reshape(n, np.atleast_1d(distribution.loc).size)
        if values.ndim == 0 or values.shape[0] != n:
            raise ValueError(f"Noise must have {n} rows, got shape {values.shape}")
        return values

    def describe(self):
        """Describe the law; arbitrary samplers are not serialized."""
        return _noise_description(self.distribution)

    def logpdf(self, values):
        """Joint row density, including independent scalar coordinates."""
        distribution = self.distribution
        density = getattr(distribution, "_scm_logpdf", None) or getattr(distribution, "logpdf", None)
        if density is None:
            raise NotImplementedError("Counterfactual inference needs an explicit continuous noise density.")
        result = np.asarray(density(values))
        return result.sum(axis=1) if result.ndim == 2 else result.reshape(-1)

    def supports_density(self):
        """Capability check without drawing noise or claiming callable support."""
        supported = getattr(self.distribution, "_scm_density_supported", False)
        return bool((supported() if callable(supported) else supported)
                    or callable(getattr(self.distribution, "logpdf", None)))


def _cluster_noise(distribution, dimension, model_rng):
    """Freeze a dense mixing matrix; draw fresh coordinate noise for each row."""
    law = distribution if isinstance(distribution, U) else U(distribution)
    mixing = model_rng.normal(size=(dimension, dimension)) / np.sqrt(dimension)

    def sample(rng, size):
        values = law.sample(size, rng)
        if values.ndim == 1:
            values = np.column_stack([values] + [law.sample(size, rng) for _ in range(dimension - 1)])
        if values.shape != (size, dimension):
            raise ValueError(f"Cluster noise needs shape {(size, dimension)}, got {values.shape}")
        return values @ mixing

    sample._scm_parameters = {"source": law.describe(), "mixing": mixing.tolist()}

    def logpdf(values):
        if np.linalg.cond(mixing) > 1e12:
            raise NotImplementedError("Cluster noise mixing is singular or ill-conditioned.")
        unmixed = np.linalg.solve(mixing.T, np.asarray(values).T).T
        return law.logpdf(unmixed) - np.linalg.slogdet(mixing)[1]

    sample._scm_logpdf = logpdf
    sample._scm_density_supported = lambda: law.supports_density() and np.linalg.cond(mixing) <= 1e12
    return U(sample)


class StructuralCausalModel:
    """Store a model and draw rows from it.

    ``model_seed`` controls coefficients drawn by the legacy random builders.
    Sampling methods use a separate ``seed`` for the data. Custom equations
    must use the supplied noise/rng and must not mutate parents or hidden state.
    """

    def __init__(self, model_seed=None):
        self.model_seed = None if model_seed is None else _integer(model_seed, "model_seed")
        self._model_rng = np.random.default_rng(self.model_seed)
        self.graph = nx.DiGraph()
        # These dictionaries remain public for existing CausalPy callers.
        self.equations = {}
        self.noise_distributions = {}
        self.unobserved_variables = {}
        self.sample_dict = {}
        self._variables = {}

    def add_variable(self, name, equation, parents=(), noise_distribution=None, *,
                     observed=True, shape=(), variable_type="custom", parameters=None):
        """Register one variable after its parents.

        Input: a callable and existing parent names. ``shape=()`` means a scalar;
        ``shape=(d,)`` means a vector of length d. Output: this model, for chaining.
        Error: invalid names, unknown parents, duplicate variables, or invalid shape.
        """
        if not isinstance(name, str) or not name or name in _RESERVED:
            raise ValueError(f"Invalid variable name: {name!r}; reserved names: {_RESERVED}")
        if name in self._variables:
            raise ValueError(f"Variable {name!r} already exists")
        if not callable(equation):
            raise TypeError(f"Equation for {name!r} must be callable")
        parents = self._check_parents(parents)
        shape = self._check_shape(shape)
        if not isinstance(observed, (bool, np.bool_)):
            raise TypeError("observed must be a boolean")
        if variable_type not in {"binary", "continuous", "categorical", "custom"}:
            raise ValueError("variable_type must be binary, continuous, categorical, or custom")
        self._check_noise(noise_distribution)
        if parameters is not None and not isinstance(parameters, dict):
            raise TypeError("parameters must be a dictionary")
        details = {"observed": bool(observed), "shape": shape,
                   "variable_type": variable_type,
                   "parameters": copy.deepcopy(parameters or {}), "legacy": False,
                   "registered_equation": equation}
        self.graph.add_node(name)
        self.graph.add_edges_from((parent, name) for parent in parents)
        self.equations[name] = equation
        self.noise_distributions[name] = noise_distribution
        self._variables[name] = details
        self.sample_dict = {}
        return self

    # Manual functions and random builders share the same registration contract.
    add_equation = add_variable

    def _check_parents(self, parents, allow_forward=False):
        if isinstance(parents, str):
            raise TypeError("parents must be a sequence of variable names")
        parents = list(parents)
        if any(not isinstance(parent, str) or not parent or parent in _RESERVED for parent in parents):
            raise ValueError("Each parent must have a valid variable name")
        if len(parents) != len(set(parents)):
            raise ValueError("Duplicate parent names")
        unknown = [parent for parent in parents if parent not in self._variables]
        if unknown and not allow_forward:
            raise ValueError(f"Unknown parent variables: {unknown}")
        return parents

    @staticmethod
    def _check_shape(shape):
        if shape is None:  # Legacy equations infer scalar/vector shape at sampling.
            return None
        if not isinstance(shape, (tuple, list)) or len(shape) > 1:
            raise ValueError("shape must be () for a scalar or (d,) for a vector")
        shape = tuple(_integer(d, "shape dimension") for d in shape)
        if any(d == 0 for d in shape):
            raise ValueError("shape dimensions must be positive")
        return shape

    @staticmethod
    def _check_noise(distribution):
        U(distribution.distribution if isinstance(distribution, U) else distribution)

    def validate(self):
        """Check the graph and registered equations before executing the model."""
        unknown = set(self.graph) - set(self._variables)
        if unknown:
            raise ValueError(f"Graph contains unknown parent variables: {sorted(unknown)}")
        if set(self._variables) - set(self.graph):
            raise ValueError("Graph omits registered variables")
        if not nx.is_directed_acyclic_graph(self.graph):
            raise ValueError("SCM graph must be acyclic; a directed cycle was found")
        if set(self.equations) != set(self._variables):
            raise ValueError("Each registered variable must have exactly one equation")
        for name in self._variables:
            if not callable(self.equations[name]):
                raise TypeError(f"Equation for {name!r} must be callable")
            self._check_noise(self.noise_distributions.get(name))
        return self

    def _copy_model(self):
        # Python functions and noise laws are preserved, not re-sampled.
        model = copy.copy(self)
        model.graph = self.graph.copy()
        model.equations = self.equations.copy()
        model.noise_distributions = self.noise_distributions.copy()
        model.unobserved_variables = self.unobserved_variables.copy()
        model._variables = {name: {**details, "parameters": copy.deepcopy(details["parameters"])}
                            for name, details in self._variables.items()}
        model._model_rng = copy.deepcopy(self._model_rng)
        model.sample_dict = {}
        return model

    def replace_mechanism(self, name, equation, parents, *, noise_distribution=_KEEP,
                          parameters=None):
        """Return a model with a new Python equation and explicit parents.

        Omit noise_distribution to keep its old law. Pass None to remove it.
        Other equations, noise laws, variable shapes and observed flags stay fixed.
        The callable can be imported from a Python module. Source strings are not accepted.
        """
        self.validate()
        if name not in self._variables:
            raise ValueError(f"Unknown variable: {name!r}")
        parents = self._check_parents(parents)
        if parameters is not None and not isinstance(parameters, dict):
            raise TypeError("parameters must be a dictionary")
        model = self._copy_model()
        model.graph.remove_edges_from(list(model.graph.in_edges(name)))
        model.graph.add_edges_from((parent, name) for parent in parents)
        model.equations[name] = equation
        if noise_distribution is not _KEEP:
            model.noise_distributions[name] = noise_distribution
        model.unobserved_variables.pop(name, None)
        model._variables[name]["legacy"] = False
        model._variables[name]["registered_equation"] = equation
        model._variables[name]["parameters"] = copy.deepcopy(parameters or {})
        return model.validate()

    def intervene(self, values):
        """Return a new model with constant equations for the named variables.

        Each constant replaces the whole equation and its private noise. Incoming
        edges are removed. Shared latent variables and all other equations remain.
        """
        if not isinstance(values, dict):
            raise TypeError("Intervention values must be a dictionary")
        model = self._copy_model()
        for name, value in values.items():
            if name not in self._variables:
                raise ValueError(f"Unknown intervention variable: {name!r}")
            constant = np.array(value, copy=True)
            shape = self._variables[name]["shape"]
            if shape is None:
                shape = constant.shape
                self._check_shape(shape)
            if constant.shape != shape:
                raise ValueError(f"Constant for {name!r} has shape {constant.shape}, expected {shape}")
            if self._variables[name]["variable_type"] == "binary" and not np.isin(constant, [0, 1]).all():
                raise ValueError(f"Constant for binary variable {name!r} must be 0 or 1")

            def fixed_equation(num_sample, _constant=constant):
                return np.broadcast_to(_constant, (num_sample,) + _constant.shape).copy()

            fixed_equation._scm_parameters = {"kind": "constant", "value": constant.tolist()}
            model = model.replace_mechanism(name, fixed_equation, parents=[], noise_distribution=None)
            model._variables[name]["shape"] = shape
        return model.validate()

    @staticmethod
    def _variable_rng(seed, name):
        # Stable across Python processes. Built-in hash() is process-dependent.
        digest = hashlib.blake2b(name.encode("utf-8"), digest_size=16).digest()
        key = [int.from_bytes(digest[i:i + 4], "little") for i in range(0, 16, 4)]
        return np.random.default_rng(np.random.SeedSequence(seed, spawn_key=key))

    def _draw_noise(self, name, rng, n):
        distribution = self.noise_distributions.get(name)
        source = distribution if isinstance(distribution, U) else U(distribution)
        try:
            return source.sample(n, rng)
        except ValueError as error:
            raise ValueError(f"Noise for {name!r}: {error}") from error

    def _evaluate(self, name, arguments):
        equation = self.equations[name]
        rng = arguments["rng"]
        try:
            signature = inspect.signature(equation)
        except (TypeError, ValueError) as error:
            raise TypeError(f"Equation for {name!r} needs a Python keyword-compatible signature") from error
        accepts_extra = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())
        if not accepts_extra:
            arguments = {key: value for key, value in arguments.items() if key in signature.parameters}
        try:
            signature.bind(**arguments)
        except TypeError as error:
            raise TypeError(f"Equation for {name!r}: {error}") from error
        if self._uses_legacy_rng(name):
            compatibility_seed = int(rng.integers(0, 2**32))
            with _legacy_random_state(compatibility_seed):
                return equation(**arguments)
        return equation(**arguments)

    def _uses_legacy_rng(self, name):
        details = self._variables[name]
        return details["legacy"] or self.equations[name] is not details["registered_equation"]

    def _sample_arrays(self, n, seed):
        n = _integer(n, "num_samples")
        seed = np.random.SeedSequence().entropy if seed is None else _integer(seed, "seed")
        self.validate()
        samples = {}
        for name in nx.topological_sort(self.graph):
            shape = self._variables[name]["shape"]
            if n == 0:
                samples[name] = np.empty((0,) + (shape or ()))
                continue
            rng = self._variable_rng(seed, name)
            arguments = {parent: samples[parent] for parent in self.graph.predecessors(name)}
            arguments.update(noise=self._draw_noise(name, rng, n), rng=rng, num_sample=n)
            values = np.asarray(self._evaluate(name, arguments))
            expected = (n,) + shape if shape is not None else None
            if values.ndim not in (1, 2) or values.shape[0] != n or (expected is not None and values.shape != expected):
                raise ValueError(f"Equation for {name!r} returned shape {values.shape}; expected {expected or '(n,) or (n, d)'}")
            if self._variables[name]["variable_type"] == "binary" and not np.isin(values, [0, 1]).all():
                raise ValueError(f"Equation for binary variable {name!r} returned a value outside 0 or 1")
            samples[name] = values
        self.sample_dict = samples
        return samples

    def _sample_frame(self, n, seed, observed_only):
        import pandas as pd
        samples = self._sample_arrays(n, seed)
        columns = {}
        # Registration order keeps output columns stable when parents change.
        for name, details in self._variables.items():
            if observed_only and not details["observed"]:
                continue
            values = samples[name]
            labels = details.get("columns")
            entries = [(labels[0] if labels else name, values)] if values.ndim == 1 else [
                (labels[i] if labels else f"{name}{i + 1}", values[:, i]) for i in range(values.shape[1])]
            for column, values in entries:
                if column in columns:
                    raise ValueError(f"Duplicate output column {column!r}; rename the variable")
                columns[column] = values
        return pd.DataFrame(columns, index=pd.RangeIndex(n))

    def generate_samples(self, num_samples, seed=None):
        """Draw all variables, including hidden variables, into a DataFrame."""
        return self._sample_frame(num_samples, seed, observed_only=False)

    def sample_observational(self, n, seed=None):
        """Draw observed variables from the fixed model."""
        return self._sample_frame(n, seed, observed_only=True)

    def sample_interventional(self, values, n, seed=None):
        """Draw observed variables after constant intervention, preserving this model."""
        return self.intervene(values).sample_observational(n, seed=seed)

    def _query_kind(self, name):
        equation = self.equations[name]
        if equation is _noise_value:
            return "noise_only"
        kind = getattr(equation, "_scm_parameters", {}).get("kind")
        if (kind not in EQUATION_FAMILIES or getattr(equation, "__module__", None) != "scm_registry"
                or self._uses_legacy_rng(name)):
            raise NotImplementedError(f"{name}: numerical queries support generated equation families and hidden noise roots.")
        return kind

    def _query_location(self, name, parents, n):
        """Pre-noise score; reuse fixed neural/tree functions without duplicating them."""
        if self.equations[name] is _noise_value:
            return np.zeros((n,) + self._variables[name]["shape"])
        parameters = self.equations[name]._scm_parameters
        shape = self._variables[name]["shape"]
        if parameters["kind"] in {"neural_network", "decision_tree"}:
            return np.asarray(self._evaluate(name, dict(parents, noise=np.zeros((n,) + shape),
                                                       rng=self._variable_rng(0, name), num_sample=n)))
        inputs = {f"{parent}[{i}]" if parent_shape else parent:
                  parents[parent][:, i] if parent_shape else parents[parent]
                  for parent, parent_shape in parameters.get("parent_shapes", {}).items()
                  for i in range(parent_shape[0] if parent_shape else 1)} if "coordinates" in parameters else parents
        columns = []
        for p in parameters.get("coordinates", [parameters]):
            score = np.full(n, p["intercept"], dtype=float)
            for parent, coefficient in p["coefficients"].items():
                score += coefficient * (inputs[parent] ** 2 if p["kind"] == "quadratic" else inputs[parent])
            columns.append(score)
        return np.column_stack(columns) if shape else columns[0]

    def query(self, targets, *, intervention=None, evidence=None, reference=None,
              query_type="interventional", summary="mean", event=None, n=2048, seed=5,
              max_seconds=10):
        """Monte Carlo quantities of this generated SCM, never fitted from sample data.

        Counterfactual equality evidence uses regular conditional densities and
        sequential residual likelihood weighting. Binary innovations are shared
        Uniform thresholds. No generic custom-function abduction is attempted.
        Mean differences use two action worlds with paired exogenous draws.
        ESS/weight cutoffs are engineering diagnostics, not confidence guarantees.
        """
        started = perf_counter()
        self.validate()
        n, seed = _integer(n, "draws"), _integer(seed, "data seed")
        if (not n or not isinstance(query_type, str) or not isinstance(summary, str)
                or query_type not in {"interventional", "counterfactual"} or summary not in {"mean", "probability", "mean_difference"}):
            raise ValueError("Use positive draws, Interventional/Counterfactual and a supported summary.")
        if (max_seconds is not None and (isinstance(max_seconds, bool) or not isinstance(max_seconds, (int, float))
                or not np.isfinite(max_seconds) or max_seconds < 0)):
            raise ValueError("max_seconds must be a finite nonnegative number or None.")
        if (not isinstance(targets, list) or not targets
                or any(not isinstance(v, str) or v not in self._variables or not self._variables[v]["observed"] for v in targets)
                or len(targets) != len(set(targets))):
            raise ValueError("Targets must be distinct observed node names.")

        def assignments(values, label):
            if not isinstance(values, dict):
                raise ValueError(f"{label} must be a JSON object of whole-node values.")
            result = {}
            for name, value in values.items():
                if name not in self._variables or not self._variables[name]["observed"]:
                    raise ValueError(f"{label}: select an observed node, not an individual coordinate.")
                array = np.asarray(value, dtype=float)
                if array.shape != self._variables[name]["shape"] or not np.isfinite(array).all():
                    raise ValueError(f"{label} {name}: use finite values with shape {self._variables[name]['shape']}.")
                if self._variables[name]["variable_type"] == "binary" and not np.isin(array, [0, 1]).all():
                    raise ValueError(f"{label} {name}: binary values must be 0 or 1.")
                result[name] = array.copy()
            return result

        intervention = assignments({} if intervention is None else intervention, "Intervention")
        evidence = assignments({} if evidence is None else evidence, "Factual evidence")
        if evidence and query_type != "counterfactual":
            raise ValueError("Factual evidence belongs to Counterfactual queries.")
        if summary == "mean_difference" and reference is None:
            raise ValueError("Mean difference requires a reference intervention object; {} means no intervention.")
        reference = assignments({} if reference is None else reference, "Reference")
        query = dict(type=query_type, targets=targets, summary=summary,
                     intervention={v:a.tolist() for v,a in intervention.items()},
                     evidence={v:a.tolist() for v,a in evidence.items()},
                     reference={v:a.tolist() for v,a in reference.items()}, event=event or {}, n=n, data_seed=seed)
        diagnostics = dict(n=n, method="sequential residual likelihood weighting" if evidence else "prior Monte Carlo",
                           binary_coupling="shared independent Uniform thresholds", conditioning="full-node equality density" if evidence else "none")
        result = dict(status="UNKNOWN", approximate=True, query=query, diagnostics=diagnostics)
        deadline = None if max_seconds is None else started + max_seconds

        def check_time():
            if deadline is not None and perf_counter() >= deadline:
                raise TimeoutError("Numerical query deadline exhausted.")

        def columns(values):
            flat = {}
            for name in targets:
                labels = self._variables[name].get("columns", [name] if not self._variables[name]["shape"]
                                                   else [f"{name}{i+1}" for i in range(values[name].shape[1])])
                flat.update({label:values[name] if values[name].ndim == 1 else values[name][:, i] for i,label in enumerate(labels)})
            return flat

        def world(actions):
            values, preserved = {}, {}
            for name in order:
                check_time()
                if name in actions:
                    values[name] = np.broadcast_to(actions[name], (n,) + actions[name].shape)
                    preserved[name] = name in evidence and np.array_equal(actions[name], evidence[name])
                elif all(preserved[p] for p in self.graph.predecessors(name)):
                    # Structural identity, not a tolerance-based equality test.
                    values[name], preserved[name] = factual[name], True
                else:
                    preserved[name] = False
                    parents = {p:values[p] for p in self.graph.predecessors(name)}
                    values[name] = np.asarray(self._evaluate(name, dict(parents, noise=noises[name], _uniform=uniforms.get(name),
                        rng=self._variable_rng(seed, name), num_sample=n)))
                if not np.isfinite(values[name]).all():
                    raise FloatingPointError(f"{name}: nonfinite action-world values.")
            return columns(values), preserved

        try:
            check_time()
            relevant = set(targets) | set(evidence)
            relevant |= set().union(*(nx.ancestors(self.graph, v) for v in relevant))
            order = list(nx.topological_sort(self.graph.subgraph(relevant)))
            kinds, noises, uniforms, factual = {}, {}, {}, {}
            log_weights = np.zeros(n)
            with np.errstate(over="raise", invalid="raise", divide="ignore"):
                for name in order:
                    check_time()
                    kinds[name] = self._query_kind(name)
                    shape = self._variables[name]["shape"]
                    if shape is None:
                        raise NotImplementedError("Queries require explicit scalar/vector shapes.")
                    source = self.noise_distributions[name]
                    law = source if isinstance(source, U) else U(source)
                    law.logpdf(np.zeros((1,) + shape))  # Unknown sampler densities fail explicitly.
                    rng = self._variable_rng(seed, name)
                    noise = self._draw_noise(name, rng, n)
                    parents = {p:factual[p] for p in self.graph.predecessors(name)}
                    observed = evidence.get(name)
                    if kinds[name] == "binary":
                        score = self._query_location(name, parents, n) + noise
                        uniform = np.column_stack([rng.random(n) for _ in range(shape[0])]) if shape else rng.random(n)
                        orientation, log_threshold = np.ones_like(uniform, dtype=bool), np.log(uniform)
                        if observed is not None:
                            likelihood = np.where(observed == 1, log_expit(score), log_expit(-score))
                            log_weights += likelihood.sum(axis=1) if shape else likelihood
                            orientation = np.broadcast_to(observed == 1, uniform.shape)
                            log_threshold += likelihood
                        uniforms[name] = (orientation, log_threshold)
                    elif observed is not None:
                        score = self._query_location(name, parents, n)
                        if kinds[name] == "bounded":
                            if np.any((observed <= 0) | (observed >= 1)):
                                raise ValueError(f"{name}: bounded equality evidence must be strictly between 0 and 1.")
                            noise = logit(observed) - score
                            log_weights -= np.log(observed * (1 - observed)).sum()
                        else:
                            noise = observed - score
                        log_weights += law.logpdf(noise)
                    noises[name] = noise
                    factual[name] = np.broadcast_to(observed, (n,) + shape) if observed is not None else np.asarray(
                        self._evaluate(name, dict(parents, noise=noise, _uniform=uniforms.get(name), rng=rng, num_sample=n)))
                    if not np.isfinite(factual[name]).all():
                        raise FloatingPointError(f"{name}: nonfinite factual values.")
                check_time()
                normalizer = logsumexp(log_weights)
                if not np.isfinite(normalizer):
                    result["reason"] = "NO_EFFECTIVE_SAMPLES: no sampled particle has positive evidence density; impossibility is not established."
                    return result
                weights = np.exp(log_weights - normalizer)
                weights /= weights.sum()
                ess, largest = min(n, 1 / np.sum(weights ** 2)), float(weights.max())
                diagnostics.update(ess=float(ess), max_weight=largest)
                if ess < 100 or largest > 0.1:
                    result["reason"] = "LOW_ESS: posterior particles failed the engineering cutoff (ESS >= 100, max weight <= 0.1)."
                    return result
                primary, preserved = world(intervention)
                if summary == "mean_difference":
                    baseline, _ = world(reference)
                    result.update(intervention_values={v:float(weights @ a) for v,a in primary.items()},
                                  reference_values={v:float(weights @ a) for v,a in baseline.items()})
                    primary = {v:a-baseline[v] for v,a in primary.items()}
                if summary == "probability":
                    operations = {"==":np.equal, "!=":np.not_equal, "<":np.less, "<=":np.less_equal, ">":np.greater, ">=":np.greater_equal}
                    if not isinstance(event, dict) or not event:
                        raise ValueError("Probability requires an event on target coordinates.")
                    hits = np.ones(n, dtype=bool)
                    for column, condition in event.items():
                        if (column not in primary or not isinstance(condition, dict) or condition.get("op") not in operations
                                or type(condition.get("value")) not in (int, float) or not np.isfinite(condition["value"])):
                            raise ValueError("Each event needs a target column, a comparison operator and a finite numeric threshold.")
                        name = next(v for v in targets if column in self._variables[v].get("columns", [v] if not self._variables[v]["shape"]
                                    else [f"{v}{i+1}" for i in range(self._variables[v]["shape"][0])]))
                        exact_point = name in intervention or (preserved[name] and name in evidence)
                        if condition["op"] in {"==", "!="} and kinds[name] != "binary" and not exact_point:
                            raise NotImplementedError("Continuous equality after changed parents is unsupported; choose >= or <=.")
                        if kinds[name] != "binary" and not exact_point:
                            resolution = 64 * np.finfo(float).eps * np.maximum(1, np.maximum(np.abs(primary[column]), abs(condition["value"])))
                            boundary_mass = float(weights @ (np.abs(primary[column] - condition["value"]) <= resolution))
                            if boundary_mass > 0.01:
                                diagnostics.update(unresolved_boundary_weight=boundary_mass, resolution_relative=64*np.finfo(float).eps)
                                raise FloatingPointError("NUMERICAL_RESOLUTION: material posterior mass cannot be resolved at the event threshold.")
                        hits &= operations[condition["op"]](primary[column], condition["value"])
                    primary = {"probability":hits.astype(float)}
                    diagnostics["event_hits"] = int(hits.sum())
                    diagnostics["comparison"] = "Exact floating-point comparison; continuous atoms at a threshold may be sensitive to roundoff."
                means = {v:float(weights @ a) for v,a in primary.items()}
                if summary == "probability":
                    means["probability"] = 1.0 if hits.all() else 0.0 if not hits.any() else min(1.0, float(weights[hits].sum()))
                errors = {v:float(np.sqrt(np.sum(weights ** 2 * (a-means[v]) ** 2))) for v,a in primary.items()}
                if summary == "probability":
                    result.update(value=means["probability"], standard_error=errors["probability"])
                else:
                    result.update(values=means, standard_errors=errors)
                check_time()
                result["status"] = "OK"
        except NotImplementedError as error:
            result.update(status="UNSUPPORTED", reason=str(error))
        except (FloatingPointError, np.linalg.LinAlgError) as error:
            message = str(error)
            result.update(reason=message if message.startswith("NUMERICAL_RESOLUTION:") else "NUMERICAL_INSTABILITY: " + message)
        except TimeoutError as error:
            result.update(reason=str(error))
        finally:
            diagnostics["elapsed_seconds"] = perf_counter() - started
        if result["status"] != "OK":
            for key in ("values", "standard_errors", "value", "standard_error", "intervention_values", "reference_values"):
                result.pop(key, None)
        return result

    def generate_observational_samples(self, num_samples, seed=None):
        """Compatibility name for sample_observational."""
        return self.sample_observational(num_samples, seed=seed)

    def compute(self, variable, num_samples):
        """Compatibility helper. Draw the model and return one unflattened array."""
        if variable not in self._variables:
            raise ValueError(f"Unknown variable: {variable!r}")
        return self._sample_arrays(num_samples, seed=None)[variable]

    def describe(self):
        """Return readable model metadata, not a serialized executable model.

        Arbitrary callables can close over mutable or external state. The caller
        must preserve that state/code separately to reproduce the model elsewhere.
        """
        self.validate()
        variables = {}
        for name, details in self._variables.items():
            variables[name] = {
                "parents": list(self.graph.predecessors(name)),
                "observed": details["observed"],
                "noise_only": self.equations[name] is _noise_value,
                "shape": details["shape"],
                "variable_type": details["variable_type"],
                "parameters": copy.deepcopy(details["parameters"]),
                "equation": _callable_description(self.equations[name]),
                "noise": _noise_description(self.noise_distributions.get(name)),
                "legacy_global_rng_adapter": self._uses_legacy_rng(name),
            }
            if "columns" in details:
                variables[name]["columns"] = list(details["columns"])
                variables[name]["dimension"] = details["shape"][0] if details["shape"] else 1
        return {"model_seed": self.model_seed, "variables": variables,
                "callable_state": "Callables/noise laws are shared on replacement; use pure functions.",
                "counterfactual_supported": all(((self.equations[v] is _noise_value)
                    or (getattr(self.equations[v], "__module__", None) == "scm_registry" and not self._uses_legacy_rng(v)
                        and getattr(self.equations[v], "_scm_parameters", {}).get("kind") in EQUATION_FAMILIES)
                    ) and U(self.noise_distributions[v].distribution if isinstance(self.noise_distributions[v], U)
                            else self.noise_distributions[v]).supports_density() for v,d in self._variables.items()),
                "counterfactual_method": "generated SCM residual likelihood weighting; shared binary Uniform thresholds"}

    @property
    def graph_dict(self):
        return {name: list(self.graph.successors(name)) for name in self.graph}

    # Compatibility builders. New code should use add_variable with explicit flags.
    def add_unobserved_variable(self, variable, distribution):
        self.add_variable(variable, _noise_value, noise_distribution=distribution,
                          observed=False, shape=None)
        self.unobserved_variables[variable] = distribution

    def add_observed_variable(self, variable, equation, parents, noise_distribution,
                              num_samples=None):
        # Old factories can declare a child before its parents. Sampling validates
        # the completed model. New add_variable calls require existing parents.
        parents = self._check_parents(parents, allow_forward=True)
        known = [parent for parent in parents if parent in self._variables]
        self.add_variable(variable, equation, known, noise_distribution, shape=None)
        self.graph.add_edges_from((parent, variable) for parent in parents)
        self._variables[variable]["legacy"] = True

    def _random_equation(self, parents, kind):
        if kind not in EQUATION_FAMILIES:
            raise ValueError(f"Unknown equation family: {kind!r}")
        factory = EQUATION_FAMILIES[kind]
        if not callable(factory):
            raise TypeError(f"Factory for {kind!r} must be callable")
        equation = factory(list(parents), self._model_rng)
        if not callable(equation):
            raise TypeError(f"Factory for {kind!r} must return a callable")
        return equation

    def create_random_linear_equation(self, parents):
        return self._random_equation(parents, "linear")

    def create_random_linear_bounded_equation(self, parents):
        return self._random_equation(parents, "bounded")

    def create_binary_equation(self, parents):
        return self._random_equation(parents, "binary")

    def build_from_graph(self, graph_dict, discrete=False, *, seed=None,
                         equation_families=None, noise_distributions=None):
        """Legacy random builder. Preserve keys and children, including isolates.

        Legacy conventions without explicit metadata: U-prefixed names are hidden
        roots; X/Y names are binary. Explicit observed metadata overrides the
        U-prefix fallback. Explicit noise_only separates mechanisms from the
        observation mask; hidden internal nodes retain parent-dependent equations.
        Use add_variable to choose types and observed flags independently of names.
        A seed resets model coefficients, not the data sampling seed.
        equation_families is a global name/pool or equation-node choice dictionary.
        noise_distributions is a global name/pool or node dictionary of named
        choices, U, raw samplers, or None. Named laws are chosen and fixed here.
        Explicit families override X/Y binary defaults. Factories run only here.
        """
        if not isinstance(graph_dict, (dict, nx.DiGraph)):
            raise TypeError("graph_dict must map variable names to their children")
        graph = graph_dict.copy() if isinstance(graph_dict, nx.DiGraph) else nx.DiGraph()
        if isinstance(graph_dict, dict):
            graph.add_nodes_from(graph_dict)
            for parent, children in graph_dict.items():
                if isinstance(children, str):
                    raise TypeError("Graph children must be a sequence of names")
                graph.add_edges_from((parent, child) for child in children)
        if not nx.is_directed_acyclic_graph(graph):
            raise ValueError("SCM graph must be acyclic; a directed cycle was found")
        if any(not isinstance(name, str) or not name or name in _RESERVED for name in graph):
            raise ValueError("Graph contains an invalid variable name")
        families = {} if equation_families is None else equation_families
        noises = {} if noise_distributions is None else noise_distributions
        observed = {name: graph.nodes[name].get("observed", not name.startswith("U")) for name in graph}
        shapes = {name: self._check_shape(graph.nodes[name].get("shape", ())) for name in graph}
        for name, shape in shapes.items():
            if "dimension" in graph.nodes[name] and _integer(graph.nodes[name]["dimension"], "dimension") != (shape[0] if shape else 1):
                raise ValueError("Node dimension must match its shape")
        if any(not isinstance(value, (bool, np.bool_)) for value in observed.values()):
            raise TypeError("observed must be a boolean")
        if any(shape is None for shape in shapes.values()):
            raise ValueError("Random graph nodes need explicit scalar or vector shapes")
        all_columns = [column for name in graph for column in graph.nodes[name].get("columns", [name] if not shapes[name]
                       else [f"{name}{i + 1}" for i in range(shapes[name][0])])]
        if len(all_columns) != len(set(all_columns)):
            raise ValueError("Graph output columns must be unique")
        mappings = []
        for label, mapping in (("equation_families", families), ("noise_distributions", noises)):
            if isinstance(mapping, (str, list, tuple)):
                if not mapping:
                    raise ValueError(f"{label} choices must not be empty")
                nodes = [name for name in graph if label == "noise_distributions" or observed[name]
                         or graph.in_degree(name) or graph.nodes[name].get("noise_only") is False]
                mapping = dict.fromkeys(nodes, mapping)
            if not isinstance(mapping, dict):
                raise TypeError(f"{label} must be a name, name sequence, or node-name dictionary")
            if set(mapping) - set(graph):
                raise ValueError(f"{label} contains unknown nodes: {set(mapping) - set(graph)}")
            mappings.append(mapping)
        families, noises = mappings
        noise_only = {name: graph.nodes[name].get("noise_only",
            not observed[name] and not graph.in_degree(name) and name not in families) for name in graph}
        if any(type(value) not in (bool, np.bool_) for value in noise_only.values()):
            raise TypeError("noise_only must be a boolean")
        if any(noise_only[name] and graph.in_degree(name) for name in graph):
            raise ValueError("A noise-only mechanism cannot have parents; choose an equation mechanism.")
        model = StructuralCausalModel(self.model_seed if seed is None else seed)
        if seed is None:
            model._model_rng = copy.deepcopy(self._model_rng)
        for name in nx.topological_sort(graph):
            noise = noises.get(name, _KEEP)
            noise_family = None
            if isinstance(noise, (str, list, tuple)):
                noise_family = _select_family(noise, NOISE_FAMILIES, model._model_rng)
                noise = U(NOISE_FAMILIES[noise_family](model._model_rng))
            shape = shapes[name]
            if noise_only[name]:
                noise = stats.norm(0, 1) if noise is _KEEP else noise
                if shape:
                    noise = _cluster_noise(noise, shape[0], model._model_rng)
                model.add_variable(name, _noise_value, noise_distribution=noise, observed=observed[name], shape=shape,
                                   variable_type="continuous" if observed[name] else "custom")
            else:
                parents = list(graph.predecessors(name))
                binary = discrete or name.startswith(("X", "Y"))
                family = _select_family(families.get(name, "binary" if binary else "linear"),
                                        EQUATION_FAMILIES, model._model_rng)
                variable_type = "binary" if family == "binary" else (
                    "continuous" if family in {"linear", "quadratic", "bounded", "neural_network", "decision_tree"} else "custom")
                parent_shapes = {parent: shapes[parent] for parent in parents}
                equation = (_cluster_equation(parent_shapes, shape, family, model._model_rng)
                            if shape or any(parent_shapes.values()) else model._random_equation(parents, family))
                noise = stats.norm(0, 1 if family == "binary" else 0.1) if noise is _KEEP else noise
                if shape:
                    noise = _cluster_noise(noise, shape[0], model._model_rng)
                model.add_equation(name, equation, parents, noise, shape=shape,
                                   observed=observed[name], variable_type=variable_type, parameters={"family": family})
            if not observed[name]:
                model.unobserved_variables[name] = noise
            model.graph.nodes[name].update(copy.deepcopy(graph.nodes[name]))
            if "columns" in graph.nodes[name]:
                columns = graph.nodes[name]["columns"]
                if (len(columns) != (shape[0] if shape else 1)
                        or any(not isinstance(column, str) for column in columns)
                        or len(columns) != len(set(columns))):
                    raise ValueError("Node columns must match its dimension and be unique strings")
                model._variables[name]["columns"] = list(columns)
            if noise_family is not None:
                model._variables[name]["parameters"]["noise_family"] = noise_family
        model.graph.graph.update(copy.deepcopy(graph.graph))
        self.__dict__.update(model.__dict__)
        return self

    def generate_random_scm(self, num_observables, num_unobservables, num_treatments,
                            num_outcomes, edge_prob=0.5, seed=None, discrete=False):
        """Legacy graph-plus-model builder. New generators can construct SCM directly."""
        from graph import generate_random_graph
        seed = int(self._model_rng.integers(0, 2**32)) if seed is None else _integer(seed, "seed")
        with _legacy_random_state(seed):
            graph_dict, _, _, _ = generate_random_graph(num_observables, num_unobservables,
                                               num_treatments, num_outcomes,
                                               sparcity_constant=edge_prob, seednum=seed)
        return self.build_from_graph(graph_dict, discrete=discrete, seed=seed)

    def get_adjacency_matrix(self):
        import pandas as pd
        nodes = sorted(self.graph)
        return pd.DataFrame(nx.to_numpy_array(self.graph, nodelist=nodes, dtype=int),
                            index=nodes, columns=nodes)


SCM = StructuralCausalModel
