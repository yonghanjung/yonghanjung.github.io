# CausalEngine 0.1.0

Browser beta: https://yonghanjung.me/experimental-lab/ . It computes on your device; Python installation is optional for the native package below.

[Methods & nuisances](https://yonghanjung.me/experimental-lab/methods.html) is the canonical implementation reference: exact nuisance fits, graph-dependent legacy branches, failure rules, encoding, source code and uncertainty distinctions. The same `web/methods.html` is bundled with this package and opens at `/methods.html` when you run the local server. Hover/focus the app’s question-mark controls for brief definitions and follow the full-document links for the complete recipe.
CausalEngine bundles the Causal Science Lab graph editor, simulation engine and graph identification tools. Draw a graph and check identification without data. Estimate a mean under one intervention (APO) or a mean difference (ATE) from a mapped numeric CSV or optional Random Data. Random Data examples are simulations, not evidence of an effect in a real school or hospital.

## Choose how to run it

- **Browser app:** the browser runs Python through Pyodide on the visitor's own CPU and memory. No Python installation is required on the visitor's computer. CSV parsing and estimation happen in the browser, without sending the selected rows to a computation server. Internet access is needed on first load to download the Pyodide runtime and numerical libraries.
- **Python API / command line:** install Python and the package dependencies on your own computer using the steps below. This executes Python locally.
- **Locally hosted browser app:** `causalengine serve` serves the bundled files locally; the browser still uses Pyodide and requires its CDN downloads. This is not a fully offline browser bundle.

The browser product is branded CausalEngine. The preserved upstream implementation was called CausalPy. This package is a local release artifact; it has not been published to PyPI. Do not use an unqualified `pip install causalengine` command.

## Requirements

Python **3.12 is recommended and was tested**. The source uses Python 3.10 syntax, so the declared minimum is Python 3.10; the full range has not been tested. Use a 64-bit Python installation with available NumPy, SciPy, pandas and NetworkX wheels. Core dependencies are `numpy>=1.24`, `scipy>=1.10`, `pandas>=1.5`, `networkx>=3.0`, and **`xgboost==2.1.4`**. pip installs these for you. XGBoost uses its actual core DMatrix/train API; no scikit-learn substitute is used.

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

For example, on the existing graph `X → A`, `X → Y`, `A → Y`, use `mapping={"X": ["x1", "x2"], "A": "assignment", "Y": "score"}`. `load_data` returns the ordered members, dimension and per-component types/codebooks under `bindings["X"]`; pass `binding_key=ready["binding_key"]` to `estimate_data`. This defines the logical node X as the whole tuple `(x1, x2)` without adding causal nodes. Every cluster must belong to an actually verified Back-door/Adjustment-criterion witness and be a non-descendant of every selected treatment. Outcome clusters and unsupported graph bindings return `UNSUPPORTED`; ordered binary treatment clusters are supported separately with per-member assignments; no alternative graph or estimator fallback is substituted. Optional `column_types` and `column_codebooks` retain mixed continuous/binary/nominal member domains; scalar types must match the graph. Codebooks require finite, unique numeric keys covering observed codes. Nominal cluster members require explicit `categorical_encoding="one_hot"`.

For Random Data, first use the existing `build` and `sample` actions, then call `estimate_data` with `source="random"`, the returned `token` and `sample_id`, the current graph, and the same query fields. This path also returns only `data_estimate`; it never invokes the model-reference calculation. The separate legacy `compare` API and `demo` command retain their simulation/reference workflow. Current data-only requests support one scalar outcome and either `estimand="ate", summary="mean_difference"` with a reference or `estimand="apo", summary="mean"` without any reference, and no factual evidence. A stale APO reference is rejected. Unsupported requests abstain with a status/reason.

### Baseline binary Mean difference: actual estimation method

The default eligible binary scalar/ordered-tuple baseline method is **2-fold AIPW with XGBoost means and minimum-variance fitted-outcome balance**. Explicit choices are `aipw`, `outcome_regression` and `ipw`. They require one binary scalar or ordered binary-cluster treatment, one scalar outcome and requested0/1 assignment(s), no factual evidence and an actually verified baseline Back-door/Adjustment-criterion witness consisting of treatment non-descendants. Graph assumptions are supplied, not discovered from the CSV. Ineligible explicit requests are `UNSUPPORTED`; failed supported fits remain `UNKNOWN`, never silently replaced.

AIPW and OR use actual **XGBoost 2.1.4** arm-specific outcome means: fixed64 rounds, depth3, eta.05, hist, nthread1, subsample1, colsample_bytree1, lambda1, min_child_weight5; base_score is the training-arm outcome mean. Every original witness/full-one-hot coordinate enters, without polynomial expansion. Zero predictors get one constant-zero column and actual XGBoost. Two treatment-stratified folds keep all fitting, prediction scaling and weight duals training-only. No benchmark or simulated reference enters learning.

For AIPW only, the weight fit minimizes `sum_arm(w*w)/N` subject to `sum_arm(w)/N=1`, `sum_arm(w*mu_a)/N=mean_cohort(mu_a)` and `w>=1e-8`, with N the whole outer-training cohort size and mu_a its fitted XGBoost arm prediction. This positive floor is part of the feasible class. Sorting/cumulative moments solve the two-equality convex problem in O(m log m); the same positive-part affine function of the centered/scaled prediction is applied to heldout rows. No RBF/weight ridge, ratio/prevalence conversion, posthoc constraint repair or heldout normalization is used. This is scalar fitted-outcome balance, not all-function balance. IPW now fits a whole-treatment joint propensity classifier instead, with no outcome or direct balancing fit.

For one requested assignment a, raw total-n APO scores are AIPW `m_a+I(A_tuple=a)*w_a*(Y-m_a)`, OR `m_a`, and IPW `I(A_tuple=a)*Y/p_hat_a`. ATE subtracts the corresponding reference score on the same rows/folds. IPW uses the fitted joint-class propensity probability, never a product of marginal probabilities. OR fits no weights. ATE AIPW/OR outcome/direct-weight fit counts remain4/4 and4/0; APO counts are2/2 and2/0. IPW fits two propensity classifiers and zero outcome/direct-weight models for either estimand; identical ATE regimes return zero with all counts0. Reversed regimes reverse signs. `estimation_details` records actual source SHA, callable/estimator, retained CSV/full-one-hot recipes, split seed, fixed XGBoost settings, training constraint/KKT residuals/duals and heldout ESS/share/mass. Code Copy contains the exact module and uses the same retained rows. Standalone replay passes both `options.estimator` and `options.estimand`, preserving scalar or ordered treatment-column arrays. Install `numpy scipy xgboost==2.1.4` for standalone replay; package install supplies all dependencies.

Minimum counts128rows/32training-arm rows and weighted8heldout-arm rows remain. Floor-adjusted convex-hull feasibility, normalized mass and standardized-mu equality residuals<=1e-8, finite fit/score and deadlines are required. Heldout ESS below max(10,.05\*n_arm) or normalized share>.20 withhold results. Raw-coordinate imbalance is now linear-only diagnostic/warning, not the old >.5 rejection gate: it is not the user-selected constraint. These are engineering checks, not positivity, inference or accuracy guarantees; no observed-data CI or unconditional double robustness is claimed.

The compatibility alias `estimation_method="legacy_knn"` still explicitly selects graph plug-in, but its actual learned means are now XGBoost. Adjustment means and general-ID terminal conditional means use the same helper, including constant-context regressions. Unconditional empirical means, nonterminal conditional row-sampling/kNN density kernels, simulator mechanisms and analytic/Monte Carlo references are unchanged. `auto` outside baseline eligibility retains this graph-dependent route and reports its real method. Native `compare`/CLI demo also use those XGBoost graph-plug-in means plus separate references; they are not the selected baseline API.

The executable source is `causalengine/balancing_aipw.py`, mirrored byte for byte in `web/balancing_aipw.py`. A pasted exec/notebook can compute without a source file; unverifiable source SHA is null. Read the canonical `web/methods.html` for exact branch settings, assumptions, support and uncertainty distinctions.

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

The browser's Random Data seed controls the generated rows. Its model seed controls the generated mechanisms. Sample CSV download and observed-data estimation reuse the stored sample's token/sample ID. `sample_reference` returns these IDs, the stored `source_seed`, and a separate `reference_seed` obtained by XOR with `0xA5A5A5A5`, so Monte Carlo reference draws are not observational sample draws. `reference_draws` is zero for the analytic path; `reference_requested_draws` records the requested Monte Carlo budget. The CSV estimation path does not request a model reference. APO Random references sample one intervention world and report its mean/MCSE; ATE retains paired two-world differences. The cell budget counts the actual one or two worlds.

### Random baseline vectors, dimensions 1–50

Keep the public graph node X at dimension 1 and add `random_cluster_sizes={"X": 25}` to the existing `build` payload. Optional `random_cluster_members={"X": [f"x{i}" for i in range(1, 26)]}` supplies the exact ordered physical headers; its length must equal the selected dimension. Default headers are `x1` through `xp` for X, or `name_1` through `name_p` for another covariate. Dimension 1 defaults to the original scalar header X. The adapter creates a real private vector using the existing SCM mechanisms/noise, while public node names, arrows, positions and question remain intact. It accepts observed continuous baseline covariates with explicit continuous mechanism families. Outcomes stay scalar; binary treatments may separately use ordered members through the existing public vector builder. Verified Back-door/Adjustment-criterion and non-descendant guards prevent treating post-treatment vectors as baseline adjustment. All generated components enter the existing observed-data estimator through the whole-node schema. This does not assert every component has a nonzero causal effect in every mechanism family.

`build` returns `random_key` and `random_bindings` alongside the token/model. Echo the returned key in `sample`, `estimate_data` and `sample_reference` requests. Sample, CSV, per-outcome estimates and model reference share the same token/sample ID and ordered bindings. A stale key, graph, shape or sample is an error. General `build_scm`/identification dimension caps remain eight; this is a private, bounded baseline-generation adapter, not a global dimension-limit change.

Generated samples retain 1–5,000 rows, at most 100 physical columns and 500,000 cells. Vector model references use at least 256 requested draws, at most 10,000, with both complete intervention frames together bounded to 500,000 cells. High-dimensional references default to 512 draws; their actual draw count and Monte Carlo standard errors are returned independently of the observed Records count. Deadline exhaustion exposes no partial reference value. Native mechanism Apply preserves the actual vector shape/members and returns a new token/key; it clears the old sample. Only after a successful Apply are the stored public family/type and snapshot keys synchronized. Failed Apply keeps the previous model, keys and data; a binary family for the continuous baseline cluster is rejected.

Keep graph/model assumptions and returned statuses when using results. The application does not automatically discover causal relationships from arbitrary uploaded data.

### Random treatment vectors and outcome configurations

The compact browser controls offer 1–4 binary treatment members and 1–50 continuous baseline covariate coordinates. For a two-member treatment, use an actual public node such as `{"name":"A","family":"binary","dimension":2,"members":["a1","a2"]}`. The generated table contains both columns in that order. An intervention `{"A":[1,0]}` is a joint assignment, not two unrelated scalar queries. ATE includes a full reference such as `{"A":[0,0]}`; APO omits `reference`. The existing API builder limit remains eight; the compact control limit does not relax estimation support requirements.

The default setup uses linear X, binary A and Normal noise. The Outcome picker selects `linear`, `quadratic` or `bounded` for Y and Normal noise, preserving advanced edits to the X mechanism; resolved model metadata records what actually ran. Linear adds coefficient-weighted parent coordinates plus noise; quadratic uses squared parent coordinates (binary treatment squares equal themselves); bounded applies expit to the affine predictor plus noise. These are existing mechanism factories, not newly fitted regressions or treatment-interaction guarantees. Vector noise retains its fixed dense mixing; no conditional-independence guarantee is implied. Model/data seeds and Records remain explicit. Changing a generation configuration requires Generate data; Head, CSV download, estimation and the separate model reference reuse that snapshot. IPW uses the joint tuple propensity and can withhold unsupported assignments without changing rows or substituting a method.

## Launch the bundled browser app locally

```sh
python -m causalengine serve --port 8766
```

Open **http://127.0.0.1:8766/** in a browser. Leave the terminal running. Press Ctrl+C to stop. The server binds to your own computer by default. On the first screen, choose a **Causal structure**, enter treatment, covariate and outcome names, then select **Update graph**. Review or edit the proposed arrows. **Identify** checks the supplied graph without a dataset or simulated model. For **Estimate**, upload a CSV and bind numeric columns to the existing observed variables, or choose **Random Data**. A baseline covariate can bind an ordered group of columns as a cluster while retaining the graph. Both estimate paths use observed rows only and do not calculate a simulated-model reference. Multiple outcomes are processed separately on the same dataset. Blank role fields create no variables; a graph can remain a draft until treatment and outcome roles are supplied. Front-door has a separate Mediators field.

CSV estimation accepts scalar or ordered-binary-vector treatments, scalar outcomes and scalar or ordered-vector baseline covariates (including explicitly coded nominal members), 1–5,000 rows, at most 100 physical selected columns and 500,000 selected cells. Every selected source column belongs to exactly one variable/member. The authoritative data binding records the whole tuple even when the public graph node keeps its existing dimension. Cluster estimation requires a verified Back-door/Adjustment-criterion witness; unsupported Front-door/Sequential bindings abstain. Identification and the general public model builder keep their existing 1–8 node-dimension limit. A separate Random baseline adapter supports 1–50 actual continuous components without changing the public logical graph. Binary variables and binary actions require 0/1. Missing, nonnumeric, nonfinite or malformed selected cells are errors; rows are not dropped, imputed or silently coerced. Unused CSV columns can contain text because the browser sends only selected columns. A changed graph, variable type or mapping requires a fresh data load. Fewer than 128 rows can be loaded, but the estimator returns an insufficient-data status. Estimates are approximate; no standard error or confidence interval is provided.

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

Select a benchmark, then choose **Download CSV** or **Estimate**. Download CSV saves its complete factual table. Estimate binds the treatment and factual outcome to the existing scalar action/outcome and all released covariates to the existing baseline covariate cluster, then uses the data-only estimator. Logical node names, arrows and positions are preserved. A built-in benchmark temporarily uses its scalar treatment; prior treatment-cluster settings are restored when leaving if the graph and treatment schema remain unedited. For the default triangle this defines X as all 25 IHDP, eight NSW or 58 ACIC covariates. The graph remains the user's causal assumption; it is not discovered from the dataset. A graph requiring an unbound mediator, additional action or time-specific variable is kept and reported unsupported rather than replaced. Choosing Random Data explicitly clears the CSV cluster binding and returns to the graph's original mechanism dimensions.

ACIC's three nominal covariates retain numeric codes and reversible label codebooks in the source table and cluster-binding metadata. For estimation, its explicit `categorical_encoding="one_hot"` option uses all K category indicators in a temporary feature view and the selected observed-data estimator. The eligible binary baseline branch defaults to balancing-weight AIPW and also permits explicit Outcome Regression or IPW; automatic general-graph queries retain the existing estimator. No categories, original covariates or rows are dropped; indicators are not extra causal nodes. XGBoost receives all indicator coordinates; separate coverage/imbalance diagnostics use training standardization. This does not promise an encoding-invariant estimate or statistical validity. Categorical actions/outcomes abstain. This is a data-only covariate view; Random Data uses the existing mechanism families and does not add a categorical sampler. The temporary dense view is bounded to 100 total columns and 500,000 cells before allocation.

`web/benchmarks/ground-truth.json` contains aggregate evaluation references separately from the factual CSVs. IHDP's reference is **4.016066896118338** over its 747 rows; ACIC's is **2.1280792580310415** over its 4,802 rows. Each is the average of the source `mu1 - mu0` conditional-mean contrasts for the released covariate rows, under treatment 1 versus 0. This is not a population ATE or the average of noisy realized potential-outcome differences. The JSON records pinned sources, hashes, definitions and exact row-alignment checks. LaLonde's real experimental records do not supply a known unit-level truth; a trial estimate is not relabeled as ground truth. The UI matches treatment/outcome bindings and the requested contrast before showing a benchmark reference. Truth metadata never enters CSV column mapping or estimation.

The app also includes `web/examples/upload-cluster.csv`, a synthetic upload example with scalar A/Y and named covariate members. Its field explanation distinguishes demonstration data from a real benchmark. Named members describe the whole data tuple without new causal nodes. Random Data can generate 1–50 actual continuous baseline components through the bounded adapter below; CSV declarations and bindings remain separate from the generated model.

The original exact categorical-stratum estimator can abstain on sparse ACIC strata; that diagnostic is retained in validation reports. The full one-hot feature view is an explicit approximation choice. Preserve returned coverage warnings and statuses.

Dataset terms are separate from the engine's MIT notice. ACIC's distributed **CDLA-Sharing-1.0** license and provider README are included under `web/benchmarks/`. The IHDP archived source contains no explicit license; the official LaLonde provider acknowledges permission to publish there without stating a general license. Source hashes and exact transformations are recorded for this local prototype; this package is not a public dataset-hosting clearance.

Identification also returns a bounded observational formula tree expanded from its existing successful ID trace. The display jointly averages any algebraically redundant free evaluation contexts using their observational marginal, with fresh bound variables. This is display metadata only; it does not add evidence/adjustment or alter the identification decision or estimation algorithm. Conditional densities and ratios still require their usual support/positivity conditions. Display unavailability does not change an identifiable status.

## Troubleshooting

- **Python or pip not found:** install Python 3.12 and use `python3.12 -m pip`; on Windows use `py -3.12 -m pip`.
- **ModuleNotFoundError:** use the same virtual environment for installation and execution; run `python -m pip show causalengine` and `python -c "import sys; print(sys.executable)"`.
- **A dependency tries to compile:** use a supported 64-bit Python 3.12 installation and upgrade pip so available binary wheels are recognized.
- **XGBoost cannot load on macOS:** the native wheel may require the OpenMP runtime (`libomp`); follow the [official XGBoost installation guide](https://xgboost.readthedocs.io/en/stable/install.html). The browser uses the official WASM package and does not need a native OpenMP installation.
- **Port already in use:** choose `--port 8767`.
- **Browser preparing calculator / CDN error:** allow internet access to `cdn.jsdelivr.net`, then reload. Installing system Python does not fix a blocked Pyodide CDN.
- **Missing sample or expired model:** regenerate the sample after changing graph/function/model settings.
- **Warning or unavailable sample estimate:** inspect the reported status/reason; do not treat a model reference as an estimate learned from real data.

## Source, provenance and scope

Original source: https://github.com/yonghanjung/yonghanjung.github.io/tree/d3d36fb7f5d9f14e4eaa29df085c55becd553788/experiment-lab/causalpy . The public service is https://yonghanjung.me/experiment-lab/causalpy/ . There was no verified standalone `yonghanjung/experiment-lab` repository.

`upstream/` preserves all 14 files byte-for-byte. `PROVENANCE.json` records their source URLs and SHA-256 hashes. Packaged Python files adapt sibling imports to the `causalengine` namespace and update two module-identity checks needed by that namespace. A deliberate `editor_engine.py` adapter extension adds validated CSV dataset state, whole-node ordered covariate bindings with snapshot keys, verified adjustment guards, and data-only estimation actions. A separate `sample_reference` action adds validated model references for the current Random Data snapshot, with a bounded paired-interventional-sampling delegate for explicit private vectors. The Random baseline adapter injects validated 1–50 component private shapes while preserving public graph limits; the original SCM and registry are preserved; eligible baseline `estimate_data` requests select the XGBoost/minimum-variance routine above. This release intentionally replaces learned conditional means inside `_estimate_mean` and terminal `_estimate_uca_mean` with XGBoost. Nonterminal row-sampling kernels, graph identification and analytic/Monte Carlo model references remain unchanged. The local web copy uses the lab website theme, variable-role/timeline builder, graph-first Identify/Estimate screen, CSV mapping, per-outcome results, model editor, logo and local guide. HTML navigation is adapted for standalone serving. The browser worker routes the new data actions and loads their dependencies; browser `editor_engine.py` contains the same data-only and categorical-feature adapter. `identification_engine.py` adds bounded observational-tree display metadata and raises the public graph limit to 100; ID decisions and algorithms are unchanged. The other 10 browser Python files remain byte-identical to the preserved upstream originals. Neither upload estimation nor Random Data estimation substitutes an SCM reference.

The upstream repository MIT `LICENSE` is preserved verbatim, including its site-template copyright notice. No new ownership attribution is asserted here. Check project-specific licensing before a public package release. This local package does not constitute a PyPI release.

The supported workflow is the browser editor plus the API/CLI shown here. The source also contains older optional plotting/regression adapters whose extra libraries and external engines are not bundled or supported by this minimal distribution. They are not required by the editor, demo or identification workflow.

### Three explicit baseline estimators

For a supported binary scalar/ordered-tuple treatment and scalar outcome, `estimate_data` accepts `estimation_method="aipw"`, `"outcome_regression"` or `"ipw"`. Choose `estimand="ate"` with `summary="mean_difference"` and a reference, or `estimand="apo"` with `summary="mean"` and reference omitted. Direct callable `estimate_balancing_aipw(..., estimator=..., estimand=...)` has the same semantics. Scalar AIPW/OR ATE arithmetic is unchanged. APO evaluates only the requested outcome arm; it is never a contrast against an implicit0 reference.

IPW uses actual XGBoost2.1.4 `binary:logistic` (two joint classes) or `multi:softprob` (more classes), fixed64rounds/depth3/eta.05/hist/nthread1/lambda1/min_child_weight5, on every original training row and its whole ordered treatment tuple label. It fits no Y model and no mu-balance solver. Each fold uses the same global lexicographic codebook and original class frequencies; no oversampling, pooling, probability clipping, stabilization or heldout renormalization. Queried probabilities below1e-6 on any heldout row abstain. Observed joint classes are bounded to32 as an engineering limit. Missing requested tuples, missing fold training classes, insufficient requested-class rows, invalid probabilities, extreme ESS/share or deadlines expose no value.

CSV mapping `A:["a1","a2"]` and intervention `A:[1,1]` bind a joint binary treatment; ATE additionally supplies reference `A:[0,0]`. Explicit component types must be binary, and the order is preserved through schema, codebook, query and Copy. Existing100-column/500000-cell/5000-row bounds apply. For generated data use a binary node with public dimension2..8 and `members:["a1","a2"]`; the existing real binary vector mechanisms generate those actual columns. No implicit continuous surrogate is used. Non-baseline/Front-door/Sequential explicit baseline requests abstain; compatible `auto` mean requests retain graph plug-in. Unsupported continuous treatment components are never converted to arbitrary class labels.

AIPW retains minimum-variance scalar-mu balance. OR fits only XGBoost means. See `web/methods.html` for exact scores, nuisance counts, support, encoding, reference and uncertainty limits.

APO benchmark references are separate released-row mean(mu_a) aggregates from the exact same pinned IHDP/ACIC sources, stored under `ground-truth.json` → `datasets[id].apo.values`. They are never fitted on or inserted into factual CSVs. LaLonde has no known unit-level ATE or APO truth. An ATE difference must not be displayed as an APO mean.
