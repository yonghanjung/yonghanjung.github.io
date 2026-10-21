"""Tian identification with actual Q[A] indices and a finite-payoff KPP compiler.

Graphs use CausalPy's explicit latent-root convention: names beginning with U
are hidden roots. No data, clipboard, plotting, or estimator modules are imported.
The SCA verifier implements the full-interval certificate in the UCA manuscript's
Algorithm 1, not the legacy minSCA checker. Every Tian intermediate, including
ancestral topological prefixes, retains its derivation and is checked for SCA.

NONRATIO certifies one constructed expression. A surviving ratio or an exhausted
SCA search budget means UNKNOWN, not an irreducibility certificate. The explicit
complete_mc option additionally searches disjoint unions of induced components.
It retains this alternative separately from the literal Tian trace. KPP compilation
uses fixed finite alphabets. The expanded fixed_payoff_expectation compiler and
the nonexpanded fitted-cell formula-trace evaluator are distinct interfaces.
Neither claims an original-outcome-marginal compiler or a fitted DML estimator.
"""

from dataclasses import dataclass, field
from fractions import Fraction
from itertools import combinations, count, product
import hashlib
import math
from time import perf_counter

import networkx as nx
import graph


@dataclass(frozen=True)
class Slot:
    variable: str
    scope: str = "free"


@dataclass(frozen=True)
class Value:
    value: object


@dataclass(frozen=True)
class Scalar:
    value: object = 1


@dataclass(frozen=True)
class ObsKernel:
    outcomes: tuple
    given: tuple = ()
    source: str = "P"

    def __post_init__(self):
        out, given = dict(self.outcomes), dict(self.given)
        if len(out) != len(self.outcomes) or len(given) != len(self.given):
            raise ValueError("Kernel coordinates must be unique")
        if out.keys() & given.keys():
            raise ValueError("Kernel outcomes and conditioning coordinates overlap")


@dataclass(frozen=True)
class QRef:
    index: int
    arguments: tuple
    _provenance: object = field(default=None, repr=False)


@dataclass(frozen=True)
class Sum:
    slots: tuple
    body: object

    def __post_init__(self):
        if any(not isinstance(s, Slot) for s in self.slots):
            raise ValueError("Sum binders must be lexical Slots")
        if len(set(self.slots)) != len(self.slots):
            raise ValueError("Sum binders must be distinct lexical Slots")


@dataclass(frozen=True)
class Product:
    factors: tuple


@dataclass(frozen=True)
class Add:
    left: object
    right: object


@dataclass(frozen=True)
class Ratio:
    numerator: object
    denominator: object


_serial = count()


def _bindings(variables):
    return tuple((v, Slot(v)) for v in sorted(variables))


def _slots(expr):
    if isinstance(expr, (ObsKernel, QRef)):
        pairs = expr.outcomes + expr.given if isinstance(expr, ObsKernel) else expr.arguments
        return {a for _, a in pairs if isinstance(a, Slot)}
    if isinstance(expr, Sum):
        return _slots(expr.body) - set(expr.slots)
    if isinstance(expr, Product):
        return set().union(*(_slots(f) for f in expr.factors))
    if isinstance(expr, Add):
        return _slots(expr.left) | _slots(expr.right)
    if isinstance(expr, Ratio):
        return _slots(expr.numerator) | _slots(expr.denominator)
    return set()


def _fresh(variable, forbidden=()):
    while True:
        slot = Slot(variable, "bound:" + str(next(_serial)))
        if slot not in forbidden:
            return slot


def substitute(expr, mapping):
    """Capture-avoiding substitution of argument slots; never replace binders."""
    def pairs(items):
        return tuple((v, mapping.get(a, a)) for v, a in items)
    if isinstance(expr, ObsKernel):
        return ObsKernel(pairs(expr.outcomes), pairs(expr.given), expr.source)
    if isinstance(expr, QRef):
        return QRef(expr.index, pairs(expr.arguments), expr._provenance)
    if isinstance(expr, Product):
        return Product(tuple(substitute(f, mapping) for f in expr.factors))
    if isinstance(expr, Add):
        return Add(substitute(expr.left, mapping), substitute(expr.right, mapping))
    if isinstance(expr, Ratio):
        return Ratio(substitute(expr.numerator, mapping), substitute(expr.denominator, mapping))
    if isinstance(expr, Sum):
        masked = {k: v for k, v in mapping.items() if k not in expr.slots}
        captured = set(expr.slots) & {v for v in masked.values() if isinstance(v, Slot)}
        body, slots = expr.body, expr.slots
        if captured:
            forbidden = _slots(body) | set(slots) | set(masked) | set(masked.values())
            rename = {s: _fresh(s.variable, forbidden) for s in captured}
            body = substitute(body, rename)
            slots = tuple(rename.get(s, s) for s in slots)
        return Sum(slots, substitute(body, masked))
    return expr


def _key(expr, bound=None, registry=None, domains=None):
    """Structural identity including contexts, source, and alpha-equivalent sums."""
    bound = {} if bound is None else bound
    def arg(a):
        if isinstance(a, Slot):
            return ("bound", bound[a]) if a in bound else ("free", a.variable, a.scope)
        return ("value", type(a.value).__name__, repr(a.value))
    def pairs(items):
        return tuple(sorted((v, arg(a)) for v, a in items))
    if isinstance(expr, Scalar):
        return ("scalar", expr.value)
    if isinstance(expr, ObsKernel):
        return ("P", expr.source, pairs(expr.outcomes), pairs(expr.given))
    if isinstance(expr, QRef):
        if registry is not None:
            return registry._semantic_key(expr, bound, domains)
        return ("Q", expr._provenance, expr.index, pairs(expr.arguments))
    if isinstance(expr, Sum):
        extended = dict(bound)
        ordinal = max(extended.values(), default=-1) + 1
        for s in expr.slots:
            extended[s] = ordinal
            ordinal += 1
        return ("sum", tuple(s.variable for s in expr.slots), _key(expr.body, extended, registry, domains))
    if isinstance(expr, Product):
        return ("product", tuple(sorted((_key(f, bound, registry, domains) for f in expr.factors), key=repr)))
    if isinstance(expr, Add):
        return ("add", tuple(sorted((_key(expr.left, bound, registry, domains), _key(expr.right, bound, registry, domains)), key=repr)))
    if isinstance(expr, Ratio):
        return ("ratio", _key(expr.numerator, bound, registry, domains), _key(expr.denominator, bound, registry, domains))
    raise TypeError("Unknown expression node")


def _d_separated(G, X, Y, Z):
    if not X or not Y:
        return True
    checker = getattr(nx, "is_d_separator", None) or getattr(nx, "d_separated")
    return checker(G, set(X), set(Y), set(Z))


def _validate_graph(G):
    if not nx.is_directed_acyclic_graph(G):
        raise ValueError("Expected a directed acyclic latent-root graph")
    if any(not isinstance(v, str) for v in G):
        raise ValueError("CausalPy variable names must be strings")
    observed = _observed(G)
    for u in set(G) - observed:
        if G.in_degree(u) or any(v not in observed for v in G.successors(u)):
            raise ValueError("Hidden U vertices must be root parents of observed vertices")
        if G.out_degree(u) > 2:
            raise ValueError("Hidden U vertices must have at most two observed children (private/pair-root scope)")


def _observed(G):
    return graph.observed_nodes(G)


