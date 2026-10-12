"""Factories for model choices. Nothing is re-selected while sampling rows."""

import numpy as np
import inspect
from scipy import stats
from scipy.special import expit, log_expit


# Edit these candidates/ranges before building a model, never while drawing rows.
PARAMETER_PRIORS = {
    name: {"coefficient_range": (-1, 1), "intercept_range": (-1, 1)}
    for name in ("linear", "quadratic", "bounded", "binary")
}
PARAMETER_PRIORS.update({
    "neural_network": {"depths": (1, 2, 3, 4, 5, 6), "widths": (4, 8),
                       "activations": ("tanh", "relu"), "weight_scales": (0.5, 1)},
    "decision_tree": {"depths": (1, 2, 3, 4, 5, 6), "threshold_range": (-1, 1), "leaf_range": (-1, 1)},
    "normal": {"scale_range": (0.1, 1)},
    "uniform": {"scale_range": (0.1, 1)},
})


def _make_equation(parents, rng, kind):
    """Choose coefficients once. The returned function only draws data noise."""
    prior = PARAMETER_PRIORS[kind]
    coefficients = {parent: float(rng.uniform(*prior["coefficient_range"])) for parent in parents}
    intercept = float(rng.uniform(*prior["intercept_range"]))

    def equation(noise, rng, num_sample, _uniform=None, **values):
        linear = np.full(num_sample, intercept)
        for parent, coefficient in coefficients.items():
            value = values[parent]
            linear += coefficient * (value ** 2 if kind == "quadratic" else value)
        linear += noise
        if kind == "binary":
            # This explicit innovation can be inferred and reused across worlds.
            if isinstance(_uniform, tuple):
                orientation, log_threshold = _uniform
                return np.where(orientation, log_threshold < log_expit(linear),
                                log_threshold > log_expit(-linear)).astype(int)
            uniform = rng.random(num_sample) if _uniform is None else _uniform
            return (uniform < expit(linear)).astype(int)
        return expit(linear) if kind == "bounded" else linear

    equation._scm_parameters = {"kind": kind, "coefficients": coefficients,
                                "intercept": intercept}
    return equation


def _parent_matrix(parents, values, n):
    return np.column_stack([values[name] for name in parents]) if parents else np.empty((n, 0))


def _neural_network(parents, rng):
    """Draw a small NumPy network once; this factory does not train it."""
    parents = list(parents)
    prior = PARAMETER_PRIORS["neural_network"]
    depth = int(rng.choice(prior["depths"]))
    width = int(rng.choice(prior["widths"]))
    activation = str(rng.choice(prior["activations"]))
    scale = float(rng.choice(prior["weight_scales"]))
    if depth < 1 or width < 1 or scale <= 0 or activation not in {"tanh", "relu"}:
        raise ValueError("Network needs positive depth/width/scale and tanh or relu activation")
    weights = [rng.normal(0, scale, (len(parents) if i == 0 else width, width)) for i in range(depth)]
    biases = [rng.normal(0, scale, width) for _ in range(depth)]
    output_weights = rng.normal(0, scale, width)
    intercept = float(rng.normal(0, scale))

    def equation(noise, num_sample, **values):
        hidden = _parent_matrix(parents, values, num_sample)
        for weight, bias in zip(weights, biases):
            hidden = hidden @ weight + bias
            hidden = np.tanh(hidden) if activation == "tanh" else np.maximum(hidden, 0)
        return hidden @ output_weights + intercept + noise

    equation._scm_parameters = {
        "kind": "neural_network", "parents": parents.copy(), "depth": depth, "width": width,
        "activation": activation, "weight_scale": scale,
        "input_weights": weights[0].tolist(), "bias": biases[0].tolist(),
        "hidden_weights": [weight.tolist() for weight in weights[1:]],
        "hidden_biases": [bias.tolist() for bias in biases[1:]],
        "output_weights": output_weights.tolist(), "intercept": intercept,
    }
    return equation


