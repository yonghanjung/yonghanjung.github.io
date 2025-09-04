---
layout: post
title: "Analyzing R-Learner and DR-Learner with Orthogonal Statistical Learning"
date: 2025-09-04
categories: [CATE]
tags: [orthogonal-statistical-learning, DR-learner, R-leraner, CATE]
description: "Abstract and overview of our short note on orthogonal losses, with PDF attached."
toc: true
related_posts: false # ← hides the ‘Enjoy Reading…’ section
---

## Abstract

This is a study note and possible simplification of the error analysis of the _R-learner_ [Nie and Wager, 2021](https://academic.oup.com/biomet/article-abstract/108/2/299/5911092) and the _DR-learner_ [Kennedy, 2023](https://projecteuclid.org/journals/electronic-journal-of-statistics/volume-17/issue-2/Towards-optimal-doubly-robust-estimation-of-heterogeneous-causal-effects/10.1214/23-EJS2157.full), using the _Orthogonal Statistical Learning (OSL)_ framework of [Foster and Syrgkanis,2020](https://projecteuclid.org/journals/annals-of-statistics/volume-51/issue-3/Orthogonal-statistical-learning/10.1214/23-AOS2258.full). Unlike the original OSL work, I provide a doubly robust error bound for the DR-learner. Furthermore, I show that it is sufficient to assume only the first-order optimality condition and the strong convexity of the risk function in order to establish that the CATE parameter exhibits quadratic or mixed-bias dependence on the nuisance estimation error.

## Citation

If you use or refer to this note, please cite as:

> Yonghan Jung, _A Short Note on Empirical Excess Risk for Orthogonal Losses_, 2025.

## PDF

You can read the full technical note with all derivations and proofs here:

[📄 Download PDF](/assets/pdf/2025-09-04-OSL.pdf)