def _induced(G, observed):
    observed = set(observed)
    all_observed = _observed(G)
    roots = {u for v in observed for u in G.predecessors(v) if u not in all_observed}
    return G.subgraph(observed | roots).copy()


def _ancestors(G, targets):
    return (set(targets) | set().union(*(nx.ancestors(G, v) for v in targets))) & _observed(G)


def _parents(G, A):
    observed = _observed(G)
    return {p for v in A for p in G.predecessors(v) if p in observed} - set(A)


def _components(G):
    observed = _observed(G)
    undirected = nx.Graph()
    undirected.add_nodes_from(sorted(observed))
    for u in set(G) - observed:
        children = list(G.successors(u))
        for a, b in product(children, repeat=2):
            if a != b:
                undirected.add_edge(a, b)
    return tuple(sorted((frozenset(c) for c in nx.connected_components(undirected)), key=lambda c: tuple(sorted(c))))


def _signature(G):
    observed = _observed(G)
    data = (tuple(sorted((v, v in observed) for v in G)), tuple(sorted(G.edges())))
    return hashlib.sha256(repr(data).encode()).hexdigest()


def preprocess(G, X, Y):
    """Assumption 1: outcome-ancestral graph, then remove irrelevant actions."""
    _validate_graph(G)
    X, Y = set(X), set(Y)
    if not Y or X & Y or not (X | Y) <= _observed(G):
        raise ValueError("Disjoint observed actions and nonempty outcomes are required")
    H = _induced(G, _ancestors(G, Y))
    X &= _observed(H)
    cut = H.copy()
    cut.remove_edges_from([(p, x) for x in X for p in list(cut.predecessors(x))])
    return H, frozenset(X & _ancestors(cut, Y)), frozenset(Y)


@dataclass(frozen=True)
class SCAWitness:
    original_graph: str
    reduced_graph: str
    actions: tuple
    outcomes: tuple
    order: tuple
    outcome_blocks: tuple
    auxiliary_blocks: tuple


def _outcome_blocks(H, actions, Y):
    blocks = [set() for _ in range(len(actions) + 1)]
    for y in Y:
        ancestors = _ancestors(H, [y])
        latest = max((i + 1 for i, x in enumerate(actions) if x in ancestors), default=0)
        blocks[latest].add(y)
    return tuple(tuple(sorted(b)) for b in blocks)


def verify_sca_witness(G, X, Y, witness):
    """Verify the supplied full order and its exact full-interval certificate."""
    H, X, Y = preprocess(G, X, Y)
    tau = witness.order
    if witness.original_graph != _signature(G) or witness.reduced_graph != _signature(H):
        return False
    if len(tau) != len(set(tau)) or set(tau) != _observed(H):
        return False
    position = {v: i for i, v in enumerate(tau)}
    if any(position[a] >= position[b] for a, b in H.edges() if a in position and b in position):
        return False
    actions = tuple(v for v in tau if v in X)
    blocks = _outcome_blocks(H, actions, Y)
    if witness.actions != actions or witness.outcomes != tuple(sorted(Y)) or witness.outcome_blocks != blocks:
        return False
    if not actions:
        return witness.auxiliary_blocks == ()
    cuts = [-1] + [position[x] for x in actions] + [len(tau)]
    for i, block in enumerate(blocks):
        if any(not cuts[i] < position[y] < cuts[i + 1] for y in block):
            return False
    auxiliary = tuple(tuple(v for v in tau[cuts[i] + 1:cuts[i + 1]] if v not in Y) for i in range(len(actions)))
    if witness.auxiliary_blocks != auxiliary:
        return False
    for i, x in enumerate(actions):
        # Future fixed vertices and all their incident edges are omitted, never projected.
        stage = H.copy()
        stage.remove_nodes_from(actions[i + 1:])
        stage.remove_edges_from(list(stage.out_edges(x)))
        future = set().union(*(set(b) for b in blocks[i + 1:]))
        history = set(tau[:position[x]])  # Includes Y_0 and all carried auxiliaries.
        if not _d_separated(stage, [x], future, history):
            return False
    return True


def find_sca_witness(G, X, Y, max_orders=10000, *, deadline=None):
    """Return (ACCEPT/NO_SCA/UNKNOWN, witness); NO_SCA is local to canonical SCA."""
    H, X, Y = preprocess(G, X, Y)
    if deadline is not None and perf_counter() >= deadline:
        return "UNKNOWN", None
    if not X:
        tau = tuple(nx.topological_sort(H.subgraph(_observed(H))))
        return "ACCEPT", SCAWitness(_signature(G), _signature(H), (), tuple(sorted(Y)), tau, (tuple(sorted(Y)),), ())
    for number, tau in enumerate(nx.all_topological_sorts(H.subgraph(_observed(H)))):
        if deadline is not None and perf_counter() >= deadline:
            return "UNKNOWN", None
        if max_orders is not None and number >= max_orders:
            return "UNKNOWN", None
        tau = tuple(tau)
        actions = tuple(v for v in tau if v in X)
        positions = [-1] + [tau.index(x) for x in actions]
        auxiliary = tuple(tuple(v for v in tau[positions[i] + 1:positions[i + 1]] if v not in Y) for i in range(len(actions)))
        w = SCAWitness(_signature(G), _signature(H), actions, tuple(sorted(Y)), tau, _outcome_blocks(H, actions, Y), auxiliary)
        if verify_sca_witness(G, X, Y, w):
            return "ACCEPT", w
    return "NO_SCA", None


def sca_expression(witness):
    if not witness.actions:
        return ObsKernel(_bindings(witness.outcomes))
    blocks, auxiliaries = witness.outcome_blocks, witness.auxiliary_blocks
    factors = [ObsKernel(_bindings(set(blocks[0]) | set(auxiliaries[0])))]
    history = set(blocks[0]) | set(auxiliaries[0])
    for i, x in enumerate(witness.actions):
        history.add(x)
        next_aux = set(auxiliaries[i + 1]) if i + 1 < len(auxiliaries) else set()
        out = set(blocks[i + 1]) | next_aux
        if out:
            factors.append(ObsKernel(_bindings(out), _bindings(history)))
        history |= out
    expr = Product(tuple(f for f in factors if f.outcomes))
    Z = set().union(*(set(z) for z in auxiliaries))
    slots = tuple(_fresh(z) for z in sorted(Z))
    return Sum(slots, substitute(expr, {Slot(s.variable): s for s in slots})) if slots else expr


def _conditional_quotient(num, den):
    if not isinstance(num, ObsKernel) or not isinstance(den, ObsKernel):
        return None
    n, d = dict(num.outcomes), dict(den.outcomes)
    if num.source != den.source or _key(ObsKernel((), num.given, num.source)) != _key(ObsKernel((), den.given, den.source)):
        return None
    if not d or not d.keys() <= n.keys() or any(n[v] != a for v, a in d.items()):
        return None
    return ObsKernel(tuple((v, a) for v, a in num.outcomes if v not in d), tuple(sorted(num.given + den.outcomes)), num.source)


