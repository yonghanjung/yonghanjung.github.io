# CausalEngine 0.1.0

Browser beta: https://yonghanjung.me/experimental-lab/ . It computes on your device; Python installation is optional for the native package below.
CausalEngine bundles the Causal Science Lab graph editor, simulation engine and graph identification tools. Draw a graph and check identification without data. Estimate a mean difference from a mapped numeric CSV or optional Random Data. Random Data examples are simulations, not evidence of an effect in a real school or hospital.

## Choose how to run it

- **Browser app:** the browser runs Python through Pyodide on the visitor's own CPU and memory. No Python installation is required on the visitor's computer. CSV parsing and estimation happen in the browser, without sending the selected rows to a computation server. Internet access is needed on first load to download the Pyodide runtime and numerical libraries.
- **Python API / command line:** install Python and the package dependencies on your own computer using the steps below. This executes Python locally.
- **Locally hosted browser app:** `causalengine serve` serves the bundled files locally; the browser still uses Pyodide and requires its CDN downloads. This is not a fully offline browser bundle.

The browser product is branded CausalEngine. The preserved upstream implementation was called CausalPy. This package is a local release artifact; it has not been published to PyPI. Do not use an unqualified `pip install causalengine` command.

## Requirements

Python **3.12 is recommended and was tested**. The source uses Python 3.10 syntax, so the declared minimum is Python 3.10; the full range has not been tested. Use a 64-bit Python installation with available NumPy, SciPy, pandas and NetworkX wheels. Core dependencies are `numpy>=1.24`, `scipy>=1.10`, `pandas>=1.5`, and `networkx>=3.0`. pip installs these for you.

## Install the downloaded wheel

Install Python 3.12 from python.org (or your normal Python manager). In a terminal, open the folder containing the downloaded wheel.

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install ./causalengine-0.1.0-py3-none-any.whl
python -c "import causalengine; print(causalengine.__version__)"
```

On Windows use `py -3.12 -m venv .venv`, then `.venv\Scripts\Activate.ps1` in PowerShell (or `.venv\Scripts\activate.bat` in Command Prompt). The remaining commands use `python`. If activation is restricted, call `.venv\Scripts\python.exe -m pip ...` directly.

## Install the downloaded source

Extract `causalengine-0.1.0-source.zip` or `causalengine-0.1.0.tar.gz`, open a terminal inside the extracted folder containing `pyproject.toml`, and create/activate a virtual environment as above. Then run:

```sh
python -m pip install --upgrade pip
python -m pip install .
```

For editable development, use `python -m pip install -e .`. Run `python -m unittest discover -s tests -v` from the extracted source to check the supported package workflow.

## Run a complete example

```sh
python -m causalengine demo
python -m causalengine demo --rows 2048 --data-seed 5
```

The example creates a **binary** action `A`, a simulated outcome `Y`, a measured background variable `X`, and a hidden input `U`. Think of `A=1` versus `A=0` as offering versus not offering tutoring in this artificial world. Generated `Y` values are not real exam scores and are not constrained to a 0–100 scale.

The JSON output includes generated row count, columns, a small preview, and a comparison:

- `data_estimate`: an approximate estimate computed from the generated observed sample. Read `status` and any `info`, `warning`, or `reason` before interpreting values.
- `scm_reference`: the value calculated from the known rules of the simulated world. Some supported settings have an exact result; others use approximate Monte Carlo calculations.
- `difference`: estimate minus model reference when both are available. This is not a confidence interval.

A weak-coverage warning means nearby sample cases are sparse for part of the requested comparison. More rows do not guarantee that the warning disappears or the error shrinks. `UNKNOWN` means the requested calculation or search was not completed; it does not establish that an effect is impossible to identify.

## Python API

```python
from causalengine.demo import run_demo

result = run_demo(rows=512, data_seed=5)
print(result["comparison"]["data_estimate"])
print(result["comparison"]["scm_reference"])
```

For the complete `Editor.request("build" / "sample" / "compare")` sequence, see `src/causalengine/demo.py`. The installed API also exports `Editor`, `SCM`, `U`, `build_scm`, `analyze`, and `graph_examples`. Use `examples/tutoring.py` for a runnable script.

```python
from causalengine import analyze

