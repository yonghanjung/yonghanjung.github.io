import graph 

def _full_closure(G, starts, incoming=False):
	"""Reach all nodes, including hidden nodes, from a set of starting nodes."""
	reached, queue = set(starts), list(starts)
	neighbors = G.predecessors if incoming else G.successors
	while queue:
		for node in neighbors(queue.pop()):
			if node not in reached:
				reached.add(node)
				queue.append(node)
	return reached

def proper_causal_path(G, X, Y):
	"""Return PCP = (De_GbarX(X) - X) & An_GunderX(Y), in graph order."""
	de_X = _full_closure(graph.G_cut_incoming_edges(G, X), X)
	an_Y = _full_closure(graph.G_cut_outgoing_edges(G, X), Y, incoming=True)
	proper = (de_X - set(X)) & an_Y
	return [node for node in G if node in proper]


def descedent_proper_causal_path(G, X, Y):
	pcp = proper_causal_path(G,X,Y)
	descendants = _full_closure(G, pcp)
	return [node for node in G if node in descendants]


def check_backdoor_criterion(G, X, Y, Z):
	'''
	Raw supplied-witness predicate; causal-query entrypoints preprocess first.
	Check if Z satisfies the Back-door Criterion relative to X and Y in graph G.

	Parameters:
	G (nx.DiGraph): The original directed graph.
	X (list): Treatment variables.
	Y (list): Outcome variables.
	Z (list): List of variables to be checked for the Back-door Criterion.

	Returns:
	bool: True if Z satisfies the Back-door Criterion, False otherwise.
	'''

	# Step 1: Check if any element in Z is a descendant of any node in X
	descendants_of_X = graph.find_descendant(G, X)
	if any(z in descendants_of_X for z in Z):
		return False  # Z contains a descendant of X

	# Step 2: Check if Z d-separates X and Y in G with outgoing edges from X removed
	G_modified = graph.G_cut_outgoing_edges(G, X)
	if graph.is_d_separated(G_modified, X, Y, Z):
		return True  # Z d-separates X and Y in the modified graph

	return False

def _cut_proper_edges(G, X, pcp):
	changed = G.copy()
	changed.remove_edges_from([(x, child) for x in X for child in G.successors(x)
							   if child in pcp])
	return changed

def _prepare_adjustment(G, X, Y):
	"""Compute one query's proper graph and forbidden descendants once."""
	X, Y = list(X), list(Y)
	pcp = set(proper_causal_path(G, X, Y))
	return _cut_proper_edges(G, X, pcp), _full_closure(G, pcp)

def proper_backdoor_graph(G, X, Y):
	"""Copy G, preserving metadata, and cut X edges entering the PCP set."""
	X, Y = list(X), list(Y)
	return _cut_proper_edges(G, X, set(proper_causal_path(G, X, Y)))

def check_adjustment_criterion(G, X, Y, Z):
	"""Raw supplied-witness predicate; causal-query entrypoints preprocess first."""
	proper, forbidden = _prepare_adjustment(G, X, Y)
	return not forbidden.intersection(Z) and graph.is_d_separated(proper, X, Y, Z)

def construct_adjustment_set(G, X, Y):
	'''
	Construct an adjustment set for estimating the causal effect of X on Y.

	Parameters:
	G (nx.DiGraph): The directed graph representing the causal structure.
	X (list): Set of treatment variables.
	Y (list): Set of outcome variables.

	Returns:
	set: The set of nodes suitable for adjustment.
	'''

	G, X, Y = graph.preprocess_query(G, X, Y)
	# Candidate sets belong to this reduced query.
	X_set = set(X)
	Y_set = set(Y)
	dpcp = descedent_proper_causal_path(G, X, Y)
	dpcp_set = set(dpcp)

	# Assuming ancestor(G, nodes) is defined
	ancestors_XY = graph.find_ancestor(G, X_set.union(Y_set))
	ancestors_XY_set = set(ancestors_XY)

	# Construct the adjustment set
	adjustment_set = ancestors_XY_set - (X_set.union(Y_set).union(dpcp_set))
	return list(adjustment_set)

def check_admissibility(G, X, Y):
	'''
	Check if P(Y | do(X)) can be represented as a back-door adjustment.

	Parameters:
	G (nx.DiGraph): The original directed graph.
	X (list): Treatment variables.
	Y (list): Outcome variables.

	Returns:
	bool: True if P(Y | do(X)) can be represented as a back-door adjustment.
	'''
	G, X, Y = graph.preprocess_query(G, X, Y)
	adjustment_Z = construct_adjustment_set(G, X, Y)
	if check_adjustment_criterion(G, X, Y, adjustment_Z):
		return True
	return False 

def adjustment_estimand(X,Y,Z,latex):
	'''
	Generate the back-door adjustment formula "sum_{z}P(y | x,z)P(z)". 

	Parameters:
	G (nx.DiGraph): The original directed graph.
	X (list): Treatment variables.
	Y (list): Outcome variables.
	Z (list): Covariate variables 
	latex (bool): True if the output is in the latex syntax.

	Returns:
	string: "sum_{z}P(y | x,z)P(z)"
	'''
	Z = sorted(set(Z))
	Z_val = ', '.join(Z)
	Z_lower_val = ', '.join(char.lower() for char in Z)

	Y_val = ', '.join(Y)
	X_val = ', '.join(X)
	XZ = sorted(set(X).union(set(Z)))
	XZ_val = ', '.join(XZ)

	if not latex:
		if len(Z) == 0:
			adjustment_estimand = f"P({Y_val} | {X_val})"
		else:
			adjustment_estimand = f"\u03A3_{{{Z_lower_val}}}P({Y_val} | {XZ_val}) P({Z_val})"
	else:
		if len(Z) == 0:
			adjustment_estimand = f"P({Y_val} \\mid {X_val})"
		else:
			adjustment_estimand = f"\\sum_{{{Z_lower_val}}}P({Y_val} \\mid {XZ_val}) P({Z_val})"
	return adjustment_estimand

def construct_minimum_adjustment_set(G,X,Y):
	"""Return an inclusion-minimal observed adjustment list, possibly empty.

	Use the proper-backdoor reduction of van der Zander et al. (2014)
	and FINDMINSEPINDAG (2020). Minimal does not mean minimum cardinality.
	Raise ValueError when no observed adjustment set exists. Preserve G.
	"""
	G, X, Y = graph.preprocess_query(G, X, Y)
	proper, forbidden = _prepare_adjustment(G, X, Y)
	excluded = X | Y | forbidden
	allowed = [node for node in G if node not in excluded
			   and G.nodes[node].get("observed", not node.startswith("U"))]
	Z = graph.find_minimal_d_separator(proper, X, Y, restricted=allowed)
	if Z is None:
		raise ValueError("No observed adjustment set exists for this query.")
	if forbidden.intersection(Z) or not graph.is_d_separated(proper, X, Y, Z):
		raise RuntimeError("Minimal adjustment set failed its criterion check.")
	return Z

