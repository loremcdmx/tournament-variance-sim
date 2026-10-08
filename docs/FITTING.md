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

| Format                      | Runtime form  | Coefficients | resid of the surface |
| --------------------------- | ------------- | ------------ | -------------------- |
| freezeout (realdata-linear) | single-β      | C0=0.6564, C1=0, β=0.3694 | 6% |
| PKO                         | 2D log-poly   | a0=1.22829, a1=-0.22862, a2=0.03549, b1=1.40175, b2=-0.14989, c=-0.10421 | 11% |
| Mystery Bounty              | 2D log-poly   | a0=2.18541, a1=-0.27892, a2=0.03057, b1=2.29124, b2=-0.35711, c=-0.16149 | 13% |
| Mystery Battle Royale       | fixed-AFS runtime-helper line | C0=5.48538, C1=3.11864, β=0 | 10% |
| mix freeze/PKO              | exact σ² composition | no promoted `{C,β}` | — |

These are the constants in `src/lib/sim/convergenceFit.ts` (the code wins if the
two ever disagree). **They are no longer what the planning cards show.** The
chips and the prove-edge card take their point from the engine's own analytic
compile and their band from the Monte-Carlo calibration below; the surfaces
above are only the fallback path of `computeConvergenceRows` when no runtime
override is passed, and the `resid` column is that surface's error against its
own grid, not a card's band.

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

The α-calibrated finish model + payout table produces σ\_ROI as an
emergent property. There is no closed form — too many interacting
non-linearities (PKO heat bins, mystery bounty log-normal noise,
min-cash plateau). So we sweep the engine over a grid, measure σ, and
fit a simple surface to the measurements.

The planning cards (**ConvergenceChart** chips and the prove-edge card) do
not evaluate these surfaces for their point estimate any more:
`src/lib/sim/formatRuntimeSigma.ts` builds the format's default one-row
schedule (the row the schedule editor produces, with the run path's ITM
rule: the payout table's paid share, or the global ITM target when the run
settings switch it on) and returns the engine's own
`buildExactBreakdown(...).sigmaEff`, so a card and a one-row schedule agree to
rounding. The band around that point is not a fit residual either: it is
measured against the engine's Monte Carlo, see
[Runtime σ band](#runtime-σ-band-what-the-cards-show). What the closed-form
surfaces still do: `computeConvergenceRows` falls back to them when no
override is passed, and the sweep scripts keep measuring them.

The price is one compile per ROI candidate. A full prove-edge table (18
candidates plus the anchor) measured 2026-10-08 on one node process: about
10–20 ms on a 1 000 field, 40 ms on 5 000, 70–90 ms on 10 000, 0.4–0.8 s on
50 000 (the slider cap) and 1–2.4 s on 100 000; a repeat with the same inputs
is free (memoized by format, field, ROI, rake and finish model), and the card
defers its input so a slider drag does not queue one table per tick. Ocean KO
has always been runtime; it is a strict upper bound with no band.

## Runtime σ band: what the cards show

The point on a planning card is the engine's analytic σ for the format's default
one-row schedule (`formatRuntimeSigma`). The band printed around it answers one
question: **how far can that analytic σ sit from what the engine actually
samples?** It does not say anything about how far the model sits from real
play; the cards' footnotes say so.

`scripts/fit_runtime_sigma_bands.ts` measures it. For every cell of the grid it
builds the card's own row (`buildFormatRuntimeRow`, the default finish model
`powerlaw-realdata-influenced`), runs the real hot loop (`simulateShard`) on it
and takes the Monte-Carlo σ of one tournament in buy-ins, `sd(final profit) /
sqrt(N) / cost`. The tables below are `MC / analytic − 1` in percent, with the
standard error of the MC σ in brackets. The SE is the larger of a kurtosis
estimate, `½·sqrt((κ−1)/n)`, and a batch-means estimate; the normal-theory SE
is not used because the right tail (bounties, BR envelopes) makes it far too
small.

