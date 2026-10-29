"""Graph generation, conversion, and queries for CausalPy.

Start with create_acyclic_graph() and generate_random_dag(). Graphs use
NetworkX DiGraph objects; dictionaries map each node to its children.
Legacy causal helpers treat names starting with 'U' as hidden variables.
Run python -B graph.py for a demo without files, plots, or a browser.
"""

from collections import deque
from collections.abc import Mapping
from itertools import combinations
from numbers import Integral, Real
import math
import random

import networkx as nx


# Graph creation and conversion

def create_acyclic_graph(graph_dict, an_Y_graph_TF=False, Y=None, node_positions=None):
    """Convert node -> children to a DAG, retaining isolated and child-only nodes.

    Positions are optional attributes. With an_Y_graph_TF, return the ancestor
    subgraph of Y using the legacy hidden-variable conventions.
    """
    if not isinstance(graph_dict, Mapping):
        raise TypeError("graph_dict must map nodes to their children")
    if an_Y_graph_TF and Y is None:
        raise ValueError("Y is required when an_Y_graph_TF is True")
    G = nx.DiGraph()
    if node_positions:
        G.add_nodes_from(node_positions)
    G.add_nodes_from(graph_dict)
    G.add_edges_from((node, child) for node, children in graph_dict.items() for child in children)
    if not nx.is_directed_acyclic_graph(G):
        raise ValueError("The graph is cyclic and cannot be created.")
    if node_positions:
        nx.set_node_attributes(G, node_positions, "pos")
    return subgraph_ancestor_Y(G, Y) if an_Y_graph_TF else G


def graph_to_graphdict(G: nx.DiGraph) -> dict:
    """Return node -> children, including nodes without children."""
    return {node: list(G.successors(node)) for node in G.nodes()}


def _count(value, name):
    if isinstance(value, bool) or not isinstance(value, Integral) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer")
    return int(value)


def _rng(seed):
    return random.Random(None if seed is None else _count(seed, "seed"))


def _random_dag(nodes, edge_prob, rng):
    nodes = list(nodes)
    rng.shuffle(nodes)
    G = nx.DiGraph()
    G.add_nodes_from(nodes)
    for parent, child in combinations(nodes, 2):
        if rng.random() < edge_prob:
            G.add_edge(parent, child)
    return G


def _connect_dag(G, ordered_nodes, connected):
    """Join weak components with forward edges between ordered observed nodes."""
    if not isinstance(connected, bool):
        raise ValueError("connected must be a bool")
    if not connected:
        return G
    if not G:
        raise ValueError("connected=True requires at least one node")
    component = {node: i for i, group in enumerate(nx.weakly_connected_components(G))
                 for node in group}
    first = {}
    for node in ordered_nodes:
        first.setdefault(component[node], node)
    representatives = list(first.values())
    G.add_edges_from(zip(representatives, representatives[1:]))
    return G


def generate_random_dag(n_nodes, edge_prob, seed=None, *, connected=True) -> nx.DiGraph:
    """Return a DAG with nodes V1,...,Vn using a local random generator.

    Shuffle node order, then sample initial forward edges with edge_prob in [0,1].
    By default, join weak components with the minimum extra forward edges.
    Connected means all nodes are linked when edge directions are ignored.
    Set connected=False to keep the initial graph, including isolated nodes.
    This defines a graph distribution, not uniform sampling over all DAGs.
    n_nodes may be zero only with connected=False. An integer seed repeats
    the graph in the same runtime;
    None uses fresh entropy. No roles, hidden nodes, functions, or layout are added.
    """
    n_nodes = _count(n_nodes, "n_nodes")
    if (isinstance(edge_prob, bool) or not isinstance(edge_prob, Real)
            or not math.isfinite(edge_prob) or not 0 <= edge_prob <= 1):
        raise ValueError("edge_prob must be a finite number between 0 and 1")
    G = _random_dag([f"V{i + 1}" for i in range(n_nodes)], edge_prob, _rng(seed))
    return _connect_dag(G, G.nodes(), connected)


