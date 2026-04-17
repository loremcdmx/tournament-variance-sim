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
ROI — as a function of **field size** and **true ROI edge**. Empirically
it's close to a power law, with a linear ROI-intercept:

```
σ_ROI(field, roi) ≈ (C0 + C1 · roi) · field^β
```

Three scalars per tournament format — `{C0, C1, β}`. `β` is the
field-size exponent (how fast σ grows with field), `C0` is the edge-free
intercept, `C1` is how much a +1.0 ROI edge inflates σ. Zeros are legal;
freezeout-realdata currently fits with `C1 ≈ 0`, meaning σ is nearly
ROI-invariant for freeze.

Current production fits (raw in `scripts/fit_beta_*.json`, inlined as
constants `SIGMA_ROI_{FREEZE,PKO,MYSTERY,MYSTERY_ROYALE}` near the top
of `src/components/charts/ConvergenceChart.tsx`):

| Format                         | C0     | C1     | β      |
| ------------------------------ | ------ | ------ | ------ |
| freezeout (realdata-linear)    | 0.6564 | 0      | 0.3694 |
| PKO (realdata-linear)          | 0.6265 | 0.4961 | 0.2763 |
| Mystery Bounty                 | 1.0063 | 1.0994 | 0.2348 |
| Mystery Battle Royale          | 1.2826 | 1.6462 | 0.2104 |
| mix freeze/PKO (effective)     | —      | —      | —      |

The mix row is effective-only: σ²\_mix = p·σ²\_PKO + (1−p)·σ²\_freeze
is a sum of two power laws with different exponents, so no single
`{C,β}` fits cleanly. `scripts/mix_effective_fit.ts` reports the
best-fit effective `{C,β}` for common mix ratios × ROIs — useful for
reporting but not for live UI math, which composes freeze+PKO
analytically.

Reading of coefficients: `β` drops as ROI-sensitivity rises because
bounty-heavy formats concentrate variance on deep runs, which
scales sub-linearly with field. Mystery Royale's C0 is ~2× freeze's
because the jackpot log-normal noise (`mysteryBountyVariance=1.8`)
lifts the whole surface.

## Why a fit and not a formula?

The α-calibrated finish model + payout table + re-entry loop produces
σ\_ROI as an emergent property. There is no closed form — too many
interacting non-linearities (ICM truncation, PKO heat bins, mystery
bounty log-normal noise, min-cash plateau). So we sweep the engine over
a grid, measure σ, and fit a simple surface to the measurements.

The fit is what the **ConvergenceChart** uses at interactive speed; the
full engine is only run when the user hits "Run".

## Quickstart

Runs the main parallel sweep across all four formats (pko, freeze,
mystery, mystery-royale) and writes `scripts/fit_beta_*.json`. 12 workers
on a 7950X, ~10 minutes per sweep.

```bash
npx tsx scripts/fit_sigma_parallel.ts
```

Narrow it:

```bash
SWEEP=mystery_only        npx tsx scripts/fit_sigma_parallel.ts
SWEEP=mystery_royale_only npx tsx scripts/fit_sigma_parallel.ts
N_WORKERS=8               npx tsx scripts/fit_sigma_parallel.ts
```

Outputs:

- `scripts/fit_beta_pko.json` — PKO (realdata-linear finish, mtt-gg-bounty payout, bountyFraction=0.5)
- `scripts/fit_beta_freeze_realdata.json` — freezeout (realdata-linear finish, mtt-standard payout)
- `scripts/fit_beta_mystery.json` — Mystery Bounty
- `scripts/fit_beta_mystery_royale.json` — Battle Royale

Each file contains the raw σ grid and the fitted coefficients. See
[Output format](#output-format).

## The sweep space

| Dimension | Values                                                    |
| --------- | --------------------------------------------------------- |
| Field     | 18 log-spaced sizes 50…50 000                             |
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
  "fields": [50, 75, 100, ..., 50000],
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
  "cRoiLinear": { "C0": 0.6265, "C1": 0.4961, "r2": 0.9973 }
}
```

The pair you paste into the UI is
`{ C0: cRoiLinear.C0, C1: cRoiLinear.C1, beta: globalBeta }`.
`perRoiFits[i].C` are the per-ROI intercepts that `cRoiLinear` then
regresses through — the joint fit freezes β across all ROIs and lets
only `C(roi)` vary.

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

1. Open `src/components/charts/ConvergenceChart.tsx`.
2. Find the coefficient constants near the top of the file:
   `SIGMA_ROI_FREEZE`, `SIGMA_ROI_PKO`, `SIGMA_ROI_MYSTERY`,
   `SIGMA_ROI_MYSTERY_ROYALE`. Each is a `{ C0, C1, beta }` literal.
3. Paste in the new values: `C0` and `C1` come from `cRoiLinear`, `beta`
   comes from `globalBeta`.
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
   `pko-realdata-linear`. The new `{C0, C1, β}` is your data-calibrated fit.

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
2. Reuse the log-log fit block from `scripts/fit_sigma_parallel.ts` (the
   `fitLogLog` helper that emits `perRoiFits`, then a second OLS on
   `C(roi)` to produce `cRoiLinear: {C0, C1, r2}`).
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
