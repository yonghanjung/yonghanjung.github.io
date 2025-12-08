---
title: "More Covariates May Hurt Ignorability"
date: 2025-10-03
description: "In realistic data with complex dependence among covariates, adding variables can reduce the plausibility of ignorability by activating collider paths. A small ADMG simulation makes this precise."
tags: [causal inference, ignorability, m-connection, colliders]
layout: post
math: true
canonical_url: https://yonghanjung.me/blog/
# repo: https://github.com/yonghanjung/FD-CATE
toc: true
related_posts: false # ← hides the ‘Enjoy Reading…’ section
---

There have been a widespread quote in causal inference

<p align="center"><i>More covariates make the ignorability (a.k.a., no unmeasured confounders) assumption more plausible.</i></p>

In this blog post, we claim that this widely believed quote is generally not true, through simple simulations. When covariates exhibit complex dependence, adding more variables increases the chance that conditioning opens spurious paths (through colliders or descendants of colliders), thereby violating ignorability. Below I make this precise with a minimal simulation.

<!-- prettier-ignore -->
<div style="margin-top:25px"></div>
<!-- prettier-ignore -->
---
<!-- prettier-ignore -->
<div style="margin-top:25px"></div>

## 1. Preliminaries

- **Variables.** Treatment $T\in \{0,1\}$, outcome $Y\in\mathbb{R}$, covariates $\mathbf X=\{X_1,\ldots,X_d\}$.
- **Potential outcomes.** $Y(t)$ is the outcome under intervention $T=t$.
- **Ignorability (unconfoundedness).** $Y(t)\perp T\mid \mathbf X$ for $t\in\{0,1\}$.
- **Causal Graph.** A graph with directed edges $\to$ and bidirected edges $\leftrightarrow$, which stands for latent confounding between variables.
- **m-connection.** [1] A path is open a set $S$ when every non-collider internal node is not in $S$ and every collider internal node is in the ancestor set $\mathrm{An}(S)$. If there exists an open path between $T$ and $Y$ given $\mathbf X$ (other than $T\to Y$), the ignorability condition fails; i.e., $Y(t) \not \perp T\mid \mathbf X$.

<!-- prettier-ignore -->
<div style="margin-top:25px"></div>
<!-- prettier-ignore -->
---
<!-- prettier-ignore -->
<div style="margin-top:25px"></div>

## 2. Simulation design

To simulate the complicated dependence structure between covariates, we generate random causal graphs on nodes $\{T, X_1,\ldots,X_d, Y\}$ with edges either $\to$ or $\leftrightarrow$, subject to rules that mimic realistic covariate dependence:

1. $T\to Y$ is always present; $T\leftrightarrow Y$ is never present.
2. For every other unordered pair, include _exactly one_ edge: directed with probability $p\in(0,1)$ or bidirected with probability $1-p$.
3. Each $X_i$ attaches to $T$ as either $X_i\to T$ or $T\leftrightarrow X_i$.
4. Each $X_i$ attaches to $Y$ as one of $X_i\to Y$ or $X_i\leftrightarrow Y$.
5. Every $X_i$ has an edge to $T$ or $Y$.
6. For every pair $(X_i,X_j)$, include a directed edge (orientation by a random total order to avoid cycles) with probability $p$, else a bidirected edge.

This rule mimics the practical custome that covarariates that are correlated with treatments or outcomes are collected (Rule 3-5), and complicate dependencies between covariates (Rule 6).

For each simluation round, we check if $T$ and $Y$ are m-connected given $\mathbf X$, via a path that does not use the direct edge $T\to Y$?\* If yes, ignorability fails.

<!-- prettier-ignore -->
<div style="margin-top:25px"></div>
<!-- prettier-ignore -->
---
<!-- prettier-ignore -->
<div style="margin-top:25px"></div>

## 3. What the pictures show

![Heatmap: probability that ignorability fails](figures/dconnection_heatmap.png)

![Lines: the same probability across $p$ for selected $d$](figures/dconnection_lines.png)

**Reading the figures.**

- **Fix $p$ (edge directedness).** The failure rate **increases with $d$**. More covariates $\Rightarrow$ more opportunities to form collider chains that open when conditioning on $\mathbf X$.
- **Fix $d$.** The failure rate **decreases** as $p$ increases, because fewer bidirected edges $\leftrightarrow$ means fewer latent-common-cause links that create harmful collider structures.

In short: the slogan _more covariates $\Rightarrow$ more plausible ignorability_ is false in general once covariates are richly dependent.

The slogan implicitly assumes that covariates are benign: pre-treatment, not colliders, not influenced by treatment, and not descendants of colliders. Real data rarely oblige. As $d$ grows under complex dependence:

- The chance that **at least one collider or its descendant** is included rises.
- Conditioning on $\mathbf X$ then **opens** paths between $T$ and $Y$ that were previously closed.
- The presence of bidirected edges $\leftrightarrow$ (latent confounding) makes such openings especially likely.

Therefore, **indiscriminate** addition of covariates can **reduce** the plausibility of ignorability.

<!-- prettier-ignore -->
<div style="margin-top:25px"></div>
<!-- prettier-ignore -->
---
<!-- prettier-ignore -->
<div style="margin-top:25px"></div>

## 5. Practical guidance

- **Structure-aware adjustment.** Prefer DAG-guided sets or identification-theory tools over “adjust for everything.”
- **Avoid post-treatment and collider variables.** Be cautious with variables strongly associated with both $T$ and $Y$; predictiveness is not causality.
- **Check overlap and perform sensitivity analyses.** Even with a good set, lack of positivity and modest hidden bias can dominate uncertainty.
- **Report diagnostics.** Show assumptions, candidate adjustment sets, and sensitivity to exclusions/inclusions.

## References

[1] Richardson, Thomas, and Peter Spirtes. "Ancestral graph Markov models." The Annals of Statistics 30.4 (2002): 962-1030.

[2] Judea Pearl. _Causality: Models, Reasoning, and Inference._ 2nd ed., Cambridge University Press, 2009.
