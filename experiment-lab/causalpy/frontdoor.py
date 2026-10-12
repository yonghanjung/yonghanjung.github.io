"""Standard front-door sets: Wienöbst et al., arXiv:2211.16468v4, Alg. 1–3/9.

Minimal means inclusion-minimal, not minimum cardinality. Graph traversals use
at most two states per vertex. Hidden vertices are traversable, never eligible.
Standard search uses the paper's theorem. Bounded conditional candidate search
and supplied C/Z validation use the manuscript criterion; no completeness claim.
"""
from collections import deque
import graph


def _prepare(G, X, Y, included, restricted):
    H, X, Y = graph.preprocess_query(G, X, Y)
    included = set(included)
    observed = graph.observed_nodes(G)
    allowed = graph.observed_nodes(H) - X - Y if restricted is None else set(restricted)
    if not included <= set(H):
        raise ValueError("A1 removed a mandatory mediator; use a reduced-query witness.")
    if not included <= allowed or not allowed <= observed - X - Y:
        raise ValueError("Mandatory and eligible mediators must be observed and outside retained X/Y.")
    return H, X, Y, included, allowed & set(H)


def _reachable(G, starts):
    """Unconditioned Bayes-ball; inc arrives from a parent, out from a child."""
    queue, seen = deque((v, "out") for v in starts), set()
    while queue:
        v, edge = queue.popleft()
        if (v, edge) in seen:
            continue
        seen.add((v, edge))
        queue.extend((w, "inc") for w in G.successors(v))
        if edge == "out":
            queue.extend((w, "out") for w in G.predecessors(v))
    return {v for v, _ in seen}


def _valid(G, X, Y, Z, C=frozenset()):
    reached = _reachable_directed_without(G, X, Z)
    return (not reached & Y
            and graph.is_d_separated(graph.G_cut_outgoing_edges(G, X), X, Z, C)
            and graph.is_d_separated(graph.G_cut_outgoing_edges(G, Z), Z, Y, X | C))


def _maximal(G, X, Y, I, R):
    """Paper Algorithms 1/2: deferred parent visits eliminate forbidden nodes."""
    eligible = R - _reachable(graph.G_cut_outgoing_edges(G, X), X)
    forbidden, deferred, seen = set(G) - eligible, set(), set()
    queue = deque((v, "out") for v in Y)
    while queue:
        v, edge = queue.popleft()
        if (v, edge) in seen:
            continue
        seen.add((v, edge))
        forbidden.add(v)
        if v not in X:
            # Algorithm 1 scans children for BOTH arrival directions.
            queue.extend((w, "inc") for w in G.successors(v))
            if edge == "out":
                for w in G.predecessors(v):
                    if w in forbidden:
                        queue.append((w, "out"))
                    else:
                        deferred.add(w)
        if v in deferred:
            queue.append((v, "out"))
    Z = set(G) - forbidden
    return Z if I <= Z and _valid(G, X, Y, Z) else None


def _directed_boundary(G, starts, boundary, blocked, backward):
    reached, seen, queue = set(), set(starts), deque(starts)
    while queue:
        v = queue.popleft()
        neighbors = G.predecessors(v) if backward else G.successors(v)
        for w in neighbors:
            if w in boundary:
                reached.add(w)
            if w not in blocked and w not in seen:
                seen.add(w)
                queue.append(w)
    return reached


def _backdoor_boundary(G, X, I, ZAn, ZXY):
    """Algorithm 9: yield endpoints separately from continuation conditions."""
    B, S = I | ZAn, I | ZXY
    blocked, reached, seen, queue = X | S, set(), set(), deque()
    def enter(w, edge, follow, emit):
        if emit and w in ZAn:
            reached.add(w)
        if follow:
            queue.append((w, edge))
    for v in S:
        for w in G.predecessors(v):
            enter(w, "out", w not in blocked, True)
    while queue:
        v, edge = queue.popleft()
        if (v, edge) in seen:
            continue
        seen.add((v, edge))
        for w in G.successors(v):
            enter(w, "inc", w not in X and v not in B, v not in B)
        for w in G.predecessors(v):
            enter(w, "out", (edge == "out" or v in B) and w not in blocked,
                  edge == "out" or v in B)
    return reached