How a format's `resid` is derived: `dev = |MC/analytic − 1| + 2·SE` per cell,
`resid` = the largest `dev` over the cells inside the format's box, rounded up
to a whole percent, never below 1 %. The box is the extent of the grid, and
`isInsideFitBox` hides the band outside it (the point stays). Rake is not
gated: the grid probes it (rake 0 and 20 %), and so it does two other finish
models (`power-law`, `linear-skill`) and two global ITM targets (12 % and 25 %,
the run setting the cards now take). Everything lives in
`src/lib/sim/runtimeSigmaBands.ts`, which `formatRuntimeSigma.ts` re-exports
and which the chips, the prove-edge card and schedule mode all read; a test pins
that table to `scripts/fit_runtime_sigma_bands.json`.

Re-run it (heavy: take a lock slot; about 16 minutes on 12 workers, 47 G tournaments) when the
compile, the hot loop or a payout table changes, then paste the printed
`RUNTIME_SIGMA_BANDS` literal:

```bash
BANDS_WORKERS=12 npx tsx scripts/fit_runtime_sigma_bands.ts
```

### Result (47.8 G tournaments, engine at `12e7d5f`)

| format | cells | box: field, ROI | largest gap | largest SE | `resid` |
| --- | ---: | --- | ---: | ---: | ---: |
| freezeout | 55 | 50–50000, -30..+100% | 0.98% | 0.72% | **3%** |
| PKO | 55 | 50–50000, -30..+100% | 0.37% | 0.55% | **2%** |
| Mystery | 55 | 50–50000, -30..+100% | 0.59% | 0.66% | **2%** |
| Battle Royale | 10 | 18, -20..+100% | 1.82% | 2.15% | **6%** |

The band before this calibration, for the record: freezeout ±50 % on the chips and
±6 % on the prove-edge card, PKO ±11 %, Mystery ±3 % on the chips and ±13 % on the
prove-edge card, Battle Royale ±10 %, and schedule mode used the 6/11/13/10 % of the
closed-form surfaces. The 6, 11, 13 and 10 % are those surfaces' own errors against
their own grids; they stopped describing anything once the point moved to the
engine's compile.

What the numbers say:

- The analytic σ and the engine agree to within 1.0 % in every cell of freezeout,
  PKO and Mystery, and to a few tenths of a percent below 10 000 players. The band is
  therefore mostly Monte-Carlo noise (2 SE): the SE grows with the field (0.0–0.1 % at
  50 players, 0.5–0.7 % at 50 000), and so does the worst cell behind `resid`.
- Battle Royale is noise-limited. One 10 000x envelope is hit about once per 2.5 M
  tournaments and carries most of the variance, so even 4 G tournaments per cell leave
  SE at 0.6–1.1 % (1 G on the probes: 1.8–2.2 %). The cells cannot separate a gap
  under about 1–2 % from zero; pooled over the six grid cells the gap is
  +0.73% ± 0.33 % (inverse-variance). The 6 % is a noise-limited constant, not a
  measured error: it is the same rule (gap + 2 SE, worst cell, rounded up) applied to
  data that cannot resolve more.
- Rake, finish model and the global ITM target do not move the gap beyond noise
  (probes below), so none of them is gated. The box is the extent of the grid: the
  full AFS slider (50–50 000) and the ROI range of the sliders and of the prove-edge
  candidates; outside it (a row with 200 000 players, ROI +150 %) the cards show the
  point only. The old gate had no ROI limit for freezeout and stopped PKO and Mystery
  at −20..+80 %, with no measurement behind either.
- `k ∝ σ²`: ±3 % on σ is about ±6 % on the volume the cards print.

Rake, finish-model and global-ITM probes (field 1 000 and ROI +10 %; Battle Royale at
its 18-max field; a Battle Royale row carries its own ITM, so the target is not probed
there), in the same units:

