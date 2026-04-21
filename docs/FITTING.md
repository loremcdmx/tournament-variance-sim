# Fitting & parameter sweeps

How to empirically measure the simulator's variance surface and plug the
resulting coefficients back into the UI. Written so a new engineer — or
a fresh Claude session with the whole repo dumped in — can go from
"I have some MTT results" to "my fit is live in ConvergenceChart"
without reading the whole codebase first.

If you are here to run a sweep right now, skip to [Quickstart](#quickstart).
If you want to fit your own data, skip to [Fit your own data](#fit-your-own-data).

## What we're fitting

The headline surface is σ\_ROI — the per-tournament standard deviation of
ROI — as a function of **field size** and **true ROI edge**. The UI uses
two runtime forms:

Single-β power law for formats where the residuals stay small enough:

```
σ_ROI(field, roi) ≈ (C0 + C1 · roi) · field^β
```

2D log-polynomial for PKO / Mystery, where the single-β surface left
visible structure in the grid residuals:

```
log σ_ROI(field, roi) =
  a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L

where L = log(field), R = roi
```

Current production fits (raw grid data in `scripts/fit_beta_*.json`,
runtime constants in `SIGMA_ROI_{FREEZE,PKO,MYSTERY,MYSTERY_ROYALE}`
near the top of `src/lib/sim/convergenceFit.ts`):

| Format                      | Runtime form  | Coefficients |
| --------------------------- | ------------- | ------------ |
| freezeout (realdata-linear) | single-β      | C0=0.6564, C1=0, β=0.3694 |
| PKO                         | 2D log-poly   | a0=1.21374, a1=-0.21789, a2=0.03473, b1=0.67318, b2=-0.03445, c=-0.05298 |
| Mystery Bounty              | 2D log-poly   | a0=2.33290, a1=-0.27564, a2=0.02917, b1=1.14218, b2=-0.09962, c=-0.08406 |
| Mystery Battle Royale       | fixed-AFS runtime-helper line | C0=5.48538, C1=3.11864, β=0, resid=10% |
| mix freeze/PKO              | exact σ² composition | no promoted `{C,β}` |

The mix row is effective-only: σ²\_mix = p·σ²\_PKO + (1−p)·σ²\_freeze
is a composition of two runtime surfaces, so no single `{C,β}` fits
cleanly. `scripts/mix_effective_fit.ts` reports an approximate effective
`{C,β}` for common mix ratios × ROIs — useful for reporting, not for live
UI math.

Reading of coefficients: in the single-β form, `β` is the field-size
exponent, `C0` is the edge-free intercept, and `C1` is how much a +1.0
ROI edge inflates σ. In the 2D log-poly form, inspect the residual report
instead of trying to interpret one coefficient in isolation. Mystery
Royale's β is 0 by construction since the AFS slider is locked at 18 in
the UI. The shipped BR tab now centers on a runtime single-row compile;
the stored `{C0, C1}` line is just a compact helper for that runtime
center inside the validated BR box (ROI ±10%), and `xval_br.ts` is the
independent sim check for the advertised residual band.

## Why a fit and not a formula?

The α-calibrated finish model + payout table + re-entry loop produces
σ\_ROI as an emergent property. There is no closed form — too many
interacting non-linearities (PKO heat bins, mystery
bounty log-normal noise, min-cash plateau). So we sweep the engine over
a grid, measure σ, and fit a simple surface to the measurements.

The fit is what the **ConvergenceChart** uses at interactive speed; the
full engine is only run when the user hits "Run".

## Quickstart

Two producers — pick the right one for what you're doing:

### Canonical (promoted to UI coefficients)

- **`scripts/fit_br_fixed18.ts`** — rebuilds the BR runtime helper line at
  fixed AFS=18 inside the actual UI ROI box (±10%). Writes
  `scripts/fit_beta_mystery_royale.json`.
- **`scripts/xval_br.ts`** — independent sim validation for the shipped BR
  helper band. Run this together with the fit script before promoting BR
  changes; `fit_drift_report.ts` only tells you whether the helper reproduces
  its own artifact, not whether the runtime-centered BR band is honest against
  simulation.
- **Freeze / PKO / Mystery canonical fits** — production artifacts
  `scripts/fit_beta_freeze_realdata.json`, `scripts/fit_beta_pko.json`,
  `scripts/fit_beta_mystery.json`. These back the `SIGMA_ROI_*`
  constants in `src/lib/sim/convergenceFit.ts`. They are updated manually after
  a drift-report review (see below) — no single script re-writes them
  end-to-end today.
- **`scripts/fit_beta_pko_core.json`** — *not* an independent UI
  canonical. It's a 7-ROI PKO baseline subset (same ROIs as the
  200k-AFS probe) retained purely so `fit_drift_report.ts` can
  compare the probe against a matched-shape reference. It has no
  current producer script and is not promoted to the widget; revisit
  together with the PKO runtime-fit overhaul.

### Diagnostic 200k-AFS probe (NOT promoted automatically)

For the narrow "can we raise the convergence widget AFS ceiling from 50k
to 200k?" gate, run the mini-sweep first:

```bash
npx tsx scripts/probe_afs_ceiling.ts
```

It measures only fields 75k/100k/150k/200k × five ROIs across
Freeze/PKO/Mystery and writes `scripts/afs_ceiling_probe.json`. The pass
criterion is per-format `max |Δ/σ| <= runtime resid`. Last 2026-04-20 run:
PKO passed, Freeze and Mystery failed, so `AFS_LOG_MAX` must stay at 50k
until those fits are extended or the UI gains per-format ceilings.

`scripts/fit_sigma_parallel.ts` runs freeze/PKO/mystery out to AFS 200k
and emits `*_200k_probe.json` files. It exists to **diagnose** how the
current power-law fit extrapolates beyond the 50k AFS used for the
canonical fits — it does not overwrite the canonical artifacts and its
outputs are not wired into the UI. Use it with `scripts/fit_drift_report.ts`
to quantify in-sample residuals (mean / RMS / p95 / max) in the user-facing
zone before deciding whether to promote any probe coefficient.

12 workers on a 7950X, ~10 minutes per sweep.

```bash
npx tsx scripts/fit_sigma_parallel.ts
```

Narrow it:

```bash
SWEEP=mystery_only  npx tsx scripts/fit_sigma_parallel.ts
N_WORKERS=8         npx tsx scripts/fit_sigma_parallel.ts
```

Probe outputs (diagnostic only):

- `scripts/fit_beta_pko_200k_probe.json`
- `scripts/fit_beta_pko_core_200k_probe.json`
- `scripts/fit_beta_freeze_realdata_200k_probe.json`
- `scripts/fit_beta_mystery_200k_probe.json`

Each file contains the raw σ grid and the fitted coefficients. See
[Output format](#output-format). MBR is intentionally excluded from this
sweep — use `fit_br_fixed18.ts` for MBR.

Drift report:

```bash
npx tsx scripts/fit_drift_report.ts
```

Reads canonical + optional probe artifacts, evaluates residuals against
the measured grids across the full range, the wide user zone
(field ∈ [100, 50k], roi ∈ [−20 %, +40 %]), and the narrow user zone
(field ∈ [500, 10k], roi ∈ [−10 %, +30 %]). Writes
`scripts/fit_drift_report.json`. Inspect it before promoting any probe
fit to the UI.

## The sweep space

| Dimension | Values                                                    |
| --------- | --------------------------------------------------------- |
| Field     | 22 log-spaced sizes 50…200 000                            |
| ROI       | 7 main: {−20, −10, 0, +10, +20, +40, +80}%                |
|           | 4 dense (PKO/mystery): {+5, +15, +25, +30}%               |
| Tourneys  | 500 per sample (enough for stable σ, short enough to run) |
| Samples   | 60k (freeze) or 120k (PKO/mystery)                        |

Everything else (buy-in $50, rake 10 %, bountyFraction 0.5, pkoHeadVar
0.4) is held fixed. The fit is **about field-and-ROI**, not
about format/rake sensitivity — those get separate sweeps if you need
them.

## Output format

```json
{
  "meta": { "N": 500, "samples": 120000, "buyIn": 50, "rake": 0.1 },
  "fields": [50, 75, 100, ..., 200000],
  "rois": [-0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.8],
  "table": {
    "0.1": [3.018, 3.459, ..., 22.7],     // σ_ROI per field at ROI=0.1
    "0.2": [...]
  },
  "perRoiFits": [
    { "roi": 0.1,  "C": 0.6729, "beta": 0.2799, "r2": 0.9402 },
    { "roi": 0.2,  "C": 0.7205, "beta": 0.2743, "r2": 0.9395 },
    ...
  ],
  "globalBeta": 0.2763,
  "globalR2": 0.9377,
  "cRoiLinear": { "C0": 0.6265, "C1": 0.4961, "r2": 0.9973 },
  "logPolyPooled": { "a": 0.0, "b1": 0.2763, "b2": 0.0123, "r2": 0.9721 }
}
```

`logPolyPooled` is a **diagnostic-only** pooled quadratic fit of
`log σ` against `log field`, with both inputs per-ROI mean-centered
before pooling (`xs = log f − mx(roi)`, `ys = log σ − my(roi)`). That
centering means the reported `{a, b1, b2}` **cannot be evaluated at an
arbitrary (field, roi)** without the per-ROI `mx(roi)`, `my(roi)`
constants, which aren't stored in the artifact. Use it only to compare
curvature: `b2 ≈ 0` with `logPolyPooled.r2 ≈ globalR2` means single-β
captures the shape; a materially nonzero `b2` with higher `r2` says
single-β is leaving structure on the table past ~10k AFS. Promoting a
log-poly form to the UI requires a second, runtime-usable fit (not
centered) — this artifact doesn't provide that.

For a single-β promotion, the tuple you paste into the UI is
`{ C0: cRoiLinear.C0, C1: cRoiLinear.C1, beta: globalBeta }`.
`perRoiFits[i].C` are the per-ROI intercepts that `cRoiLinear` then
regresses through — the joint fit freezes β across all ROIs and lets
only `C(roi)` vary.

For PKO / Mystery, do not paste the artifact's single-β summary into
the UI. Run `scripts/refit_2d_logpoly.ts` and promote the reported
`a0/a1/a2/b1/b2/c` coefficients only after `fit_drift_report.ts` confirms
user-zone residuals are acceptable.

Pitfalls:

- **`cRoiLinear.r2`** should be ≥ 0.99. This is the fit that powers the
  UI's ROI slider; if it drops, the linear `C(roi) = C0 + C1·roi`
  assumption is the problem — try `C0 + C1·roi + C2·roi²` and upgrade
  the formula in `ConvergenceChart.tsx`.
- **`perRoiFits[i].r2`** in the ~0.94 range is normal, not a red flag.
  The engine's σ(field) isn't a pure power law — there's curvature at
  tiny fields (≤75) and at the mega-field tail. R² ≈ 0.94 is what a
  single `{C, β}` can capture; the residuals are a known shape artifact.
- **`globalR2`** reflects the single-β constraint across all 11 ROIs.
  Expect similar ~0.94; much below that means one format's σ(field)
  slope shifts with ROI enough to warrant per-ROI β (not currently
  supported by the UI formula).
- If any `perRoiFits[i].r2 < 0.80` or you see a clear break in σ(field)
  on a log-log plot, the power-law assumption is failing at that ROI —
  likely the engine saturates (see "edge-case behavior" in
  `notes/review_dossier.md`). Drop the outlier ROI before refitting or
  narrow the field range.

## Wiring a fit into the UI

Never promote a probe fit without first running `fit_drift_report.ts`
and confirming that user-zone residuals don't regress. A fit with better
global R² but worse residuals inside `field ∈ [500, 10k], roi ∈ [−10 %, +30 %]`
is a net loss for the UI.

1. Open `src/lib/sim/convergenceFit.ts`.
2. Find the coefficient constants near the top of the file:
   `SIGMA_ROI_FREEZE`, `SIGMA_ROI_PKO`, `SIGMA_ROI_MYSTERY`,
   `SIGMA_ROI_MYSTERY_ROYALE`. Each is a `SigmaCoef` literal with
   `kind: "single-beta"` or `kind: "log-poly-2d"`.
3. For single-β fits, paste `C0`/`C1` from `cRoiLinear` and `beta` from
   `globalBeta`. For PKO / Mystery, paste the 2D coefficients from
   `scripts/refit_2d_logpoly.ts`. For MBR, use
   `fit_beta_mystery_royale.json` (produced by
   `scripts/fit_br_fixed18.ts`); its β is 0 by construction and its
   `resid` must be backed by `scripts/xval_br.ts`, not only by
   `fit_drift_report.ts`.
4. Verify: `npx tsc --noEmit && npm test && npm run build`. The widget
   recomputes σ on every ROI/field scrub, so a broken constant shows up
   instantly as `NaN` or a visually flat curve.
5. Browser-test: load the widget, toggle the format tab, scrub the ROI
   slider, confirm σ responds smoothly and the "σ for 1000 MTTs" number
   is in the right ballpark (~3–5 % at mid-field mid-ROI for a typical
   tournament).

## Fit your own data

You have a CSV of real tournaments. You want to fit this model to your
data. Two paths — pick based on what your data looks like:

### Path A — your data is per-tournament finish results

Columns like `player_id, tourney_id, finish_place, field_size, buyin, profit`.
This is the input the calibration pipeline was designed for. See
`memory/tournament_variance_sim_data_plan.md` for the full design; the
short version:

1. Bucket rows by ROI (compute empirical ROI per player), field size,
   format.
2. For each bucket, fit **α** (the power-law finish-PMF exponent) via
   MLE against the empirical finish distribution. This replaces the
   binary-search-on-declared-ROI that `calibrateAlpha()` currently does.
3. Emit an α-table keyed by `(roi_bucket, format)`; load it in
   `finishModel.ts` as a new finish model.
4. Re-run the σ sweep (above) using that finish model instead of
   `pko-realdata-linear`. The new runtime coefficients are your
   data-calibrated fit; use single-β only if residuals justify it.

This is multi-day work. The scaffold script doesn't exist yet —
`scripts/calibrate.ts` is a TODO in the memory doc. Ping the author
before building it so we stay aligned on format.

### Path B — your data is aggregate σ measurements

You have, per (field, ROI) cell, an empirical σ\_ROI from a large
sample of real players. Fit the surface directly:

1. Write a script that reads your CSV and emits a table with the same
   shape as `scripts/fit_beta_pko.json`:
   ```json
   { "fields": [...], "rois": [...], "table": { "0.1": [σ, σ, ...] } }
   ```
2. Reuse the log-log fit block from `scripts/fit_sigma_parallel.ts` if
   single-β is enough. If residuals show field/ROI interaction, use the
   2D log-poly workflow from `scripts/refit_2d_logpoly.ts`.
3. Compare your fitted coefficients to the engine's. Divergence tells
   you where the engine's defaults are wrong for your population —
   usually in `pkoHeadVar`, `mysteryBountyVariance`, or the payout
   curve shape.

## Long-running data collection: `continuous_fit.ts`

When you want to sample a much wider scenario space than the fixed
18×7 grid — different rakes, buy-ins, payout structures, finish models,
schedule shapes — use the resumable JSONL harness:

```bash
npx tsx scripts/continuous_fit.ts                            # runs forever
CF_SAMPLES=30000 CF_TARGET_RUNS=8 npx tsx scripts/continuous_fit.ts
```

Behavior:

- Appends one line per `(cell, seed)` to
  `data/variance-fits/continuous.jsonl`. Each line is a full scenario
  spec + our-σ + PD-σ + wall time.
- Restart-safe. On startup it reads the existing JSONL to rebuild the
  cell-coverage map and skips cells that already have
  `≥ CF_TARGET_RUNS` samples.
- Runs **both** our α-model and PrimeDope's binary-ITM model on every
  cell with the same seed, so downstream diff analysis costs nothing extra.

Analyze with:

```bash
npx tsx scripts/analyze_continuous_fit.ts
```

Prints the PD-vs-ours σ ratio distribution, worst-N divergent cells,
and breakdowns by finish model / payout. Useful for spotting systematic
bias (PD underestimates σ on wide-edge play, etc. — see the
["PD divergences"](#related-docs) thread).

## TournamentRow — what a scan cell looks like

Every sweep builds an array of `TournamentRow` objects and hands them
to `runSimulation()`. The shape is in `src/lib/sim/types.ts`. Minimal
required fields for a sweep:

```ts
{
  players: 500,             // field size
  roi: 0.10,                // true edge
  buyIn: 50,
  rake: 0.10,
  count: 500,               // how many MTTs in this cell's "session"
  payoutStructure: "mtt-gg-bounty",   // see payouts.ts for the full list
  gameType: "pko",          // "freezeout" | "pko" | "mystery" | "mystery-royale"
  bountyFraction: 0.5,      // PKO / mystery only
  pkoHeadVar: 0.4,          // PKO only — bounty-heat σ
  finishModel: { id: "pko-realdata-linear" },
}
```

If you're adding a new sweep, copy `fit_beta_pko.ts` — all
boilerplate is right there.

## Real payout samples — `data/payout-samples/`

The payout-curve presets (`mtt-gg-bounty`, `mtt-sunday-million`, etc.)
are anchored to real JSON samples stored in `data/payout-samples/`.
Each file is one tournament's advertised payout structure. Use these
when you need to validate that a new preset reproduces reality, or when
tuning `firstShare`/`ftRatio`/`minCashBuyIns` knobs in `payouts.ts`.

Schema:

```json
{
  "id": "gg-mini-coinhunter-pko-2026-04-14",
  "source": "GGPoker",
  "tournament": "₹11 Mini CoinHunter PKO",
  "format": "bounty",
  "buyIn": 11,
  "entries": 541,
  "prizePool": 5474,
  "paid": 62,
  "places": [{ "from": 1, "to": 1, "prize": 377.61 }, ...],
  "bounty": { "type": "progressive", "pctOfBuyIn": 50 }
}
```

Validate with:

```bash
npx tsx scripts/compare_real_samples.ts
```

This diffs every sample against `buildRealisticCurve()` and prints
per-sample % error at places 1, FT, and min-cash.

## Related docs

- **`docs/ARCHITECTURE.md`** — engine data flow, determinism contract,
  hot-loop shape. Read before touching anything under `src/lib/sim/`.
- **`notes/primedope_sd_theories.md`** — why PrimeDope's σ diverges
  from ours in ~5 distinct regimes.
- **`notes/review_dossier.md`** — deep comparison of our engine vs
  PrimeDope, 49 KB.
- **`AGENTS.md`** — style and re-entry guide, required reading after
  context compression.
- **`README.md`** — user-facing overview in RU + EN.