def reduce_expression(expr, G=None, domains=None, registry=None):
    """Only justified raw CI, normalization, chain rule, and same-factor cancellation."""
    if isinstance(expr, QRef) and registry is not None:
        registry._semantic_key(expr, {}, domains)  # Validate provenance/support first.
        return expr
    if isinstance(expr, (Scalar, QRef)):
        return expr
    if isinstance(expr, ObsKernel):
        if not expr.outcomes:
            return Scalar(1)
        given = list(expr.given)
        if G is not None and expr.source == "P":
            for item in list(given):
                rest = [v for v, _ in given if v != item[0]]
                if _d_separated(G, [v for v, _ in expr.outcomes], [item[0]], rest):
                    given.remove(item)
        return ObsKernel(tuple(sorted(expr.outcomes)), tuple(sorted(given)), expr.source)
    if isinstance(expr, Sum):
        body = reduce_expression(expr.body, G, domains, registry)
        if not expr.slots:
            return body
        if isinstance(body, ObsKernel):
            outputs = dict(body.outcomes)
            # Normalization holds at a fixed context and with independent head
            # coordinates. A diagonal such as P(A=a | B=a) or P(A=a,B=a)
            # does not sum over the kernel's whole head alphabet.
            if all(outputs.get(s.variable) == s
                   and sum(a == s for _, a in body.outcomes) == 1
                   and all(a != s for _, a in body.given) for s in expr.slots):
                remaining = tuple((v, a) for v, a in body.outcomes if a not in expr.slots)
                return reduce_expression(ObsKernel(remaining, body.given, body.source), G, domains, registry)
        return Sum(expr.slots, body)
    if isinstance(expr, Ratio):
        num = reduce_expression(expr.numerator, G, domains, registry)
        den = reduce_expression(expr.denominator, G, domains, registry)
        if isinstance(den, Scalar) and den.value == 0:
            raise ZeroDivisionError("Zero denominator in identification expression")
        if _key(num, registry=registry, domains=domains) == _key(den, registry=registry, domains=domains):
            return Scalar(1)
        quotient = _conditional_quotient(num, den)
        if quotient is not None:
            return reduce_expression(quotient, G, domains, registry)
        return _reduce_product((Ratio(num, den),), G, domains, registry)
    if isinstance(expr, Product):
        return _reduce_product(tuple(reduce_expression(f, G, domains, registry) for f in expr.factors), G, domains, registry)
    if isinstance(expr, Add):
        left, right = (reduce_expression(e, G, domains, registry) for e in (expr.left, expr.right))
        if isinstance(left, Scalar) and isinstance(right, Scalar):
            return Scalar(left.value + right.value)
        if isinstance(left, Scalar) and left.value == 0:
            return right
        if isinstance(right, Scalar) and right.value == 0:
            return left
        return Add(left, right)
    raise TypeError("Unknown expression node")


def _reduce_product(factors, G, domains, registry=None):
    numerator, denominator = [], []
    coefficient = 1
    def collect(f, invert=False):
        nonlocal coefficient
        if isinstance(f, Product):
            for child in f.factors:
                collect(child, invert)
        elif isinstance(f, Ratio):
            collect(f.numerator, invert)
            collect(f.denominator, not invert)
        elif isinstance(f, Scalar):
            if invert:
                if f.value == 0:
                    raise ZeroDivisionError("Zero denominator")
                coefficient *= Fraction(1, 1) / f.value
            else:
                coefficient *= f.value
        else:
            (denominator if invert else numerator).append(f)
    for f in factors:
        collect(f)
    if coefficient == 0:
        return Scalar(0)
    for d in list(denominator):
        found = next((i for i, n in enumerate(numerator)
                      if _key(n, registry=registry, domains=domains) == _key(d, registry=registry, domains=domains)), None)
        if found is not None:
            numerator.pop(found)
            denominator.remove(d)
    if coefficient != 1:
        numerator.insert(0, Scalar(coefficient))
    def combine(items):
        return Scalar(1) if not items else items[0] if len(items) == 1 else Product(tuple(items))
    n, d = combine(numerator), combine(denominator)
    quotient = _conditional_quotient(n, d)
    if quotient is not None:
        return reduce_expression(quotient, G, domains, registry)
    return n if not denominator else Ratio(n, d)


@dataclass
class QRecord:
    index: int
    nodes: tuple
    parents: tuple
    graph_signature: str
    source: str
    expression: object
    derivations: list = field(default_factory=list)
    sca_status: str = "UNKNOWN"
    witness: object = None
    sca_definition: object = None
    symbol: object = None
    evaluation_variables: tuple = ()


class QRegistry:
    """Indices refer to actual original-model Q[A], never arbitrary sums."""
    def __init__(self, G, source="P", max_orders=10000, *, deadline=None, max_expression_occurrences=None):
        self.G, self.source, self.max_orders = G, source, max_orders
        self.deadline, self._remaining = deadline, max_expression_occurrences
        self.graph_signature = _signature(G)
        self.records, self._by_nodes = [], {}
        self._provenance = object()

    def _intern(self, A, expr, operation, certificate=None):
        A = tuple(sorted(A))
        parents = tuple(sorted(_parents(self.G, A)))
        if certificate is not None and not verify_sca_witness(self.G, parents, A, certificate):
            raise ValueError("Invalid original-query SCA certificate")
        if A in self._by_nodes:
            r = self.records[self._by_nodes[A]]
            r.derivations.append((operation, expr))
            if certificate is not None and r.witness is None:
                r.sca_status, r.witness = "ACCEPT", certificate
        else:
            status, witness = ("ACCEPT", certificate) if certificate is not None else find_sca_witness(self.G, parents, A, self.max_orders, deadline=self.deadline)
            r = QRecord(len(self.records), A, parents, self.graph_signature, self.source, expr, [(operation, expr)], status, witness)
            self._by_nodes[A] = r.index
            self.records.append(r)
        if r.witness is not None and r.symbol is None:
            r.sca_definition = _with_source(sca_expression(r.witness), self.source)
            r.symbol = "f_" + str(1 + sum(record.symbol is not None for record in self.records))
        # True external parents remain r.parents. A Tian representation may also
        # contain redundant evaluation contexts (e.g. R in Q[Y]=Q[M,Y]/Q[M]).
        # Carry the original assignment through every ref so outer binders reach
        # those contexts consistently. These coordinates do not redefine Q[A].
        r.evaluation_variables = tuple(sorted(_observed(self.G)))
        return QRef(r.index, _bindings(r.evaluation_variables), self._provenance)

    def reference(self, A):
        """Return an issued reference to an already registered original-model Q[A]."""
        index = self._by_nodes[tuple(sorted(A))]
        record = self.records[index]
        return QRef(index, _bindings(record.evaluation_variables), self._provenance)

    def _semantic_key(self, ref, bound, domains):
        if ref._provenance is not self._provenance or not isinstance(ref.index, int) or not 0 <= ref.index < len(self.records):
            raise ValueError("Q locality requires a genuine reference issued by this registry")
        record = self.records[ref.index]
        args = dict(ref.arguments)
        if len(args) != len(ref.arguments) or set(args) != set(record.evaluation_variables):
            raise ValueError("A registered Q reference must retain its full argument map")
        for v, a in args.items():
            if not isinstance(a, (Slot, Value)):
                raise ValueError("Registered Q arguments must be Slots or Values")
            if domains is not None:
                alphabet = domains.get(v)
                if not isinstance(alphabet, (tuple, list)) or not alphabet or len(set(alphabet)) != len(alphabet):
                    raise ValueError("Q locality needs supported finite arguments")
                states = (a.value,) if isinstance(a, Value) else domains.get(a.variable)
                if not isinstance(states, (tuple, list)) or not states or len(set(states)) != len(states) or any(value not in alphabet for value in states):
                    raise ValueError("Q locality needs supported finite arguments")
            elif isinstance(a, Value) or a.variable != v:
                raise ValueError("Fixed or aliased Q arguments need finite alphabets for locality")
        retained = tuple((v, args[v]) for v in sorted(set(record.nodes) | set(record.parents)))
        # Parent locality changes equality only, never the raw expansion's inputs.
        return ("original Q", record.graph_signature, record.source, record.nodes,
                record.parents, _key(QRef(ref.index, retained, self._provenance), bound))

    def expand(self, expr, prefer_sca=True, keep_sca=False, _stack=()):
        if self._remaining is not None:
            if self._remaining <= 0:
                raise ExpressionLimit("Indexed expression occurrence budget exhausted")
            self._remaining -= 1
        if isinstance(expr, QRef):
            r = self.records[expr.index]
            if keep_sca and r.sca_definition is not None:
                return expr
            if r.index in _stack:
                raise ValueError("Cyclic Q derivation")
            definition = r.sca_definition if prefer_sca and r.sca_definition is not None else r.expression
            mapping = {Slot(v): a for v, a in expr.arguments}
            expanded = substitute(definition, mapping)
            return self.expand(expanded, prefer_sca, keep_sca, _stack + (r.index,))
        if isinstance(expr, Product):
            return Product(tuple(self.expand(f, prefer_sca, keep_sca, _stack) for f in expr.factors))
        if isinstance(expr, Add):
            return Add(self.expand(expr.left, prefer_sca, keep_sca, _stack), self.expand(expr.right, prefer_sca, keep_sca, _stack))
        if isinstance(expr, Ratio):
            return Ratio(self.expand(expr.numerator, prefer_sca, keep_sca, _stack), self.expand(expr.denominator, prefer_sca, keep_sca, _stack))
        if isinstance(expr, Sum):
            return Sum(expr.slots, self.expand(expr.body, prefer_sca, keep_sca, _stack))
        return expr