def constructive_FD(G, X, Y, *, included=(), restricted=None):
    """Find a maximal standard FD set; R is intersected with An(Y) after A1."""
    G, X, Y, I, R = _prepare(G, X, Y, included, restricted)
    Z = _maximal(G, X, Y, I, R)
    return False if Z is None else {"Z": [v for v in G if v in Z], "C": []}


def constructive_minimum_FD(G, X, Y, *, included=(), restricted=None):
    """Algorithm 3/9: inclusion-minimal FD set with mandatory I and eligible R."""
    G, X, Y, I, R = _prepare(G, X, Y, included, restricted)
    Z = _maximal(G, X, Y, I, R)
    if Z is None:
        return False
    ZAn = _directed_boundary(G, Y, Z, X | Y | Z, True)
    ZXY = _directed_boundary(G, X, ZAn, X | Y | I | ZAn, False)
    result = I | ZXY | _backdoor_boundary(G, X, I, ZAn, ZXY)
    if not _valid(G, X, Y, result):
        raise RuntimeError("Paper front-door traversal failed its criterion check.")
    return {"Z": [v for v in G if v in result], "C": []}


def check_FD(G, X, Y, *, included=(), restricted=None):
    return constructive_FD(G, X, Y, included=included, restricted=restricted) is not False


def conditional_FD(G, X, Y, Z, C=()):
    """Validate supplied mediators/baseline covariates after A1; no set search.

    Conditional FD: manuscript appendix/a1.tex, Def. conditional FD. C must be
    nondescendant of X; C and X must be nondescendants of Z. Variables are whole
    graph nodes, including vector clusters. A removed supplied witness is an error.
    """
    G, X, Y = graph.preprocess_query(G, X, Y)
    Z, C = tuple(Z), tuple(C)
    if len(set(Z)) != len(Z) or len(set(C)) != len(C):
        raise ValueError("Supplied FD variables must be unique.")
    Z, C = set(Z), set(C)
    if not Z | C <= graph.observed_nodes(G):
        raise ValueError("Supplied C/Z must remain observed after A1.")
    if any(a & b for i, a in enumerate((X, Y, Z, C)) for b in (X, Y, Z, C)[i+1:]):
        raise ValueError("Retained X, Y, Z and C must be pairwise disjoint.")
    if (C & set(graph.find_descendant(G, X))
            or (C | X) & set(graph.find_descendant(G, Z))
            or not _valid(G, X, Y, Z, C)):
        return False
    result = {name: [v for v in G if v in nodes]
              for name, nodes in (("X", X), ("Y", Y), ("Z", Z), ("C", C))}
    result["query"] = G.graph["query"].copy()
    return result


def find_conditional_fd(G, X, Y, *, max_candidates="auto", max_seconds=1.0):
    """Bounded Z/C candidate search; ACCEPT is verified, every miss is UNKNOWN.

    Try path-node mediator subsets and the union of two constrained back-door
    separators. This heuristic is neither complete nor a linear-time FD finder.
    Budgets include A1; deadline checks are cooperative. Clusters are whole nodes.
    """
    from itertools import combinations
    from math import isfinite
    from time import perf_counter
    import networkx as nx
    from SBD import Result
    started = perf_counter()
    if max_candidates != "auto" and (type(max_candidates) is not int or max_candidates < 0):
        raise ValueError("max_candidates must be 'auto' or a nonnegative integer.")
    if max_seconds is not None and (isinstance(max_seconds, bool)
            or not isinstance(max_seconds, (int, float)) or not isfinite(max_seconds) or max_seconds < 0):
        raise ValueError("max_seconds must be None or a finite nonnegative number.")
    H, X, Y = graph.preprocess_query(G, X, Y)
    observed = graph.observed_nodes(H)
    limit = min(256, max(1, len(observed)**2)) if max_candidates == "auto" else max_candidates
    expired = lambda: max_seconds is not None and perf_counter() - started >= max_seconds
    if expired():
        return Result("UNKNOWN")
    if not X:
        return Result("ACCEPT", conditional_FD(H, X, Y, (), ()))
    descendants = set().union(*(nx.descendants(H, x) for x in X))
    ancestors = set().union(*(nx.ancestors(H, y) for y in Y))
    pool = [v for v in H if v in observed & descendants & ancestors - X - Y]
    first = graph.G_cut_outgoing_edges(H, X)
    searched = 0
    for size in range(1, len(pool)+1):
        for nodes in combinations(pool, size):
            if searched >= limit or expired():
                return Result("UNKNOWN", searched=searched)
            searched += 1
            Z = set(nodes)
            de_Z = set().union(*(nx.descendants(H, z) for z in Z))
            if X & de_Z or _reachable_directed_without(H, X, Z) & Y:
                continue
            eligible = observed - X - Y - Z - descendants - de_Z
            C1 = graph.find_minimal_d_separator(first, X, Z, restricted=eligible)
            if expired():
                return Result("UNKNOWN", searched=searched)
            if C1 is None:
                continue
            second = graph.G_cut_outgoing_edges(H, Z)
            C2 = graph.find_minimal_d_separator(second, Z, Y, included=X, restricted=eligible | X)
            if expired():
                return Result("UNKNOWN", searched=searched)
            if C2 is not None:
                witness = conditional_FD(H, X, Y, Z, set(C1) | (set(C2) - X))
                if expired():
                    return Result("UNKNOWN", searched=searched)
                if witness:
                    return Result("ACCEPT", witness, searched)
    return Result("UNKNOWN", searched=searched)