| format | rake | finish model | global ITM | MC/analytic − 1 | SE |
| --- | ---: | --- | ---: | ---: | ---: |
| freezeout | 0 | default | off | +0.03% | 0.09% |
| freezeout | 0.2 | default | off | +0.01% | 0.07% |
| freezeout | 0.1 | power-law | off | +0.10% | 0.07% |
| freezeout | 0.1 | linear-skill | off | +0.06% | 0.08% |
| freezeout | 0.1 | default | 12 % | +0.12% | 0.07% |
| freezeout | 0.1 | default | 25 % | +0.11% | 0.08% |
| PKO | 0 | default | off | +0.18% | 0.06% |
| PKO | 0.2 | default | off | +0.03% | 0.06% |
| PKO | 0.1 | power-law | off | +0.09% | 0.07% |
| PKO | 0.1 | linear-skill | off | +0.12% | 0.06% |
| PKO | 0.1 | default | 12 % | +0.09% | 0.07% |
| PKO | 0.1 | default | 25 % | +0.22% | 0.09% |
| Mystery | 0 | default | off | -0.19% | 0.19% |
| Mystery | 0.2 | default | off | +0.02% | 0.16% |
| Mystery | 0.1 | power-law | off | +0.22% | 0.25% |
| Mystery | 0.1 | linear-skill | off | +0.49% | 0.28% |
| Mystery | 0.1 | default | 12 % | -0.08% | 0.18% |
| Mystery | 0.1 | default | 25 % | +0.44% | 0.31% |
| Battle Royale | 0 | default | off | -0.44% | 2.15% |
| Battle Royale | 0.2 | default | off | +0.24% | 1.77% |
| Battle Royale | 0.08 | power-law | off | +0.60% | 1.91% |
| Battle Royale | 0.08 | linear-skill | off | -1.78% | 1.91% |

Per-cell tables, MC/analytic − 1 in percent with the SE in brackets (field down, ROI across):

**freezeout, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | +0.1% (0.0) | +0.0% (0.0) | +0.1% (0.0) | +0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) |
| 100 | +0.0% (0.0) | +0.0% (0.0) | +0.1% (0.0) | +0.0% (0.0) | +0.0% (0.0) | +0.1% (0.0) | +0.0% (0.0) |
| 300 | +0.1% (0.1) | +0.1% (0.1) | -0.0% (0.0) | +0.1% (0.0) | +0.1% (0.0) | +0.0% (0.0) | +0.0% (0.0) |
| 1000 | +0.2% (0.1) | +0.1% (0.1) | +0.1% (0.1) | +0.0% (0.1) | -0.0% (0.1) | +0.0% (0.1) | +0.1% (0.1) |
| 3000 | +0.4% (0.2) | +0.1% (0.2) | +0.4% (0.1) | +0.2% (0.1) | +0.0% (0.1) | -0.1% (0.1) | +0.1% (0.1) |
| 10000 | +0.2% (0.3) | +0.8% (0.3) | +0.3% (0.3) | -0.1% (0.2) | -0.1% (0.2) | +0.0% (0.2) | -0.0% (0.2) |
| 50000 | +1.0% (0.7) | -0.0% (0.7) | -0.1% (0.5) | +0.4% (0.5) | +0.1% (0.4) | -0.2% (0.5) | +0.8% (0.4) |

**PKO, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | +0.1% (0.0) | +0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) |
| 100 | +0.0% (0.0) | +0.1% (0.0) | +0.0% (0.0) | +0.1% (0.0) | -0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) |
| 300 | -0.0% (0.1) | +0.2% (0.0) | +0.1% (0.0) | +0.1% (0.0) | +0.1% (0.0) | +0.0% (0.0) | +0.0% (0.0) |
| 1000 | +0.0% (0.1) | +0.0% (0.1) | +0.1% (0.1) | +0.1% (0.1) | -0.1% (0.1) | +0.0% (0.0) | -0.1% (0.0) |
| 3000 | +0.0% (0.1) | -0.1% (0.1) | +0.1% (0.1) | +0.3% (0.1) | +0.1% (0.1) | -0.0% (0.1) | -0.0% (0.1) |
| 10000 | -0.1% (0.2) | +0.1% (0.2) | +0.2% (0.2) | +0.0% (0.2) | +0.3% (0.2) | +0.1% (0.2) | -0.2% (0.1) |
| 50000 | +0.1% (0.5) | +0.4% (0.5) | +0.4% (0.4) | -0.1% (0.3) | +0.2% (0.3) | -0.3% (0.3) | +0.3% (0.2) |