def generate_random_graph(num_observables, num_unobservables, num_treatments,
                          num_outcomes, sparcity_constant=0.25, seednum=123, *, connected=True):
    """Legacy generator: return [graph_dict, positions, treatments, outcomes].

    Keep X/Y/V labels, pairwise hidden roots, and initial p=min(2*sparcity_constant,1).
    By default, join remaining weak components after adding hidden roots.
    Add only observed-to-observed forward edges; hidden roots stay unchanged.
    Connected means all nodes, including hidden ones, are linked ignoring direction.
    Extra connection edges can increase density beyond the initial draw probability.
    connected=False preserves previous seeded outputs, including positions and roles.
    An empty graph requires connected=False. The RNG does not change global states.
    The result represents hidden roots explicitly in a DAG.
    """
    num_observables = _count(num_observables, "num_observables")
    num_unobservables = _count(num_unobservables, "num_unobservables")
    num_treatments = _count(num_treatments, "num_treatments")
    num_outcomes = _count(num_outcomes, "num_outcomes")
    if num_treatments + num_outcomes > num_observables:
        raise ValueError("treatments and outcomes must fit within num_observables")
    if not isinstance(sparcity_constant, Real) or not math.isfinite(sparcity_constant):
        raise ValueError("sparcity_constant must be a finite number")
    rng = _rng(seednum)
    treatments = [f"X{i + 1}" for i in range(num_treatments)]
    outcomes = [f"Y{i + 1}" for i in range(num_outcomes)]
    others = [f"V{i + 1}" for i in range(num_observables - num_treatments - num_outcomes)]
    G = _random_dag(treatments + outcomes + others, min(sparcity_constant * 2, 1.0), rng)
    observables = list(G.nodes())
    max_confounders = num_observables * (num_observables - 1) // 2
    if num_unobservables > max_confounders:
        print(f"Warning: Requested {num_unobservables} unobservables, but only {max_confounders} unique pairs exist. Generating {max_confounders}.")
        num_unobservables = max_confounders
    pairs = set()
    max_tries = num_unobservables * 20
    for _ in range(max_tries):
        if len(pairs) == num_unobservables:
            break
        pair = tuple(sorted(rng.sample(observables, 2)))
        if pair not in pairs:
            pairs.add(pair)
            hidden = f"U_{pair[0]}_{pair[1]}"
            G.add_edges_from((hidden, child) for child in pair)
    if len(pairs) < num_unobservables:
        print(f"Warning: Could only generate {len(pairs)} unique confounders after {max_tries} attempts.")
    _connect_dag(G, observables, connected)
    positions = {node: (rng.uniform(0, 100), rng.uniform(0, 100)) for node in G.nodes()}
    return [graph_to_graphdict(G), positions, treatments, outcomes]


def generate_random_cluster_graph(num_observables, num_unobservables, num_treatments,
                                  num_outcomes, sparcity_constant=0.25, seednum=123, *,
                                  connected=True, cluster_prob=0.5, cluster_sizes=(2, 3, 4, 8)):
    """Return a DAG whose nodes randomly output scalars or vectors.

    Dimensions are fixed model metadata, including for hidden roots. Set
    cluster_prob=0 for scalar nodes. Legacy generate_random_graph is unchanged.
    """
    if (isinstance(cluster_prob, bool) or not isinstance(cluster_prob, Real)
            or not math.isfinite(cluster_prob) or not 0 <= cluster_prob <= 1):
        raise ValueError("cluster_prob must be between 0 and 1")
    sizes = tuple(_count(size, "cluster size") for size in cluster_sizes)
    if not sizes or min(sizes) < 2:
        raise ValueError("cluster_sizes must contain dimensions of at least 2")
    graph_dict, positions, treatments, outcomes = generate_random_graph(
        num_observables, num_unobservables, num_treatments, num_outcomes,
        sparcity_constant, seednum, connected=connected)
    G = create_acyclic_graph(graph_dict, node_positions=positions)
    rng = _rng(seednum)
    for name in G:
        dimension = rng.choice(sizes) if rng.random() < cluster_prob else 1
        G.nodes[name].update(shape=() if dimension == 1 else (dimension,),
                             dimension=dimension, observed=not name.startswith("U"),
                             columns=[name] if dimension == 1 else [f"{name}[{i}]" for i in range(dimension)])
    G.graph.update(treatments=treatments, outcomes=outcomes)
    return G