def _with_source(expr, source):
    if isinstance(expr, ObsKernel):
        return ObsKernel(expr.outcomes, expr.given, source)
    if isinstance(expr, Product):
        return Product(tuple(_with_source(f, source) for f in expr.factors))
    if isinstance(expr, Add):
        return Add(_with_source(expr.left, source), _with_source(expr.right, source))
    if isinstance(expr, Sum):
        return Sum(expr.slots, _with_source(expr.body, source))
    return expr


def _marginal(expr, removed):
    slots = tuple(_fresh(v) for v in sorted(removed))
    return Sum(slots, substitute(expr, {Slot(s.variable): s for s in slots})) if slots else expr


def _tian_paths(G, X, Y):
    """The same pure traversal as identify.ID_return_Ctree, without UI imports."""
    D = _ancestors(_induced(G, _observed(G) - set(X)), Y)
    original = _components(G)
    paths, operations = {}, {}
    for i, Di in enumerate(_components(_induced(G, D))):
        W = next(S for S in original if Di <= S)
        path, ops = [W], ["δ"]
        while True:
            A = frozenset(_ancestors(_induced(G, W), Di))
            if A == Di:
                if A != W:
                    path.append(A)
                    ops.append("Σ")
                break
            if A == W:
                return 0, Di, A
            path.append(A)
            ops.append("Σ")
            S = next(S for S in _components(_induced(G, A)) if Di <= S)
            if S != A:
                path.append(S)
                ops.append("δ")
            W = S
        paths[i], operations[i] = path, ops
    return 1, paths, operations


def _is_nonratio(expr):
    if isinstance(expr, Scalar):
        if isinstance(expr.value, (int, Fraction)):
            return expr.value >= 0
        try:
            return math.isfinite(expr.value) and expr.value >= 0
        except (TypeError, ValueError, OverflowError):
            return False
    if isinstance(expr, ObsKernel):
        return True
    if isinstance(expr, Sum):
        return _is_nonratio(expr.body)
    if isinstance(expr, Product):
        return all(_is_nonratio(f) for f in expr.factors)
    if isinstance(expr, Add):
        return _is_nonratio(expr.left) and _is_nonratio(expr.right)
    return False


@dataclass
class IdentificationResult:
    status: str
    expression: object
    indexed_expression: object
    component_expressions: dict
    registry: QRegistry
    reduced_graph: object
    actions: tuple
    outcomes: tuple
    trace: object
    literal_expression: object = None
    literal_indexed_expression: object = None
    mc_expression: object = None
    mc_indexed_expression: object = None
    mc_partition: tuple = ()
    mc_certificates: tuple = ()
    mc_search_status: str = "NOT_REQUESTED"
    selected_derivation: str = "literal"
    formula_status: str = "COMPLETE"

    @property
    def indexing_status(self):
        """COMPLETE means all literal raw c-factor seeds have SCA definitions."""
        seeds = [r for r in self.registry.records if any(why == "original c-component factor" for why, _ in r.derivations)]
        return "COMPLETE" if all(r.sca_definition is not None for r in seeds) else "UNKNOWN"

    def compile_kpp(self, domains, values, max_terms=100000):
        if self.status != "NONRATIO":
            raise ValueError("No certified non-ratio expression; status=" + self.status)
        return compile_kpp(self.expression, domains, values, max_terms)


def _raw_component(order, component, source):
    return Product(tuple(ObsKernel(_bindings([v]), _bindings(order[:i]), source)
                         for i, v in enumerate(order) if v in component))


def _find_disjoint_partition(accepted_masks, full_mask):
    """Find a disjoint accepted cover; no two-block or minimum-size restriction."""
    masks = tuple(sorted(set(accepted_masks)))
    if any(mask <= 0 or mask & ~full_mask for mask in masks):
        raise ValueError("Partition masks must be nonempty subsets of the target")
    failed = set()
    def visit(remaining):
        if not remaining:
            return ()
        if remaining in failed:
            return None
        first = remaining & -remaining
        for mask in masks:
            if mask & first and mask & remaining == mask:
                suffix = visit(remaining ^ mask)
                if suffix is not None:
                    return (mask,) + suffix
        failed.add(remaining)
        return None
    return visit(full_mask)