**Mystery, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | +0.2% (0.4) | +0.4% (0.3) | +0.1% (0.2) | +0.3% (0.3) | +0.0% (0.2) | -0.1% (0.1) | +0.1% (0.2) |
| 100 | +0.3% (0.3) | -0.3% (0.3) | +0.0% (0.3) | -0.1% (0.2) | +0.1% (0.2) | -0.1% (0.2) | -0.3% (0.1) |
| 300 | +0.5% (0.4) | +0.3% (0.3) | +0.3% (0.4) | +0.1% (0.2) | -0.0% (0.2) | +0.1% (0.2) | -0.2% (0.1) |
| 1000 | +0.0% (0.3) | -0.1% (0.2) | -0.2% (0.2) | +0.2% (0.2) | -0.2% (0.2) | +0.1% (0.1) | +0.1% (0.2) |
| 3000 | -0.3% (0.2) | +0.4% (0.2) | +0.1% (0.2) | +0.0% (0.1) | +0.1% (0.2) | +0.0% (0.3) | +0.1% (0.1) |
| 10000 | -0.2% (0.2) | -0.1% (0.2) | +0.1% (0.2) | +0.0% (0.2) | +0.3% (0.2) | +0.0% (0.2) | +0.1% (0.1) |
| 50000 | +0.4% (0.7) | +0.2% (0.5) | -0.1% (0.5) | +0.6% (0.4) | +0.2% (0.4) | +0.4% (0.3) | +0.2% (0.3) |

**Battle Royale, rake 0.08: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 18 | +1.8% (1.1) | -0.0% (1.0) | -0.5% (1.0) | +0.9% (0.8) | +0.3% (0.7) | +1.3% (0.6) |

Every raw number, including kurtosis, both SE estimators and the realized ROI of each
cell, is in `scripts/fit_runtime_sigma_bands.json`.

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
  constants in `src/lib/sim/convergenceFit.ts`.
- **`scripts/resweep_sigma.ts`** — regenerates a canonical PKO/Mystery grid
  with the **current** engine, using the same row recipe as
  `fit_sigma_parallel.ts`:

  ```bash
  FORMAT=pko     N_WORKERS=16 npx tsx scripts/resweep_sigma.ts   # ~8 min
  FORMAT=mystery N_WORKERS=16 npx tsx scripts/resweep_sigma.ts   # ~4 min
  npx tsx scripts/refit_2d_logpoly.ts                            # new coefficients
  ```

  **Why this exists:** a stored grid ages. In 2026-07 an audit found the
  engine had drifted ~10-14% above the stored PKO grid at small fields ×
  high ROI (and the stored Mystery grid had been measured with a different
  payout structure entirely), which put the shipped surfaces 18-22% low
  there — and since `k ∝ σ²`, the convergence widget understated required
  volume by up to ~1.9×. **Re-measure before refitting** whenever the
  compile/hot-loop path has changed; refitting a stale grid just re-learns
  the old engine. Validate the promoted coefficients on *off-grid* points
  (the LOO xval in `refit_2d_logpoly.ts` only covers the fitted grid).
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

This wires the closed-form fallback surfaces only. What the planning cards
print comes from the engine's compile and from `runtimeSigmaBands.ts`; to change
a card's band, re-run `fit_runtime_sigma_bands.ts` (see
[Runtime σ band](#runtime-σ-band-what-the-cards-show)).

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
