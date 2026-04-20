# Repo Atlas

This is the quick map for humans who need to change the repo without first
reading every 5k-line component. Read this after `AGENTS.md`, before you start
editing.

## Canonical flow

1. `src/app/page.tsx` owns persisted state, scenario loading, and the top-level
   composition of the MTT simulator.
2. `src/components/ScheduleEditor.tsx` edits the schedule rows.
3. `src/components/ControlsPanel.tsx` edits run controls and visualizes the run
   lifecycle.
4. `src/lib/sim/useSimulation.ts` bridges React to the worker pool.
5. `src/lib/sim/worker.ts` dispatches worker messages into `engine.ts`.
6. `src/lib/sim/engine.ts` compiles the schedule, runs shards, merges shards,
   and builds the final result payload.
7. `src/components/ResultsView.tsx` consumes `SimulationResult` and renders the
   derived UI.

That boundary is intentional: the engine stays pure TypeScript, and React
stops at `useSimulation.ts`.

## Where things live

### `src/lib/sim/`

Production math and orchestration for the Monte Carlo engine.

- `types.ts`: canonical data contracts. Start here for new fields.
- `finishModel.ts`: PMF builders, ROI calibration, PrimeDope compare path.
- `payouts.ts`: payout tables and normalization.
- `engine.ts`: compile, hot loop, merge, post-processing.
- `worker.ts`: worker protocol and transfer lists.
- `useSimulation.ts`: React-owned pool lifecycle, progress composition,
  background run caching.
- `progressAggregation.ts`, `progressConstants.ts`: pure progress math extracted
  out of React/worker glue.
- `*.test.ts`: determinism, payout correctness, engine invariants.

If the change affects randomness, payout math, or result semantics, it belongs
here first.

### `src/components/`

Top-level product UI.

- `ScheduleEditor.tsx`: schedule table and advanced row controls.
- `ControlsPanel.tsx`: run controls, ETA, progress bar, phase labels.
- `ResultsView.tsx`: result composition and most product-side post-hoc views.
- `ModelPresetSelector.tsx`, `PayoutStructureCard.tsx`: smaller surrounding UI.

### `src/components/charts/`

Chart-specific rendering. Keep these chart-focused; shared math should live in
 `src/lib/`.

### `src/lib/results/`

Pure post-hoc helpers used by the result UI.

- `refLines.ts`: persistence and helpers for ROI reference lines.
- `satellite.ts`: satellite-only result reductions.
- `trajectoryTransforms.ts`: deterministic path/rakeback/jackpot transforms.

This folder exists to keep `ResultsView.tsx` from becoming the only place where
post-processing can live.

### `src/lib/ui/`

Pure UI math and persistence helpers.

- `etaEstimator.ts`: ETA smoothing and bootstrap logic.
- `progressBarState.ts`: progress-bar state machine.
- `useLocalStorageState.ts`: controlled localStorage-backed state.

### `scripts/`

Offline tooling, calibration sweeps, parity probes, benches, and research
artifacts. See [`scripts/README.md`](../scripts/README.md) before running
anything non-trivial.

## Large-file hotspots

These files are healthy enough to ship from, but expensive to touch casually:

- `src/components/ResultsView.tsx`
- `src/components/ScheduleEditor.tsx`
- `src/app/page.tsx`
- `src/lib/sim/engine.ts`

Rule of thumb:

- If the logic is pure and reusable, move it out before adding more branches.
- If the logic is hot-path engine code, prefer stability and benchmarks over
  aggressive decomposition.

## Branch and worktree hygiene

- `main` is production.
- `dev` is the integration branch and must stay ahead of or equal to `main`.
- Long-running or dirty work belongs on a named branch such as `wip/*`, not on
  `dev`.
- Before shipping, the repo should be green on all four gates: test, typecheck,
  lint, build.

## Recommended entry points

- New payout structure: `src/lib/sim/payouts.ts`
- New finish model: `src/lib/sim/finishModel.ts`
- New stochastic channel: `src/lib/sim/types.ts` then `src/lib/sim/engine.ts`
- New result card: `src/components/ResultsView.tsx`
- New chart math: `src/lib/results/*` or `src/lib/sim/*`
- New chart rendering: `src/components/charts/*`
- New calibration fit: `docs/FITTING.md` plus the relevant script in `scripts/`