def fit_conditional_fd_mean(G, X, Y, data, action_values, *, witness=None,
                            seed=0, params=None, carrier_sampler=None, regression_factory=None,
                            num_boost_round=100):
    """Native UCA backward-regression plug-in; scalar/vector component means.

    Reuse UCA.py's statmodules.learn_mu learner. Four disjoint iid row blocks
    train mu, train r, freeze the auxiliary carrier, and evaluate. Graph nodes
    stay atomic; declared columns expand only at the regression boundary.
    Default continuous-action carrier assumes full-real conditional support;
    constrained actions require a supplied supported carrier_sampler(n,rng,aux).
    No source density, binning, corrected score or causal CI is constructed.
    """
    import numpy as np
    import pandas as pd
    import xgboost as xgb
    import statmodules
    if type(num_boost_round) is not int or num_boost_round < 1:
        raise ValueError("num_boost_round must be a positive integer.")
    X, Y = tuple(X), tuple(Y)
    if set(action_values) != set(X):
        raise ValueError("Specify every original treatment value.")
    if witness is None:
        result = find_conditional_fd(G, X, Y)
        if result.status != "ACCEPT":
            from SBD import SearchLimitExceeded
            raise SearchLimitExceeded("No verified conditional FD witness found.")
        witness = result.witness
    checked = conditional_FD(G, X, Y, witness['Z'], witness['C'])
    if not checked or not checked['X']:
        raise ValueError("Native FD regression needs a valid witness and retained treatment.")
    if not isinstance(data, pd.DataFrame) or len(data) < 16 or not data.columns.is_unique:
        raise ValueError("Supply at least 16 iid rows with unique column names.")
    roles = checked['Z'] + checked['X'] + checked['C'] + checked['Y']
    schema = {}
    for v in roles:
        attrs = G.nodes[v]
        width = attrs.get('dimension', (attrs.get('shape') or (1,))[0])
        columns = attrs.get('columns', [v] if width == 1 else [])
        if len(columns) != width or any(c not in data for c in columns):
            raise ValueError("Declare existing columns for each whole graph variable.")
        schema[v] = list(columns)
    columns = [c for v in roles for c in schema[v]]
    if len(set(columns)) != len(columns) or not np.isfinite(data[columns].to_numpy(dtype=float)).all():
        raise ValueError("FD coordinates must have distinct columns and finite numeric data.")
    group = lambda names: [c for v in names for c in schema[v]]
    xc, zc, cc, yc = (group(checked[k]) for k in ('X','Z','C','Y'))
    fixed, binary = [], []
    for v in checked['X']:
        value = np.asarray(action_values[v], dtype=float).reshape(-1)
        kind = G.nodes[v].get('variable_type')
        if kind not in ('binary','continuous') or len(value) != len(schema[v]) or not np.isfinite(value).all():
            raise ValueError("Declare binary/continuous action type and its whole-vector value.")
        if kind == 'binary' and (not np.isin(value,(0,1)).all() or not data[schema[v]].isin((0,1)).all().all()):
            raise ValueError("Binary action values/data must be zero or one.")
        fixed.extend(value); binary.extend([kind == 'binary']*len(value))
    rng = np.random.default_rng(seed)
    ids = np.array_split(rng.permutation(len(data)),4)
    mu_rows, r_rows, aux_rows, evaluation = (data.iloc[i] for i in ids)
    auxiliary = aux_rows[xc].to_numpy(dtype=float)
    if carrier_sampler is not None:
        carrier = np.asarray(carrier_sampler(len(r_rows),rng,auxiliary.copy()),dtype=float)
    else:
        carrier = rng.binomial(1,.5,size=(len(r_rows),len(xc))).astype(float)
        real = np.flatnonzero(~np.asarray(binary))
        if len(real):
            covariance = np.atleast_2d(np.cov(auxiliary[:,real],rowvar=False)) + 1e-6*np.eye(len(real))
            carrier[:,real] = rng.multivariate_normal(auxiliary[:,real].mean(axis=0),covariance,len(r_rows))
    if carrier.shape != (len(r_rows),len(xc)) or not np.isfinite(carrier).all():
        raise ValueError("Carrier must return a finite joint action matrix of the declared shape.")
    if any(binary) and not np.isin(carrier[:,np.asarray(binary)],(0,1)).all():
        raise ValueError("Carrier must respect binary coordinates.")
    settings = dict(booster='gbtree',objective='reg:squarederror',max_depth=4,eta=.3,nthread=1,seed=seed)
    settings.update(params or {})
    if settings['booster'] == 'gblinear': settings.pop('max_depth',None)
    def learn(features, target):
        if regression_factory is not None:
            model = regression_factory(); model.fit(features,target)
            return lambda a: np.asarray(model.predict(a))
        names = [f'f{i}' for i in range(features.shape[1])]
        frame = pd.DataFrame(features,columns=names); frame['target'] = target
        model = statmodules.learn_mu(frame,names,'target',params=settings,num_boost_round=num_boost_round)
        return lambda a: model.predict(xgb.DMatrix(a,feature_names=names))
    mu_features = zc + xc + cc
    augmented = np.column_stack((r_rows[zc].to_numpy(),carrier,r_rows[cc].to_numpy()))
    r_features = np.column_stack((r_rows[xc].to_numpy(),r_rows[cc].to_numpy(),carrier))
    # Natural X and C MUST come from the SAME held-out source row.
    evaluate = np.column_stack((np.broadcast_to(fixed,(len(evaluation),len(xc))),
                                evaluation[cc].to_numpy(),evaluation[xc].to_numpy()))
    predictions = []
    for outcome in yc:
        mu = learn(mu_rows[mu_features].to_numpy(),mu_rows[outcome].to_numpy())
        r = learn(r_features,mu(augmented))
        predictions.append(r(evaluate))
    predictions = np.column_stack(predictions)
    return dict(mode='NATIVE_UCA_PLUGIN',estimate=predictions.mean(axis=0),
                standard_error=predictions.std(axis=0,ddof=1)/np.sqrt(len(evaluation)),
                outcome_columns=yc,witness=checked,
                blocks={k:tuple(map(int,i)) for k,i in zip(('mu','r','auxiliary','evaluation'),ids)},
                inference='Held-out fitted plug-in fluctuation only; causal coverage is not certified.')


