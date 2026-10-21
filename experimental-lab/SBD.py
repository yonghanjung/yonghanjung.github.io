"""Canonical sequential back-door search (UCA manuscript, Algorithm 1).

Graphs are DAGs with independent hidden roots; vector variables remain single
nodes. ACCEPT is a sufficient identification certificate. Exhaustive NO_SBD
excludes canonical SCA only in the manuscript's finite-positive private/pair-root
class. UNKNOWN means a search budget ended, never nonidentification.
"""
from dataclasses import dataclass
from math import isfinite
from time import perf_counter
import networkx as nx
import graph


class SearchLimitExceeded(RuntimeError):
    """The canonical order search is unfinished."""


class _TimeBudgetExpired(Exception):
    pass


def _check_deadline(deadline):
    if deadline is not None and perf_counter() >= deadline:
        raise _TimeBudgetExpired


observed_nodes = graph.observed_nodes


def preprocess(G, X, Y):
    """Shared query-first A1, with the SBD independent-root model guard."""
    H, X, Y = graph.preprocess_query(G, X, Y)
    graph.require_latent_roots(G)  # Validate the input model class, including irrelevant hidden nodes.
    return H, X, Y


def partition_outcomes(G, X, Y, *, deadline=None):
    """Keep the supplied treatment order; latest ancestor defines each block."""
    blocks = [[] for _ in range(len(X) + 1)]
    for y in G:
        if y in Y:
            _check_deadline(deadline)
            ancestors = nx.ancestors(G, y)
            _check_deadline(deadline)
            latest = max((i + 1 for i, x in enumerate(X) if x in ancestors), default=0)
            blocks[latest].append(y)
    return {f"Y{i}": block for i, block in enumerate(blocks)}


@dataclass(frozen=True)
class Witness:
    original_actions: tuple
    retained_nodes: tuple
    actions: tuple
    outcomes: tuple
    order: tuple
    outcome_blocks: tuple
    auxiliary_blocks: tuple

    @property
    def factors(self):
        """Ordered (head, given) leaves from the accepted witness only."""
        if not self.actions:
            return ((self.outcomes, ()),)
        Z = self.auxiliary_blocks + ((),)
        factors, history = [], ()
        for i in range(len(self.actions) + 1):
            head = self.outcome_blocks[i] + Z[i]
            if head:
                factors.append((head, history))
            if i < len(self.actions):
                history += head + (self.actions[i],)
        return tuple(factors)

    def expression(self, latex=False):
        separator = " \\mid " if latex else " | "
        terms = ["P(" + ", ".join(head) +
                 (separator + ", ".join(given) if given else "") + ")"
                 for head, given in self.factors]
        summed = [v for block in self.auxiliary_blocks for v in block]
        prefix = (("\\sum" if latex else "Σ") + "_{" + ", ".join(summed) + "} ") if summed else ""
        return prefix + " ".join(terms)

    def dictionaries(self):
        return ({f"X{i+1}": [x] for i, x in enumerate(self.actions)},
                {f"Z{i+1}": list(z) for i, z in enumerate(self.auxiliary_blocks)},
                {f"Y{i}": list(y) for i, y in enumerate(self.outcome_blocks)})


@dataclass(frozen=True)
class Result:
    status: str
    witness: object = None
    searched: int = 0

    def __bool__(self):
        raise TypeError("Inspect status explicitly; UNKNOWN is not False.")


def _certificate(H, X, Y, order, original, *, deadline=None):
    _check_deadline(deadline)
    actions = tuple(v for v in order if v in X)
    blocks = tuple(tuple(b) for b in partition_outcomes(H, actions, Y, deadline=deadline).values())
    _check_deadline(deadline)
    positions = {v: i for i, v in enumerate(order)}
    cuts = [-1] + [positions[x] for x in actions] + [len(order)]
    if any(not cuts[i] < positions[y] < cuts[i+1]
           for i, block in enumerate(blocks) for y in block):
        return None
    auxiliary, history = [], set()
    for i, x in enumerate(actions):
        _check_deadline(deadline)
        stage = H.copy()
        stage.remove_nodes_from(actions[i+1:])
        stage.remove_edges_from(list(stage.out_edges(x)))
        future = set().union(*blocks[i+1:])
        prefix = set(order[:positions[x]])
        _check_deadline(deadline)
        if not graph.is_d_separated(stage, [x], future, prefix):
            return None
        _check_deadline(deadline)
        history.update(blocks[i])
        separator = graph.find_minimal_d_separator(
            stage, [x], future, included=history, restricted=prefix)
        _check_deadline(deadline)
        if separator is None:
            raise RuntimeError("Full-prefix certificate has no constrained separator.")
        auxiliary.append(tuple(v for v in order if v in set(separator) - history))
        history.update(separator)
        history.add(x)
    _check_deadline(deadline)
    return Witness(tuple(original), tuple(H), actions, tuple(v for v in H if v in Y),
                   tuple(order), blocks, tuple(auxiliary))


