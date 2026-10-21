# Benchmark factual tables

These are actual publicly distributed data snapshots, prepared for the local prototype. The manifest records source URLs, pinned versions, original SHA256 hashes, schema, exact transformations and dataset-specific terms. No rows or pre-treatment features were dropped. Counterfactual/ground-truth outcome columns are excluded from analysis tables.

IHDP is the CEVAE/NPCI first semi-synthetic replication. LaLonde is the445-row NSW experimental Dehejia–Wahba subset, not a CPS comparison. ACIC is causallib zymu_1.csv from ACIC2016 with all58covariates; its separate CDLA-Sharing1.0 LICENSE and provider README are preserved. Missing explicit licensing in the IHDP/NBER distributions is recorded, not replaced by the engine LICENSE.

## Aggregate benchmark references

`ground-truth.json` contains separate evaluation metadata. IHDP and ACIC use the full released-row mean of `mu1 - mu0` from the same pinned source rows; this is a conditional-mean reference over released covariates, not the noisy potential-outcome sample contrast or a population ATE. LaLonde has no known unit-level ground truth. Source hashes, definition sources and row alignment are recorded in that JSON. The factual CSVs and their hashes are unchanged, and no truth columns enter mapping or estimation.
