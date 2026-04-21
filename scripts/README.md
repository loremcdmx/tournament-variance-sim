# Scripts Guide

The `scripts/` folder is intentionally broad: it contains production-adjacent
calibration tools, reproducible benches, PrimeDope parity probes, and one-off
research utilities. Do not assume every file here is part of the normal
product workflow.

## Buckets

### Canonical fitting and promotion

Use these when changing coefficients that feed the shipped UI:

- `fit_br_fixed18.ts`
- `xval_br.ts`
- `fit_sigma_parallel.ts`
- `fit_drift_report.ts`
- `fit_beta_freeze_realdata.json`
- `fit_beta_pko.json`
- `fit_beta_mystery.json`
- `fit_beta_mystery_royale.json`

For BR specifically, `fit_br_fixed18.ts` rebuilds the runtime helper line for
the validated UI box, while `xval_br.ts` is the independent sim check for the
advertised residual band around that runtime center.

Read [`docs/FITTING.md`](../docs/FITTING.md) first. Promotion without a drift
report is not considered complete.

### Benches and perf diagnostics

Use these when making performance claims or comparing a refactor to baseline:

- `bench_convergence.ts`
- `bench_engine_perf.ts`
- `bench_rakeback_pipeline.ts`
- `bench_run_click_path.ts`
- `bench_schedule_edit.ts`
- `profile_hot_loop.ts`

These are the scripts that should back perf claims in commit messages and docs.

### Product verification and smoke checks

Use these when validating user-visible behavior outside the main app flow:

- `smoke.ts`
- `smoke_fixed_itm.ts`
- `verify_convergence_tabs.ts`
- `verify_rakeback.ts`
- `check_primedope.ts`

### PrimeDope parity and ingestion research

These support compare-mode investigation and data import work. Useful, but not
canonical release tooling:

- `pd_*`
- `dump_pd_tables.ts`
- `parse_pd_curves.mjs`
- `ingest_finishes.ts`
- `compare_real_samples.ts`
- `cash_crosscheck.ts`

### Research and one-off probes

These are exploratory. Treat their outputs as evidence, not as promoted truth:

- `continuous_fit.ts`
- `analyze_continuous_fit.ts`
- `mix_effective_fit.ts`
- `probe_*`
- `variance_sweep.ts`
- `sd_experiments.ts`
- `skill_shape_sweep.ts`
- `xval_*.ts`

## Rules of thumb

1. If a script affects shipped coefficients or release claims, document it in
   `docs/FITTING.md`, `README.md`, or `CHANGELOG.md` as appropriate.
2. If a script is only for local exploration, keep its outputs out of the main
   repo unless they are intentionally promoted artifacts.
3. If you add a new bench, make it reproducible and cheap enough to rerun.
4. If a script becomes canonical, call that out here explicitly. Silence means
   "diagnostic or exploratory."