def _random_order(G, rng, deadline):
    """Randomized Kahn traversal; valid orders, not uniformly distributed orders."""
    degree = dict(G.in_degree())
    ready = [v for v in G if degree[v] == 0]
    order = []
    while ready:
        _check_deadline(deadline)
        i = rng.randrange(len(ready))
        v = ready[i]
        ready[i] = ready[-1]
        ready.pop()
        order.append(v)
        for child in G.successors(v):
            degree[child] -= 1
            if degree[child] == 0:
                ready.append(child)
    return tuple(order)


def _sample_orders(G, limit, seed, deadline):
    from random import Random
    rng = Random(seed)
    for draw in range(limit):
        yield tuple(nx.topological_sort(G)) if draw == 0 else _random_order(G, rng, deadline)


def find_sbd(G, X, Y, *, max_orders="auto", max_seconds="auto", fixed_order=None, strategy="auto", seed=0):
    """Auto: bounded random search, then up to two seconds of full-order search.

    Random phase tries one canonical order, then seeded Kahn candidates, for at
    most one second and min(256, n*n) draws (duplicates included). n counts A1
    observed nodes; clusters count as one. Fallback has no order-count cap.
    Default misses are UNKNOWN, even when fallback exhausts all orders.
    searched counts candidate checks; fallback may recheck random candidates.
    max_seconds is an overall deadline including A1; explicit None removes only
    that overall cap, preserving hybrid phase limits. Checks are cooperative.
    strategy='random' keeps pure sampling; strategy='exhaustive' enumerates orders.
    max_orders=None with auto requests exhaustive search without default timeout.
    Explicit strategies retain their max_orders/max_seconds semantics. Only
    exhaustive exhaustion returns NO_SBD. Seed reproduces candidates, not timings.
    Stage separators remain inclusion-minimal for fixed history and prefix.
    """
    if strategy not in ('auto', 'random', 'exhaustive'):
        raise ValueError("strategy must be 'auto', 'random', or 'exhaustive'.")
    if seed is not None and type(seed) is not int:
        raise ValueError("seed must be an integer or None.")
    strategy = ('exhaustive' if max_orders is None else 'hybrid') if strategy == 'auto' else strategy
    if strategy == 'random' and max_orders is None:
        raise ValueError("Random search requires a finite max_orders draw budget.")
    X, Y = tuple(X), tuple(Y)
    automatic = type(max_orders) is str and max_orders == "auto"
    if not automatic and max_orders is not None and (type(max_orders) is not int or max_orders < 0):
        raise ValueError("max_orders must be 'auto', a nonnegative integer, or None.")
    if type(max_seconds) is str and max_seconds == "auto":
        max_seconds = None if max_orders is None else (3.0 if strategy == "hybrid" else 1.0)
    if max_seconds is not None and (type(max_seconds) not in (int, float)
            or not isfinite(max_seconds) or max_seconds < 0):
        raise ValueError("max_seconds must be 'auto', a finite nonnegative number, or None.")
    started = perf_counter() if strategy == "hybrid" or max_seconds is not None else None
    deadline = None if max_seconds is None else started + max_seconds
    if len(set(X)) != len(X) or len(set(Y)) != len(Y):
        raise ValueError("Query nodes must be unique.")
    H, retained, outcomes = preprocess(G, X, Y)
    original = H.graph["query"]["original_actions"]
    observed = H.subgraph(observed_nodes(H))
    if automatic:
        max_orders = min(256, len(observed) ** 2)
    fixed = None
    if fixed_order is not None:
        fixed_order = tuple(fixed_order)
        if len(set(fixed_order)) != len(fixed_order) or set(fixed_order) != set(X):
            raise ValueError("fixed_order must contain exactly the query treatments.")
        fixed = tuple(v for v in fixed_order if v in retained)
    searched = 0
    try:
        _check_deadline(deadline)
        if not retained:
            order = tuple(nx.topological_sort(observed))
            witness = _certificate(H, retained, outcomes, order, original, deadline=deadline)
            return Result("ACCEPT", witness)
    except _TimeBudgetExpired:
        return Result("UNKNOWN")
    phases = ("random", "exhaustive") if strategy == "hybrid" else (strategy,)
    for phase in phases:
        phase_deadline = deadline
        if strategy == "hybrid":
            phase_end = started + 1.0 if phase == "random" else perf_counter() + 2.0
            phase_deadline = phase_end if deadline is None else min(deadline, phase_end)
        seen, phase_count = set(), 0
        try:
            orders = iter(nx.all_topological_sorts(observed) if phase == "exhaustive" else
                          _sample_orders(observed, max_orders, seed, phase_deadline))
            while True:
                _check_deadline(phase_deadline)
                try:
                    order = tuple(next(orders))
                except StopIteration:
                    _check_deadline(phase_deadline)
                    break
                _check_deadline(phase_deadline)
                if strategy == "exhaustive" and max_orders is not None and phase_count >= max_orders:
                    return Result("UNKNOWN", searched=searched)
                if phase == "random":
                    if order in seen:
                        continue
                    seen.add(order)
                searched += 1
                phase_count += 1
                if fixed is not None and tuple(v for v in order if v in retained) != fixed:
                    continue
                witness = _certificate(H, retained, outcomes, order, original, deadline=phase_deadline)
                _check_deadline(phase_deadline)
                if witness is not None:
                    return Result("ACCEPT", witness, searched)
        except _TimeBudgetExpired:
            if strategy != "hybrid":
                return Result("UNKNOWN", searched=searched)
    return Result("NO_SBD" if strategy == "exhaustive" else "UNKNOWN", searched=searched)