def _mc_alternative(H, X, Y, D, order, registry, max_mc_unions):
    """Reviewer-approved MC construction; each block has an original-Q certificate."""
    original = _components(H)
    SX = frozenset().union(*(S for S in original if S & X))
    DX = frozenset(D & SX)
    atoms = _components(_induced(H, DX))
    accepted, exhausted = {}, False
    full_mask = (1 << len(atoms)) - 1
    partition = () if not DX else None
    # Small unions first. Once a cover is certified, unused unions cannot affect
    # its soundness; worst-case exhaustive search still takes exponentially many.
    masks = (sum(1 << i for i in chosen) for size in range(1, len(atoms) + 1)
             for chosen in combinations(range(len(atoms)), size))
    for number, mask in enumerate(masks):
        if registry.deadline is not None and perf_counter() >= registry.deadline:
            exhausted = True
            break
        if max_mc_unions is not None and number >= max_mc_unions:
            exhausted = True
            break
        B = frozenset().union(*(A for i, A in enumerate(atoms) if mask & (1 << i)))
        record_index = registry._by_nodes.get(tuple(sorted(B)))
        if record_index is None:
            parents = _parents(registry.G, B)
            status, certificate = find_sca_witness(registry.G, parents, B, registry.max_orders, deadline=registry.deadline)
        else:
            record = registry.records[record_index]
            status, certificate = record.sca_status, record.witness
        if status == "UNKNOWN":
            exhausted = True
        if status == "ACCEPT":
            definition = _with_source(sca_expression(certificate), registry.source)
            accepted[mask] = registry._intern(B, definition, "MC joint block", certificate)
            partition = _find_disjoint_partition(accepted, full_mask)
            if partition is not None:
                break
    if partition is None:
        return None, (), (), "UNKNOWN" if exhausted else "NO_MC"
    factors = [accepted[mask] for mask in partition]
    blocks = tuple(tuple(registry.records[ref.index].nodes) for ref in factors)
    certificates = tuple(registry.records[ref.index].witness for ref in factors)
    for S in original:
        if S & X:
            continue
        A = frozenset(D & S)
        if not A:
            continue
        # D is ancestral after actions are deleted; S contains no action. This
        # is an ancestral marginal, not an arbitrary sum assigned Q semantics.
        if _ancestors(_induced(H, S), A) != set(A):
            raise ValueError("MC outside component marginal is not ancestral")
        seed = registry._intern(S, _raw_component(order, S, registry.source), "original c-component factor")
        factors.append(registry._intern(A, _marginal(seed, S - A), "MC outside ancestral marginalization"))
    return _marginal(Product(tuple(factors)), D - Y), blocks, certificates, "ACCEPT"


class ExpressionLimit(RuntimeError):
    """A raw formula expansion is unfinished; graph certificates stay valid."""


def _reduce_registered(expr, registry, H):
    try:
        indexed = reduce_expression(registry.expand(expr, keep_sca=True), H, registry=registry)
        first = None
        for prefer in (True, False):
            candidate = reduce_expression(registry.expand(indexed, prefer_sca=prefer), H)
            if _is_nonratio(candidate):
                return candidate, indexed
            if first is None:
                first = candidate
        return first, indexed
    except ExpressionLimit:
        return None, expr


def identify_indexed(G, X, Y, source="P", max_orders=10000, ctree=None,
                     complete_mc=False, max_mc_unions=10000, *, max_seconds=None,
                     max_expression_occurrences=None):
    """Construct and reduce a Tian estimand; optional ctree is ID_return_Ctree's output.

    Every registered Q[A] is checked on its own original-graph external-parent
    query after preprocessing. Original raw derivations are kept alongside f_i.
    A supplied ctree's successful operations are independently checked; a failure
    is recomputed locally. complete_mc additionally searches all finite disjoint
    unions needed for an MC partition, with UNKNOWN on budget exhaustion. It does
    not establish completeness for all non-ratio estimands.
    """
    if max_seconds is not None and (type(max_seconds) not in (int, float) or not math.isfinite(max_seconds) or max_seconds < 0):
        raise ValueError("max_seconds must be None or a finite nonnegative number")
    if max_expression_occurrences is not None and (type(max_expression_occurrences) is not int or max_expression_occurrences < 0):
        raise ValueError("max_expression_occurrences must be None or a nonnegative integer")
    deadline = None if max_seconds is None else perf_counter() + max_seconds
    H, X, Y = preprocess(G, X, Y)
    registry = QRegistry(G, source, max_orders, deadline=deadline, max_expression_occurrences=max_expression_occurrences)
    order = tuple(nx.topological_sort(H.subgraph(_observed(H))))
    if not X:
        expr = ObsKernel(_bindings(Y), source=source)
        result = IdentificationResult("NONRATIO", expr, expr, {}, registry, H, (), tuple(sorted(Y)), None,
                                      literal_expression=expr, literal_indexed_expression=expr)
        if complete_mc:
            result.mc_expression, result.mc_indexed_expression, result.mc_search_status = expr, expr, "ACCEPT"
        return result
    trace = _tian_paths(H, X, Y) if ctree is None else ctree
    if trace[0] != 1:
        actual = _tian_paths(H, X, Y)
        if trace[0] != 0 or actual[0] != 0:
            raise ValueError("Supplied C-tree failure is not a valid failure of this reduced query")
        trace = actual
        return IdentificationResult("NOT_IDENTIFIABLE", None, None, {}, registry, H, tuple(sorted(X)), tuple(sorted(Y)), trace)
    paths, ops = trace[1:]
    outputs = {}
    original = _components(H)
    for key, path in paths.items():
        W = frozenset(path[0])
        if W not in original or len(ops[key]) != len(path) or ops[key][0] != "δ":
            raise ValueError("Invalid initial C-tree component or operation sequence")
        current = registry._intern(W, _raw_component(order, W, source), "original c-component factor")
        for A, operation in zip(path[1:], ops[key][1:]):
            A = frozenset(A)
            if not A or not A < W:
                raise ValueError("Tian steps must strictly shrink a nonempty set")
            if operation == "Σ":
                if _ancestors(_induced(H, W), A) != set(A):
                    raise ValueError("A marginal is not ancestral in its source kernel")
                current = registry._intern(A, _marginal(current, W - A), "ancestral marginalization")
            elif operation == "δ":
                components = _components(_induced(H, W))
                if not A <= W or any(c & A and not c <= A for c in components):
                    raise ValueError("Extraction set is not a c-component union")
                local_order = [v for v in order if v in W]
                prefixes = [Scalar(1)]
                # Prefix marginals are actual Q[A] only because they are ancestral.
                for i in range(1, len(local_order) + 1):
                    prefix = frozenset(local_order[:i])
                    prefixes.append(registry._intern(prefix, _marginal(current, W - prefix), "ancestral topological prefix"))
                extracted = Product(tuple(Ratio(prefixes[i + 1], prefixes[i]) for i, v in enumerate(local_order) if v in A))
                current = registry._intern(A, extracted, "c-component extraction")
            else:
                raise ValueError("Unknown C-tree operation")
            W = A
        outputs[key] = current
    D = _ancestors(_induced(H, _observed(H) - set(X)), Y)
    expected = {frozenset(c) for c in _components(_induced(H, D))}
    actual = [frozenset(registry.records[r.index].nodes) for r in outputs.values()]
    if len(actual) != len(expected) or len(set(actual)) != len(actual) or set(actual) != expected:
        raise ValueError("C-tree does not produce precisely the query's induced components")
    expr, indexed = _reduce_registered(_marginal(Product(tuple(outputs.values())), D - Y), registry, H)
    status = "NONRATIO" if _is_nonratio(expr) else "UNKNOWN"
    result = IdentificationResult(status, expr, indexed, outputs, registry, H, tuple(sorted(X)), tuple(sorted(Y)), trace,
                                  literal_expression=expr, literal_indexed_expression=indexed)
    if expr is None:
        result.formula_status = "UNKNOWN"
    if complete_mc:
        alternative, blocks, certificates, mc_status = _mc_alternative(H, X, Y, D, order, registry, max_mc_unions)
        result.mc_partition, result.mc_certificates, result.mc_search_status = blocks, certificates, mc_status
        if alternative is not None:
            result.mc_expression, result.mc_indexed_expression = _reduce_registered(alternative, registry, H)
            if result.mc_expression is None:
                result.formula_status = "UNKNOWN"
            elif not _is_nonratio(result.mc_expression):
                raise ValueError("Certified MC construction failed the raw nonnegative grammar check")
            if result.mc_expression is not None and result.status != "NONRATIO":
                result.expression, result.indexed_expression = result.mc_expression, result.mc_indexed_expression
                result.status, result.selected_derivation = "NONRATIO", "MC"
    return result