def observed_nodes(G):
    """Metadata first; U-prefix is a fallback for legacy graphs only."""
    return {v for v in G if G.nodes[v].get("observed", not str(v).startswith("U"))}


def require_latent_roots(G):
    if any(G.in_degree(v) for v in set(G) - observed_nodes(G)):
        raise ValueError("This method requires independent hidden roots.")


def marginalize_hidden_nodes(G):
    """Private analysis graph; never replace the full simulated/editor DAG.

    Recursively substitute hidden equations. Each hidden variable's independent
    exogenous noise becomes one root with its first observed descendants as
    children. Keep shared-noise frontiers whole (not independent pair roots).
    Existing independent-root graphs are copied without changing their labels.
    """
    if not isinstance(G, nx.DiGraph) or not nx.is_directed_acyclic_graph(G):
        raise ValueError("A directed acyclic graph is required.")
    observed = observed_nodes(G)
    hidden = set(G) - observed
    if all(G.in_degree(v) == 0 for v in hidden):
        return G.copy()

    def frontier(start):
        reached, pending, result = set(), list(G.successors(start)), set()
        while pending:
            node = pending.pop()
            if node in reached:
                continue
            reached.add(node)
            if node in observed:
                result.add(node)
            else:
                pending.extend(G.successors(node))
        return result

    H = nx.DiGraph()
    H.graph.update(G.graph)
    H.add_nodes_from((v, dict(G.nodes[v])) for v in G if v in observed)
    for source in G:
        if source in observed:
            H.add_edges_from((source, child) for child in frontier(source))
    noise_roots = {}
    used = set(G)
    for node in G:
        if node not in hidden:
            continue
        root = "U_noise_" + str(node)
        while root in used:
            root += "_"
        used.add(root)
        noise_roots[root] = node
        H.add_node(root, observed=False, dimension=1, projection_noise_for=node)
        H.add_edges_from((root, child) for child in frontier(node))
    H.graph["latent_projection"] = dict(
        kind="hidden-equation substitution with independent noise frontiers",
        source_nodes=list(G), noise_roots=noise_roots,
        information="Analysis copy only; original hidden variables and SCM equations are unchanged.")
    return H


def preprocess_query(G, X, Y):
    """Apply A1 to this query, preserving the input graph and source map.

    Restrict to An(Y), then prune actions using the graph with incoming edges
    to all candidate actions removed. Pruned actions remain ordinary nodes.
    Probability positivity/discreteness are model assumptions, not graph tests.
    """
    X, Y = tuple(X), tuple(Y)
    if not isinstance(G, nx.DiGraph) or not nx.is_directed_acyclic_graph(G):
        raise ValueError("A directed acyclic graph is required.")
    original_observed = observed_nodes(G)
    if (not Y or len(set(X)) != len(X) or len(set(Y)) != len(Y)
            or set(X) & set(Y) or not set(X) | set(Y) <= original_observed):
        raise ValueError("Use unique disjoint observed nodes and nonempty outcomes.")
    def ancestors(H, starts):
        reached, queue = set(starts), list(starts)
        while queue:
            for parent in H.predecessors(queue.pop()):
                if parent not in reached:
                    reached.add(parent)
                    queue.append(parent)
        return reached
    H = G.subgraph(ancestors(G, Y)).copy()
    candidates = set(X) & set(H)
    cut = G_cut_incoming_edges(H, candidates)
    actions = candidates & ancestors(cut, Y)
    observed = observed_nodes(H)
    previous = G.graph.get("query", {})
    same_query = set(X) == set(previous.get("actions", ())) and set(Y) == set(previous.get("original_outcomes", ()))
    H.graph["query"] = {"original_actions": previous["original_actions"] if same_query else X, "original_outcomes": previous["original_outcomes"] if same_query else Y,
                        "source_observed": previous.get("source_observed", tuple(v for v in G if v in original_observed)),
                        "actions": tuple(v for v in H if v in actions),
                        "retained_observed": tuple(v for v in H if v in observed)}
    return H, actions, set(Y)