def verify_witness(G, X, Y, witness):
    """Recheck this exact full order, partition and separator witness."""
    H, retained, outcomes = preprocess(G, X, Y)
    order = witness.order
    if len(order) != len(set(order)) or set(order) != observed_nodes(H):
        return False
    positions = {v: i for i, v in enumerate(order)}
    if any(positions[a] >= positions[b] for a, b in H.edges
           if a in positions and b in positions):
        return False
    return witness == _certificate(H, retained, outcomes, order, H.graph["query"]["original_actions"])


def require_witness(result):
    if result.status == "UNKNOWN":
        raise SearchLimitExceeded("SBD search budget exhausted; use find_sbd with larger max_orders/max_seconds or disable limits with None.")
    if result.status != "ACCEPT":
        raise ValueError("No canonical SBD witness exists for this query.")
    return result.witness


def criterion(G, X, Y, **options):
    result = find_sbd(G, X, Y, **options)
    if result.status == "UNKNOWN":
        require_witness(result)
    return result.status == "ACCEPT"


def estimand(G, X, Y, latex=False):
    return require_witness(find_sbd(G, X, Y)).expression(latex)


def adjustment_sets(G, X, Y, *, fixed_order=None):
    """Return canonical stage sets; optionally fix the treatment order."""
    return require_witness(find_sbd(G, X, Y, fixed_order=fixed_order)).dictionaries()[1]


def check_fixed_order(G, X, Y, Z):
    """Sufficient supplied sequential back-door witness check, not a completeness criterion."""
    H, actions, _ = preprocess(G, X, Y)
    if set(actions) != set(X):
        raise ValueError("Use an A1-reduced query for a supplied sequential witness.")
    G = H
    X, Y = tuple(X), set(Y)
    if any(x in nx.descendants(G, later) for i, x in enumerate(X) for later in X[i+1:]):
        return False
    blocks = tuple(map(set, partition_outcomes(G, X, Y).values()))
    history, used = set(), set()
    for i, x in enumerate(X):
        z = set(Z.get(f"Z{i+1}", ()))
        if (not z <= observed_nodes(G) or z & (set(X) | Y | used)
                or any(z & nx.descendants(G, action) for action in X[i:])):
            return False
        stage = G.copy()
        stage.remove_nodes_from(X[i+1:])
        stage.remove_edges_from(list(stage.out_edges(x)))
        history.update(blocks[i])
        if not graph.is_d_separated(stage, [x], set().union(*blocks[i+1:]), history | z):
            return False
        history.update(z | {x})
        used.update(z)
    return True
