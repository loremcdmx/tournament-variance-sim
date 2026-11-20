# Fitting & parameter sweeps

How to empirically measure the simulator's variance surface, summarise it in
closed-form coefficients for the research scripts, and measure the band the
planning cards print. Written so a new engineer — or a fresh Claude session
with the whole repo dumped in — can go from "I have some MTT results" to a
fitted surface without reading the whole codebase first. A surface never
reaches a number the app prints: the cards compile their row (see
[Why a fit and not a formula?](#why-a-fit-and-not-a-formula)).

If you are here to run a sweep right now, skip to [Quickstart](#quickstart).
If you want to fit your own data, skip to [Fit your own data](#fit-your-own-data).

## What we're fitting

The headline surface is σ\_ROI — the per-tournament standard deviation of
ROI — as a function of **field size** and **true ROI edge**. The surfaces
take two forms:

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

Current fits (raw grid data in `scripts/fit_beta_*.json`, constants in
`SIGMA_ROI_{FREEZE,PKO,MYSTERY,MYSTERY_ROYALE}` near the top of
`scripts/lib/sigmaSurfaces.ts`):

| Format                      | Form          | Coefficients | resid of the surface |
| --------------------------- | ------------- | ------------ | -------------------- |
| freezeout (realdata-linear) | single-β      | C0=0.6459, C1=0, β=0.3715 | 15% |
| PKO                         | 2D log-poly   | a0=0.28406, a1=0.07573, a2=0.01632, b1=1.22695, b2=-0.10408, c=-0.09765 | 5% |
| Mystery Bounty              | 2D log-poly   | a0=2.08379, a1=-0.28581, a2=0.03218, b1=2.18546, b2=-0.30473, c=-0.16109 | 14% |
| Mystery Battle Royale       | fixed-AFS runtime-helper line | C0=7.50416, C1=4.03121, β=0 | 1% |
| mix freeze/PKO              | exact σ² composition | no promoted `{C,β}` | — |

All four were refitted on 19 November 2026 from grids read off the compile of
that day (see [Quickstart](#quickstart)); the held-out and off-grid errors of
each are below and in the comments of `sigmaSurfaces.ts`.

These are the constants in `scripts/lib/sigmaSurfaces.ts` (the code wins if the
two ever disagree). **No number the app prints reads them.** The chips and the
prove-edge card take their point from the engine's own analytic compile and
their band from the Monte-Carlo calibration below; `computeConvergenceRows`
takes the σ of every tab as a required input and prints no volume (a dash) for
a tab whose σ it was not given. The `resid` column is each surface's error
against its own grid, not a card's band. The surfaces live under `scripts/`
because they are far from the cards' rows. `scripts/surface_vs_card_gap.ts`
compares each with the runtime σ the card of its format prints at the same
point (default finish model `powerlaw-realdata-influenced`; rake 10 %, Battle
Royale 8 %, its tab's default; every even field 50–600 and 80 log-spaced
fields to 50 000, at 10-point ROI steps over each tab's box; Battle Royale at
its 18 seats, in 1-point steps over its ±10 % box). On the
19 November 2026 engine the freeze line is off by up to 71.4 % (field 260,
ROI −30 %; p95 47.3 %), PKO by up to 30.5 % (field 50 000, ROI +80 %; p95
19.0 %) and Mystery by up to 107.4 % (field 50, ROI +80 %; p95 29.2 %), where
the surface's σ is 2.07× the card's and its volume 4.3×. Only the BR line,
fitted to the card's own row, stays within 0.1 %. Re-run the script after a
refit or an engine change before quoting these figures.
`scripts/lib/sigmaSurfaces.test.ts` fails if a file under `src/` imports,
defines or evaluates a surface.

The mix row is effective-only: σ²\_mix = p·σ²\_PKO + (1−p)·σ²\_freeze
is a composition of two surfaces, so no single `{C,β}` fits cleanly.
`scripts/mix_effective_fit.ts` reports an approximate effective `{C,β}` for
common mix ratios × ROIs of the two surfaces — a research summary. The app's
Mix tab blends the runtime σ of freeze, PKO and Mystery instead,
σ²\_mix = Σ wᵢ·σᵢ² over the components that carry weight.

Reading of coefficients: in the single-β form, `β` is the field-size
exponent, `C0` is the edge-free intercept, and `C1` is how much a +1.0
ROI edge inflates σ. In the 2D log-poly form, inspect the residual report
instead of trying to interpret one coefficient in isolation. Mystery
Royale's β is 0 by construction since the AFS slider is locked at 18 in
the UI. The BR tab centers on `formatRuntimeSigma("mystery-royale")`,
the compile of the editor's default BR row on the $10 ticket; the stored
`{C0, C1}` line is a compact helper through that same σ inside the BR slider
box (ROI ±10%), and `xval_br.ts` runs the engine's Monte Carlo on that row as a
sanity check. The freeze line has C1 = 0 because its finish model
(`freeze-realdata-linear`) plays one shape whatever the ROI.

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
surfaces still do: the sweep and probe scripts read and measure them; nothing
in `src/` does.

The price is one compile and one `validateSchedule` per ROI candidate: the
validation runs the calibration again to tell whether the run would accept
that ROI (`formatRuntimeRoiReached`), and at 50 000 players it costs about as
much as the compile. A full prove-edge table (18 candidates plus the anchor),
measured 2026-11-19 as CPU time of one node process on a busy machine: about
20–60 ms on a 1 000 field, 60–150 ms on 5 000, 130–200 ms on 10 000,
0.6–1.0 s on 50 000 (the slider cap) and 1.2–2.8 s on 100 000 (Mystery is the
slowest); a repeat with the same inputs is free (memoized by format, field,
ROI, rake, finish model and ITM target), and the card defers its input so a
slider drag does not queue one table per tick. Ocean KO has always been
runtime; it is a strict upper bound with no band.

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

One format can be re-measured alone with `BANDS_FILTER="pko|"` (the filter is a
substring of the cell id). The run then writes only that format's cells, so merge
them into the stored artifact: keep the other formats' cells and recompute that
format's `table` and `summary` entries from its 55 cells. `BANDS_RESUME=1` with a
larger `BANDS_BATCHES` adds batches to the cells already in the tmp dir (the seed is
per cell and a batch is a fixed slice of samples, so the first batches are reused).

### Result (51.4 G tournaments: freezeout, Mystery and Battle Royale at `06a6bb2`, the PKO cells at `b2faf2e`)

| format | cells | box: field, ROI | largest gap | largest SE | `resid` |
| --- | ---: | --- | ---: | ---: | ---: |
| freezeout | 55 | 50–50000, -30..+100% | 0.44% | 0.40% | **2%** |
| PKO | 55 | 50–50000, -30..+100% | 0.59% | 0.45% | **2%** |
| Mystery | 55 | 50–50000, -30..+100% | 0.85% | 0.47% | **2%** |
| Battle Royale | 10 | 18, -20..+100% | 3.93% | 1.92% | **7%** |

Every cell's stored analytic σ is today's `formatRuntimeSigma` to within 1 %
(`runtimeSigmaBands.test.ts` checks all 175). Freezeout, Mystery and Battle Royale
were re-measured on 19 November 2026 because their cells came from the run at
`12e7d5f`: before the xoshiro128** generator, the GG freezeout and bounty curves and
the Battle Royale cash/KO centre. Their analytic σ had moved by up to 0.05 %
(freezeout), 2.1 % (Mystery, the seven cells at field 300) and 0.67 % (Battle Royale).
Each cell ran at the script's own seed: 24 batches (120 M tournaments), 72 at field
50 000 for freezeout and Mystery and 48 at Mystery field 100 / ROI −20 %, which brings
every SE to 0.5 % or less; Battle Royale kept 800 batches (4 G) per grid cell and 200
(1 G) per probe, about 1.5 h of CPU in all. On those numbers the freezeout band
narrows from 3 % to 2 %, Mystery stays at 2 % and Battle Royale widens from 6 % to 7 %.

The band before this calibration, for the record: freezeout ±50 % on the chips and
±6 % on the prove-edge card, PKO ±11 %, Mystery ±3 % on the chips and ±13 % on the
prove-edge card, Battle Royale ±10 %, and schedule mode used the 6/11/13/10 % of the
closed-form surfaces. The 6, 11, 13 and 10 % were those surfaces' own errors against
their own grids (all four surfaces were refitted on 19 November 2026); they
stopped describing anything once the point moved to the engine's compile.

What the numbers say:

- The analytic σ and the engine agree to within 1.0 % in every cell of freezeout,
  PKO and Mystery, and to a few tenths of a percent below 10 000 players. The band is
  therefore mostly Monte-Carlo noise (2 SE). For freezeout and PKO the SE grows with
  the field (0.0–0.1 % at 50 players; at 50 000, 0.2–0.4 % for freezeout on 360 M
  tournaments and 0.3–0.45 % for PKO); Mystery's SE is not monotone in the field
  (0.2–0.4 % at 50 players, up to 0.47 % at field 300). The 55 freezeout cells pool to
  a gap of −0.002 % ± 0.006 % (inverse-variance; χ² 66 on 55 cells, largest |z| 2.9);
  the run at `12e7d5f` pooled to +0.045 % ± 0.006 % (χ² 118), the first-place excess
  of the old generator. The 55 PKO cells pool to −0.008 % ± 0.006 % (χ² 52, largest
  |z| 2.06). Mystery pools to −0.06 % ± 0.03 % (χ² 75, largest |z| 3.2: −0.46 % ±
  0.15 % at field 100, ROI +60 %); its unweighted mean gap is −0.04 %, a fiftieth of
  its band. Its worst cell for the band is +0.85 % ± 0.47 % (field 300, ROI −20 %).
- Battle Royale is noise-limited. One 10 000x envelope is hit about once per 2.5 M
  tournaments and carries most of the variance (85–88 % of it by the compile's own
  moments), so even 4 G tournaments per cell leave SE at 0.6–1.2 % (1 G on the probes:
  1.8–1.9 %). The cells cannot separate a gap under about 1–2 % from zero. The worst
  cell, ROI −20 %, read −3.93 % ± 1.17 % (z −3.4); its next 4 G tournaments (batches
  800–1599 of the same seed, not part of the published cell) read +0.02 % ± 1.12 %
  (both halves pooled: −1.94 % ± 0.81 %), and the compile's σ equals the exact
  moments of what the hot loop draws there (the alias tables, the Poisson KO count
  and the envelope tiers, summed by hand). To repeat the replicate, run that one cell
  with `BANDS_FILTER="mystery-royale|afs18|roi-0.2|rake0.08|powerlaw"
  BANDS_BR_BATCHES=1600` and its own `BANDS_TMP`, then pool the records with
  `batch` ≥ 800 in the tmp dir's `w*.jsonl` (about 15 minutes of CPU for the two
  halves; restore the JSON afterwards). So the 7 % is the same rule (gap + 2 SE,
  worst cell, rounded up) applied to a 3.4-SE dip in data that cannot resolve more,
  not a measured error. Pooled over the six grid cells
  the gap is −0.67 % ± 0.33 % (inverse-variance; −0.38 % ± 0.35 % without the ROI −20 %
  cell); the run at `12e7d5f` pooled to +0.73 % ± 0.33 % on the old generator.
- Rake, finish model and the global ITM target do not move the gap beyond noise
  (probes below), so none of them is gated. The ITM probes cover field 1 000 at
  ROI +10 % only; an independent check at targets 5–40 % stayed within the bands. The box is the extent of the grid: the
  full AFS slider (50–50 000) and the ROI range of the sliders and of the prove-edge
  candidates; outside it (a row with 200 000 players, ROI +150 %) the cards show the
  point only. The old gate had no ROI limit for freezeout and stopped PKO and Mystery
  at −20..+80 %, with no measurement behind either.
- `k ∝ σ²`: ±2 % on σ is about ±4 % on the volume the cards print.
- The PKO cells were re-measured after the knockouts moved to the elimination tree
  (exact Bernoulli knockouts, a fixed own head for the winner and a per-place head-size
  factor, in place of a Poisson count with a flat 0.4 head noise): all 55 cells at the
  script's own seeds, 120 M tournaments each and 180 M at field 50 000 / ROI −30 % and
  −20 %, whose SE was 0.56 % and 0.50 % at 120 M. Every SE is now at most 0.45 %. The
  largest gap is −0.59 % (50 000, ROI +30 %, z −1.6) and the largest |gap| + 2 SE 1.41 %
  (50 000, ROI 0: +0.56 % ± 0.42 %), so the band stays 2 % (1 % on the 30
  specified-grid cells alone). Rake, finish model and the ITM target stay under 0.1 %.

Rake, finish-model and global-ITM probes (field 1 000 and ROI +10 %; Battle Royale at
its 18-max field; a Battle Royale row carries its own ITM, so the target is not probed
there), in the same units:

| format | rake | finish model | global ITM | MC/analytic − 1 | SE |
| --- | ---: | --- | ---: | ---: | ---: |
| freezeout | 0 | default | off | -0.06% | 0.09% |
| freezeout | 0.2 | default | off | +0.07% | 0.07% |
| freezeout | 0.1 | power-law | off | -0.04% | 0.07% |
| freezeout | 0.1 | linear-skill | off | +0.01% | 0.07% |
| freezeout | 0.1 | default | 12 % | +0.17% | 0.08% |
| freezeout | 0.1 | default | 25 % | -0.15% | 0.09% |
| PKO | 0 | default | off | +0.07% | 0.07% |
| PKO | 0.2 | default | off | +0.01% | 0.06% |
| PKO | 0.1 | power-law | off | +0.02% | 0.07% |
| PKO | 0.1 | linear-skill | off | -0.02% | 0.07% |
| PKO | 0.1 | default | 12 % | -0.07% | 0.07% |
| PKO | 0.1 | default | 25 % | -0.05% | 0.10% |
| Mystery | 0 | default | off | +0.13% | 0.24% |
| Mystery | 0.2 | default | off | -0.01% | 0.19% |
| Mystery | 0.1 | power-law | off | -0.21% | 0.20% |
| Mystery | 0.1 | linear-skill | off | -0.10% | 0.15% |
| Mystery | 0.1 | default | 12 % | -0.03% | 0.17% |
| Mystery | 0.1 | default | 25 % | -0.12% | 0.24% |
| Battle Royale | 0 | default | off | +1.64% | 1.92% |
| Battle Royale | 0.2 | default | off | +0.02% | 1.76% |
| Battle Royale | 0.08 | power-law | off | +0.65% | 1.88% |
| Battle Royale | 0.08 | linear-skill | off | -0.31% | 1.89% |

Per-cell tables, MC/analytic − 1 in percent with the SE in brackets (field down, ROI across):

**freezeout, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | +0.1% (0.0) | -0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) |
| 100 | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.1% (0.0) | -0.0% (0.0) |
| 300 | +0.1% (0.1) | -0.1% (0.1) | -0.1% (0.0) | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) |
| 1000 | -0.1% (0.1) | +0.1% (0.1) | -0.1% (0.1) | +0.1% (0.1) | -0.0% (0.1) | -0.0% (0.1) | -0.1% (0.1) |
| 3000 | -0.2% (0.2) | +0.1% (0.2) | +0.0% (0.1) | +0.1% (0.1) | +0.1% (0.1) | +0.1% (0.1) | +0.0% (0.1) |
| 10000 | +0.1% (0.3) | -0.0% (0.3) | +0.0% (0.2) | -0.4% (0.2) | -0.1% (0.2) | -0.1% (0.2) | +0.1% (0.1) |
| 50000 | +0.2% (0.4) | -0.3% (0.4) | +0.1% (0.3) | -0.4% (0.3) | -0.1% (0.2) | +0.1% (0.2) | -0.3% (0.2) |

**PKO, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | -0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) |
| 100 | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) |
| 300 | -0.0% (0.1) | +0.0% (0.0) | -0.0% (0.0) | -0.0% (0.0) | +0.0% (0.0) | +0.0% (0.0) | -0.0% (0.0) |
| 1000 | -0.0% (0.1) | +0.0% (0.1) | +0.1% (0.1) | -0.1% (0.1) | -0.1% (0.1) | +0.0% (0.1) | -0.0% (0.0) |
| 3000 | -0.3% (0.1) | -0.3% (0.1) | +0.2% (0.1) | -0.1% (0.1) | -0.1% (0.1) | -0.1% (0.1) | -0.0% (0.1) |
| 10000 | +0.1% (0.3) | -0.2% (0.2) | -0.1% (0.2) | +0.3% (0.2) | +0.2% (0.2) | -0.1% (0.1) | +0.2% (0.1) |
| 50000 | +0.2% (0.5) | -0.0% (0.4) | +0.6% (0.4) | +0.4% (0.4) | -0.6% (0.4) | +0.1% (0.4) | +0.1% (0.3) |

**Mystery, rake 0.1: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -30% | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | -0.1% (0.4) | -0.0% (0.3) | -0.5% (0.2) | +0.5% (0.3) | +0.1% (0.2) | +0.0% (0.2) | -0.0% (0.2) |
| 100 | -0.5% (0.3) | +0.2% (0.3) | +0.1% (0.2) | -0.2% (0.3) | -0.3% (0.2) | -0.5% (0.1) | -0.2% (0.2) |
| 300 | -0.1% (0.4) | +0.9% (0.5) | +0.1% (0.4) | -0.3% (0.2) | -0.2% (0.2) | -0.2% (0.1) | -0.3% (0.1) |
| 1000 | +0.4% (0.4) | +0.0% (0.3) | +0.1% (0.2) | -0.1% (0.2) | -0.3% (0.1) | +0.1% (0.2) | -0.1% (0.1) |
| 3000 | +0.1% (0.3) | +0.0% (0.2) | -0.1% (0.1) | +0.2% (0.1) | -0.2% (0.1) | +0.0% (0.2) | -0.1% (0.1) |
| 10000 | -0.0% (0.2) | +0.4% (0.2) | +0.1% (0.2) | -0.1% (0.2) | +0.1% (0.2) | +0.2% (0.1) | +0.2% (0.1) |
| 50000 | -0.6% (0.4) | -0.2% (0.3) | -0.2% (0.3) | -0.2% (0.2) | +0.4% (0.2) | -0.2% (0.2) | +0.2% (0.2) |

**Battle Royale, rake 0.08: MC/analytic − 1 in % (SE in %)**

| AFS ↓ ROI → | -20% | 0% | 10% | 30% | 60% | 100% |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 18 | -3.9% (1.2) | -0.7% (1.0) | -0.5% (0.9) | -0.2% (0.9) | -0.3% (0.7) | -0.4% (0.6) |

Every raw number, including kurtosis, both SE estimators and the realized ROI of each
cell, is in `scripts/fit_runtime_sigma_bands.json`.

## Quickstart

Two producers — pick the right one for what you're doing:

### Canonical grids and surfaces

- **`scripts/fit_br_fixed18.ts`** — rebuilds the BR runtime helper line at
  fixed AFS=18 inside the BR slider box (ROI ±10%), from
  `formatRuntimeSigma("mystery-royale")`: the card's own row, the editor's
  default BR row on the $10 ticket. Writes `scripts/fit_beta_mystery_royale.json`.
  Until 19 November 2026 it fitted a hand-built $50 row, which draws the $25
  envelope table and read 27 % under the card; the line now reaches the card's σ
  within 0.08 % over the whole box.
- **`scripts/xval_br.ts`** — runs the engine's Monte Carlo on that same row at
  four ROIs between the fit points (100 M tournaments each) and checks the line
  against it within its `resid` plus 2 SE. At 100 M tournaments the SE is about
  6 %, so it catches a wrong row or a broken line, not a 1 % gap;
  `fit_runtime_sigma_bands.ts` (4 G per BR cell) is the precise check of the
  analytic σ against the hot loop.
- **Freeze / PKO / Mystery canonical fits** — the artifacts
  `scripts/fit_beta_freeze_realdata.json` (18 fields × 7 ROIs),
  `scripts/fit_beta_pko.json` and `scripts/fit_beta_mystery.json` (18 fields × 11
  ROIs), all written by `resweep_sigma.ts`. These back the `SIGMA_ROI_*` constants
  in `scripts/lib/sigmaSurfaces.ts`.
- **`scripts/resweep_sigma.ts`** — regenerates a canonical freeze, PKO or
  Mystery grid on the **current** engine, with the row recipe of
  `fit_sigma_parallel.ts`. Each cell is the exact per-tournament σ of the
  compiled row in buy-ins (`compiledEntryMoments`): the value a Monte-Carlo sweep
  of the cell converges to, without its noise, in about a second per format:

  ```bash
  FORMAT=freeze  npx tsx scripts/resweep_sigma.ts
  FORMAT=pko     npx tsx scripts/resweep_sigma.ts
  FORMAT=mystery npx tsx scripts/resweep_sigma.ts
  npx tsx scripts/refit_2d_logpoly.ts              # new coefficients
  ```

  `refit_2d_logpoly.ts` prints both forms for each format; PKO and Mystery
  promote the 2D log-poly (Model B), freeze the single-β line (Model A). The
  freeze row (`mtt-standard`, `freeze-realdata-linear`) plays one shape whatever
  the ROI, so its seven columns are the same σ and its C1 is 0.

  It used to run the engine (120 000 samples × 500 tournaments per cell, about
  8 minutes on 16 workers). The two agree: the compiled σ of the engine just
  before the October 2026 PKO payout curve matches the Monte-Carlo PKO grid
  measured in July within ±0.6 % in all 198 cells, and on the current engine
  the hot loop on 15 cells spanning the box (fields 50–50 000 × ROI −20/+10/+80 %,
  20 M tournaments each) lands within its own SE (0.06–0.96 %; χ² 17.0 on 15
  cells, largest |z| 2.3). `fit_runtime_sigma_bands.ts` measures the same gap
  over the cards' rows.

  **Why this exists:** a stored grid ages. In 2026-07 an audit found the
  engine had drifted ~10-14% above the stored PKO grid at small fields ×
  high ROI (and the stored Mystery grid had been measured with a different
  payout structure entirely), which put the shipped surfaces 18-22% low
  there — and since `k ∝ σ²`, the convergence widget understated required
  volume by up to ~1.9×. In 2026-11 the July PKO grid read 0.67–1.05× the
  engine: the October `mtt-gg-bounty` curve raised σ by 2–49 % (most at fields
  750–3 000) and the elimination-tree knockouts lowered it by up to 7 % at field
  50, so `SIGMA_ROI_PKO` read 0.73–1.22× the engine until it was refitted
  (`scripts/lib/sigmaSurfaces.test.ts` now compares the stored PKO grid with the compile in
  all 198 cells and fails past 1 %). **Re-measure before refitting** whenever the
  compile/hot-loop path or a payout table has changed; refitting a stale grid
  just re-learns the old engine. Validate the promoted coefficients on
  *off-grid* points (the held-out errors in `refit_2d_logpoly.ts` only cover the
  fitted grid): the PKO surface misses 170 geometric midpoints between the
  grid points by 3.9 % at p95, and misses by up to 9.7 % around fields
  260-300 at ROI −20 %, where steps in the `mtt-gg-bounty` curve put a narrow
  feature into σ that no grid field samples. Midpoints alone do not see such a
  step: check every field up to a few thousand players.

  **Freeze and Mystery, refitted 19 November 2026.** The Mystery grid had been
  measured by the old Monte-Carlo sweep at a per-KO log-variance of 2.4
  (`mysteryBountyVariance` 2.0 plus a 0.4 PKO head-size term the recipe used to
  add, a channel the engine no longer has) and read 1.00–1.16× today's compile;
  the freeze grid (Monte Carlo, April) read 0.99–1.01× except at field 200, 1.04×.
  Both were re-read from the compile and refitted. Their errors, held out on the
  grid and on a dense off-grid scan (170 geometric midpoints; every field
  50–2 000 at ROI −20/0/+10/+30/+80 %; 401 log-spaced fields 2 000–50 000 at the 11
  grid ROIs):

  | surface | leave one cell out: mean / p95 / max | leave one field out: mean / p95 / max | midpoints p95 / max | dense p95 / max | `resid` |
  | --- | --- | --- | --- | --- | ---: |
  | Mystery | **4.5 / 13.05 / 43.0 %** (field 50, ROI +80 %) | 5.6 / 22.5 / 52.0 % | 7.0 / 10.3 % | 8.1 / 35.4 % (fields 50–64, ROI +80 %; from field 100: 7.9 / 13.1 %) | 14 % |
  | freeze | 4.0 / 11.5 / 11.8 % (in effect in-sample) | **4.5 / 14.2 / 14.2 %** (field 50 000; 12.0 % at field 300) | 10.0 / 10.0 % | 9.4 / 13.3 % (fields 255–280) | 15 % |

  `resid` is the bold held-out p95, rounded up. The held-out unit is a distinct
  cell. The freeze columns are copies of one another, so leaving out one cell keeps
  six exact copies of it in the fit and returns the in-sample miss (11.1 % at
  most); the freeze grid holds 18 distinct cells, one per field, and with 18 the p95
  is the max. Leaving out a whole field is an extrapolation at fields 50 and
  50 000, which is where the Mystery and PKO field-out p95 come from (PKO: 6.3 /
  11.0 % against 4.9 / 9.2 % cell by cell). `refit_2d_logpoly.ts` prints both.

  The freeze line passes over a plateau: σ stays at 4.40–4.51 buy-ins from 200 to
  260 players and then climbs (4.84 at 300, 6.28 at 500), which no single power of
  the field can follow. The 2D log-poly form follows it better (leave one field
  out: p95 = max 9.9 %), but freeze keeps the single-β form: no card reads the
  surface, and `fit_drift_report.ts` consumes it as a line.
  `scripts/lib/sigmaSurfaces.test.ts` compares every stored cell of all three grids, and the
  BR line's five points, with today's compile (1 %), holds the freeze line to the
  least-squares fit of its grid, and holds every held-out freeze field within
  `resid`.
- **`scripts/fit_beta_pko_core.json`** — *not* an independent
  canonical grid. It's a 7-ROI PKO baseline subset (same ROIs as the
  200k-AFS probe) retained purely so `fit_drift_report.ts` can
  compare the probe against a matched-shape reference. It has no
  current producer script and backs no surface.