def find_topological_order(G):
    """Return observed nodes in parent-before-child order."""
    observed = observed_nodes(G)
    return [node for node in nx.topological_sort(G) if node in observed]


def all_possible_orders_X(G, X):
    """Return distinct orders of X induced by the observed-node subgraph."""
    if not nx.is_directed_acyclic_graph(G):
        raise ValueError("The graph must be a directed acyclic graph (DAG)")
    observed = G.subgraph(observed_nodes(G))
    orders = {tuple(node for node in order if node in X)
              for order in nx.all_topological_sorts(observed)}
    return [list(order) for order in sorted(orders)]


def subgraphs(G, C):
    """Return a subgraph view of C plus its directly adjacent hidden nodes."""
    observed_set = observed_nodes(G)
    nodes = list(C)
    for node in C:
        neighbors = list(G.predecessors(node)) + list(G.successors(node))
        nodes.extend(neighbor for neighbor in neighbors if neighbor not in observed_set)
    return G.subgraph(nodes)


def _relatives(G, C, incoming):
    observed_set = observed_nodes(G)
    relatives = set()
    for node in C:
        if node in G:
            relatives.update(G.predecessors(node) if incoming else G.successors(node))
    return {node for node in relatives if node in observed_set and node not in C}


def find_parents(G, C):
    """Return sorted observed parents outside C."""
    return sorted(_relatives(G, C, incoming=True))


def find_children(G, C):
    """Return observed children outside C as a list."""
    return list(_relatives(G, C, incoming=False))


def _closure(G, nodes, ancestors):
    observed_set = observed_nodes(G)
    result = set()
    for node in nodes:
        if node in observed_set:
            result.add(node)
            reachable = nx.ancestors(G, node) if ancestors else nx.descendants(G, node)
            result.update({other for other in reachable if other in observed_set})
    return list(result)


def find_descendant(G, nodes):
    """Return observed descendants, including each observed starting node."""
    return _closure(G, nodes, ancestors=False)


def find_ancestor(G, nodes):
    """Return observed ancestors, including each observed starting node."""
    return _closure(G, nodes, ancestors=True)


def subgraph_ancestor_Y(G, Y):
    """Return the ancestor subgraph of Y with adjacent hidden nodes."""
    return subgraphs(G, find_ancestor(G, Y))


def list_all_c_components(G):
    """Group observed nodes connected by shared hidden parents.

    Preserve graph order between components and legacy set-based member order.
    Observed directed edges do not connect these components.
    """
    observed_set = observed_nodes(G)
    observed = [node for node in G if node in observed_set]
    neighbors = {node: set() for node in observed}
    for hidden in G:
        if hidden not in observed_set:
            children = [node for node in G.successors(hidden) if node in observed_set]
            for node in children:
                neighbors[node].update(child for child in children if child != node)
    order = {node: index for index, node in enumerate(observed)}
    neighbors = {node: sorted(adjacent, key=order.__getitem__) for node, adjacent in neighbors.items()}
    components, visited = [], set()
    for node in observed:
        if node in visited:
            continue
        component, queue = set(), deque([node])
        while queue:
            current = queue.popleft()
            if current not in visited:
                visited.add(current)
                component.add(current)
                queue.extend(neighbors[current])
        # Retain the legacy set reconstruction and its member iteration order.
        components.append(list({node for node in component if node in observed_set}))
    return components