def evaluate(expr, conditional, domains, values=None):
    """Exact finite evaluation; conditional(outputs, given, source) returns a mass."""
    env = {Slot(v): value for v, value in (values or {}).items()}
    def resolve(a, local):
        return a.value if isinstance(a, Value) else local[a]
    def run(e, local):
        if isinstance(e, Scalar):
            return e.value
        if isinstance(e, ObsKernel):
            return conditional({v: resolve(a, local) for v, a in e.outcomes}, {v: resolve(a, local) for v, a in e.given}, e.source)
        if isinstance(e, Product):
            return math.prod(run(f, local) for f in e.factors)
        if isinstance(e, Add):
            return run(e.left, local) + run(e.right, local)
        if isinstance(e, Ratio):
            den = run(e.denominator, local)
            if den <= 0:
                raise ValueError("The identification expression requires positive denominator support")
            return run(e.numerator, local) / den
        if isinstance(e, Sum):
            total = 0
            for row in product(*(domains[s.variable] for s in e.slots)):
                new = dict(local)
                new.update(zip(e.slots, row))
                total += run(e.body, new)
            return total
        raise ValueError("Expand indexed kernels before numeric evaluation")
    return run(expr, env)


class CompilationLimit(ValueError):
    pass


@dataclass(frozen=True)
class KPPProgram:
    terms: tuple
    mode: str = "fixed_payoff_expectation"

    @property
    def payoff_bound(self):
        return len(self.terms) * max((c for c, _ in self.terms), default=0)

    @property
    def selector_probabilities(self):
        return tuple(Fraction(1, len(self.terms)) for _ in self.terms)

    @property
    def stages(self):
        # Every occurrence receives fresh output slots, even for repeated kernels.
        return tuple(tuple({"source": k.source, "outcome_slots": tuple((v, f"copy:{j}:{ell}:{v}") for v, _ in k.outcomes),
                            "given": tuple((v, a.value) for v, a in k.given),
                            "event": tuple((v, a.value) for v, a in k.outcomes)}
                           for ell, k in enumerate(kernels)) for j, (_, kernels) in enumerate(self.terms))

    def expectation(self, conditional):
        return sum(c * math.prod(conditional({v: a.value for v, a in k.outcomes}, {v: a.value for v, a in k.given}, k.source) for k in kernels)
                   for c, kernels in self.terms)

    def draw_payoff(self, draw_kernel, rng):
        """Lazy payoff evaluator; unused independent draws have been integrated out.

        draw_kernel(outcome_names, given_values, source, rng) draws a fresh vector.
        This evaluates the selected term, not the full multi-term product path.
        """
        if not self.terms:
            return 0
        j = rng.randrange(len(self.terms))
        coefficient, kernels = self.terms[j]
        success = True
        for k in kernels:
            drawn = draw_kernel(tuple(v for v, _ in k.outcomes), {v: a.value for v, a in k.given}, k.source, rng)
            success &= all(drawn[v] == a.value for v, a in k.outcomes)
        return len(self.terms) * coefficient if success else 0


def _validate_raw_expression(expr, domains, values):
    """Check original lexical arguments without enumerating joint assignments."""
    for v, states in domains.items():
        if not isinstance(states, (tuple, list)) or not states or len(set(states)) != len(states):
            raise ValueError("Declare each finite alphabet as a nonempty tuple/list of unique values")
    state_sets = {v: set(states) for v, states in domains.items()}
    if not _is_nonratio(expr):
        raise ValueError("Unresolved ratio, index, or negative coefficient in KPP input")
    env = {Slot(v): Value(value) for v, value in values.items()}
    def validate_arguments(e, bound):
        if isinstance(e, ObsKernel):
            for v, a in e.outcomes + e.given:
                if v not in domains:
                    raise ValueError("Missing finite alphabet for a raw-kernel coordinate")
                if isinstance(a, Value):
                    states = (a.value,)
                elif isinstance(a, Slot):
                    if a in bound:
                        states = bound[a]
                    elif a in env:
                        states = (env[a].value,)
                    else:
                        raise ValueError("Every free raw-kernel argument needs a fixed value")
                else:
                    raise ValueError("Raw-kernel arguments must be Slots or Values")
                if any(state not in state_sets[v] for state in states):
                    raise ValueError("Every raw-kernel argument needs supported finite values")
        elif isinstance(e, Sum):
            local = dict(bound)
            for s in e.slots:
                if s.variable not in domains:
                    raise ValueError("Missing finite alphabet for a summation slot")
                local[s] = domains[s.variable]
            validate_arguments(e.body, local)
        elif isinstance(e, Product):
            for f in e.factors:
                validate_arguments(f, bound)
        elif isinstance(e, Add):
            validate_arguments(e.left, bound)
            validate_arguments(e.right, bound)
    # Check the original raw expression. Normalization may erase a context or
    # summation coordinate, but cannot establish support for a missing input.
    validate_arguments(expr, {})
    return env


def compile_kpp(expr, domains, values, max_terms=100000):
    """Compile a finite raw nonnegative sum-product into normalized draws + payoff.

    Finite sum expansion is explicit and may be exponential; max_terms fails
    explicitly rather than silently truncating. Positive conditional support is
    an obligation on the observational source. No observational ratio is sampled.
    """
    if max_terms < 1:
        raise ValueError("max_terms must be positive")
    env = _validate_raw_expression(expr, domains, values)
    # The compiler accepts raw grammar before any reduction. In particular it
    # must not silently turn an uncertified k/k (possibly 0/0) into a payoff.
    expr = reduce_expression(expr)
    if not _is_nonratio(expr):
        raise ValueError("KPP reduction produced a nonfinite or unsupported coefficient")
    def terms(e, local):
        if isinstance(e, Scalar):
            return [(e.value, ())]
        if isinstance(e, ObsKernel):
            k = substitute(e, local)
            for v, a in k.outcomes + k.given:
                if v not in domains or not isinstance(a, Value) or a.value not in domains[v]:
                    raise ValueError("Every raw-kernel argument needs a supported fixed finite value")
            return [(1, (k,))]
        if isinstance(e, Sum):
            if any(s.variable not in domains for s in e.slots):
                raise ValueError("Missing finite alphabet for a summation slot")
            out = []
            for row in product(*(domains[s.variable] for s in e.slots)):
                sub = dict(local)
                sub.update((s, Value(value)) for s, value in zip(e.slots, row))
                out.extend(terms(e.body, sub))
                if len(out) > max_terms:
                    raise CompilationLimit("Finite KPP term budget exceeded")
            return out
        if isinstance(e, Product):
            out = [(1, ())]
            for f in e.factors:
                part = terms(f, local)
                if len(out) * len(part) > max_terms:
                    raise CompilationLimit("Finite KPP term budget exceeded")
                out = [(a * b, k + ell) for a, k in out for b, ell in part]
            return out
        if isinstance(e, Add):
            left, right = terms(e.left, local), terms(e.right, local)
            if len(left) + len(right) > max_terms:
                raise CompilationLimit("Finite KPP term budget exceeded")
            return left + right
        raise ValueError("KPP compiler accepts only raw nonnegative sum-products")
    expanded = terms(expr, env)
    if any(not _is_nonratio(Scalar(c)) for c, _ in expanded):
        raise ValueError("KPP expansion produced a nonfinite or unsupported coefficient")
    expanded = [(c, k) for c, k in expanded if c > 0]
    if any(not _is_nonratio(Scalar(len(expanded) * c)) for c, _ in expanded):
        raise ValueError("KPP selector-scaled payoff is nonfinite or unsupported")
    return KPPProgram(tuple(expanded))


