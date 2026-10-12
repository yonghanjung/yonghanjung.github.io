"""JSON identification API for the browser Worker; no data fitting or plotting."""
from dataclasses import asdict
from math import isfinite
from time import perf_counter
import re
import networkx as nx
import adjustment
import graph
import identify
import indexed_identification as ii
import SBD
import frontdoor
import tian
from examples import UCA_GRAPH_DICTIONARY


def _graph(payload):
    if not isinstance(payload, dict):
        raise ValueError('A JSON object is required.')
    nodes, edges = payload.get('nodes'), payload.get('edges', [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 50 or not isinstance(edges, list) or len(edges) > 2500:
        raise ValueError('Use 1 to 50 nodes and at most 2500 edges.')
    G = nx.DiGraph()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError('Each node must be a JSON object.')
        name, observed, dimension = node.get('name'), node.get('observed', True), node.get('dimension', 1)
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name) or name in G:
            raise ValueError('Use unique variable names starting with a letter.')
        if type(observed) is not bool or type(dimension) is not int or not 1 <= dimension <= 8:
            raise ValueError('Observed must be boolean; dimension must be 1 to 8.')
        G.add_node(name, observed=observed, dimension=dimension)
    for edge in edges:
        if not isinstance(edge, list) or len(edge) != 2 or any(not isinstance(v,str) or v not in G for v in edge):
            raise ValueError('Every edge must join two existing variables.')
        G.add_edge(*edge)
    return G


def _limit(payload, key, default, integer=False):
    value = payload.get(key, default)
    if value is not None and (type(value) not in ((int,) if integer else (int, float)) or not isfinite(value) or value < 0):
        raise ValueError(f'{key} must be None or a nonnegative ' + ('integer.' if integer else 'number.'))
    return value


def _row(status, formula=None, witness=None, **extra):
    return dict(status=status, formula=formula, witness=witness, **extra)


def _json_ready(value):
    if isinstance(value, dict):
        return {str(k):_json_ready(v) for k,v in value.items()}
    if isinstance(value, (list,tuple,set,frozenset)):
        return [_json_ready(v) for v in (sorted(value) if isinstance(value,(set,frozenset)) else value)]
    return value


def _render(expr, registry=None):
    """Keep lexical sum copies distinct; names are text, never executable HTML."""
    labels, remaining = {}, [50000]
    def slot(value):
        if isinstance(value, ii.Value):
            return str(value.value)
        if value.scope == 'free':
            return value.variable
        if value not in labels:
            labels[value] = f'{value.variable}@{len(labels)+1}'
        return labels[value]
    def visit(e):
        remaining[0] -= 1
        if remaining[0] < 0:
            raise ii.ExpressionLimit('Formula display occurrence budget exhausted')
        if isinstance(e, ii.Scalar):
            return str(e.value)
        if isinstance(e, ii.ObsKernel):
            out = ', '.join(slot(s) for _, s in e.outcomes)
            given = ', '.join(slot(s) for _, s in e.given)
            return f'{e.source}({out}' + (f' | {given}' if given else '') + ')'
        if isinstance(e, ii.QRef):
            return 'Q[' + ','.join(registry.records[e.index].nodes) + ']'
        if isinstance(e, ii.Sum):
            return 'Σ_{' + ', '.join(map(slot, e.slots)) + '} (' + visit(e.body) + ')'
        if isinstance(e, ii.Product):
            return ' × '.join('(' + visit(f) + ')' for f in e.factors) or '1'
        if isinstance(e, ii.Ratio):
            return '(' + visit(e.numerator) + ')/(' + visit(e.denominator) + ')'
        if isinstance(e, ii.Add):
            return '(' + visit(e.left) + ' + ' + visit(e.right) + ')'
        raise TypeError('Unknown expression node.')
    return None if expr is None else visit(expr)


def _tree(expr, registry=None):
    """A bounded MathML-ready tree; preserve lexical copies and literal values."""
    labels, remaining = {}, [50000]
    def argument(variable, value):
        if isinstance(value, ii.Value):
            return dict(variable=variable, value=value.value, label=str(value.value))
        if value.scope != 'free' and value not in labels:
            labels[value] = f'{value.variable}@{len(labels)+1}'
        return dict(variable=variable, label=value.variable if value.scope == 'free' else labels[value])
    def visit(e):
        remaining[0] -= 1
        if remaining[0] < 0:
            raise ii.ExpressionLimit('Formula tree occurrence budget exhausted')
        if isinstance(e, ii.Scalar):
            return dict(type='number', value=str(e.value))
        if isinstance(e, ii.ObsKernel):
            return dict(type='probability', source=e.source,
                outcomes=[argument(v,s) for v,s in e.outcomes], given=[argument(v,s) for v,s in e.given])
        if isinstance(e, ii.QRef):
            return dict(type='kernel', nodes=list(registry.records[e.index].nodes),
                        arguments=[argument(v,s) for v,s in e.arguments])
        if isinstance(e, ii.Sum):
            return dict(type='sum', variables=[argument(s.variable,s) for s in e.slots], body=visit(e.body))
        if isinstance(e, ii.Product):
            return dict(type='product', factors=[visit(f) for f in e.factors])
        if isinstance(e, ii.Ratio):
            return dict(type='ratio', numerator=visit(e.numerator), denominator=visit(e.denominator))
        if isinstance(e, ii.Add):
            return dict(type='add', left=visit(e.left), right=visit(e.right))
        raise TypeError('Unknown expression node.')
    return None if expr is None else visit(expr)


def _adjustment_expression(X,Y,Z):
    if not Z:
        return ii.ObsKernel(ii._bindings(Y),ii._bindings(X))
    return ii._marginal(ii.Product((ii.ObsKernel(ii._bindings(Y), ii._bindings(set(X)|set(Z))),
                                    ii.ObsKernel(ii._bindings(Z)))), set(Z))


def _fd_expression(X,Y,Z,C):
    if not X:
        return ii.ObsKernel(ii._bindings(Y))
    natural = {v:ii.Slot(v,'fd-natural') for v in X}
    bindings = lambda names: tuple((v,natural.get(v,ii.Slot(v))) for v in sorted(names))
    inner = ii.Sum(tuple(natural.values()),ii.Product((
        ii.ObsKernel(ii._bindings(Y),bindings(set(Z)|set(X)|set(C))),
        ii.ObsKernel(bindings(set(X)|set(C))))))
    return ii._marginal(ii.Product((ii.ObsKernel(ii._bindings(Z),ii._bindings(set(X)|set(C))),inner)),set(Z)|set(C))


def _tian_expression(witness):
    if not witness.actions:
        return ii.ObsKernel(ii._bindings(witness.outcomes))
    x, natural = witness.actions[0], ii.Slot(witness.actions[0],'tian-natural')
    outside, inside = [], []
    for head,given,bound in witness.factors:
        binding = lambda v: natural if bound and v == x else ii.Slot(v)
        factor = ii.ObsKernel(((head,binding(head)),),tuple((v,binding(v)) for v in given))
        (inside if bound else outside).append(factor)
    expression = ii.Product(tuple(outside)+(ii.Sum((natural,),ii.Product(tuple(inside))),))
    return ii._marginal(expression,set(witness.order)-set(witness.actions)-set(witness.outcomes))


def _wmc_expression(witness):
    groups = [ii._marginal(ii.Product(tuple(ii.ObsKernel(ii._bindings(head),ii._bindings(given))
                 for head,given in factors)),set(summed)) for summed,factors in witness.groups]
    return ii._marginal(ii.Product(tuple(groups)),set(witness.D)-set(witness.outcomes))


def _sbd_expression(witness):
    factors = [ii.ObsKernel(ii._bindings(head), ii._bindings(given)) for head, given in witness.factors]
    summed = {v for block in witness.auxiliary_blocks for v in block}
    return ii._marginal(ii.Product(tuple(factors)), summed)


def _id_formula(H, X, Y, trace):
    """Compact Q-factor definitions, including the actual δ/Σ trace.

    δ_A Q[W] extracts A by ratios of topological-prefix marginals of Q[W].
    Keeping these named kernels avoids an exponentially expanded display.
    """
    if not X:
        return 'P(' + ', '.join(sorted(Y)) + ')', [], _tree(ii.ObsKernel(ii._bindings(Y)))
    order = graph.find_topological_order(H)
    label = lambda nodes: 'Q[' + ','.join(v for v in order if v in nodes) + ']'
    definitions, D, factors, trees = [], set(), [], []
    for key, path in trace[1].items():
        W = set(path[0])
        seed = ['P(' + v + (' | ' + ', '.join(order[:i]) if i else '') + ')'
                for i, v in enumerate(order) if v in W]
        definitions.append(dict(kernel=label(W), formula=' × '.join(seed), kernel_tree=dict(type='kernel',nodes=sorted(W)),
            formula_tree=_tree(ii.Product(tuple(ii.ObsKernel(ii._bindings([v]),ii._bindings(order[:i]))
                        for i,v in enumerate(order) if v in W)))))
        for A, operation in zip(path[1:], trace[2][key][1:]):
            A = set(A)
            body = ('Σ_{' + ','.join(sorted(W-A)) + '} ' if operation == 'Σ' else 'δ_{' + ','.join(sorted(A)) + '} ')
            kernel = dict(type='kernel',nodes=[v for v in order if v in W])
            tree = (dict(type='sum',variables=[dict(variable=v,label=v) for v in sorted(W-A)],body=kernel)
                    if operation == 'Σ' else dict(type='extract',nodes=sorted(A),body=kernel))
            definitions.append(dict(kernel=label(A), formula=body + label(W), kernel_tree=dict(type='kernel',nodes=sorted(A)),formula_tree=tree))
            W = A
        D.update(W)
        factors.append(label(W))
        trees.append(dict(type='kernel',nodes=[v for v in order if v in W]))
    formula = ' × '.join(factors)
    if D-set(Y):
        formula = 'Σ_{' + ','.join(sorted(D-set(Y))) + '} (' + formula + ')'
    tree = dict(type='product',factors=trees)
    if D-set(Y):
        tree = dict(type='sum',variables=[dict(variable=v,label=v) for v in sorted(D-set(Y))],body=tree)
    return formula, definitions, tree


def analyze(payload):
    """Analyze an immutable graph snapshot; UNKNOWN never means not identifiable.

    Automatic criteria use A1. Supplied Z is checked on the original graph.
    MC is finite-positive private/pair-root scope; vectors remain whole nodes.
    max_seconds is one shared Analyze deadline, including all Q queries.
    """
    started = perf_counter()
    G = _graph(payload)
    X, Y = payload.get('X', []), payload.get('Y', [])
    if not isinstance(X,list) or not isinstance(Y,list) or any(not isinstance(v,str) for v in X+Y):
        raise ValueError('X and Y must be lists of variable names.')
    H, actions, outcomes = graph.preprocess_query(G, X, Y)
    order = graph.find_topological_order(H)
    ordered = lambda values: [v for v in order if v in values]
    x, y = ordered(actions), ordered(outcomes)
    seconds = _limit(payload, 'max_seconds', 3)
    orders = _limit(payload, 'max_orders', 256, True)
    unions = _limit(payload, 'max_mc_unions', 256, True)
    deadline = None if seconds is None else started+seconds
    remaining = lambda: None if deadline is None else max(0, deadline-perf_counter())
    query = dict(original_actions=list(X), actions=x, outcomes=y, retained_nodes=list(H),
                 source_nodes=list(G), pruned_actions=[v for v in X if v not in actions])
    criteria, indexed = {}, dict(status='NOT_RUN', formula=None)

    def safe(name, run):
        try:
            criteria[name] = run()
        except (NotImplementedError, ValueError) as error:
            criteria[name] = _row('UNSUPPORTED', reason=str(error))
        except (SBD.SearchLimitExceeded, ii.ExpressionLimit) as error:
            criteria[name] = _row('UNKNOWN', reason=str(error))

    try:
        trace = identify.ID_return_Ctree(G, X, Y)
        status = 'NOT_IDENTIFIABLE' if trace[0] == 0 else 'IDENTIFIABLE'
        formula, definitions, tree = (None, [], None) if trace[0] == 0 else _id_formula(H, actions, outcomes, trace)
        identification = dict(status=status, formula=formula, formula_tree=tree, trace=trace, definitions=definitions,
            extraction='δ_A Q[W] = product over A of ratios of adjacent topological-prefix marginals of Q[W].')
    except ValueError as error:
        trace = None
        identification = dict(status='UNSUPPORTED', formula=None, reason=str(error))

    def bd():
        descendants = set().union(*(nx.descendants(H, v) for v in actions))
        allowed = graph.observed_nodes(H) - actions - outcomes - descendants
        Z = graph.find_minimal_d_separator(graph.G_cut_outgoing_edges(H, actions), actions, outcomes, restricted=allowed)
        if Z is None:
            return _row('NO_BD')
        if not adjustment.check_backdoor_criterion(H, x, y, Z):
            raise RuntimeError('BD separator failed its criterion.')
        return _row('ACCEPT', adjustment.adjustment_estimand(x,y,Z,False) if x else _id_formula(H,actions,outcomes,trace)[0], {'Z':Z},
                    formula_tree=_tree(_adjustment_expression(x,y,Z) if x else ii.ObsKernel(ii._bindings(y))))
    safe('BD', bd)
    def ac():
        try:
            Z = adjustment.construct_minimum_adjustment_set(G, X, Y)
        except ValueError:
            return _row('NO_AC')
        return _row('ACCEPT', adjustment.adjustment_estimand(x,y,Z,False) if x else 'P(' + ', '.join(y) + ')', {'Z':Z},
                    formula_tree=_tree(_adjustment_expression(x,y,Z) if x else ii.ObsKernel(ii._bindings(y))))
    safe('AC', ac)
    if 'Z' in payload:
        Z = payload['Z']
        valid = isinstance(Z, list) and all(isinstance(v,str) for v in Z) and len(Z) == len(set(Z)) and set(Z) <= graph.observed_nodes(G)-set(X)-set(Y)
        for name, check in [('BD',adjustment.check_backdoor_criterion),('AC',adjustment.check_adjustment_criterion)]:
            criteria[name].update(supplied_status=('ACCEPT' if check(G,X,Y,Z) else 'REJECT') if valid else 'INVALID',
                supplied_Z=Z, supplied_scope='original graph and original query')
    def sbd():
        result = SBD.find_sbd(G,X,Y,max_orders=orders,max_seconds=remaining(),strategy='exhaustive')
        return _row(result.status, _render(_sbd_expression(result.witness)) if result.witness else None,
                    asdict(result.witness) if result.witness else None, searched=result.searched,
                    formula_tree=_tree(_sbd_expression(result.witness)) if result.witness else None)
    safe('SBD', sbd)
    def fd():
        witness = frontdoor.constructive_minimum_FD(G,X,Y)
        if witness:
            return _row('ACCEPT', frontdoor.frontdoor_estimand(x,y,witness['Z'],witness['C'],False),witness,
                        formula_tree=_tree(_fd_expression(x,y,witness['Z'],witness['C'])))
        result = frontdoor.find_conditional_fd(G,X,Y,max_candidates=256,max_seconds=remaining())
        witness = result.witness
        return _row(result.status, frontdoor.frontdoor_estimand(x,y,witness['Z'],witness['C'],False) if witness else None,witness,searched=result.searched,
                    formula_tree=_tree(_fd_expression(x,y,witness['Z'],witness['C'])) if witness else None)
    def singleton():
        if len(actions) > 1:
            return _row('UNSUPPORTED', reason='Tian 2002 supports one retained treatment.')
        if not tian.check_Tian_criterion(G,X,Y):
            return _row('NO_TIAN')
        witness = tian.tian_witness(G,X,Y)
        return _row('ACCEPT', witness.expression(),asdict(witness),formula_tree=_tree(_tian_expression(witness)))
    safe('Tian', singleton)
    criteria['gTian'] = dict(criteria['Tian'], alias='Tian; current verified singleton API')
    def wmc():
        result = tian.find_wmc(G,X,Y,max_orders=orders,max_seconds=remaining(),strategy='exhaustive')
        return _row(result.status,result.witness.expression() if result.witness else None,
                    asdict(result.witness) if result.witness else None,searched=result.searched,
                    formula_tree=_tree(_wmc_expression(result.witness)) if result.witness else None)
    safe('WMC', wmc)
    def product():
        if trace is None:
            return _row('UNSUPPORTED', reason='Generic ID input model is unsupported.')
        if trace[0] == 0:
            return _row('NO_PRODUCT')
        if not actions:
            return _row('ACCEPT', identification['formula'],{'blocks':[]},formula_tree=identification['formula_tree'])
        certificates, expressions, D, unknown = [], [], set(), False
        for path in trace[1].values():
            B = set(path[-1]); D.update(B)
            parents = graph.find_parents(G, B)
            result = SBD.find_sbd(G,parents,B,max_orders=orders,max_seconds=remaining(),strategy='exhaustive')
            if result.status == 'NO_SBD':
                return _row('NO_PRODUCT', witness={'rejected_block':sorted(B)})
            if result.status == 'UNKNOWN':
                unknown = True
            else:
                certificates.append(dict(block=sorted(B),parents=parents,certificate=asdict(result.witness)))
                expressions.append(_sbd_expression(result.witness))
        if unknown:
            return _row('UNKNOWN', witness={'accepted_blocks':certificates})
        expression = ii._marginal(ii.Product(tuple(expressions)), D-outcomes)
        return _row('ACCEPT',_render(expression),{'blocks':certificates},formula_tree=_tree(expression))
    def mc():
        nonlocal indexed
        if len(graph.observed_nodes(G)) > 18:
            raise NotImplementedError('Indexed MC is limited to 18 observed nodes; generic ID supports 50 total nodes.')
        ii._validate_graph(G)
        result = ii.identify_indexed(G,X,Y,complete_mc=True,max_orders=orders,max_mc_unions=unions,
            max_seconds=remaining(),max_expression_occurrences=50000)
        indexed = dict(status=result.status, formula_status=result.formula_status,
            formula=_render(result.expression,result.registry), literal_formula=_render(result.literal_expression,result.registry),
            mc_formula=_render(result.mc_expression,result.registry),mc_partition=result.mc_partition,
            formula_tree=_tree(result.expression,result.registry),literal_formula_tree=_tree(result.literal_expression,result.registry),
            mc_formula_tree=_tree(result.mc_expression,result.registry),
            mc_search_status=result.mc_search_status,selected_derivation=result.selected_derivation,indexing_status=result.indexing_status)
        status = result.mc_search_status if result.status != 'NOT_IDENTIFIABLE' else 'NO_MC'
        return _row(status,indexed['mc_formula'],{'partition':result.mc_partition,
            'certificates':[asdict(w) for w in result.mc_certificates]},formula_tree=indexed['mc_formula_tree'],reason=(
                'MC certificate is valid; formula expansion is unfinished.' if result.mc_search_status == 'ACCEPT' and result.formula_status == 'UNKNOWN'
                else 'MC failure excludes MC only; generic identification is a separate result.'))
    safe('MC', mc)
    if criteria['MC']['status'] == 'UNSUPPORTED':
        indexed = dict(status='UNSUPPORTED',formula=None,reason=criteria['MC']['reason'])
    safe('FD', fd)
    safe('Product', product)
    snapshot = dict(nodes=[dict(name=v,**G.nodes[v]) for v in G],edges=[list(edge) for edge in G.edges])
    return _json_ready(dict(snapshot=snapshot,query=query,identification=identification,criteria=criteria,indexed=indexed,
        budget=dict(max_seconds=seconds,max_orders=orders,max_mc_unions=unions,elapsed_seconds=perf_counter()-started)))


def graph_examples():
    """Fresh JSON graph snapshots from the exact source dictionary."""
    result = []
    for key, case in UCA_GRAPH_DICTIONARY.items():
        G = graph.create_acyclic_graph(case['graph'])
        G.add_nodes_from((v,{'observed':v in case['observed']}) for v in G)
        observed = list(nx.topological_sort(G.subgraph(case['observed'])))
        width = min(7,len(observed))
        positions = {v:(100+640*(i%width)/max(1,width-1),285 if len(observed)<=7 else 230+90*(i//width)) for i,v in enumerate(observed)}
        for i,v in enumerate(v for v in G if v not in case['observed']):
            positions[v] = (60+92*(i%9),45+70*(i//9))
        result.append(dict(id=key,title=case['title'],source=list(case['source']),
            nodes=[dict(name=v,observed=v in case['observed'],dimension=1,x=positions[v][0],y=positions[v][1]) for v in G],
            edges=[list(edge) for edge in G.edges],X=list(case['X']),Y=list(case['Y']),Z=list(case['Z'])))
    return result
