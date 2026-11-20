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
│       collects shards, exposes {status, progress, result}    │
│                                                              │
│         ▼ ShardRequest × N workers                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Web Worker pool (N = min(16, hc − 2))               │    │
│  │  ─ src/lib/sim/worker.ts                             │    │
│  │        thin dispatcher — onmessage routes to engine  │    │
│  │  ─ src/lib/sim/engine.ts                             │    │
│  │        thin orchestrator: runSimulation + mergeShards │    │
│  │        + a barrel re-exporting the modules below      │    │
│  │  ─ src/lib/sim/compile.ts      schedule → compiled    │    │
│  │  ─ src/lib/sim/compileEntry.ts row → CompiledEntry    │    │
│  │  ─ src/lib/sim/scheduleMoments.ts closed-form σ       │    │
│  │  ─ src/lib/sim/schedulePassOrder.ts row interleave    │    │
│  │  ─ src/lib/sim/hotLoop.ts      simulateShard (MC core)│    │
│  │  ─ src/lib/sim/buildResult.ts  shard → result         │    │
│  │  ─ src/lib/sim/resultStats.ts  scalar stats + RoR     │    │
│  │  ─ src/lib/sim/resultEnvelopes.ts percentile bands    │    │
│  │  ─ src/lib/sim/resultStreaks.ts streaks + swings      │    │
│  │  ─ src/lib/sim/resultDecomposition.ts per-row split   │    │
│  │  ─ src/lib/sim/resultCurves.ts sensitivity + conv.    │    │
│  │  ─ src/lib/sim/resultLeaderboard.ts BR promo channel  │    │
│  │  ─ src/lib/sim/engineTypes.ts  Compiled*/RawShard…    │    │
│  │  ─ src/lib/sim/simNumerics.ts  poisson + histograms   │    │
│  │  ─ src/lib/sim/finishModel.ts                        │    │
│  │        pmf + α calibration                           │    │
│  │  ─ src/lib/sim/payouts.ts                            │    │
│  │  ─ src/lib/sim/rng.ts                                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│         ▲ RawShard × N → mergeShards → SimulationResult      │
│                                                              │
│  ResultsView (charts, tables)                                │
└──────────────────────────────────────────────────────────────┘
```

## UI surface map

The default MTT view is the mechanical schedule/worker/results calculator. The second tab, `OceanComparisonReport`, compares downside trajectories for exactly four formats: Freezeout, PKO, Mystery and Ocean KO, defined by `FORMAT_COMPARISON_FORMATS`. Battle Royale remains in the mechanical calculator and is not part of this report. The report loads on first use and remains mounted when switching back to the mechanical tab, retaining settings and completed results; leaving a running comparison cancels it. Its dedicated `formatComparison.worker.ts` compiles each format once and runs formats sequentially with `simulateDownsideShard`. This collector uses the same entry loop and random draws as `simulateShard`, but skips unused horizontal-chord scans and individual hi-res paths. Exact downside observations and all report checkpoint paths are retained. The normal simulator keeps its complete collector.

`useFormatComparison.ts` terminates the worker on cancellation, replacement or unmount. A three-entry, session-only LRU reuses complete four-format summaries for an identical seven-field configuration. Each summary carries its sorted per-career maxima, and the UI builds one shared risk-curve grid per metric from them once the rows have arrived. Partial/cancelled reports are not cached. Results own a configuration snapshot. No simulation starts on mount. Volume planning widgets load when their disclosure opens; cash mode loads on its first visit and remains mounted through later mode switches. The Ocean report also keeps completed results when hidden, while stopping an unfinished calculation. Closed report tables and the Space explorer defer rendering until opened.

The optional `collectDownsideReport` input collects EV shortfall, time below EV, time below the previous profit high and consecutive losing entries at every tournament endpoint, for every sample. It adds no randomness and leaves the normal simulation outputs unchanged. Ties are differences within `1e-9` of a ticket (`DOWNSIDE_TIE_TOLERANCE`), so float noise in a break-even entry is not a loss. Per-path maxima are computed before quantiles; plotted endpoint percentiles are not simultaneous trajectory bands. Recovery statistics remain conditional on recovery and include the unrecovered fraction at the selected horizon. See [Downside comparison](OCEAN_DOWNSIDE_REPORT.md).

The report also embeds `EmpiricalOceanExplorer`, a deterministic comparison of two public Space moment anchors and paired Ocean mechanical coefficients. `src/lib/calibration/oceanTransport.ts` computes component means and exposure covariance; it does not sample a payoff distribution or validate streak durations. The public JSON files contain runtime parameters only. Detailed research pages and evaluations remain excluded. Imported mechanical scenarios open in the first tab.

The simulator UI is no longer one undifferentiated `ResultsView.tsx` blob.
The current split is:

- **`src/app/page.tsx`** — top-level page composition, scenario loading,
  persistence wiring, and run/compare orchestration.
- **`src/components/ScheduleEditor.tsx`** — schedule authoring UI and per-row
  tournament controls.
- **`src/components/ResultsView.tsx`** — results page orchestrator. It owns
  section-level state, compare-mode toggles, card composition, and wires
  `SimulationResult` into the smaller presentation modules below.
- **`src/components/results/TrajectoryPlot.tsx`** — trajectory chart rendering,
  visibility gating, hover/highlight behavior, chart asset construction, and
  y-range policy. If you need to change how path charts work, start here.
- **`src/components/results/StatCards.tsx`** — shared KPI card language used by
  Expected Profit / Risk / Drawdowns / Series.
- **`src/components/results/ResultsPanels.tsx`** — long-form explanatory panels
  such as PrimeDope comparison notes and model-limit cards.
- **`src/components/charts/FinishPMFPreview.tsx`** — the per-row EV breakdown /
  payout preview surface. It now acts as the container/composer for:
  - **`src/components/charts/finishPreview/PreviewParts.tsx`** — reusable
    preview chrome such as hero stats, EV breakdown rows, split cards, and
    slider styling tokens.
  - **`src/lib/sim/previewRowStats.ts`** — pure row-level preview math:
    finish PMF calibration, EV decomposition, shell stats, and tier building.
    A row with a Field-size range is previewed as the equal-weight mixture of
    the engine's field sizes (`previewFieldMixture.ts`), not at `players`.
- **`src/components/CashApp.tsx`** — cash-mode input/orchestration surface. It
  now owns cash-input persistence, worker-pool lifecycle, and the editor side
  of the cash page, while the result surface lives in:
  - **`src/components/cash/CashResultsView.tsx`** — cash results orchestrator:
    hero cards, section composition, summaries, and mix breakdown.
  - **`src/components/cash/CashResultsCharts.tsx`** — cash chart subsystem:
    trajectory, histograms, odds, convergence, diagnostics, and toolbar chrome.
  - **`src/components/cash/CashResultsShared.tsx`** — reusable cash result
    presentation language and formatting helpers.

## Data flow per run

1. **User clicks Run.** `useSimulation.run(input)` is called with `SimulationInput` (schedule, samples, seed, model, bankroll, noise params, etc.).

2. **Compile step.** There is no separate build round-trip before the shards. A worker runs `compileSchedule(input, calibrationMode)` itself for every `ShardRequest` it receives (and again for the final `BuildRequest`); it is a pure function of the input, so every worker gets the same schedule without sharing state. It:
   - For each row, picks the effective field size (or enumerates variants if `fieldVariability` is set).
     The sizes come from `fieldVariants.ts` (`fieldVariantSizes`), the one place
     that decides them: validation checks every size (pinned or free ITM), the
     preview averages over them, a calibration warning is raised once per row
     and quotes the size that misses the most with its `fieldSize` (the size
     validation reports; sizes that miss in opposite directions can average
     out to the target, so the mixture's mean, which the expected profit
     reads, is not quoted), and under a range `players` is read as the range
     midpoint
     (`normalizeGameTypeConsistency`), never as a field of its own. A Battle
     Royale row carries no range; `compileSchedule`, `validateSchedule` and
     `computeRowStats` all normalize the row first, so none of them plays one.
   - Calls `buildFinishPMF(N, model, α)` with a starting α, then `calibrateAlpha()` which binary-searches α so that the *realized* ROI (Σ pmf × payout − cost) matches `row.roi`. This is the honest calibration.
   - For the PrimeDope compare run (`calibrationMode: "primedope-binary-itm"`), `buildBinaryItmAssets` builds the binary-ITM pmf directly (every paid place equally likely, real top-heavy payouts kept) and there is no α search. `compileEntry.ts` falls back to `calibrateShelledItm` (a row with a pinned `itmRate`) or `calibrateAlpha` only when the PD finish-model flag is off. The pinned ITM was stamped from the row's own payout table, so a row whose ITM cannot pay its ROI on PD's table and pool is compiled again with a free ITM (`calibrateAlpha`, which also drops the row's finish locks) and plays that compile when it lands closer to the ROI; a row that hits keeps its ITM and its bytes, and a row that neither compile reaches carries the `primedope-free-itm-unreachable` warning. `pdCurves.ts` is PD's payout-table family, read by the `mtt-primedope` payout structure; it does not calibrate anything.
   - For bounty rows, applies the requested KO EV share as a finish-shape
     target and then closes constrained rows (`itmRate`, shells, fixed-shape
     models) by setting the actual bounty budget to `targetTotal - cashEV`.
     This keeps total ROI pinned even when α hits a boundary. The KO EV never
     passes what the bounty pool can pay one entry (`bountyEvCeiling`, see
     "KO EV share"). Battle Royale keeps its published average envelope size
     fixed and scales expected KO counts instead.
   - Builds alias tables for fast weighted sampling.
   - Returns `CompiledEntry[]` — flat, shard-independent, serializable.

3. **Shard dispatch.** `runJob` splits `[0, samples)` of every pass into contiguous shards (formula under "Performance knobs"), pre-assigns each shard to worker `i % W` round-robin and posts all of them at once; each worker works through its own queue serially. Workers share no mutable state — a `ShardRequest` carries the `SimulationInput` and the calibration mode, not the compiled schedule, and the worker compiles it (step 2) and runs `simulateShard(sStart, sEnd)`. A worker keeps the last compiled schedule in `compileCache.ts`, keyed by the whole input plus the mode, so the shards of one job and its build compile once per worker; the build clears it. Seeds are not shard-local: the hot loop opens `sampleStream(seed, sampleIdx, channel)` where `sampleIdx` is the *global* index in `[0, samples)`. This is what makes the run deterministic independent of pool size.

4. **Progress reporting.** Workers post `ShardProgressMsg` as a shard runs. The tick count adapts to the shard size (`progressTicks` in `hotLoop.ts`: 15 to 40 per shard, growing with the log of its sample count). The hook aggregates them into a single `progress` number exposed to the UI.

5. **Shard merging.** When a worker returns `ShardResultMsg`, the hook stores the `RawShard`. Once every shard of every pass has arrived, the hook posts one `BuildRequest` per pass (worker `i % W`), carrying that pass's shards. That worker, not the main thread, runs `mergeShards([...])` (concatenates the shard-local buffers, picks the global best/worst path, sums histograms) and then `buildResult()` for the post-processing: percentile envelopes, downswings catalog, row decomposition, risk-of-ruin integration, convergence curves. It posts `build-progress` messages while it works and the `SimulationResult` when it is done.

6. **Twin run (compare mode).** When `compareMode` is set, `buildPasses` adds a second pass to the same job: `"primedope"` runs `calibrationMode: "primedope-binary-itm"` on the same seed (on a PKO schedule, the same schedule with its bounties stripped), `"random"` runs the same model on a different seed (an engine option only: the UI never sends it, and persistence reads a saved `"random"` as `"primedope"`, since the results draw no pane for it). The second pass is not queued behind the first: both passes' shards go into the one pool together, each pass gets its own `BuildRequest`, and the result is attached as `result.comparison`. Under the "Like PrimeDope" preset the two calibrations swap panes (`pdPresetFlip`).

## Key types

All in `src/lib/sim/types.ts`:

- **`TournamentRow`** — one line in the schedule. Has buy-in, rake, field, ROI, payout structure, and optional bounty/mystery fields. `count` is the row's per-pass frequency; compile-time scheduling interleaves rows as evenly as possible inside each pass rather than batching one row at a time.
- **`SimulationInput`** — `{schedule, scheduleRepeats, samples, bankroll, seed, finishModel, ...noise, ...tilt}`.
- **`FinishModelConfig`** — `{id: "power-law"|"stretched-exp"|"empirical"|..., alpha?, beta?, empiricalBuckets?}`. Note: `alpha` is read only by the three real-data tilt models and by rows with no `itmRate` (`calibrateAlpha` returns it as-is). On a fixed-ITM row, which is every row the app runs because `applyItmTarget` stamps one, every other model solves its own α against the ROI and ignores it; the app sends `alpha` only where it is read (`manualAlphaFor`).
- **`SimulationResult`** — `{samples, totalBuyIn, expectedProfit, finalProfits, rowProfits, histogram, samplePaths, envelopes, stats, decomposition, downswings, sensitivity, ...}`. This is what `ResultsView` consumes.
- **`RowDecomposition`** — per-row `{mean, stdDev, varianceShare, kellyFraction, kellyBankroll}`.

## Hot-loop shape

`simulateShard()` in `hotLoop.ts` is a plain `for` loop over samples, with a nested loop over compiled entries. No allocations inside the inner loop — all scratch buffers come from the shard's preallocated pool. The typed arrays (`Float64Array`, `Int32Array`) are chosen specifically so the JS engine can keep things in numeric-typed shapes without boxing.

Per tournament entry:

```text
for sample s in [sStart, sEnd):
  rng = sampleStream(seed, s, STREAM_FINISH)   // one stream id per channel
  ...for each row...
    draw finish place from alias table
    look up payoutByPlace[place]   (+ bountyByPlace if PKO)
    profit += payout - singleCost