def compile_conditional_fd(G, X, Y, domains, action_values, *, witness=None,
                           compiler=None, request="mean", outcome_values=None):
    """Verified conditional FD -> optional UCA engine's normalized program.

    Import/install the current ``uca_compiler`` engine or inject that module.
    Declare finite scalar alphabets explicitly; no discretization is performed.
    Mean requires one numeric outcome. Distribution requests specify one joint
    outcome cell. Compile once, then use the engine's fit_score with source data.
    """
    from importlib import import_module
    X, Y = tuple(X), tuple(Y)
    if set(action_values) != set(X):
        raise ValueError("action_values must specify every original treatment.")
    if witness is None:
        result = find_conditional_fd(G, X, Y)
        if result.status != "ACCEPT":
            from SBD import SearchLimitExceeded
            raise SearchLimitExceeded("No conditional FD witness found within the search budget.")
        witness = result.witness
    checked = conditional_FD(G, X, Y, witness["Z"], witness["C"])
    if not checked:
        raise ValueError("The supplied conditional FD witness is invalid.")
    roles = set().union(*(set(checked[k]) for k in ("X", "Y", "Z", "C")))
    if not roles <= set(domains):
        raise ValueError("Every FD coordinate needs a declared finite alphabet.")
    for v in roles:
        attrs = G.nodes[v]
        if (attrs.get("dimension", 1) != 1 or attrs.get("shape", ())
                or attrs.get("variable_type") == "continuous"):
            raise NotImplementedError("This UCA adapter supports finite scalar coordinates only.")
        if not isinstance(domains[v], (tuple, list, range)) or not domains[v]:
            raise ValueError("Declare each finite alphabet as a nonempty tuple/list/range.")
        if any(not isinstance(a, (str, int, float, bool)) for a in domains[v]):
            raise NotImplementedError("Joint cluster states require a separate explicit adapter.")
    if any(action_values[v] not in domains[v] for v in checked["X"]):
        raise ValueError("Every retained treatment value must belong to its declared alphabet.")
    if request not in ("mean", "distribution"):
        raise ValueError("request must be 'mean' or 'distribution'.")
    if request == "mean" and outcome_values:
        raise ValueError("Mean requests do not fix outcome values.")
    if request == "distribution" and set(outcome_values or {}) != set(checked["Y"]):
        raise ValueError("Distribution requests must specify the joint outcome cell.")
    if compiler is None:
        try:
            compiler = import_module("uca_compiler")
        except ModuleNotFoundError as exc:
            raise ImportError("Make the UCA engine importable or pass compiler=uca_compiler.") from exc
    ii = compiler.ii
    X, Y, Z, C = (tuple(checked[k]) for k in ("X", "Y", "Z", "C"))
    natural = {v: ii.Slot(v, "fd-natural") for v in X}
    slots = {v: ii.Slot(v, "fd-sum") for v in C + Z}
    binding = lambda names: tuple((v, slots[v]) for v in names)
    fixed = tuple((v, ii.Value(action_values[v])) for v in X)
    inner = ii.Product((
        ii.ObsKernel(tuple((v, ii.Slot(v)) for v in Y), binding(Z + C) + tuple(natural.items())),
        ii.ObsKernel(tuple(natural.items()) + binding(C))))
    expression = ii.Sum(tuple(slots.values()), ii.Product((
        ii.ObsKernel(binding(Z), fixed + binding(C)),
        ii.Sum(tuple(natural.values()), inner)))) if X else ii.ObsKernel(tuple((v, ii.Slot(v)) for v in Y))
    return compiler.construct_uca(expression, {v: tuple(domains[v]) for v in roles},
                                  values=outcome_values, outcomes=Y, request=request,
                                  identifying_family=True)


def _reachable_directed_without(G, starts, removed):
    """Reach directed descendants without traversing mediator candidates."""
    reached, queue = set(starts), list(starts)
    while queue:
        for child in G.successors(queue.pop()):
            if child not in removed and child not in reached:
                reached.add(child)
                queue.append(child)
    return reached


def frontdoor_estimand(X, Y, Z, C, latex):
    """Format a validated FD witness; fixed and summed natural actions differ."""
    if not X:
        return "P(" + ", ".join(Y) + ")"
    separator, sigma = (r" \mid ", r"\sum") if latex else (" | ", "Σ")
    fixed = ", ".join(f"{v}={v.lower()}" for v in X)
    natural = ", ".join(f"{v}={v.lower()}'" for v in X)
    z, y = ", ".join(Z), ", ".join(Y)
    c = ", ".join(C)
    outer, inner = ", ".join(v.lower() for v in list(C)+list(Z)), ", ".join(v.lower()+"'" for v in X)
    baseline = (", " + c) if C else ""
    return (f"{sigma}_{{{outer}}} P({z}{separator}{fixed}{baseline}) "
            f"{sigma}_{{{inner}}} P({y}{separator}{z}, {natural}{baseline}) P({natural}{baseline})")