def _finite_nonnegative(value, label):
    if not _is_nonratio(Scalar(value)):
        raise ValueError(label + " must be finite, real, and nonnegative")
    return value


def _finite_float(value, label):
    if isinstance(value, (str, bytes)):
        raise ValueError(label + " must be a real numeric value")
    try:
        converted = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(label + " exceeds the supported floating-point precision") from error
    if not math.isfinite(converted):
        raise ValueError(label + " exceeds the supported floating-point precision")
    return converted


def _summarize_bounded_values(values, bound, delta):
    if delta is not None:
        if isinstance(delta, bool):
            raise ValueError("delta must lie strictly between zero and one")
        delta = _finite_float(delta, "delta")
        if not 0 < delta < 1:
            raise ValueError("delta must lie strictly between zero and one")
    try:
        comparison_bound = float(bound)
    except OverflowError:
        comparison_bound = math.inf  # every finite float lies below this exact bound
    mean, squared_deviations, n = 0.0, 0.0, 0
    for n, raw in enumerate(values, 1):
        value = _finite_float(raw, "Evaluation value")
        if not 0 <= value <= comparison_bound:
            raise ValueError("Evaluation values must lie in the declared bounded range")
        difference = value - mean
        mean = _finite_float(mean + difference / n, "MC mean")
        squared_deviations = _finite_float(squared_deviations + difference * (value - mean), "MC variance")
    if not n:
        raise ValueError("At least one evaluation value is required")
    standard_error = math.sqrt(max(squared_deviations, 0) / (n - 1) / n) if n > 1 else None
    radius = None
    if delta is not None:
        radius = _finite_float(_finite_float(bound, "Evaluation bound")
                               * math.sqrt((math.log(2) - math.log(delta)) / (2 * n)), "MC radius")
    return TraceEstimate(mean, standard_error, n, bound, radius)


@dataclass(frozen=True)
class TraceEstimate:
    value: float
    standard_error: object
    n_draws: int
    known_bound: object
    mc_radius: object = None


@dataclass(frozen=True)
class TraceProgram:
    """Known uniform formula trace, evaluated using frozen fitted cell functions.

    draw_value is a conditional (Rao--Blackwellized) trace value W*product(hat p),
    not a draw of raw nature outputs or an original-outcome marginal. Every leaf
    occurrence has an index in leaves, even when a subtree object is reused.
    Callbacks must stay fixed over estimate's iid traces, independently of the
    trace RNG. Training randomness/error is not included in MC uncertainty.
    """
    tree: tuple
    leaves: tuple
    domains: tuple
    fixed_values: tuple
    weight_bound: object
    occurrence_count: int
    mode: str = "fitted_cell_trace_expectation"

    def draw_value(self, predict_cell, rng):
        """predict_cell(index, outcome_values, given_values, source) is a model fit.

        Predictions must be finite and in [0,1]; no learned/raw conditional
        sampling callback is used. Known selectors and labels alone are drawn.
        """
        alphabets, env = dict(self.domains), dict(self.fixed_values)
        def resolve(argument, local):
            return argument.value if isinstance(argument, Value) else local[argument]
        def run(node, local):
            kind = node[0]
            if kind == "scalar":
                return node[1]
            if kind == "cell":
                index, kernel = node[1], self.leaves[node[1]]
                value = predict_cell(index, {v: resolve(a, local) for v, a in kernel.outcomes},
                                     {v: resolve(a, local) for v, a in kernel.given}, kernel.source)
                _finite_nonnegative(value, "Fitted conditional-cell prediction")
                if value > 1:
                    raise ValueError("Fitted conditional-cell predictions must be clipped to [0,1]")
                return value
            if kind == "add":
                value = 2 * run(node[1 + rng.randrange(2)], local)
            elif kind == "sum":
                new, weight = dict(local), 1
                for slot in node[1]:
                    states = alphabets[slot.variable]
                    new[slot] = states[rng.randrange(len(states))]
                    weight *= len(states)
                value = weight * run(node[2], new)
            elif kind == "product":
                value = 1
                for child in node[1]:
                    # Internal choices are fresh; outer bindings stay shared.
                    value *= run(child, local)
                    _finite_nonnegative(value, "Formula-trace value")
            else:
                raise ValueError("Unknown compiled trace node")
            return _finite_nonnegative(value, "Formula-trace value")
        return run(self.tree, env)

    def estimate(self, predict_cell, n_draws, rng, delta=None):
        """Online plugin integration with conditional MC error only.

        The supplied fitted callback is required to be frozen; mutation cannot be
        detected by this interface. delta, if supplied, requests the Hoeffding
        radius B*sqrt(log(2/delta)/(2*N)). Learning/overlap errors remain separate.
        Large exact weights are supported by draw_value but this MC summary uses
        floats and explicitly rejects unrepresentable intermediate quantities.
        """
        if isinstance(n_draws, bool) or not isinstance(n_draws, int) or n_draws < 1:
            raise ValueError("n_draws must be a positive integer")
        return _summarize_bounded_values((self.draw_value(predict_cell, rng) for _ in range(n_draws)), self.weight_bound, delta)


def compile_kpp_trace(expr, domains, values):
    """Compile the supplied raw formula tree without term/assignment expansion.

    Binary Add uses probability 1/2; Sum samples each declared coordinate
    uniformly. Domain lists and formula occurrences, not an arithmetic DAG, are
    charged inputs. Compilation/sampling do not materialize their Cartesian
    product. Learned cells need not normalize, so no kernel normalization or
    source-CI reduction is applied to the supplied expression. Positive source
    context support and frozen prediction functions are caller obligations.
    """
    env = _validate_raw_expression(expr, domains, values)
    leaves, occurrences = [], 0
    def build(e):
        nonlocal occurrences
        occurrences += 1
        if isinstance(e, Scalar):
            return ("scalar", e.value), e.value
        if isinstance(e, ObsKernel):
            leaves.append(e)
            return ("cell", len(leaves) - 1), 1
        if isinstance(e, Add):
            left, lb = build(e.left)
            right, rb = build(e.right)
            bound = _finite_nonnegative(2 * max(lb, rb), "Trace bound")
            return ("add", left, right), bound
        if isinstance(e, Product):
            children, bound = [], 1
            for f in e.factors:
                child, cb = build(f)
                children.append(child)
                bound = _finite_nonnegative(bound * cb, "Trace bound")
            return ("product", tuple(children)), bound
        if isinstance(e, Sum):
            child, bound = build(e.body)
            for s in e.slots:
                bound = _finite_nonnegative(bound * len(domains[s.variable]), "Trace bound")
            return ("sum", e.slots, child), bound
        raise ValueError("Trace compiler accepts only raw nonnegative formula trees")
    tree, bound = build(expr)
    return TraceProgram(tree, tuple(leaves), tuple((v, tuple(states)) for v, states in domains.items()),
                        tuple((s, a.value) for s, a in env.items()), bound, occurrences)


