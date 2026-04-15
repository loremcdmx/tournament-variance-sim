# Changelog

All notable changes to tournament-variance-sim live here. One entry per
day (YYYY-MM-DD). User-facing changes first, engine/calibration second,
tooling/infra last.

## 2026-04-15

### Background sibling-run precompute

- After a foreground run finishes, `useSimulation` now precomputes up to
  4 additional sibling runs on the same `SimulationInput` with derived
  seeds (golden-ratio stride), sequentially, on the same worker pool.
  Each completed sibling is cached; `ResultsView` renders a
  `‹ N/M ›` selector at the top that instantly swaps `result` to any
  cached run — no worker round-trip.
- Batch key = `JSON.stringify(input with seed=0)`. Any non-seed change
  (schedule, controls, compare flags) starts a new batch; clicking Run
  again also resets via a `batchRef.version` bump that orphans the
  in-flight background loop.
- Twin/PD-compare passes are built via a shared `buildPasses` helper so
  cached siblings use the exact same calibration/flip logic as the
  foreground run. Background errors are silent and halt the loop.
- Added i18n keys `seedBatch.label/prev/next/computing/full` (EN + RU).

### Real-data payout calibration

- **New corpus** `data/payout-samples/` of ground-truth MTT payout tables
  scraped from real tournaments. First three samples: GG Mini CoinMasters
  (911, regular), GG Mini CoinHunter PKO (541, bounty, partial top-34),
  PokerStars SCOOP 119-L Main Event (16,883, regular). JSON schema +
  add-a-sample workflow in `data/payout-samples/README.md`.
- **Browser-safe parser** `src/lib/sim/realPayouts.ts` (`validateSample`,
  `expandFractions`, `summarizeSample`) and **node-only loader**
  `scripts/lib/loadPayoutSamples.ts` — split so the parser can be
  imported by worker-safe code paths without dragging `node:fs`.
- **Comparison CLI** `npx tsx scripts/compare_real_samples.ts` diffs
  every sample against the modelled presets and prints a
  (1st%, 2nd/1st, top9%, min-cash-bi, paid%) table for quick retuning.
- **Auto-picking test** `src/lib/sim/realPayouts.test.ts` runs
  structural + sanity checks on every sample it finds on disk.

### `buildRealisticCurve` rewrite — exact-constraint solver

- Old two-pass fixed-point tuned `minRaw` against a stretched-exponential
  tail and drifted 1–4 pp on huge fields. Replaced with a direct solver:
  - Final table built in normalized space from `firstShare` and
    `ftRatio` (flat-top-2 supported for PKO regular side).
  - Tail parameterised as `tail[j] = tailEnd + (tailStart − tailEnd) ·
    (1 − t)^c`.
  - `c` solved by 80-step bisection so `sum(tail) = 1 − ftSum` exactly.
- Result: **1st share and min-cash both hit post-normalization targets
  exactly.** Real-sample fit vs new presets:

  | Sample                    | 1st Δ    | top9 Δ  | min-cash Δ |
  | ------------------------- | -------- | ------- | ---------- |
  | GG Mini CoinMasters (911) | −0.02 pp | −0.98pp | ±0.00×bi   |
  | SCOOP 119-L Main (16883)  | ±0.00 pp | +0.14pp | ±0.00×bi   |
  | Mini CoinHunter PKO (541) | ±0.00 pp | +3.67pp | ±0.00×bi   |

  (Bounty top9 drift is the unavoidable trade: a flat-top-2 FT with a
  6.9 % first share forces a shallower FT-cascade to keep ft[8] large
  enough for the tail to absorb 70 % of the pool.)

### Field-size-aware preset anchors

- Replaced per-preset fixed `firstShareRaw` with `firstShareForField(
  small, large, players)` — log-linear interpolation between a
  500-runner anchor and a 15 000-runner anchor. Real tables compress
  1st share as the field grows (tier rounding eats the top); anchoring
  at both ends matches the GG (911-runner) and PS SCOOP (16k-runner)
  samples simultaneously without a custom AFS fudge.
- Retuned all MTT presets to real-sample targets:
  - `mtt-standard`: 19 % → 12 %, ftRatio 1.40, min 1.75
  - `mtt-pokerstars`: 16 % → 10.75 %, ftRatio 1.40, min 1.75
  - `mtt-gg`: 17.8 % → 11.5 %, ftRatio 1.41, min 1.84
  - `mtt-sunday-million`: 16.5 % → 11.5 %, ftRatio 1.42, min 1.85
  - `mtt-gg-bounty`: flat 6.9 % top-2, ftRatio 1.26, min 1.71
  - `mtt-flat`: 9.5 % → 6.5 %, ftRatio 1.25, min 2.0
  - `mtt-top-heavy`: 25 % → 17 %, ftRatio 1.55, min 1.5
- PD `>700` fallback now uses the same exact-constraint generator with
  PD-shape params (22 % → 13 %, ftRatio 1.42).

### PrimeDope compare: payout-structure default flip

- The `primedope-binary-itm` comparison pass previously **always**
  forced every row onto `mtt-primedope`, conflating finish-model and
  payout-structure differences on the A/B chart. Flipped the default:
  both passes now honour the user's selected payout, so the comparison
  isolates the finish-model effect.
- **New opt-in flag** `SimulationInput.usePrimedopePayouts` re-enables
  the old override, for reproducing PD's σ on their reference
  scenarios. Threaded through `compileSchedule` →
  `compileRowVariants` → `compileSingleEntry` as a
  `forcePrimedopePayouts` boolean.
- **UI toggle** in ControlsPanel under the twin-run selector, visible
  only when `compareMode === "primedope"`. Default off. Added
  `controls.usePrimedopePayouts` and `help.usePrimedopePayouts` i18n
  keys (EN + RU). Wired through `ControlsState`, `initialControls`,
  `BASE_CONTROLS`, `ZERO_SHOCKS`, `extractModelPatch`, `buildInput`.

### Test suite

- `engine.test.ts`: weakened `samplePaths.worst` drawdown assertion
  from strict equality to `≤ stats.maxDrawdownWorst + ε`. Root cause:
  `samplePaths.worst` selects by final profit (`hiResWorstFinal`),
  while `stats.maxDrawdownWorst` is the global max across all samples
  — different samples in general. The old calibration accidentally
  made them agree on the default scenario; retuning exposed the
  latent invariant mismatch.
- 101/101 tests green after all changes.