answer = analyze({
    "nodes": [{"name": "A", "observed": True}, {"name": "Y", "observed": True}],
    "edges": [["A", "Y"]], "X": ["A"], "Y": ["Y"],
    "Z": [], "max_seconds": 3,
})
print(answer["identification"]["status"])
```

### Data-only estimation API

`load_data` takes a graph, selected numeric rows and an explicit variable-to-header mapping. It does not construct an SCM. Reuse its `data_id` for each outcome; a new load invalidates the old ID, including when replacement validation fails. A mapping value can be a single header or an ordered list of headers defining the full vector of a baseline covariate node. List bindings require the returned `binding_key` in each estimate request. The public graph, its node dimensions, names, arrows and roles are not rewritten by these bindings.

```python
from causalengine import Editor

editor = Editor()
graph = {
    "nodes": [{"name": "A", "family": "binary"}, {"name": "Y", "family": "linear"}],
    "edges": [["A", "Y"]],
}
# Illustrative numeric rows, not an actual study.
ready = editor.request("load_data", {
    **graph, "columns": ["assignment", "score"],
    "mapping": {"A": "assignment", "Y": "score"},
    "rows": [[i % 2, 10 + 3 * (i % 2)] for i in range(512)],
})
answer = editor.request("estimate_data", {
    **graph, "source": "csv", "data_id": ready["data_id"],
    "type": "interventional", "summary": "mean_difference", "targets": ["Y"],
    "intervention": {"A": 1}, "reference": {"A": 0}, "Z": [], "max_seconds": 10,
})
print(answer["data_estimate"])  # status OK, Y mean difference 3 for these rows
```

For example, on the existing graph `X → A`, `X → Y`, `A → Y`, use `mapping={"X": ["x1", "x2"], "A": "assignment", "Y": "score"}`. `load_data` returns the ordered members, dimension and per-component types/codebooks under `bindings["X"]`; pass `binding_key=ready["binding_key"]` to `estimate_data`. This defines the logical node X as the whole tuple `(x1, x2)` without adding causal nodes. Every cluster must belong to an actually verified Back-door/Adjustment-criterion witness and be a non-descendant of every selected treatment. Cluster actions/outcomes and unsupported graph bindings return `UNSUPPORTED`; no alternative graph or estimator fallback is substituted. Optional `column_types` and `column_codebooks` retain mixed continuous/binary/nominal member domains; scalar types must match the graph. Codebooks require finite, unique numeric keys covering observed codes. Nominal cluster members require explicit `categorical_encoding="one_hot"`.

For Random Data, first use the existing `build` and `sample` actions, then call `estimate_data` with `source="random"`, the returned `token` and `sample_id`, the current graph, and the same query fields. This path also returns only `data_estimate`; it never invokes the model-reference calculation. The separate legacy `compare` API and `demo` command retain their simulation/reference workflow. Current data-only requests support one observed scalar outcome at a time and fixed interventional mean differences without factual evidence. Unsupported requests abstain with a status/reason.

### Baseline binary Mean difference: actual estimation method

`estimate_data` now selects **2-fold balancing-weight AIPW (regularized entropy calibration)** only for one scalar binary treatment, one scalar outcome, fixed 0/1 regimes, no factual evidence, and an actually verified baseline Back-door/Adjustment-criterion witness. All adjustment nodes must be treatment non-descendants. Graph assumptions are supplied by the user; they are not discovered or verified from the CSV. Other supported queries retain their existing kNN g-computation or general-ID kernel plug-in method, identified by the actual returned `method`. A nuisance-fit failure within the new branch returns `UNKNOWN` with no value; there is no silent kNN fallback. The optional request field `estimation_method="legacy_knn"` explicitly selects the original graph plug-in estimator; `"auto"` is the default. This is a user choice, never an automatic response to a failed balancing fit. The actual method can be kNN adjustment or a general-ID kernel plug-in according to the graph. `estimation_details.requested_method` records this choice and the copied replay request retains it. The separate legacy `compare`, `run_demo` and CLI `demo` still use the original sample estimator and model-reference workflow. Inspect their actual method labels; they do not demonstrate the new baseline estimator.

The actual numerical implementation is `causalengine/balancing_aipw.py`, mirrored byte for byte as `web/balancing_aipw.py` for the browser worker. `data_estimate.estimation_details` records its source SHA256, callable entry, exact current CSV column recipes (including full one-hot indicators), contrast, split seed, options and fold diagnostics. The website's Details copies this actual source and a script using the same retained CSV; no model or benchmark truth enters either nuisance fit. This source can also be pasted into an `exec`/notebook context without a source file: computation works and its unverifiable source SHA is explicitly `null`.

For each of two treatment-stratified folds, preprocessing and both nuisance fits use the training rows only. The basis consists of every supplied standardized covariate coordinate and its coordinatewise square, centered/scaled using training rows. There are no pairwise interaction terms. Arm-specific ridge least squares uses averaged squared loss with fixed penalty **0.001** on slopes and an unpenalized intercept. Binary outcomes use the same least-squares nuisance, so this is not logistic regression.

For each arm separately, direct positive inverse weights are learned by regularized entropy calibration to the **whole training cohort (ATE target)**, not the treated cohort. For training basis B, slopes theta minimize `logsumexp(B_arm @ theta) - mean(B_train) @ theta + 0.01/2 * ||theta||^2`. The inverse-weight function is `alpha_a(b) = n_train * exp(b @ theta) / sum_train_arm(exp(B @ theta))`. Its training weighted arm mass is n_train, and selected moment imbalance equals the slope-penalty gradient up to solver tolerance. This fits two direct inverse-weight functions, not a separately fitted coherent propensity probability. Heldout weights reuse the training normalizer; there is no heldout normalization or weight clipping.

The heldout score is `m1 - m0 + I(A=1)*alpha1*(Y-m1) - I(A=0)*alpha0*(Y-m0)`. Its raw average over **all n rows** estimates the 1-versus-0 contrast; reverse regimes change its sign and identical regimes give zero. Fixed two-fold seed and options are recorded. Neither regularization nor basis selection uses the evaluation reference. Small arm samples, solver/nonfinite/deadline failures, training moment imbalance above 0.5, heldout arm ESS below `max(10, 0.05*n_arm)` or normalized weight share above 0.20 return no estimate. Lesser ESS/concentration/mass/balance issues warn. All limits are engineering diagnostics, not a proof of positivity. Finite basis and fixed regularization can leave misspecification bias; no unconditional double robustness, finite-sample unbiasedness or confidence interval is claimed. `estimation_details` exposes the actual fits and diagnostics for the current run.

Direct observed-data use, after verifying the required graph/causal assumptions:

```python
import numpy as np
from causalengine.balancing_aipw import estimate_balancing_aipw