@dataclass(frozen=True)
class FittedProbabilityCell:
    head: tuple
    context: tuple
    source: str
    predict: object

    def __call__(self, outcomes, given, source="P"):
        if source != self.source or set(outcomes) != set(self.head) or set(given) != set(self.context):
            raise ValueError("Prediction coordinates/source do not match the fitted cell")
        features = tuple(given[v] for v in self.context) + tuple(outcomes[v] for v in self.head)
        value = _finite_float(self.predict(features), "Regression prediction")
        return min(1.0, max(0.0, value))


def fit_probability_cell(rows, head, context, domains, fit_regression, rng, source="P"):
    """Fit conditional cell predictions from genuine iid observational source rows.

    For each row draw a fresh independent uniform head label U; regress
    1{row[head]=U} on (row[context], U), using the supplied learner
    fit_regression(feature_rows, binary_responses)->predict(feature_tuple).
    The auxiliary RNG must be independent of the source rows. Training and
    feature/label costs are charged; this adapter provides no generic learner
    rate, automatic overlap guarantee, or conditional sampling oracle.
    """
    head, context = tuple(head), tuple(context)
    if not head or len(set(head)) != len(head) or len(set(context)) != len(context) or set(head) & set(context):
        raise ValueError("Disjoint unique coordinates and a nonempty head are required")
    coordinates = head + context
    for v in coordinates:
        states = domains.get(v)
        if not isinstance(states, (tuple, list)) or not states or len(set(states)) != len(states):
            raise ValueError("Declare supported finite alphabets for regression coordinates")
    features, responses = [], []
    for row in rows:
        if any(v not in row or row[v] not in domains[v] for v in coordinates):
            raise ValueError("Source training rows must have supported head/context values")
        label = tuple(domains[v][rng.randrange(len(domains[v]))] for v in head)
        features.append(tuple(row[v] for v in context) + label)
        responses.append(int(all(row[v] == value for v, value in zip(head, label))))
    if not features:
        raise ValueError("At least one observational source row is required")
    predict = fit_regression(features, responses)
    if not callable(predict):
        raise ValueError("The supplied learner must return a callable fitted predictor")
    return FittedProbabilityCell(head, context, source, predict)


@dataclass(frozen=True)
class FDRegressionResult:
    value: float
    standard_error: object
    n_evaluation: int
    outcome_bound: float
    mc_radius: object
    mu: object
    r: object
    mode: str = "front_door_backward_regression"


def fit_front_door(train_mu, train_r, evaluation, action_name, mediators,
                   outcome_name, covariates, domains, action_value, fit_mu,
                   fit_r, rng, outcome_bound=1, delta=None):
    """Two supplied regressions for a valid FD/conditional-FD scalar expectation.

    The caller supplies the identification certificate and independent iid source
    blocks, population context support, and an auxiliary RNG independent of all
    source rows. Obvious reused block/row objects are rejected; equal row contents
    are legal and independence cannot be proved from data. Y must lie in [0,B].

    fit_mu learns Y from (Z,X,C). Fresh independent uniform U is drawn per train_r
    row; fit_r learns clipped hat_mu(Z,U,C) from (X,C,U). Its population target is
    M(hat_mu), not M(mu). Held-out evaluation uses hat_r(x,C,X): fixed action x
    and natural X retain distinct feature positions. No mediator conditional
    density or Cartesian mediator grid is fitted/constructed. Supplied learners
    return frozen callable predictors; their training/error guarantees are not
    provided by this adapter. SE/Hoeffding cover held-out fluctuation only.
    """
    if train_mu is train_r or train_mu is evaluation or train_r is evaluation:
        raise ValueError("Use independent training/evaluation block objects")
    train_mu, train_r, evaluation = tuple(train_mu), tuple(train_r), tuple(evaluation)
    if not train_mu or not train_r or not evaluation:
        raise ValueError("Nonempty independent training/evaluation blocks are required")
    identities = [{id(row) for row in block} for block in (train_mu, train_r, evaluation)]
    if any(identities[i] & identities[j] for i, j in combinations(range(3), 2)):
        raise ValueError("Training/evaluation blocks must not reuse row objects")
    mediators, covariates = tuple(mediators), tuple(covariates)
    coordinates = mediators + (action_name,) + covariates + (outcome_name,)
    if not mediators or len(set(coordinates)) != len(coordinates) or any(not isinstance(v, str) for v in coordinates):
        raise ValueError("FD action/mediator/outcome/covariate coordinates must be distinct")
    bound = _finite_float(outcome_bound, "Outcome bound")
    if bound <= 0:
        raise ValueError("Outcome bound must be positive")
    alphabets = {}
    for v in coordinates:
        states = domains.get(v)
        if not isinstance(states, (tuple, list)) or not states or len(set(states)) != len(states):
            raise ValueError("Declare supported finite alphabets for FD coordinates")
        alphabets[v] = tuple(states)
    state_sets = {v: set(states) for v, states in alphabets.items()}
    if action_value not in state_sets[action_name]:
        raise ValueError("Fixed FD action must have supported finite value")
    def check(mapping, names):
        if any(v not in mapping or mapping[v] not in state_sets[v] for v in names):
            raise ValueError("FD source/evaluation arguments must have supported finite values")
    mu_coordinates = mediators + (action_name,) + covariates
    mu_features, responses = [], []
    for row in train_mu:
        check(row, coordinates)
        response = _finite_float(row[outcome_name], "Observed outcome")
        if not 0 <= response <= bound:
            raise ValueError("Observed outcomes must lie in the declared bounded range")
        mu_features.append(tuple(row[v] for v in mu_coordinates))
        responses.append(response)
    mu_predict = fit_mu(mu_features, responses)
    if not callable(mu_predict):
        raise ValueError("The outcome learner must return a callable fitted predictor")
    def mu(z_values, action, c_values):
        check(z_values, mediators)
        check(c_values, covariates)
        if action not in state_sets[action_name]:
            raise ValueError("Outcome-regression action must have supported finite value")
        features = tuple(z_values[v] for v in mediators) + (action,) + tuple(c_values[v] for v in covariates)
        return min(bound, max(0.0, _finite_float(mu_predict(features), "Outcome regression prediction")))
    r_features, pseudo_outcomes = [], []
    for row in train_r:
        check(row, mu_coordinates)
        auxiliary = alphabets[action_name][rng.randrange(len(alphabets[action_name]))]
        pseudo_outcomes.append(mu(row, auxiliary, row))
        r_features.append((row[action_name],) + tuple(row[v] for v in covariates) + (auxiliary,))
    r_predict = fit_r(r_features, pseudo_outcomes)
    if not callable(r_predict):
        raise ValueError("The marginalization learner must return a callable fitted predictor")
    def r(source_action, c_values, auxiliary_action):
        check(c_values, covariates)
        if source_action not in state_sets[action_name] or auxiliary_action not in state_sets[action_name]:
            raise ValueError("Marginalization-regression actions must have supported finite values")
        features = (source_action,) + tuple(c_values[v] for v in covariates) + (auxiliary_action,)
        return min(bound, max(0.0, _finite_float(r_predict(features), "Marginalization regression prediction")))
    def scores():
        for row in evaluation:
            check(row, (action_name,) + covariates)
            yield r(action_value, row, row[action_name])
    summary = _summarize_bounded_values(scores(), bound, delta)
    return FDRegressionResult(summary.value, summary.standard_error, summary.n_draws,
                              bound, summary.mc_radius, mu, r)
