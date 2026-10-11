"""CausalPy graph editor API, bundled from the local Python engine."""

import json
import re

import networkx as nx
import numpy as np

from SCM import SCM
from scm_registry import EQUATION_FAMILIES, NOISE_FAMILIES



def _integer(value, name, upper):
    if type(value) is not int or not 0 <= value <= upper:
        raise ValueError(f"{name}: an integer from 0 to {upper} is required.")
    return value


def generate_scm(payload):
    """Build a real fixed SCM from node metadata; then draw observed rows."""
    if not isinstance(payload, dict):
        raise ValueError("A JSON object is required.")
    nodes, edges = payload.get("nodes"), payload.get("edges", [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 50:
        raise ValueError("Use 1 to 50 nodes.")
    if not isinstance(edges, list) or len(edges) > 2500:
        raise ValueError("Use a list of at most 2500 edges.")
    model_seed = _integer(payload.get("model_seed", 7), "model seed", 2**32 - 1)
    data_seed = _integer(payload.get("data_seed", 5), "data seed", 2**32 - 1)
    n = _integer(payload.get("n", 8), "rows", 1000)
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
    model = SCM(model_seed=model_seed).build_from_graph(
        graph, equation_families=families,
        noise_distributions=list(NOISE_FAMILIES) if noise == "random" else noise)
    data = model.sample_observational(n, seed=data_seed)
    if not np.isfinite(data.to_numpy(dtype=float)).all():
        raise ValueError("The sample contains NaN/Inf. Change the graph or function settings.")
    return {"columns": list(data.columns), "rows": data.to_numpy().tolist(),
            "shape": list(data.shape), "model": model.describe()}
