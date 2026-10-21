import networkx as nx
from itertools import combinations, chain

import identify
import adjustment
import SBD
import graph

def power_combination(lst):
	n = len(lst)
	out = []
	for k in range(1, n//2 + 1):
		for S in combinations(lst, k):
			comp = [x for x in lst if x not in S]

			if k == n - k:  
				if S > tuple(comp):  # canonical ordering
					continue

			# Flatten each side
			left  = [item for group in S for item in group]
			right = [item for group in comp for item in group]

			out.append([left, right])
	return out

# Tian & Pearl (AAAI 2002), single-treatment c-component criterion.
def _query(G, X, Y):
    Y = list(graph.observed_nodes(G) - set(X)) if Y is None else Y
    H, actions, outcomes = graph.preprocess_query(G, X, Y)
    graph.require_latent_roots(G)
    return H, actions, outcomes


def check_Tian_criterion(G, X, Y=None):
    """2002 singleton sufficient criterion after A1; multi-action is inapplicable.

    Y=None queries the entire observed non-action law. Pass the actual outcomes
    for an outcome-specific query. Empty retained actions are observational.
    """
    if Y is None and not (graph.observed_nodes(G) - set(X)):
        graph.preprocess_query(G, [], X)  # Validate the nonempty whole-law domain.
        graph.require_latent_roots(G)
        return True  # The empty post-intervention law is the constant one.
    H, X, Y = _query(G, X, Y)
    if not X:
        return True
    if len(X) != 1:
        return False
    return not (set(graph.find_children(H, X)) & set(graph.find_c_components(H, X)))


def check_product_criterion(G,X,Y):
	result = identify.return_AC_tree(G, X, Y)
	if result is None:
		return False
	adj_dict_components, adj_dict_operations = result
	for adj_dict_component in adj_dict_components.values():
		if len(adj_dict_component) != 1:
			return False 
	return True 

def check_Generalized_Tian_criterion(G, X, Y=None):
    """Compatibility entry: only the verified singleton 2002 theorem is supported."""
    return check_Tian_criterion(G, X, Y)


from dataclasses import dataclass


@dataclass(frozen=True)
class TianWitness:
    original_actions: tuple
    actions: tuple
    outcomes: tuple
    order: tuple
    district: tuple
    factors: tuple  # (head, full observed prefix, natural-action binding)

    def expression(self, latex=False):
        if not self.actions:
            return "P(" + ", ".join(self.outcomes) + ")"
        x = self.actions[0]
        def term(leaf):
            head, given, natural = leaf
            def label(v):
                return f"{x}={x.lower()}" + ("'" if natural else "") if v == x else v
            cond = (r" \mid " if latex else " | ") + ", ".join(map(label, given)) if given else ""
            return "P(" + label(head) + cond + ")"
        outside = " ".join(term(f) for f in self.factors if not f[2])
        inside = " ".join(term(f) for f in self.factors if f[2])
        sigma = r"\sum" if latex else "Σ"
        result = outside + f" ({sigma}_{{{x.lower()}'}} " + inside + ")"
        auxiliary = [v.lower() for v in self.order if v not in self.actions + self.outcomes]
        return (f"{sigma}_{{{', '.join(auxiliary)}}} " if auxiliary else "") + result


def tian_witness(G, X, Y, topo_V=None):
    """Exact c-factor witness for the finite-positive 2002 root model.

    All leaves use one order and the source observational marginal on An(Y).
    Action values are fixed outside its district; natural values are summed
    only inside its district. Cluster variables remain whole nodes.
    """
    original = tuple(X)
    H, X, Y = _query(G, X, Y)
    original = H.graph["query"]["original_actions"]
    observed = graph.observed_nodes(H)
    order = tuple(graph.find_topological_order(H) if topo_V is None else [v for v in topo_V if v in observed])
    if set(order) != graph.observed_nodes(H) or len(order) != len(set(order)):
        raise ValueError("Supply a full observed topological order.")
    rank = {v: i for i, v in enumerate(order)}
    if any(rank[u] >= rank[v] for u, v in H.edges if u in rank and v in rank):
        raise ValueError("Supply a full observed topological order.")
    actions = tuple(v for v in order if v in X)
    outcomes = tuple(v for v in order if v in Y)
    if len(actions) > 1:
        raise NotImplementedError("Tian 2002 supports one retained treatment; use ID or SBD for multiple treatments.")
    if not actions:
        return TianWitness(original, (), outcomes, order, (), ())
    component = set(graph.find_c_components(H, actions))
    district = tuple(v for v in order if v in component)
    if set(graph.find_children(H, actions)) & set(district):
        raise ValueError("The singleton Tian 2002 criterion is not satisfied.")
    leaves = tuple((v, order[:i], v in district) for i, v in enumerate(order))
    return TianWitness(original, actions, outcomes, order, district, leaves)


def Tian_estimand(G, X, Y, latex, topo_V=None):
    return tian_witness(G, X, Y, topo_V).expression(latex)


def generalized_Tian_estimand(G, X, Y, latex, topo_V=None):
    """Compatibility entry; unverified multi-treatment formulas are not returned."""
    return Tian_estimand(G, X, Y, latex, topo_V)


# --- dc-partition (Def. 9) and generalized Tian check (Def. 10) ---

def _as_list(obj):
	"""Utility: normalize scalars/iterables to a list of strings."""
	if obj is None:
		return []
	if isinstance(obj, (list, tuple, set)):
		return list(obj)
	return [obj]

def _c_partition_of_X(G, X):
	"""
	Partition X by c-components in G.
	Returns a list of sets [Xc1, Xc2, ...], each wholly contained in a single c-component.
	"""
	X = _as_list(X)
	buckets = {}  # key: frozenset(c-comp nodes), value: set of X in that c-comp
	for xi in X:
		cc_nodes = set(graph.find_c_components(G, [xi]))  # union of the c-component containing xi
		key = frozenset(cc_nodes)
		if key not in buckets:
			buckets[key] = set()
		buckets[key].add(xi)
	# Return just the X-contents for each c-component; ignore empty
	return [sorted(list(s)) for s in buckets.values() if len(s) > 0], [set(k) for k in buckets.keys()]

def dc_partition(G, X, Y):
	r"""
	Definition 9 (Descendant-closed c-partition). For each c-part X_c ⊆ X,
	let
		X'_c = De_{G(c(X_c))}(X_c) \ PCP(X, Y) \ Y,
	where c(X_c) is the c-component containing X_c, G(c(X_c)) is the induced subgraph on that component,
	De_{G(c(X_c))}(X_c) are directed descendants *within that subgraph*,
	and PCP(X,Y) is the proper causal path set. (Defs. and notation per the draft.)  # :contentReference[oaicite:1]{index=1}

	Returns:
		dc_blocks: list of lists, each is X'_c (sorted)
		meta: list of dicts with extra info per block (c-comp nodes, etc.)
	"""
	G, actions, outcomes = graph.preprocess_query(G, X, Y)
	X, Y = list(actions), list(outcomes)
	X = _as_list(X)
	Y = set(_as_list(Y))

	# c-partition (groups of X by c-component)
	Xc_list, ccomp_nodes_list = _c_partition_of_X(G, X)

	pcp = set(adjustment.proper_causal_path(G, X, list(Y)))  # PCP(X,Y)

	dc_blocks = []
	meta = []

	for Xc, ccomp_nodes in zip(Xc_list, ccomp_nodes_list):
		# G(c(Xc)): subgraph induced by c-component nodes (graph.subgraphs keeps relevant U's too)
		Gc = graph.subgraphs(G, list(ccomp_nodes))

		# De_{G(c(Xc))}(Xc) (observable descendants within the subgraph; the helper includes the nodes themselves)
		De_in_c = set(graph.find_descendant(Gc, Xc))

		# X'_c = De_{G(c(Xc))}(Xc) \ PCP(X,Y) \ Y
		Xc_prime = list(sorted(list(De_in_c - pcp - Y)))

		dc_blocks.append(Xc_prime)
		meta.append({
			"Xc": list(sorted(Xc)),
			"c_component": list(sorted(ccomp_nodes)),
			"De_in_c": list(sorted(De_in_c)),
			"PCP": list(sorted(pcp)),
			"Y": list(sorted(Y)),
			"Xc_prime": list(sorted(Xc_prime)),
		})

	return dc_blocks, meta

def check_dcGenTian(G, X, Y, return_witness=False):
	r"""
	Definition 10 (Generalized Tian’s Criterion via dc-partition).
	Let {X'_1, ..., X'_c} = dc_partition(G, X, Y).
	X satisfies the generalized Tian criterion iff, for every nonempty X'_i,
		X'_i = De_{G(c(X'_i))}(X'_i).
	(All notation as in the draft.)  # :contentReference[oaicite:2]{index=2}

	Args:
		G: nx.DiGraph
		X: list[str] | str
		Y: list[str] | str
		return_witness: if True, return (bool, details) with a failing witness

	Returns:
		bool  |  (bool, dict) if return_witness
	"""
	G, actions, outcomes = graph.preprocess_query(G, X, Y)
	X, Y = list(actions), list(outcomes)
	dc_blocks, meta = dc_partition(G, X, Y)

	for block, info in zip(dc_blocks, meta):
		Xp = set(block)
		if len(Xp) == 0:
			continue  # vacuously satisfied for this block
		# c(X'_i): c-component containing X'_i (they should all be within a single c-comp)
		c_nodes = set(graph.find_c_components(G, list(Xp)))
		Gc = graph.subgraphs(G, list(c_nodes))
		De_in_c = set(graph.find_descendant(Gc, list(Xp)))  # includes Xp itself

		if De_in_c != Xp:
			if return_witness:
				witness = {
					"X_prime": sorted(list(Xp)),
					"c_component_of_X_prime": sorted(list(c_nodes)),
					"De_in_c_of_X_prime": sorted(list(De_in_c)),
					"meta": info,
				}
				return False, witness
			return False

	return (True, {"dc_blocks": dc_blocks, "meta": meta}) if return_witness else True


@dataclass(frozen=True)
class WMCWitness:
    """One global WMC block; groups bind their own observational dummy values."""
    original_actions: tuple
    actions: tuple
    outcomes: tuple
    order: tuple
    D: tuple
    block: tuple
    parents: tuple
    kernel: object
    groups: tuple  # (locally summed nodes, ((head tuple, given tuple), ...))

    def expression(self, latex=False):
        sigma, bar = (r"\sum", r" \mid ") if latex else ("Σ", " | ")
        terms = []
        for i, (summed, factors) in enumerate(self.groups):
            def label(v):
                if v in summed:
                    return f"{v}={v.lower()}'_{i}"
                return f"{v}={v.lower()}" if v in self.actions else v
            leaves = ["P(" + ", ".join(map(label, head)) +
                      (bar + ", ".join(map(label, given)) if given else "") + ")"
                      for head, given in factors]
            body = " ".join(leaves)
            if summed:
                body = f"{sigma}_{{" + ", ".join(f"{v.lower()}'_{i}" for v in summed) + "} " + body
            terms.append("(" + body + ")")
        outer = [v for v in self.D if v not in self.outcomes]
        return (f"{sigma}_{{" + ", ".join(outer) + "} " if outer else "") + " ".join(terms)


def find_wmc(G, X, Y, *, max_orders="auto", max_seconds="auto", strategy="auto"):
    """Manuscript WMC, one joint D_X query; NO_WMC is not nonidentification.

    Finite-positive independent-root models; clusters are whole nodes. Outside
    c-factors average unused prefix context against its normalized source law.
    The default three-second overall deadline includes outer A1 and SBD's
    random-then-two-second fallback. Explicit numeric limits remain overall caps.
    """
    from time import perf_counter
    from math import isfinite
    started = perf_counter()
    seconds = (None if max_orders is None else 3.0) if max_seconds == "auto" else max_seconds
    if seconds is not None and (isinstance(seconds, bool) or not isinstance(seconds, (int, float))
                                or not isfinite(seconds) or seconds < 0):
        raise ValueError("max_seconds must be 'auto', None, or a finite nonnegative number.")
    if max_orders != "auto" and max_orders is not None and (type(max_orders) is not int or max_orders < 0):
        raise ValueError("max_orders must be 'auto', None, or a nonnegative integer.")
    H, X, Y = _query(G, X, Y)
    order = tuple(graph.find_topological_order(H))
    ordered = lambda nodes: tuple(v for v in order if v in nodes)
    actions, outcomes = ordered(X), ordered(Y)
    remainder = H.copy()
    remainder.remove_nodes_from(X)
    D = graph.observed_nodes(H) & (set(Y).union(*(nx.ancestors(remainder, y) for y in Y)))
    districts = [set(s) for s in graph.list_all_c_components(H)]
    SX = set().union(*(s for s in districts if s & X))
    block = D & SX
    parents = set(graph.find_parents(H, block))
    remaining = None if seconds is None else max(0.0, seconds - (perf_counter() - started))
    if remaining == 0:
        return SBD.Result("UNKNOWN")
    kernel, searched = None, 0
    if block:
        result = SBD.find_sbd(H, ordered(parents), ordered(block), max_orders=max_orders, max_seconds=remaining, strategy=strategy)
        searched = result.searched
        if result.status != "ACCEPT":
            return SBD.Result("NO_WMC" if result.status == "NO_SBD" else "UNKNOWN", searched=searched)
        kernel = result.witness
    groups = []
    for district in districts:
        A = district & D
        if district & X or not A:
            continue
        factors = tuple(((v,), order[:order.index(v)]) for v in order if v in district)
        context = set().union(*(set(given) for _, given in factors)) - district - D - X
        if context:
            factors = ((ordered(context), ()),) + factors
        groups.append((ordered((district - A) | context), factors))
    if kernel is not None:
        groups.append((tuple(v for z in kernel.auxiliary_blocks for v in z), kernel.factors))
    if seconds is not None and perf_counter() - started >= seconds:
        return SBD.Result("UNKNOWN", searched=searched)
    witness = WMCWitness(H.graph["query"]["original_actions"], actions, outcomes, order,
                         ordered(D), ordered(block), ordered(parents), kernel, tuple(groups))
    return SBD.Result("ACCEPT", witness, searched)


def check_multilinear_v1(G, X, Y, return_witness=False):
    """Compatibility WMC checker; unfinished search raises, never returns False."""
    result = find_wmc(G, X, Y)
    if result.status == "UNKNOWN":
        SBD.require_witness(result)
    accepted = result.status == "ACCEPT"
    if not return_witness:
        return accepted
    if not accepted:
        return False, None
    w = result.witness
    H, _, _ = graph.preprocess_query(G, w.actions, w.outcomes)
    return True, dict(D=list(w.D), D_X=list(w.block), PA_DX=list(w.parents),
                      S_X=graph.find_c_components(H, w.actions), witness=w)

def check_multilinear(G,X,Y,return_witness: bool = False):
	r"""
	Implements:
	  D := an_{G(V \\ X)}(Y)
	  S_X := graph.find_c_components(G, X)
	  D_X := S_X ∩ X
	  PA_DX := graph.find_parents(G, D_X) \ D_X
	  return (SBD.criterion(G, PA_DX, D_X))

	Returns:
	  If return_witness:
		  (bool, {'D','S_X','D_X','PA_DX'})
	  else:
		  bool
	"""
	G, actions, outcomes = graph.preprocess_query(G, X, Y)
	X, Y = list(actions), list(outcomes)
	topo_V = graph.find_topological_order(G)
	
	X = list(X)
	Y = list(Y)
 
	# Find V\X and create the corresponding subgraph
	V_minus_X = list(set(G.nodes()).difference(set(X)))
	subgraph_V_minus_X = graph.subgraphs(G,V_minus_X)
	# Find ancestors of Y in G(V\X)
	D = list(set(graph.find_ancestor(subgraph_V_minus_X,Y)) | set(Y))
	S_X = graph.find_c_components(G, X)
	DX = sorted(set(S_X).intersection(set(D)))
	if len(DX) == 0:
		return True 
 
	subgraph_DX = graph.subgraphs(G,DX)
	c_components_DX = graph.list_all_c_components(subgraph_DX)
 
	# 1. Check if DX is SBD 
	PA_DX = list(graph.find_parents(G, DX))  # Find the parents of Y in G
	SAC_ok = not DX or bool(SBD.criterion(G, PA_DX, DX))
	if SAC_ok: 
		if return_witness:
			witness = {
				'D': sorted(D, key=lambda x: topo_V.index(x) ),
				'S_X': sorted(set(S_X), key=lambda x: topo_V.index(x)),
				'D_X': sorted(set(DX), key=lambda x: topo_V.index(x) ),
				'PA_DX': sorted(set(PA_DX), key=lambda x: topo_V.index(x) )
			}
			return SAC_ok, witness
		else:
			return SAC_ok
 
	# 2. Check if each element is SBD 
	SAC_ok_everyC = True
	for c_element in c_components_DX:
		PA_c_element = list(graph.find_parents(G, c_element))  
		SAC_ok_celement = bool(SBD.criterion(G, PA_c_element, c_element))
  
		if SAC_ok_celement == False:
			SAC_ok_everyC = False 
			break 
	
	if SAC_ok_everyC:
		if return_witness:
			witness = {
				'D': sorted(D, key=lambda x: topo_V.index(x) ),
				'S_X': sorted(set(S_X), key=lambda x: topo_V.index(x)),
				'D_X': sorted(set(DX), key=lambda x: topo_V.index(x) ),
				'PA_DX': sorted(set(PA_DX), key=lambda x: topo_V.index(x) )
			}
			return SAC_ok_everyC, witness
		else:
			return SAC_ok_everyC


	# 2. Check powerset 
	power_DX = power_combination(c_components_DX)
 
	for powerset in power_DX:
		powerset0, powerset1 = powerset 
		PA_power0 = list(graph.find_parents(G, powerset0))  # Find the parents of Y in G
		PA_power1 = list(graph.find_parents(G, powerset1))  # Find the parents of Y in G
		
		SAC_ok_0 = bool(SBD.criterion(G, PA_power0, powerset0))
		SAC_ok_1 = bool(SBD.criterion(G, PA_power1, powerset1))
	 
		if SAC_ok_0 and SAC_ok_1:
			return True 

	if return_witness:
		witness = {
			'D': sorted(D, key=lambda x: topo_V.index(x) ),
			'S_X': sorted(set(S_X), key=lambda x: topo_V.index(x)),
			'D_X': sorted(set(DX), key=lambda x: topo_V.index(x) ),
			'PA_DX': sorted(set(list(graph.find_parents(G, DX))), key=lambda x: topo_V.index(x) )
		}
		return False, witness
	else:
		return False
	
	
 
	
	






def require_legacy_estimation_query(G, X, Y):
    """Validate only: legacy Tian learners need an explicit reduced graph/query."""
    H, actions, _ = _query(G, X, Y)
    if set(actions) != set(X) or set(H) != set(G):
        raise NotImplementedError("Legacy Tian estimation requires an explicit A1-reduced graph and query.")
    if len(actions) != 1 or not check_Tian_criterion(H, X, Y):
        raise NotImplementedError("Legacy Tian estimation requires the singleton Tian 2002 criterion.")