# Z has one column per actual covariate coordinate; A and Y are observed rows.
# Full one-hot encoding is required for nominal covariates; keep all levels.
result = estimate_balancing_aipw(Z, A, Y, seed=5,
                                intervention=1, reference=0, max_seconds=10)
print(result["status"], result.get("estimate"), result.get("reason"))
```

### Random Data model reference

After `build` and `sample`, call `Editor.request("sample_reference", {...graph, "source": "random", "token": built["token"], "sample_id": sampled["sample_id"], "type": "interventional", "summary": "mean_difference", "targets": ["Y"], "intervention": {"A": 1}, "reference": {"A": 0}, "Z": [], "n": 2048, "max_seconds": 10})`. This optional, separate call reuses the fixed generated model and validates the sample snapshot, including `random_key` when an explicit Random cluster is active. It does not change or replace the stored observed sample. The result's `model_reference` uses the existing reference calculator for scalar models: `reference_kind="exact_model_mean"` marks a verified analytic expectation; `"monte_carlo_model_mean"` is an approximate model reference, not an exact truth. Explicit vector Random clusters use the existing `sample_interventional` API for two paired, no-evidence intervention worlds of the same fixed model, returning the mean paired difference and its Monte Carlo standard error. This narrow branch avoids unnecessary conditional-density evaluation during unconditional sampling; the original reference calculator is unchanged. Unavailable calculations stay unavailable. This target is the generated model's population mean contrast; it is separate from benchmark released-row references and the estimate learned from observed rows.

The browser's Random Data seed controls the generated rows. Its model seed controls the generated mechanisms. Sample CSV download and observed-data estimation reuse the stored sample's token/sample ID. `sample_reference` returns these IDs, the stored `source_seed`, and a separate `reference_seed` obtained by XOR with `0xA5A5A5A5`, so Monte Carlo reference draws are not observational sample draws. `reference_draws` is zero for the analytic path; `reference_requested_draws` records the requested Monte Carlo budget. The CSV estimation path does not request a model reference.

### Random baseline vectors, dimensions 1–50

Keep the public graph node X at dimension 1 and add `random_cluster_sizes={"X": 25}` to the existing `build` payload. Optional `random_cluster_members={"X": [f"x{i}" for i in range(1, 26)]}` supplies the exact ordered physical headers; its length must equal the selected dimension. Default headers are `x1` through `xp` for X, or `name_1` through `name_p` for another covariate. Dimension 1 defaults to the original scalar header X. The adapter creates a real private vector using the existing SCM mechanisms/noise, while public node names, arrows, positions and question remain intact. It accepts observed continuous baseline covariates with explicit continuous mechanism families. Actions and outcomes stay scalar; verified Back-door/Adjustment-criterion and non-descendant guards prevent treating post-treatment vectors as baseline adjustment. All generated components enter the existing observed-data estimator through the whole-node schema. This does not assert every component has a nonzero causal effect in every mechanism family.

`build` returns `random_key` and `random_bindings` alongside the token/model. Echo the returned key in `sample`, `estimate_data` and `sample_reference` requests. Sample, CSV, per-outcome estimates and model reference share the same token/sample ID and ordered bindings. A stale key, graph, shape or sample is an error. General `build_scm`/identification dimension caps remain eight; this is a private, bounded baseline-generation adapter, not a global dimension-limit change.

Generated samples retain 1–5,000 rows, at most 100 physical columns and 500,000 cells. Vector model references use at least 256 requested draws, at most 10,000, with both complete intervention frames together bounded to 500,000 cells. High-dimensional references default to 512 draws; their actual draw count and Monte Carlo standard errors are returned independently of the observed Records count. Deadline exhaustion exposes no partial reference value. Native mechanism Apply preserves the actual vector shape/members and returns a new token/key; it clears the old sample. Only after a successful Apply are the stored public family/type and snapshot keys synchronized. Failed Apply keeps the previous model, keys and data; a binary family for the continuous baseline cluster is rejected.

Keep graph/model assumptions and returned statuses when using results. The application does not automatically discover causal relationships from arbitrary uploaded data.

## Launch the bundled browser app locally

```sh
python -m causalengine serve --port 8766
```

Open **http://127.0.0.1:8766/** in a browser. Leave the terminal running. Press Ctrl+C to stop. The server binds to your own computer by default. On the first screen, choose a **Causal structure**, enter treatment, covariate and outcome names, then select **Update graph**. Review or edit the proposed arrows. **Identify** checks the supplied graph without a dataset or simulated model. For **Estimate**, upload a CSV and bind numeric columns to the existing observed variables, or choose **Random Data**. A baseline covariate can bind an ordered group of columns as a cluster while retaining the graph. Both estimate paths use observed rows only and do not calculate a simulated-model reference. Multiple outcomes are processed separately on the same dataset. Blank role fields create no variables; a graph can remain a draft until treatment and outcome roles are supplied. Front-door has a separate Mediators field.

CSV estimation accepts scalar treatments/outcomes and scalar or ordered-vector baseline covariates (including explicitly coded nominal members), 1–5,000 rows, at most 100 physical selected columns and 500,000 selected cells. Every selected source column belongs to exactly one variable/member. The authoritative data binding records the whole tuple even when the public graph node keeps its existing dimension. Cluster estimation requires a verified Back-door/Adjustment-criterion witness; unsupported Front-door/Sequential bindings abstain. Identification and the general public model builder keep their existing 1–8 node-dimension limit. A separate Random baseline adapter supports 1–50 actual continuous components without changing the public logical graph. Binary variables and binary actions require 0/1. Missing, nonnumeric, nonfinite or malformed selected cells are errors; rows are not dropped, imputed or silently coerced. Unused CSV columns can contain text because the browser sends only selected columns. A changed graph, variable type or mapping requires a fresh data load. Fewer than 128 rows can be loaded, but the estimator returns an insufficient-data status. Estimates are approximate; no standard error or confidence interval is provided.

For **No unmeasured confounding -- Sequential**, add or remove time points and enter covariates before treatment and outcomes afterward at each time. The template includes forward history connections as explicit, editable assumptions; it does not infer relationships from names. Later covariates are not pooled into a single baseline adjustment set. Full history is the default; Markovian order limits direct cross-time arrows by the displayed Time ID lag. Blank or removed gaps still count, and indirect paths may span several times. Node & model settings opens on the right while keeping left inputs in place. It retains functions, seeds, JSON inputs and detailed queries. The local guide and examples/support page match the website.

Names must be unique ASCII identifiers beginning with a letter, followed by letters, digits or underscores. The role builder reserves the `U` prefix for hidden roots. The engine accepts at most 100 variables including hidden roots; this is a build limit, not a promise of fast or available estimation for every large model. Auto arrange changes positions and edge routes, not causal relationships.

The native observed-data Mean difference request accepts **one outcome node per request**. The browser uses the same uploaded dataset or generated sample for separate `estimate_data` calls, preserving each outcome's status, value and warning. For fixed Interventional comparisons without factual evidence, the browser can omit selected actions that are not ancestors of the individual outcome in the drawn graph; the graph and data are unchanged. Each result names its computed actions. If none of the selected actions is an ancestor of an outcome, both reduced regimes are empty and the same-data mean contrast is zero under the supplied graph. This conclusion depends on the graph assumptions, not on automatic discovery from the CSV. Inspect the outcome-specific query and status.

Small native checks covered optional covariates, arbitrary valid names, multiple outcome queries on one sample, conditional Front-door with a baseline covariate, and two-/three-stage Sequential graphs. These do not guarantee an estimate for every edited graph. Front-door and Sequential Back-door can show weak-coverage warnings. A criterion accepted in a supplied graph does not verify its real-world assumptions. An unavailable data estimate remains unavailable; the browser never substitutes the known simulated-model answer.

**Not implemented:** IV with Monotonicity, IV numerical bounds, Difference-in-Differences and Synthetic Control estimators or assumption-enforcement workflows. Drawing a graph alone does not add those capabilities. The native `demo` command above remains its separate simulated tutoring example.

The native Python demo does not require Pyodide or a browser. The browser app downloads Pyodide from jsDelivr even when served locally.

## Data preview, download and benchmarks

After Random Data is generated, **Head** and **Download CSV** reuse that stored sample and its token/sample ID; they do not resample. Uploaded CSV previews/downloads use the selected dataset snapshot. Inspect the displayed source and row count before running an estimate.

The benchmark picker supplies actual factual analysis tables with source/version/checksum metadata under `web/benchmarks/manifest.json`:

- **IHDP · CEVAE replication 1:** all 747 rows and 25 original covariates, with the factual semi-synthetic outcome. Counterfactual and expected-potential-outcome columns are excluded.
- **LaLonde · NSW experimental (DW subset):** all 185 treated and 260 experimental controls, eight pre-treatment covariates, and factual 1978 earnings. This is not an NSW+CPS observational comparison.
- **ACIC 2016 · causallib set 1:** all 4,802 rows and 58 original covariates from the pinned distributed `x.csv` and `zymu_1.csv`. The factual outcome selects only the assigned noisy potential outcome. No organizer parameter/replicate identity beyond this distribution is invented.

Select a benchmark, then choose **Download CSV** or **Estimate**. Download CSV saves its complete factual table. Estimate binds the treatment and factual outcome to the existing scalar action/outcome and all released covariates to the existing baseline covariate cluster, then uses the data-only estimator. The current graph's nodes, dimensions, arrows, positions, roles and question are preserved; only a separate member-binding annotation changes. For the default triangle this defines X as all 25 IHDP, eight NSW or 58 ACIC covariates. The graph remains the user's causal assumption; it is not discovered from the dataset. A graph requiring an unbound mediator, additional action or time-specific variable is kept and reported unsupported rather than replaced. Choosing Random Data explicitly clears the CSV cluster binding and returns to the graph's original mechanism dimensions.

ACIC's three nominal covariates retain numeric codes and reversible label codebooks in the source table and cluster-binding metadata. For estimation, its explicit `categorical_encoding="one_hot"` option uses all K category indicators in a temporary feature view and the selected observed-data estimator. The eligible binary baseline branch uses balancing-weight AIPW; other queries retain the existing estimator. No categories, original covariates or rows are dropped; indicators are not extra causal nodes. The estimator standardizes its features, so this does not promise equal category distances, an encoding-invariant estimate or statistical validity. Categorical actions/outcomes abstain. This is a data-only covariate view; Random Data uses the existing mechanism families and does not add a categorical sampler. The temporary dense view is bounded to 100 total columns and 500,000 cells before allocation.

`web/benchmarks/ground-truth.json` contains aggregate evaluation references separately from the factual CSVs. IHDP's reference is **4.016066896118338** over its 747 rows; ACIC's is **2.1280792580310415** over its 4,802 rows. Each is the average of the source `mu1 - mu0` conditional-mean contrasts for the released covariate rows, under treatment 1 versus 0. This is not a population ATE or the average of noisy realized potential-outcome differences. The JSON records pinned sources, hashes, definitions and exact row-alignment checks. LaLonde's real experimental records do not supply a known unit-level truth; a trial estimate is not relabeled as ground truth. The UI matches treatment/outcome bindings and the requested contrast before showing a benchmark reference. Truth metadata never enters CSV column mapping or estimation.

The app also includes `web/examples/upload-cluster.csv`, a synthetic upload example with scalar A/Y and named covariate members. Its field explanation distinguishes demonstration data from a real benchmark. Named members describe the whole data tuple without new causal nodes. Random Data can generate 1–50 actual continuous baseline components through the bounded adapter below; CSV declarations and bindings remain separate from the generated model.

The original exact categorical-stratum estimator can abstain on sparse ACIC strata; that diagnostic is retained in validation reports. The full one-hot feature view is an explicit approximation choice. Preserve returned coverage warnings and statuses.

Dataset terms are separate from the engine's MIT notice. ACIC's distributed **CDLA-Sharing-1.0** license and provider README are included under `web/benchmarks/`. The IHDP archived source contains no explicit license; the official LaLonde provider acknowledges permission to publish there without stating a general license. Source hashes and exact transformations are recorded for this local prototype; this package is not a public dataset-hosting clearance.

Identification also returns a bounded observational formula tree expanded from its existing successful ID trace. The display jointly averages any algebraically redundant free evaluation contexts using their observational marginal, with fresh bound variables. This is display metadata only; it does not add evidence/adjustment or alter the identification decision or estimation algorithm. Conditional densities and ratios still require their usual support/positivity conditions. Display unavailability does not change an identifiable status.

## Troubleshooting

- **Python or pip not found:** install Python 3.12 and use `python3.12 -m pip`; on Windows use `py -3.12 -m pip`.
- **ModuleNotFoundError:** use the same virtual environment for installation and execution; run `python -m pip show causalengine` and `python -c "import sys; print(sys.executable)"`.
- **A dependency tries to compile:** use a supported 64-bit Python 3.12 installation and upgrade pip so available binary wheels are recognized.
- **Port already in use:** choose `--port 8767`.
- **Browser preparing calculator / CDN error:** allow internet access to `cdn.jsdelivr.net`, then reload. Installing system Python does not fix a blocked Pyodide CDN.
- **Missing sample or expired model:** regenerate the sample after changing graph/function/model settings.
- **Warning or unavailable sample estimate:** inspect the reported status/reason; do not treat a model reference as an estimate learned from real data.

## Source, provenance and scope

Original source: https://github.com/yonghanjung/yonghanjung.github.io/tree/d3d36fb7f5d9f14e4eaa29df085c55becd553788/experiment-lab/causalpy . The public service is https://yonghanjung.me/experiment-lab/causalpy/ . There was no verified standalone `yonghanjung/experiment-lab` repository.

`upstream/` preserves all 14 files byte-for-byte. `PROVENANCE.json` records their source URLs and SHA-256 hashes. Packaged Python files adapt sibling imports to the `causalengine` namespace and update two module-identity checks needed by that namespace. A deliberate `editor_engine.py` adapter extension adds validated CSV dataset state, whole-node ordered covariate bindings with snapshot keys, verified adjustment guards, and data-only estimation actions. A separate `sample_reference` action adds validated model references for the current Random Data snapshot, with a bounded paired-interventional-sampling delegate for explicit private vectors. The Random baseline adapter injects validated 1–50 component private shapes while preserving public graph limits; the original SCM, registry and legacy estimator functions are preserved; eligible baseline `estimate_data` requests select the additional balancing-weight routine above. It calls the existing observed-data estimator without changing its algorithms. The local web copy uses the lab website theme, variable-role/timeline builder, graph-first Identify/Estimate screen, CSV mapping, per-outcome results, model editor, logo and local guide. HTML navigation is adapted for standalone serving. The browser worker routes the new data actions and loads their dependencies; browser `editor_engine.py` contains the same data-only and categorical-feature adapter. `identification_engine.py` adds bounded observational-tree display metadata and raises the public graph limit to 100; ID decisions and algorithms are unchanged. The other 10 browser Python files remain byte-identical to the preserved upstream originals. Neither upload estimation nor Random Data estimation substitutes an SCM reference.

The upstream repository MIT `LICENSE` is preserved verbatim, including its site-template copyright notice. No new ownership attribution is asserted here. Check project-specific licensing before a public package release. This local package does not constitute a PyPI release.

The supported workflow is the browser editor plus the API/CLI shown here. The source also contains older optional plotting/regression adapters whose extra libraries and external engines are not bundled or supported by this minimal distribution. They are not required by the editor, demo or identification workflow.