def find_c_components(G, C):
    """Return the union of observed components containing any node in C."""
    components = list_all_c_components(G)
    by_node = {node: component for component in components for node in component}
    result = set()
    for node in set(C):
        result.update(by_node.get(node, ()))
    return list(result)


def _cut_edges(G, X, incoming):
    changed = G.copy()
    for node in X:
        if node in changed:
            edges = changed.in_edges(node) if incoming else changed.out_edges(node)
            changed.remove_edges_from(list(edges))
    return changed


def G_cut_incoming_edges(G, X):
    """Return a copy with all incoming edges of X removed."""
    return _cut_edges(G, X, incoming=True)


def G_cut_outgoing_edges(G, X):
    """Return a copy with all outgoing edges of X removed."""
    return _cut_edges(G, X, incoming=False)


def is_d_separated(G, X, Y, Z):
    """Check d-separation using NetworkX; X, Y, Z are node collections."""
    check = getattr(nx, "is_d_separator", None) or nx.d_separated
    return check(G, set(X), set(Y), set(Z))


def _separator_closure(G, starts, ancestors, blocked):
    """Algorithm closure, not ordinary d-connection; visit two states per node."""
    queue, visited = deque((node, False) for node in starts), set()
    while queue:
        node, arrowhead = queue.popleft()
        if (node, arrowhead) in visited:
            continue
        visited.add((node, arrowhead))
        if node not in blocked or arrowhead:
            queue.extend((parent, False) for parent in G.predecessors(node)
                         if parent in ancestors)
        if node not in blocked:
            queue.extend((child, True) for child in G.successors(node)
                         if child in ancestors)
    return {node for node, _ in visited}


def find_minimal_d_separator(G, X, Y, *, included=(), restricted=None):
    """Find an inclusion-minimal separator with mandatory/allowed nodes.

    Implement van der Zander & Liśkiewicz (2020), Section 3, FINDMINSEPINDAG.
    Return a graph-ordered list, or None if no allowed separator exists.
    Empty endpoints are permitted. Hidden nodes remain in graph traversal;
    the caller must exclude them from restricted. No graph is modified.
    """
    X, Y, included = set(X), set(Y), set(included)
    restricted = set(G) if restricted is None else set(restricted)
    if not G.is_directed() or not nx.is_directed_acyclic_graph(G):
        raise ValueError("A directed acyclic graph is required.")
    if not (X | Y | included | restricted) <= set(G):
        raise ValueError("All query and separator nodes must exist in the graph.")
    if X & Y or (X | Y) & included or not included <= restricted:
        raise ValueError("X/Y must be disjoint and included must be allowed outside X/Y.")
    ancestors = X | Y | included
    queue = list(ancestors)
    while queue:
        for parent in G.predecessors(queue.pop()):
            if parent not in ancestors:
                ancestors.add(parent)
                queue.append(parent)
    candidate = (restricted & ancestors) - X - Y
    reached_X = _separator_closure(G, X, ancestors, candidate)
    if reached_X & Y:
        return None
    candidate = (candidate & reached_X) | included
    reached_Y = _separator_closure(G, Y, ancestors, candidate)
    result = (candidate & reached_Y) | included
    if not is_d_separated(G, X, Y, result):
        raise RuntimeError("Minimal separator failed its separation check.")
    return [node for node in G if node in result]