### Diagnostic 200k-AFS probe (NOT promoted automatically)

To see how the surfaces extrapolate from 50k to 200k players, run the
mini-sweep:

```bash
npx tsx scripts/probe_afs_ceiling.ts
```

It measures only fields 75k/100k/150k/200k × five ROIs across
Freeze/PKO/Mystery and writes `scripts/afs_ceiling_probe.json`. The pass
criterion is per-format `max |Δ/σ| <= resid` of the surface. Last 2026-04-20 run:
PKO passed, Freeze and Mystery failed. That verdict is about the surfaces
only: the cards no longer read them, so it does not decide the slider ceiling.
What does is the runtime band (`runtimeSigmaBands.ts` holds only on the grid
`fit_runtime_sigma_bands.ts` measured, up to field 50 000) and the compile
cost (0.6–1.0 s per prove-edge table at 50 000, 1.2–2.8 s at 100 000; see
[Why a fit and not a formula?](#why-a-fit-and-not-a-formula)). Raising
`AFS_LOG_MAX` past 50k means measuring band cells out there first.

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
fit into `scripts/lib/sigmaSurfaces.ts`.

## The sweep space

| Dimension | Canonical grid (`resweep_sigma.ts`)                                 | 200k diagnostic sweep (`fit_sigma_parallel.ts`) |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Field     | 18 log-spaced sizes 50…50 000                                       | 22 sizes 50…200 000                             |
| ROI       | PKO / Mystery: 11 = {−20, −10, 0, +5, +10, +15, +20, +25, +30, +40, +80}% | 7 main {−20, −10, 0, +10, +20, +40, +80}% + 4 dense {+5, +15, +25, +30}% |
|           | freeze: 7 = {−20, −10, 0, +10, +20, +40, +80}%                      | the same for freeze                              |
| Tourneys  | none, σ read from the compile                                       | 500                                             |
| Samples   | none                                                                | 120k                                            |

Everything else (buy-in $50, rake 10 %, bountyFraction 0.5) is held fixed. The
fit is **about field-and-ROI**, not about format/rake sensitivity — those get
separate sweeps if you need them.

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

That is the shape of the Monte-Carlo artifacts `fit_sigma_parallel.ts` writes.
The canonical grids `resweep_sigma.ts` writes carry `meta`, `fields`, `rois`,
`table`, `perRoiFits` (with each ROI's power-law R²), `globalBeta` and
`cRoiLinear: { C0, C1 }`, with no `globalR2`, no `cRoiLinear.r2` and no
`logPolyPooled`. On the freeze grid, whose columns are copies, `C(roi)` does not
vary, so an R² of the `C(roi)` line would be 0/0. Mystery's per-ROI R² falls from
0.91 at ROI −20 % to 0.73 at +80 %: its σ(field) bends on a log-log plot, which is
why PKO and Mystery promote the 2D log-poly form and not a power law. For the
canonical grids the checks are the in-sample R² and the held-out errors
`refit_2d_logpoly.ts` prints for both forms, plus a dense off-grid scan against
the compile (see [Canonical](#canonical-grids-and-surfaces)).

`logPolyPooled` is a **diagnostic-only** pooled quadratic fit of
`log σ` against `log field`, with both inputs per-ROI mean-centered
before pooling (`xs = log f − mx(roi)`, `ys = log σ − my(roi)`). That
centering means the reported `{a, b1, b2}` **cannot be evaluated at an
arbitrary (field, roi)** without the per-ROI `mx(roi)`, `my(roi)`
constants, which aren't stored in the artifact. Use it only to compare
curvature: `b2 ≈ 0` with `logPolyPooled.r2 ≈ globalR2` means single-β
captures the shape; a materially nonzero `b2` with higher `r2` says
single-β is leaving structure on the table past ~10k AFS. Promoting a
log-poly form to a surface requires a second, evaluable fit (not
centered) — this artifact doesn't provide that.

For a single-β promotion, the tuple you paste into the surface is
`{ C0: cRoiLinear.C0, C1: cRoiLinear.C1, beta: globalBeta }`.
`perRoiFits[i].C` are the per-ROI intercepts that `cRoiLinear` then
regresses through — the joint fit freezes β across all ROIs and lets
only `C(roi)` vary.

For PKO / Mystery, do not paste the artifact's single-β summary into
the surface. Run `scripts/refit_2d_logpoly.ts` and promote the reported
`a0/a1/a2/b1/b2/c` coefficients only after `fit_drift_report.ts` confirms
user-zone residuals are acceptable.

Pitfalls of the `fit_sigma_parallel.ts` artifacts, for a single-β promotion (the
canonical grids carry only `perRoiFits[i].r2`):

- **`cRoiLinear.r2`** should be ≥ 0.99. This is the fit behind a
  single-β surface's ROI term; if it drops, the linear `C(roi) = C0 + C1·roi`
  assumption is the problem — try `C0 + C1·roi + C2·roi²` and upgrade
  the evaluator, `evalSigma` in `scripts/lib/sigmaSurfaces.ts` (the `SigmaCoef` types live there).
- **`perRoiFits[i].r2`** in the ~0.94 range is normal, not a red flag.
  The engine's σ(field) isn't a pure power law — there's curvature at
  tiny fields (≤75) and at the mega-field tail. R² ≈ 0.94 is what a
  single `{C, β}` can capture; the residuals are a known shape artifact.
- **`globalR2`** reflects the single-β constraint across all 11 ROIs.
  Expect similar ~0.94; much below that means one format's σ(field)
  slope shifts with ROI enough to warrant per-ROI β (not currently
  supported by `evalSigma`).
- If any `perRoiFits[i].r2 < 0.80` or you see a clear break in σ(field)
  on a log-log plot, the power-law assumption is failing at that ROI —
  likely the engine saturates (see "edge-case behavior" in
  `notes/review_dossier.md`). Drop the outlier ROI before refitting or
  narrow the field range.

## Updating a surface

This updates the closed-form surfaces the research scripts read, nothing the
app prints. What the planning cards print comes from the engine's compile and
from `runtimeSigmaBands.ts`; to change a card's band, re-run
`fit_runtime_sigma_bands.ts` (see
[Runtime σ band](#runtime-σ-band-what-the-cards-show)). Do not import a surface
into `src/`, not even as a fallback: `scripts/lib/sigmaSurfaces.test.ts` fails
if a file there imports, defines or evaluates one.

Never promote a probe fit without first running `fit_drift_report.ts`
and confirming that user-zone residuals don't regress. A fit with better
global R² but worse residuals inside `field ∈ [500, 10k], roi ∈ [−10 %, +30 %]`
is a net loss for the scripts that read it.

1. Open `scripts/lib/sigmaSurfaces.ts`.
2. Find the coefficient constants near the top of the file:
   `SIGMA_ROI_FREEZE`, `SIGMA_ROI_PKO`, `SIGMA_ROI_MYSTERY`,
   `SIGMA_ROI_MYSTERY_ROYALE`. Each is a `SigmaCoef` literal with
   `kind: "single-beta"` or `kind: "log-poly-2d"`.
3. For freeze, PKO and Mystery, paste the block `scripts/refit_2d_logpoly.ts`
   prints under "Production-ready constants": the single-β line for freeze
   (`C0`/`β` equal the artifact's `cRoiLinear` / `globalBeta`), the 2D
   coefficients for PKO and Mystery, and `resid` = the held-out p95 rounded up
   (one field held out where the ROI columns are copies, as for freeze; one cell
   otherwise). For MBR, use
   `fit_beta_mystery_royale.json` (produced by
   `scripts/fit_br_fixed18.ts`); its β is 0 by construction and its
   `resid` is the line's largest miss of the card's σ over the BR slider
   box, rounded up (`scripts/lib/sigmaSurfaces.test.ts` walks the box);
   `scripts/xval_br.ts` is the Monte-Carlo sanity check of the same row.
4. Verify: `npx vitest run scripts/lib/sigmaSurfaces.test.ts && npx tsc -p
   tsconfig.scripts.json`. The test holds each surface to its grid and pins
   its value at one box centre (5 %), so a broken or pasted-over constant fails
   there.

## Fit your own data

You have a CSV of real tournaments. You want to fit this model to your
data. Two paths — pick based on what your data looks like:

### Path A — your data is per-tournament finish results

Columns like `player_id, tourney_id, finish_place, field_size, buyin, profit`.
This is the input the calibration pipeline was designed for. The full
design is not kept in this repo; the short version:

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

This is multi-day work. The scaffold script doesn't exist yet
(`scripts/calibrate.ts` was only ever planned). Ping the author before
building it so we stay aligned on format.

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
   usually in `mysteryBountyVariance`, `pkoHeat`, or the payout
   curve shape.

## Long-running data collection: `continuous_fit.ts`

When you want to sample a much wider scenario space than the fixed
18 × 11 grid (18 × 7 for freeze) — different rakes, buy-ins, payout structures, finish models,
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
  finishModel: { id: "pko-realdata-linear" },
}
```

If you're adding a new sweep, copy `resweep_sigma.ts` — it is the canonical
recipe. It reads each cell from the compile (`compiledEntryMoments`), which is
exact for a row whose tournaments are independent; a sweep over channels that
tie tournaments together (skill uncertainty, session shocks, drift, tilt) has to
run the engine, as `fit_sigma_parallel.ts` does. (`fit_beta_pko.ts` is the old
7-ROI recipe and refuses to overwrite `fit_beta_pko.json`; see its header.)

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

### GG freezeouts — `mtt-gg-freeze` (aggregate fit, Oct 2026)

`mtt-gg` copies one CoinPoker tournament (Mini CoinMasters, ₹25, 911
entries with re-entries). Real GGPoker freezeouts pay the winner much
less, so `mtt-gg-freeze` is fitted to aggregated real results instead of
a single sample: per-place average prizes of single entries in GG
freezeouts of 250–9,999 runners (no satellites, steps, T$ builders,
multi-day stages or rebuys), bucketed as places 1–9 and then by share of
the field. Only those per-bucket averages were used; no player-level data
is in this repo.

| | Value |
|---|---|
| 1st place | 16.9 % of the pool at 250 runners, 8.27 % at 10,000, log-linear in between, flat outside |
| 2nd | 1st / 1.22 (`topRatio`) |
| 3rd–9th | each 1.31× smaller than the one above (`ftRatio`) |
| Paid | 14.5 % of the field |
| Min-cash | 2.24 buy-ins |

How it was fitted and checked:

1. **Target.** The σ of one entry with a *uniform* finish. With no skill
   in the picture, that σ depends on the payout table alone, so it tests
   the table without assuming any finish model.
2. **Train.** Jan–Oct 2026, seven field bands (250–499 … 5,000–9,999).
   The parameters minimise the miss on that σ per band, with the shares of
   places 1, top-3 and top-9, the paid share and the min-cash as secondary
   terms.
3. **Hold-out.** The whole of 2025, same filter and bands, untouched while
   fitting. Pass rule fixed in advance: in every band the
   data / table σ ratio is within 1.00 ± max(2 SE, 0.03), and the pooled
   ratio is within 1.00 ± 0.03. Result: 0.98–0.99 in the five bands from
   250 to 2,499 runners, 1.01 and 1.10 in the two big-field bands (their
   SE is 5–11 %: only 2–3 wins), 1.02 pooled. `mtt-gg` gives 0.89–0.95
   from 500 runners up and 0.90 pooled.
4. **What it does not cover.** The table fixes the prize ladder only.
   Skilled players also cash more often than the finish model's ITM
   shell (paid share) assumes, which keeps the full model σ ~5 % above
   real results even on this table. Fields above 10,000 and below 250
   are extrapolated. The flat top (2nd ≈ 82 % of 1st) may partly come
   from final-table deals; the aggregates cannot tell.

A first attempt that kept `mtt-gg`'s field slope and trained on 700–2,499
only passed 2025 in those fields but failed in 250–699 (the table paid
13.5 % to 1st where real tournaments pay 15–17 %); hence the wider
training range and the table's own slope.

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