```

The payout/bounty tables are computed once per shard in `compileSchedule()` and reused for every sample of it. That's the whole point of the compile step — pay the finish-model + α-calibration cost once per row and shard, not N × samples times.

### KO EV share

For PKO, Mystery, and Battle Royale rows, `row.bountyEvBias` moves the
requested split between cash EV and KO EV while keeping the row's total
winnings target anchored to `singleCost * (1 + roi)`. α-adjustable rows can
usually hit the requested cash target directly. Fixed-ITM/shelled rows and
fixed-shape models may hit an α boundary first, so `compileSchedule()` treats
the requested split as a shape request and then reconciles the actual bounty
budget as `targetTotal - cashEV`.

Either way the KO EV is capped by the bounty pool: one entry collects at most
N x buyIn x bountyFraction x (1 - P(last)) (`bountyEvCeiling`), read on the
pmf the row plays, after sit-through. `settleBountyAgainstPool`
(`bountySplit.ts`) does it for `compileEntry`, `previewRowStats` and
`validation` alike. A row whose KO EV fits is solved once. A plan
past the ceiling is cut to the largest KO EV the pmf solved for it can pay,
the fixed point b = ceiling(solve(total - b)), and the cash side is asked for
the rest: more cash lowers P(last) and lifts the ceiling, so a bracketed
regula falsi (Illinois) between the first ceiling and the plan finds it in a
few solves, and a pinned ITM with unpaid places (P(last) fixed by the pin)
lands on it in one solve. A cash side that
cannot deliver the rest leaves the row short of its total: `validateSchedule`
blocks it, and the engine raises `target-unreachable` (the PrimeDope pass its
own two kinds) so the expected profit reads the pmf. A model that does not aim
at the ROI (uniform, empirical, the realdata shapes, a hand-set α) plays its
own cash side and closes the rest with the KO EV, so it misses only where the
pool cuts that KO EV (`poolCut`); such a row is blocked and flagged like any
other, while one whose shape alone overpays the total stays held to its shape.

Battle Royale has one extra invariant: the GG-style tier table fixes the
average dollars per envelope. The engine therefore scales `bountyKmean`
(expected envelope-dropping KOs), not the average envelope size, when the KO
share changes.

A fixed-ITM Battle Royale row centres its cash target on the configured KO
pool: `singleCost * (1 + roi)` minus the lifted per-seat bounty, about 54 % of
the winnings in cash at the default share. `compileEntry`, `previewRowStats` and
`validation` compute that centre the same way. Off the 18-max table (late
registration that lifts the field to 21 or more pays four places, or a finish
lock is set) the BR solver steps aside and the shelled solver aims at that
centre, so a different centre in one of the three gates or previews a solve
the run never plays.

### PKO knockouts

A PKO row's bounty at a finishing place is played on the model's own elimination picture, the uniform-killer progressive tree (`pkoKoCash`): the knockout made when j + 1 players remain is a Bernoulli(1/j) for anyone still alive and pays that stage's expected half-head, and the hot loop jumps straight from one knockout to the next (one uniform per knockout plus one, no Poisson count). The winner always makes the last knockout and keeps the expected own final head (`pkoWinnerHead`) as a fixed amount. Each knockout is multiplied by a mean-one log-normal factor whose log-σ depends on the finishing place (`pkoKoLogSigma`): `compileEntry` runs an O(N) second-moment recursion of the tree (`pkoTreeVarianceByPlace`) and sizes the factor so that the haul's variance at every place is the tree's (victim head sizes and the winner's head growing with the own knockouts included). Where the Bernoulli count alone already spreads more than the tree (2nd place in fields of 4 to 44 and 3rd in fields of 5 to 10, up to +3.8 % in σ, because a player who knocks out more meets smaller heads) no factor can narrow it, so a haul that holds a knockout is pulled toward the mean of such hauls instead (`pkoHaulShrink`, `pkoHaulShift`): the place keeps its mean and the tree's chance of no bounty, i / (N − 1) at index i, and its variance becomes the tree's. Shrink and factor are both the identity where the count meets the tree, so nothing switches at a field size. A `mysteryBountyVariance` set on a PKO row stacks on the factor. The haul is scaled by `bountyByPlace[place] / raw[place]`, so the mean of every place and every heat bin is unchanged, and `compiledEntryMoments` reads the same per-place variance (`pkoHaulVariance`). Per-tournament σ is the tree's, to rounding, at every field from 2 up, every bounty share and ROI. On a 3 000-player row the walk costs about 5 % more per tournament than the Poisson draw it replaced (about +7 ns); single-table rows got faster. Mystery and Battle Royale keep the Poisson count around `bountyKmean`.

### PKO heat

When `row.pkoHeat > 0`, `compileSchedule()` builds `HEAT_BIN_COUNT` alternative `bountyByPlace` tables. Each bin corresponds to a different concentration exponent on the raw elimination-order weights. The hot loop draws one Gaussian per tournament, snaps it to the nearest bin, and uses that bin's table. Mean bounty is preserved per bin (each is renormalized back to the base pmf's expected bounty). Only σ shifts — hot bins concentrate bounty mass on the deepest finishes, fattening the right tail. This is **not** a finish-position change — prize EV still sits on the α-calibrated target.

## Determinism contract

### Ocean KO

`oceanKo.ts` models a random recursive knockout tree: finishing rank j selects
its killer uniformly among ranks 1..j-1. Each knockout spins the actual victim
bounty; half is added to the killer and half paid as cash. Winner cash also
includes a full final spin on the updated own bounty. The sampler draws only
the hero's descendant subtree (Beta-binomial size), preserving this model's
distribution without building every player's tree for every early finish.
One scratch array is allocated per shard; its separate RNG salt is `0x0cea4b07`.

`compileEntry` preserves physical heads and dollar tier thresholds, then applies
a fixed payout scale to calibrate bounty EV to the existing finish/ROI model.
This is a player-edge assumption, not per-tournament conservation. The second
moment of adaptive Legendary heads is bounded analytically: `secondDollar`
and `stats.sigmaPerTournamentAnalytic` are **upper bounds** for Ocean entries,
with lower bounds exposed by `compiledEntryMoments` and the preview. Convergence and
prove-edge cards label the conservative distance, take full ticket price as
an input, and have no fitted residual band. `stats.sigmaPerTournamentAnalyticKind`
preserves this distinction in diagnostic exports. See [Ocean KO](OCEAN_KO.md).

### Seed contract

**A `SimulationInput` with a given seed must produce a byte-identical `SimulationResult` regardless of pool size, shard order, or rebuild.**

This is enforced by `engine.test.ts` and is non-negotiable. Concretely:

- The engine **does not** call `Math.random()`. Only `sampleStream(seed, sampleIdx, channel)` from `rng.ts`: xoshiro128** with all four state words hashed from the seed, the sample index and the channel id.
- `sampleIdx` is the **global** sample index, not a shard-local index. Two workers can run samples 0..4999 and 5000..9999 in parallel and still produce the exact same aggregate as a single-worker 0..9999 run.
- Iteration order inside the hot loop is fixed — no `Set`, no `Object.keys` on anything that matters.
- No `Date.now()` / `performance.now()` inside the engine. Timing is measured outside, in `useSimulation`.

If you add a new stochastic mechanism:
1. Give it the next `STREAM_*` id in `rng.ts` so it has a stream of its own.
2. Write a determinism test: run with the same input twice, assert identical `finalProfits`.
3. Write a pool-invariance test if practical: 1-worker vs N-worker runs should agree.

### Seed eras

Determinism is `input + seed → bytes` *within one construction of the sample
streams*. There have been two changes of era.

The second, after v0.7.8, replaced the generator itself. `mulberry32` has a 32-bit
counter for a state, so every stream of every sample, channel and seed was a
window of one cycle of 2^32 outputs, and over that cycle the output is not
uniform: only 44% of the 32-bit values occur and small ones are too frequent
(`P(u < 2^-12)` is 0.39% above nominal, the mean is 0.49997). The finish draw
maps a uniform onto places with the winner at index 0, so first place came up
about 0.3% too often in every run at every seed: +0.10 to +0.23 points of ROI
on fields of 180 to 50,000 at +10% ROI, which no sample count removes. The cash
deviate had variance 1.00022 for the same reason (the "+1 SE mean" note that
used to sit in WISDOM.md), and at 10^9 draws about a third of the samples
replayed part of another one. `sampleStream` is xoshiro128** (period 2^128 - 1,
every 32-bit output equally frequent), seeded per sample and channel by four
independent hashes. Every simulation output changed again; distributions moved
only by the removed bias.

The first: `mixSeed` (`rng.ts`) was changed in commit `3eb91fb` (2026-09-02, first shipped in
v0.7.7) to finalize the seed before it meets the sample index: the old raw XOR made seeds that differ only in low bits the
same simulation with samples permuted (seeds 1, 2, 3, 7 had byte-identical
`stats.mean/stdDev`). Every simulation output changed with that commit — a new
numerical era. Stored runs and share links from before it reproduce the same
*distributions* (σ fits were re-checked within 2% of `evalSigma`) but not the
same individual paths, best/worst samples, or downswing catalog entries. A
stored-vs-fresh mismatch across that boundary is not a determinism failure; the
pool-invariance tests compare runs against each other, never against pinned
values. Fit grids under `scripts/fit_*.json` measured before the change should
be refitted before a small drift is called a regression.

## Storage of results

Only a subset of per-sample data is retained — keeping all of it for 100k samples at 300 tournaments each would be ~240 MB of hot-res points per run.

- **`finalProfits`** — `Float64Array(samples)`. Every sample's final P&L. Used by histogram, stats, envelopes.
- **`satelliteSeatsWon`** — optional sample-by-row integer paid-finish counters. Satellite ticket statistics use these counts directly, without deriving tickets from profit affected by rakeback or ROI noise.
- **`rowProfits`** — `Float64Array(samples × rows)`, row-major. Used by decomposition and by mixed-schedule cards (e.g., satellite equity).
- **`samplePaths`** — the first 1000 global sample indices have a hi-res trajectory path stored, independent of shard boundaries. The slider in `ResultsView` caps at `samplePaths.paths.length`, not `samples`. If you want more, bump `HI_RES_GLOBAL_CAP` (a local constant in `simulateShard`, `hotLoop.ts`; each shard stores the part of that global prefix that falls in its own range) and the `Math.min(1000, …)` caps in `ResultsView.tsx` — but be aware of memory.
- **`envelopes`** — mean / p05 / p95 / min / max over all samples, on the low-res checkpoint grid (`K = min(240, N)`, `makeCheckpointGrid` in `grids.ts`). This is what the shaded percentile band on the trajectory chart uses.

## Completed run snapshots

`useSimulation` stores effective worker input, raw persisted/share source and the completed result in each cached seed entry. The result header, bankroll, settings, charts and share export use that entry. Editing inputs leaves a visible rerun notice; it cannot reinterpret the stored result. PD-only updates select the PrimeDope calibration pass and atomically replace that pass and its flags in the same cached entry. Pending checkbox flags never substitute for completed report settings.

## React integration

`useSimulation.ts` and `useResulthubLookup.ts` are the only React-touching files in `src/lib/sim/`. Every engine module is pure TS, testable under Vitest without a DOM, and `engineSourcePurity.test.ts` pins both facts: the engine modules never read the clock or `Math.random`, and nothing but those two hooks imports React. (`useSimulation.ts` times the run with `performance.now()` and seeds the engine-only "random" compare pass with `Math.random()`; `resulthubLookup.ts` and `useResulthubLookup.ts` use the current date for the ResultHub lookup.)

The core of what `useSimulation` returns:

```ts
{
  run(input, source?, opts?): void,
  cancel(): void,
  status: "idle" | "running" | "done" | "error",
  progress: number,              // 0..1
  stage: ProgressStage | null,   // "simulating" or a build stage
  result: SimulationResult | null,
  elapsedMs: number,
  error: string | null,
  // ...plus the cached sibling-seed runs (availableRuns, selectRun), the
  // background precompute (backgroundStatus, interruptBackground), the
  // PrimeDope-only re-run (runPdOnly, pdStatus, pdProgress) and estimateMs.
}
```

The full surface is the return statement at the bottom of `useSimulation.ts`.

It owns a pool of `Worker` instances across renders (refs, not state) and transitively tracks `jobId` so late shard messages from a cancelled run are ignored.

## i18n

All UI strings live in `src/lib/i18n/dict.ts` as a flat object `{[key]: {en, ru}}`. `useT()` (via `LocaleProvider`) returns a typed `(key: DictKey) => string`. Adding a locale = adding a field to every entry; TypeScript will fail the build until every key is covered.

**Do not** build strings by concatenation for user-visible text. Use placeholder keys like `"{n}"` and `str.replace("{n}", String(n))`.

## Performance knobs

- **Pool size** — `poolSize()` in `useSimulation.ts`. Defaults to `min(16, hardwareConcurrency − 2)`; `hc / 2` idled half the cores on no-SMT hardware (Apple Silicon), and past 16 oversharding buys nothing. The cash pool in `CashApp.tsx` still uses `min(12, hc / 2)`. Change if you see the OS get starved.
- **Shard count** — per pass `min(W × oversub, ⌊S / minPerShard⌋, S)` in `runJob` (`useSimulation.ts`), where `W` is the pool size, `S` the sample count, `oversub` is 4 (6 from 200 000 samples) and `minPerShard` is 64 (32 from 100 000 samples). Shards are over-subscribed so a slow tail shard does not park the progress bar; each worker is still CPU-bound, so this buys granularity, not speed. The split never changes the result (see the seed contract).
- **Checkpoint grid K** — `makeCheckpointGrid(N)` in `grids.ts`. Currently `K = min(240, N)`. Bigger K = smoother trajectory charts but more per-sample and build work. Two costs scale with it and were the bulk of a typical run before they were rewritten; keep both shapes:
  - the per-sample "playing for nothing" scan (`pathChords.ts`). The definition (`scanPathChordsReference`) checks every later segment for every starting checkpoint, O(K²): about 46 µs of a sample whatever the schedule length, 50-85% of the simulate phase at 200-1,000 tournaments. `scanPathChords` gets the same numbers from a suffix-range binary search and two monotonic stacks.
  - the envelope percentiles (`resultEnvelopes.ts`): eight order statistics for each of the K+1 columns. They come from `selectSortedRanks` (`orderStatistics.ts`, Floyd-Rivest selection) on blocks of neighbouring columns read row by row, not from K+1 full sorts of a column gathered with a cache miss per value. The build step is single-threaded, so this was most of the wall-clock after the pool finished (about 190 ms at 10,000 samples and 2.3 s at 100,000, now about 50 ms and 0.45 s).
  Both return bit-identical results to the code they replaced (checked over 274 full-result digests: every demo scenario, every format, schedule lengths around the grid edges, 1 to 200,500 samples, uneven shard splits).
- **`HI_RES_GLOBAL_CAP`** — how many sample paths to retain at full resolution: the first 1000 global sample indices (`simulateShard` in `hotLoop.ts`). Trades memory for slider range; the `Math.min(1000, …)` caps in `ResultsView.tsx` must move with it.
- **`HEAT_BIN_COUNT`** — PKO heat bin count, 33 (`engineConstants.ts`). It sets how finely the per-tournament heat Gaussian is quantized (`HEAT_BIN_SCALE`), so changing it changes PKO heat output: treat it as a model change, not a tuning knob.

## Testing

`src/lib/sim/*.test.ts` — Vitest. Run with `npm test`. The important categories:

- **Determinism** — same input, same seed → byte-identical `finalProfits`.
- **Realized ROI in SE** — the α calibration produces a run whose mean ROI matches `row.roi` within a few standard errors.
- **Row decomposition sums** — Σ rowMean ≈ totalMean, Σ rowVar ≈ totalVar (with cross-terms near zero because we fix row-independent seeds).
- **Empirical histogram reproduction** — feeding a flat histogram gives uniform pmf; feeding a spike at position 1 makes the player always win.
- **Payout normalization** — every `getPayoutTable()` result sums to 1 ± ε.

Add new tests next to the file they cover. Keep them fast — the whole suite runs in ~40s on an idle machine (166 files / 2128 tests; CPU-bound Monte Carlo, several times slower under load — see `CONTRIBUTING.md` on reading a red run).

## What lives outside `src/lib/sim/`

- **`src/components/charts/`** — all uPlot charts. They read `SimulationResult` and nothing else. Pure rendering.
- **`src/components/ResultsView.tsx`** — results orchestrator. Owns section
  state, compare wiring, and composes the submodules below; it should not be
  the home for low-level chart math anymore.
- **`src/components/results/TrajectoryPlot.tsx`** — low-level trajectory chart
  subsystem: asset building, trim-aware y-range, hover hit-testing, and
  visibility/restyling of path families.
- **`src/components/results/StatCards.tsx`** — reusable result-card language
  and shared internal subwidgets.
- **`src/components/results/ResultsPanels.tsx`** — explanatory/report panels
  that would otherwise bloat `ResultsView.tsx`.
- **`src/lib/scenarios.ts`** — declarative demo presets. Read by the scenario grid in `page.tsx`.
- **`src/lib/persistence.ts`** — localStorage + share-URL. Stores only the serializable state, no worker state. `buildShareUrl` leaves the sender's ResultHub nicknames out of the link (`withoutShareIdentifiers`). A state with no rows is refused on read. `readShareHash` tells a link that carries nothing from a `#s=` link that does not decode, and the page clears the second kind and says so. `saveLocal` and `saveUserPresets` return whether the browser took the write; the page shows a notice for a refused autosave and an alert for a refused preset save or import.
- **`src/lib/lineStyles.ts`** — color/width presets for the trajectory chart (`classic`, `duotone`, `mono`, `vivid`, `highContrast`, `neon`); no tracker branding.

## Remaining structural debt

The repo is cleaner than it was, but it is not “finished forever”. The biggest
remaining concentrated modules are:

- **`src/lib/sim/engine.ts`** — **split done.** Formerly a ~3500-line monolith,
  it is now a ~240-line orchestrator (`runSimulation` + `mergeShards`) plus a
  barrel that re-exports the public surface from sibling modules:
  `compile.ts` (compile/calibration/analytic-σ), `hotLoop.ts`
  (`simulateShard` — the determinism-critical Monte Carlo core),
  `buildResult.ts` (result assembly), `engineTypes.ts` (contract types),
  `simNumerics.ts` (poisson + histograms), `grids.ts`, `engineConstants.ts`.
  Importers still use the `./engine` path unchanged. `compile.ts` has since
  been split again into a ~255-line orchestrator plus `compileEntry.ts`
  (per-row calibration/bounty/heat compilation), `scheduleMoments.ts`
  (closed-form per-entry moments feeding the convergence widgets), and
  `schedulePassOrder.ts` (row interleaving). `buildResult.ts` has likewise
  been split into a ~285-line sequencer plus `resultStats.ts` (scalar
  moments, VaR/CVaR, Kelly, Gaussian + historical RoR), `resultEnvelopes.ts`
  (percentile bands and hi-res upsampling), `resultStreaks.ts` (drawdown /
  breakeven / recovery catalogs and the swing rankings),
  `resultDecomposition.ts` (per-row variance split), `resultCurves.ts`
  (sensitivity + convergence), and `resultLeaderboard.ts` (BR leaderboard
  channel). The `onBuildProgress` stage labels are owned by the module that
  does the work.
- **`src/components/charts/FinishPMFPreview.tsx`** — presentation and preview
  economics still live together in one large UI module.
- **`src/components/cash/CashResultsView.tsx`** — much cleaner than the old
  `CashApp.tsx`, but still the next split point inside cash-mode presentation
  if we want finer boundaries between cards, breakdowns, and disclosure panels.
- **`src/components/CashApp.tsx`** — now mostly orchestration/editor logic, but
  the input-side chrome is still large enough that cash settings could be split
  into their own modules later.
- **`src/components/ScheduleEditor.tsx`** — dense but still large because row
  chrome, presets, and format-specific editing all live in one place.
- **`src/components/charts/FinishPMFPreview.tsx`** — much smaller than before,
  but still owns shape-control wiring and format-specific preview state.
- **`src/lib/i18n/dict.ts`** — intentionally centralized, but large enough that
  any future locale work should stay disciplined and grouped.

If you are doing cleanup work, prefer extracting **self-contained subsystems**
with real boundaries (chart asset builders, result panels, preview economics,
cash result cards) instead of “misc helpers” files that only move clutter
around.

## Where to start if you want to...

| Goal                              | Start here                                             |
| --------------------------------- | ------------------------------------------------------ |
| Add a payout structure            | `types.ts` + `payouts.ts` + `dict.ts` (`payout.<id>.short` / `.full`) + the `STRUCTURES`, `PAYOUT_COMPAT` and `PAYOUT_GAMETYPE_ALLOW` tables in `ScheduleEditor.tsx` + `PAYOUT_STRUCTURE_ID_RECORD` in `persistence.ts` |
| Add a finish model                | `src/lib/sim/finishModel.ts` + `types.ts` + `FINISH_MODEL_ID_RECORD` in `persistence.ts` + the select in `ControlsPanel.tsx` |
| Add a new chart                   | `src/components/charts/` + `ResultsView.tsx`           |
| Add a noise / tilt channel        | `SimulationInput` in `types.ts` + hot loop in `hotLoop.ts` |
| Add a demo scenario               | `src/lib/scenarios.ts` + `dict.ts`                     |
| Add a language                    | `src/lib/i18n/dict.ts` — add the locale field, TS will force you through every key |
| Change the worker pool sizing     | `useSimulation.ts` → `poolSize()`                      |
| Change how α is calibrated        | `src/lib/sim/finishModel.ts` → `calibrateAlpha()`      |
| Change what gets stored per-run   | `src/lib/sim/buildResult.ts` → `buildResult()`         |
| Fit σ_ROI to new data / re-fit presets | `docs/FITTING.md`                                 |
| Run parameter sweeps              | `docs/FITTING.md` → `scripts/fit_sigma_parallel.ts`    |