def find_reacheable_set(G, X, A, Z):
    """Legacy path search inside A, each starting x, and hidden nodes.

    Keep path-specific collider checks; a node-only visited search is not equivalent.
    The historical spelling is retained for existing callers.
    """
    X_set, A_set, Z_set = set(X), set(A), set(Z)
    hidden = set(G) - observed_nodes(G)
    open_colliders = Z_set.union(find_ancestor(G, Z))
    undirected = G.to_undirected()
    closure = set()

    def valid_path(path):
        for index in range(1, len(path) - 1):
            node = path[index]
            collider = G.has_edge(path[index - 1], node) and G.has_edge(path[index + 1], node)
            if (collider and node not in open_colliders) or (not collider and node in Z_set):
                return False
        return True

    for x in X:
        allowed = A_set.union({x}, hidden)
        queue, visited = deque([(x, [x])]), set()
        while queue:
            current, path = queue.popleft()
            if current in A_set.union({x}) and current not in visited:
                closure.add(current)
                visited.add(current)
            for neighbor in undirected.neighbors(current):
                if neighbor not in path and neighbor in allowed:
                    extended = path + [neighbor]
                    if valid_path(extended):
                        queue.append((neighbor, extended))
    return list(closure.union(X_set))


def do_calculus_1(G, Y, Z, X, W):
    """Check Rule 1's separation condition after cutting incoming edges of X."""
    return is_d_separated(G_cut_incoming_edges(G, X), Y, Z, W + X)


def do_calculus_2(G, Y, Z, X, W):
    """Check Rule 2's condition after incoming-X and outgoing-Z cuts."""
    changed = G_cut_outgoing_edges(G_cut_incoming_edges(G, X), Z)
    return is_d_separated(changed, Y, Z, W + X)


def do_calculus_3(G, Y, Z, X, W):
    """Check Rule 3's condition with the legacy ancestor-of-W inclusion rule."""
    changed = G_cut_incoming_edges(G, X)
    Z_W = list(set(Z) - set(find_ancestor(changed, W)))
    return is_d_separated(G_cut_incoming_edges(changed, Z_W), Y, Z, W + X)


# Ordered variables and vector-column expansion

def contiguous_series(G, W, topo_V=None):
    """Return the longest contiguous run in the supplied order of W."""
    if topo_V is None:
        topo_V = find_topological_order(G)
    position = {node: index for index, node in enumerate(topo_V)}
    current, best = [], []
    for node in W:
        if node in position:
            if current and position[node] != position[current[-1]] + 1:
                if len(current) > len(best):
                    best = current
                current = []
            current.append(node)
    return current if len(current) > len(best) else best


def find_successors(G, W, topo_V=None):
    """Return nodes after contiguous W; preserve the legacy contiguity check."""
    if topo_V is None:
        topo_V = find_topological_order(G)
    W = sorted(W, key=topo_V.index)
    if set(contiguous_series(G, W)) != set(W):
        raise ValueError(f"{W} is not contiguous")
    return topo_V[topo_V.index(W[-1]) + 1:]


def find_predecessors(G, W, topo_V=None):
    """Return nodes before the first node of W in topological order."""
    if topo_V is None:
        topo_V = find_topological_order(G)
    W = sorted(W, key=topo_V.index)
    return topo_V[:topo_V.index(W[0])]


def expand_variables(variable_list, cluster_map):
    """Replace conceptual variables by their mapped data columns."""
    if not variable_list or not cluster_map:
        return variable_list
    return [column for node in variable_list for column in cluster_map.get(node, [node])]


def _sorted_components(components, node):
    try:
        return sorted(components, key=lambda column: int(column[len(node):]))
    except ValueError:
        return sorted(components)


def build_cluster_map(conceptual_nodes, obs_data):
    """Map each variable to prefix-matching columns, excluding its exact name."""
    clusters = {}
    for node in conceptual_nodes:
        components = [column for column in obs_data.columns if column.startswith(node) and column != node]
        if components:
            clusters[node] = _sorted_components(components, node)
    return clusters