def _decision_tree(parents, rng):
    """Draw a complete binary tree once; root variables use a single leaf."""
    parents = list(parents)
    prior = PARAMETER_PRIORS["decision_tree"]
    depth = int(rng.choice(prior["depths"])) if parents else 0
    if depth < 0:
        raise ValueError("Tree depth must be non-negative")
    n_splits = 2 ** depth - 1
    features = rng.integers(0, len(parents), n_splits) if n_splits else np.empty(0, dtype=int)
    thresholds = rng.uniform(*prior["threshold_range"], n_splits)
    leaves = rng.uniform(*prior["leaf_range"], 2 ** depth)

    def equation(noise, num_sample, **values):
        inputs = _parent_matrix(parents, values, num_sample)
        index = np.zeros(num_sample, dtype=int)
        for _ in range(depth):
            right = inputs[np.arange(num_sample), features[index]] > thresholds[index]
            index = 2 * index + 1 + right
        return leaves[index - n_splits] + noise

    equation._scm_parameters = {
        "kind": "decision_tree", "parents": parents.copy(), "depth": depth,
        "used_parents": [parents[i] for i in sorted(set(features.tolist()))],
        "features": features.tolist(), "thresholds": thresholds.tolist(), "leaves": leaves.tolist(),
    }
    return equation


# Equation factories receive (parents, model_rng) and return a fixed callable.
EQUATION_FAMILIES = {
    "linear": lambda parents, rng: _make_equation(parents, rng, "linear"),
    "quadratic": lambda parents, rng: _make_equation(parents, rng, "quadratic"),
    "bounded": lambda parents, rng: _make_equation(parents, rng, "bounded"),
    "binary": lambda parents, rng: _make_equation(parents, rng, "binary"),
    "neural_network": _neural_network,
    "decision_tree": _decision_tree,
}


def _cluster_equation(parent_shapes, output_shape, kind, rng):
    """Reuse scalar factories per output coordinate, with flattened parent inputs."""
    features = [(name, i, f"{name}[{i}]" if shape else name)
                for name, shape in parent_shapes.items() for i in range(shape[0] if shape else 1)]
    equations = [EQUATION_FAMILIES[kind]([key for _, _, key in features], rng)
                 for _ in range(output_shape[0] if output_shape else 1)]
    if any(not callable(equation) for equation in equations):
        raise TypeError("Equation factories must return callables")
    signatures = [inspect.signature(equation) for equation in equations]

    def equation(noise, rng, num_sample, _uniform=None, **values):
        inputs = {key: values[name][:, i] if parent_shapes[name] else values[name]
                  for name, i, key in features}
        outputs = []
        for i, (function, signature) in enumerate(zip(equations, signatures)):
            arguments = dict(inputs, noise=noise[:, i] if output_shape else noise,
                             rng=rng, num_sample=num_sample)
            if _uniform is not None:
                arguments["_uniform"] = (tuple(value[:, i] for value in _uniform) if isinstance(_uniform, tuple)
                                          else _uniform[:, i]) if output_shape else _uniform
            if not any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values()):
                arguments = {key: value for key, value in arguments.items() if key in signature.parameters}
            value = np.asarray(function(**arguments))
            if value.shape != (num_sample,):
                raise ValueError("Each cluster coordinate must return an n-row scalar array")
            outputs.append(value)
        return np.column_stack(outputs) if output_shape else outputs[0]

    equation._scm_parameters = {"kind": kind, "parent_shapes": dict(parent_shapes),
                                "coordinates": [getattr(f, "_scm_parameters", {}) for f in equations]}
    return equation


def _uniform_noise(rng):
    scale = float(rng.uniform(*PARAMETER_PRIORS["uniform"]["scale_range"]))
    return stats.uniform(loc=-scale, scale=2 * scale)


# Noise factories receive model_rng and return a raw law or sampler(rng, size).
NOISE_FAMILIES = {
    "normal": lambda rng: stats.norm(loc=0, scale=float(rng.uniform(*PARAMETER_PRIORS["normal"]["scale_range"]))),
    "uniform": _uniform_noise,
}


def _select_family(selection, registry, rng):
    """Validate a name/pool and select once with the model RNG."""
    choices = [selection] if isinstance(selection, str) else selection
    if not isinstance(choices, (list, tuple)) or not choices:
        raise ValueError("Family choices must be a name or nonempty name sequence")
    if any(not isinstance(name, str) or name not in registry for name in choices):
        raise ValueError(f"Unknown family choices: {choices}")
    if any(not callable(registry[name]) for name in choices):
        raise TypeError("Each family factory must be callable")
    return selection if isinstance(selection, str) else str(rng.choice(choices))
