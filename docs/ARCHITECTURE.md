# Architecture

This document describes the data flow, module boundaries, and invariants of the Monte Carlo engine. If you're forking and want to change core behavior, read this first — then browse `src/lib/sim/` with this map in hand.

## High-level layout

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React, main thread)                                     │
│  ─ src/app/page.tsx          composes the page               │
│  ─ src/components/*          schedule editor, controls, view │
│                                                              │
│         ▼ SimulationInput                                    │
│                                                              │
│  ─ src/lib/sim/useSimulation.ts                              │
│       owns the worker pool, dispatches shards,               │
│       merges results, exposes {status, progress, result}     │
│                                                              │
│         ▼ ShardRequest × N workers                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Web Worker pool (N ≈ hardwareConcurrency / 2)       │    │
│  │  ─ src/lib/sim/worker.ts                             │    │
│  │        thin dispatcher — onmessage routes to engine  │    │
│  │  ─ src/lib/sim/engine.ts                             │    │
│  │        compileSchedule / simulateShard / buildResult │    │
│  │  ─ src/lib/sim/finishModel.ts                        │    │
│  │        pmf + α calibration                           │    │
│  │  ─ src/lib/sim/payouts.ts                            │    │
│  │  ─ src/lib/sim/icm.ts                                │    │
│  │  ─ src/lib/sim/rng.ts                                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│         ▲ RawShard × N → mergeShards → SimulationResult      │
│                                                              │
│  ResultsView (charts, tables)                                │
└──────────────────────────────────────────────────────────────┘
```

## Data flow per run

1. **User clicks Run.** `useSimulation.onRun(input)` is called with `SimulationInput` (schedule, samples, seed, model, bankroll, noise params, etc.).

2. **Build step.** The hook sends a `BuildRequest` to worker 0. That worker runs `compileSchedule(input)` which:
   - For each row, picks the effective field size (or enumerates variants if `fieldVariability` is set).
   - Calls `buildFinishPMF(N, model, α)` with a starting α, then `calibrateAlpha()` which binary-searches α so that the *realized* ROI (Σ pmf × payout − cost) matches `row.roi`. This is the honest calibration.
   - For the PrimeDope compare run, uses `calibrateShelledItm` + `pdCurves` to pin ITM rate and solve for α/shape.
   - Builds alias tables for fast weighted sampling.
   - Returns `CompiledEntry[]` — flat, shard-independent, serializable.

3. **Shard dispatch.** The hook splits `[0, samples)` into K contiguous shards and sends one `ShardRequest` per free worker. Workers are stateless — each receives the compiled schedule in the request and runs `simulateShard(sStart, sEnd)`. Seeds are not shard-local: the hot loop uses `mixSeed(baseSeed, sampleIdx, rowIdx, bulletIdx)` where `sampleIdx` is the *global* index in `[0, samples)`. This is what makes the run deterministic independent of pool size.

4. **Progress reporting.** Workers post `ShardProgressMsg` periodically (every ~1000 samples or so). The hook aggregates into a single `progress` number exposed to the UI.

5. **Shard merging.** When a worker returns `ShardResultMsg`, the hook stores the `RawShard`. Once all K shards arrive, `mergeShards([...])` concatenates the shard-local buffers, picks the global best/worst path, sums histograms, and then `buildResult()` does the post-processing: percentile envelopes, downswings catalog, row decomposition, risk-of-ruin integration, convergence curves.

6. **Twin run (compare mode).** When `compareWithPrimedope` is true, steps 2–5 run a *second* time with `calibrationMode: "primedope-binary-itm"` on the same seed and same schedule. The result is attached as `result.comparison`. This second run is dispatched right after the first completes to keep worker allocation simple.

## Key types

All in `src/lib/sim/types.ts`:

- **`TournamentRow`** — one line in the schedule. Has buy-in, rake, field, ROI, payout structure, and optional bounty/mystery/ICM fields.
- **`SimulationInput`** — `{schedule, scheduleRepeats, samples, bankroll, seed, finishModel, ...noise, ...tilt}`.
- **`FinishModelConfig`** — `{id: "power-law"|"stretched-exp"|"empirical"|..., alpha?, beta?, empiricalBuckets?}`. Note: when `alpha` is set, calibration is skipped and the override is used as-is.
- **`SimulationResult`** — `{samples, totalBuyIn, expectedProfit, finalProfits, rowProfits, histogram, samplePaths, envelopes, stats, decomposition, downswings, sensitivity, ...}`. This is what `ResultsView` consumes.
- **`RowDecomposition`** — per-row `{mean, stdDev, varianceShare, kellyFraction, kellyBankroll}`.

## Hot-loop shape

`simulateShard()` in `engine.ts` is a plain `for` loop over samples, with a nested loop over compiled entries. No allocations inside the inner loop — all scratch buffers come from the shard's preallocated pool. The typed arrays (`Float64Array`, `Int32Array`) are chosen specifically so the JS engine can keep things in numeric-typed shapes without boxing.

Per tournament entry:

```text
for sample s in [sStart, sEnd):
  rng = mulberry32(mixSeed(seed, s, rowIdx, bulletIdx))
  ...for each row...
    for each bullet fired:
      draw finish place from alias table
      look up payoutByPlace[place]   (+ bountyByPlace if PKO)
      apply per-place ICM reweight if row.icmEnabled and place ≤ 9
      profit += payout - singleCost
```

The payout/bounty tables are computed once in `compileSchedule()` and reused for every sample. That's the whole point of the build step — pay the finish-model + α-calibration cost once per row, not N × samples times.

### PKO heat

When `row.pkoHeat > 0`, `compileSchedule()` builds `HEAT_BIN_COUNT` alternative `bountyByPlace` tables. Each bin corresponds to a different concentration exponent on the raw elimination-order weights. The hot loop draws one Gaussian per tournament, snaps it to the nearest bin, and uses that bin's table. Mean bounty is preserved per bin (each is renormalized back to the base pmf's expected bounty). Only σ shifts — hot bins concentrate bounty mass on the deepest finishes, fattening the right tail. This is **not** a finish-position change — prize EV still sits on the α-calibrated target.

## Determinism contract

**A `SimulationInput` with a given seed must produce a byte-identical `SimulationResult` regardless of pool size, shard order, or rebuild.**

This is enforced by `engine.test.ts` and is non-negotiable. Concretely:

- The engine **does not** call `Math.random()`. Only `mulberry32`, seeded via `mixSeed(baseSeed, sampleIdx, rowIdx, bulletIdx)`.
- `sampleIdx` is the **global** sample index, not a shard-local index. Two workers can run samples 0..4999 and 5000..9999 in parallel and still produce the exact same aggregate as a single-worker 0..9999 run.
- Iteration order inside the hot loop is fixed — no `Set`, no `Object.keys` on anything that matters.
- No `Date.now()` / `performance.now()` inside the engine. Timing is measured outside, in `useSimulation`.

If you add a new stochastic mechanism:
1. Allocate a fresh `mixSeed` slot for it so it doesn't collide with existing channels.
2. Write a determinism test: run with the same input twice, assert identical `finalProfits`.
3. Write a pool-invariance test if practical: 1-worker vs N-worker runs should agree.

## Storage of results

Only a subset of per-sample data is retained — keeping all of it for 100k samples at 300 tournaments each would be ~240 MB of hot-res points per run.

- **`finalProfits`** — `Float64Array(samples)`. Every sample's final P&L. Used by histogram, stats, envelopes.
- **`rowProfits`** — `Float64Array(samples × rows)`, row-major. Used by decomposition and by mixed-schedule cards (e.g., satellite equity).
- **`samplePaths`** — only the *first* ~1000 samples of shard 0 have a hi-res trajectory path stored. The slider in `ResultsView` caps at `samplePaths.paths.length`, not `samples`. If you want more, bump `wantHiResPaths` in `engine.ts` — but be aware of memory.
- **`envelopes`** — mean / p05 / p95 / min / max over all samples, on an 80-point checkpoint grid. This is what the shaded percentile band on the trajectory chart uses.

## React integration

`useSimulation.ts` is the **only** React-touching file in `src/lib/sim/`. Everything else is pure TS, testable under Vitest without a DOM.

The hook exposes:

```ts
{
  run(input: SimulationInput): void,
  cancel(): void,
  status: "idle" | "running" | "done" | "error",
  progress: number,              // 0..1
  result: SimulationResult | null,
  elapsedMs: number,
  error: string | null,
}
```

It owns a pool of `Worker` instances across renders (refs, not state) and transitively tracks `jobId` so late shard messages from a cancelled run are ignored.

## i18n

All UI strings live in `src/lib/i18n/dict.ts` as a flat object `{[key]: {en, ru}}`. `useT()` (via `LocaleProvider`) returns a typed `(key: DictKey) => string`. Adding a locale = adding a field to every entry; TypeScript will fail the build until every key is covered.

**Do not** build strings by concatenation for user-visible text. Use placeholder keys like `"{n}"` and `str.replace("{n}", String(n))`.

## Performance knobs

- **Pool size** — `poolSize()` in `useSimulation.ts`. Defaults to `hardwareConcurrency / 2`. Change if you see the OS get starved.
- **Shard count** — equal to pool size in the current implementation. There's no overlap benefit to oversharding — each worker is CPU-bound.
- **Checkpoint grid K** — `makeCheckpointGrid(N)` in `engine.ts`. Currently `K = min(80, N)`. Bigger K = smoother trajectory charts but more main-thread sort work.
- **`wantHiResPaths`** — how many sample paths to retain at full resolution. Currently 1000. Trades memory for slider range.
- **`HEAT_BIN_COUNT`** — PKO heat bin count. 13 is more than enough; 5 would be fine.

## Testing

`src/lib/sim/*.test.ts` — Vitest. Run with `npm test`. The important categories:

- **Determinism** — same input, same seed → byte-identical `finalProfits`.
- **Realized ROI in SE** — the α calibration produces a run whose mean ROI matches `row.roi` within a few standard errors.
- **Row decomposition sums** — Σ rowMean ≈ totalMean, Σ rowVar ≈ totalVar (with cross-terms near zero because we fix row-independent seeds).
- **Re-entry variance amplification** — 3 bullets should yield roughly √3× σ compared to 1 bullet on an uncorrelated draw.
- **ICM flattening** — applying ICM reduces the top-1 payout share and the upside variance.
- **Empirical histogram reproduction** — feeding a flat histogram gives uniform pmf; feeding a spike at position 1 makes the player always win.
- **Payout normalization** — every `getPayoutTable()` result sums to 1 ± ε.

Add new tests next to the file they cover. Keep them fast — the whole suite should finish in single-digit seconds.

## What lives outside `src/lib/sim/`

- **`src/components/charts/`** — all uPlot charts. They read `SimulationResult` and nothing else. Pure rendering.
- **`src/components/ResultsView.tsx`** — composite view. Owns the slider/legend state, line-style preset picker, and the "show/hide" state for each CollapsibleSection. Does not touch the engine.
- **`src/lib/scenarios.ts`** — declarative demo presets. Read by the scenario grid in `page.tsx`.
- **`src/lib/persistence.ts`** — localStorage + share-URL. Stores only the serializable state, no worker state.
- **`src/lib/lineStyles.ts`** — tracker-inspired color/width presets for the trajectory chart (HM2, H2N, HM3, PT4, PokerCraft, PokerDope).

## Where to start if you want to...

| Goal                              | Start here                                             |
| --------------------------------- | ------------------------------------------------------ |
| Add a payout structure            | `src/lib/sim/payouts.ts` + `types.ts` + `dict.ts`      |
| Add a finish model                | `src/lib/sim/finishModel.ts` + `types.ts`              |
| Add a new chart                   | `src/components/charts/` + `ResultsView.tsx`           |
| Add a noise / tilt channel        | `SimulationInput` in `types.ts` + hot loop in `engine.ts` |
| Add a demo scenario               | `src/lib/scenarios.ts` + `dict.ts`                     |
| Add a language                    | `src/lib/i18n/dict.ts` — add the locale field, TS will force you through every key |
| Change the worker pool sizing     | `useSimulation.ts` → `poolSize()`                      |
| Change how α is calibrated        | `src/lib/sim/finishModel.ts` → `calibrateAlpha()`      |
| Change what gets stored per-run   | `src/lib/sim/engine.ts` → `buildResult()`              |