def unfold_graph_from_data(G, clustered_list, obs_data):
    """Expand conceptual nodes and edges to prefix-matching data columns."""
    clusters = {node: _sorted_components([column for column in obs_data.columns
                                         if column.startswith(node)], node)
                for node in clustered_list}
    expanded = nx.DiGraph() if G.is_directed() else nx.Graph()
    for node in G:
        expanded.add_nodes_from(clusters.get(node, [node]))
    for parent, child in G.edges():
        expanded.add_edges_from((p, c) for p in clusters.get(parent, [parent])
                                for c in clusters.get(child, [child]))
    return expanded


# Display and legacy text export: plotting dependencies load only when needed.

def _node_color(node):
    if node.startswith(("T", "X")):
        return "blue"
    if node.startswith(("O", "Y")):
        return "red"
    return "gray" if node.startswith("U") else "lightblue"


def visualize(graph):
    """Display a graph with legacy treatment/outcome/hidden-node colors."""
    import matplotlib.pyplot as plt

    positions = nx.get_node_attributes(graph, "pos") or nx.spring_layout(graph)
    nx.draw(graph, positions, with_labels=True, node_color=[_node_color(node) for node in graph],
            font_weight="bold", arrows=True)
    plt.title("Graph")
    plt.show(block=False)


def visualize_interactive(graph, filename="interactive_graph.html", edge_curvature=0):
    """Write a draggable PyVis HTML graph when explicitly requested."""
    if not graph.nodes():
        print("Graph is empty. Nothing to visualize.")
        return
    from pyvis.network import Network

    net = Network(height="750px", width="100%", directed=True, notebook=True, cdn_resources="in_line")
    net.from_nx(graph)
    for node in net.nodes:
        node["color"] = _node_color(str(node["id"]))
    for edge in net.edges:
        edge["smooth"] = {"type": "curvedCW", "roundness": edge_curvature}
    net.show_buttons(filter_=["physics"])
    try:
        net.show(filename)
        print(f"Interactive graph saved to {filename}")
        print("Open this file in a browser. To move nodes freely, uncheck the 'enabled' box in the 'physics' menu.")
    except Exception as error:
        print(f"An error occurred while generating the interactive graph: {error}")


def write_joint_distribution(variables):
    """Return the legacy symbolic joint-distribution label."""
    return f"P({' , '.join(variables)})"


def graph_dict_to_fusion_graph(graph_dict):
    """Return legacy Fusion text with random layout and illustrative weights.

    The weights are placeholders, not SCM coefficients. This legacy exporter
    retains its use of global Python random state.
    """
    nodes, edges = set(), []
    for node, children in graph_dict.items():
        if node.startswith("U_"):
            if len(children) == 2:
                edges.append(f"{children[0]} -- {children[1]} {random.uniform(-1, 1):.2f}")
        else:
            nodes.add(node)
            for child in children:
                edges.append(f"{node} -> {child}")
                if not child.startswith("U_"):
                    nodes.add(child)
    positions = {node: (random.randint(-200, 200), random.randint(-200, 200)) for node in nodes}
    text = "<NODES>\n" + "\n".join(f"{node}  {pos[0]},{pos[1]}" for node, pos in positions.items())
    return text + "\n\n<EDGES>\n" + "\n".join(edges)


def _demo():
    """Run graph and SCM assertions without files, plots, or a browser."""
    import numpy as np
    import pandas as pd
    from SCM import SCM

    for n, probability, edges, connected in ((0, 0, 0, False), (1, 1, 0, True),
                                             (3, 0, 2, True), (3, 0, 0, False), (3, 1, 3, True)):
        G = generate_random_dag(n, probability, seed=7, connected=connected)
        assert len(G) == n and G.number_of_edges() == edges and nx.is_directed_acyclic_graph(G)
        assert not connected or nx.is_weakly_connected(G)
        restored = create_acyclic_graph(graph_to_graphdict(G))
        assert list(restored.nodes()) == list(G.nodes()) and set(restored.edges()) == set(G.edges())
    legacy, positions, X, Y = generate_random_graph(3, 1, 1, 1, seednum=7)
    assert len(create_acyclic_graph(legacy, node_positions=positions)) == 4 and X == ["X1"] and Y == ["Y1"]
    hidden_only, _, _, _ = generate_random_graph(2, 1, 1, 1, sparcity_constant=0, seednum=7)
    hidden_only = create_acyclic_graph(hidden_only)
    assert nx.is_weakly_connected(hidden_only) and all(parent.startswith("U") for parent, _ in hidden_only.edges())
    G = create_acyclic_graph({"U_X_Y": ["X", "Y"], "X": ["Y"], "Y": [], "Z": []})
    order = find_topological_order(G)
    assert set(order) == {"X", "Y", "Z"} and order.index("X") < order.index("Y")
    assert set(find_ancestor(G, ["Y"])) == {"X", "Y"}
    assert set(find_descendant(G, ["X"])) == {"X", "Y"}
    assert find_parents(G, ["Y"]) == ["X"] and find_children(G, ["X"]) == ["Y"]
    assert {frozenset(c) for c in list_all_c_components(G)} == {frozenset(("X", "Y")), frozenset(("Z",))}
    assert set(find_c_components(G, ["Y"])) == {"X", "Y"}
    assert set(subgraphs(G, ["Y"])) == {"U_X_Y", "Y"}
    assert set(subgraph_ancestor_Y(G, ["Y"])) == {"U_X_Y", "X", "Y"}
    assert len(G_cut_incoming_edges(G, ["X"]).in_edges("X")) == 0
    assert len(G_cut_outgoing_edges(G, ["X"]).out_edges("X")) == 0
    assert G.has_edge("U_X_Y", "X") and G.has_edge("X", "Y")
    assert set(find_reacheable_set(G, ["X"], ["Y"], [])) == {"X", "Y"}
    assert not is_d_separated(G, ["X"], ["Y"], [])
    assert all_possible_orders_X(G, ["X", "Y"]) == [["X", "Y"]]
    for rule in (do_calculus_1, do_calculus_2, do_calculus_3):
        assert isinstance(rule(G, ["Y"], ["Z"], ["X"], []), bool)
    chain = create_acyclic_graph({"A": ["B"], "B": ["C"], "C": []})
    assert contiguous_series(chain, ["A", "B"]) == ["A", "B"]
    assert find_successors(chain, ["A"]) == ["B", "C"] and find_predecessors(chain, ["C"]) == ["A", "B"]
    columns = pd.DataFrame(columns=["C2", "C1", "Y"])
    assert build_cluster_map(["C"], columns) == {"C": ["C1", "C2"]}
    assert expand_variables(["C", "Y"], {"C": ["C1", "C2"]}) == ["C1", "C2", "Y"]
    assert set(unfold_graph_from_data(create_acyclic_graph({"C": ["Y"]}), ["C"], columns).edges()) == {("C1", "Y"), ("C2", "Y")}
    assert write_joint_distribution(["X", "Y"]) == "P(X , Y)"
    assert "<EDGES>" in graph_dict_to_fusion_graph(legacy)
    G = generate_random_dag(3, 0.5, seed=7)
    model = SCM(model_seed=7).build_from_graph(graph_to_graphdict(G), discrete=False)
    rows = model.sample_observational(4, seed=11)
    assert rows.shape == (4, 3) and np.isfinite(rows.to_numpy()).all()
    changed = model.intervene({"V1": 1}).sample_observational(4, seed=11)
    assert changed.V1.eq(1).all()
    pd.testing.assert_frame_equal(rows, model.sample_observational(4, seed=11))
    print("Connectivity: default connected; opt-out isolates; hidden-only connection: PASS")
    print("Graph creation, queries, cuts, causal helpers, column expansion, and text export: PASS")
    print(f"SCM demo: {len(G)} nodes, {G.number_of_edges()} edges, {len(rows)} rows; intervention and original: PASS")
    print("ALL GRAPH DEMOS PASSED")


if __name__ == "__main__":
    _demo()
