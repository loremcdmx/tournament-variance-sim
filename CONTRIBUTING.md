# Contributing

Thanks for forking. This file covers the dev workflow, what gets tested, and the conventions that keep the codebase tractable.

For the architecture map (what each file does, how the engine is wired) read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — this doc assumes you already know the layout.

## Dev setup

```bash
npm install
npm run dev         # http://localhost:3000
```

Requires Node 20+. Everything else is pinned in `package.json`.

```bash
npm test            # vitest
npm run test:watch  # watch mode
npx tsc --noEmit    # type check (no emit)
npm run lint        # eslint
npm run build       # prod build (catches real Next.js errors)
```

Before a PR: run **all four** — test, typecheck, lint, build. Any one failing blocks the merge.

## Branching

- `main` — prod. Vercel auto-deploys from here.
- `dev` — integration branch for batched work. `dev` must always be ahead of or equal to `main`; never behind. Before starting work, run `git log dev..main` and verify it's empty.
- Feature branches off `dev` are fine but not required for small fixes.

To ship: merge `dev` into `main` as a fast-forward (`git merge --ff-only dev`) and push. If `--ff-only` fails, something landed on `main` out-of-band — investigate before force-anything.

## Commit style

Imperative subject, tight body, no emoji.

```
Short subject line in imperative mood

Optional body — one paragraph max on the *why*, not the *what*.
The diff already tells us what. Reference specific file:line if
something needs callout.
```

Bundle related changes. A preset rework and a lint fix go in **separate** commits — mixed commits make bisect harder and make reviews painful. If you see unstaged work in `git status` that doesn't belong to your current task, don't `git add -A` — stage the specific files instead.

## Testing

Tests live next to the file they cover: `engine.test.ts` for `engine.ts`, etc. We use Vitest, and the whole suite runs in single-digit seconds — keep it that way.

### What to test

- **New stochastic mechanism** → add a determinism test (same input + seed → identical `finalProfits`) and a direction test (does the mechanism move σ / mean / whatever in the expected direction).
- **New payout structure** → the existing `payouts.test.ts` loop will catch any missing normalization. Add a shape test if the structure has a particular invariant (e.g., flat = all places equal, winner-takes-all = single element).
- **New finish model** → at minimum, assert `sum(pmf) == 1` and that α calibration converges (or that the model short-circuits it explicitly).
- **UI component** → generally not tested. The engine is where correctness matters.

### The determinism contract

Described in detail in `docs/ARCHITECTURE.md`. Summary:

- Same `SimulationInput` + same `seed` → byte-identical `SimulationResult`, regardless of worker pool size or shard order.
- `engine.test.ts` enforces this with a direct comparison. Do not regress it.
- Consequence: never use `Math.random()`, `Date.now()`, or any time/env-dependent API inside `src/lib/sim/`. Only `mulberry32` seeded via `mixSeed(baseSeed, sampleIdx, rowIdx, bulletIdx)`.
- `sampleIdx` is the **global** index in `[0, samples)`, not shard-local. This is what makes parallel runs reproducible.

Adding a new stochastic channel? Pick a `mixSeed` slot that doesn't collide with existing ones, and add a 3-line test that runs the same input twice and asserts equality.

## Code style

- **TypeScript strict** — everything. No `any` except when pinned to an external API shape we can't control.
- **Comments**: only when the *why* is non-obvious. Don't describe what the code does; name things better instead. References to past fixes or "added for X" rot — put that in the commit message, not the code.
- **No premature abstractions.** Three similar lines is fine. Wait for the fourth.
- **No feature flags for our own code.** If we want to change behavior, change it. Flags are for third-party rollout, not internal toggles.
- **Error handling at boundaries only.** Inside the engine, trust the types. At the UI/worker boundary and at localStorage, validate and fall back cleanly.
- **i18n for every user-visible string.** Add a key to `src/lib/i18n/dict.ts` with both `en` and `ru`. TypeScript will fail the build if a key is missing in any locale.

## UI work

Before calling UI changes "done": start the dev server, exercise the feature in a browser, and check both the happy path and 1–2 edge cases. Type-checks and tests verify *code correctness*, not *feature correctness*. If you can't physically test the UI (e.g., hardware-specific), say so explicitly in the PR description — don't claim success.

For UI regressions, `ResultsView` is the hot spot — it's the biggest file in `src/components/`. Work incrementally.

## Performance

The engine is the performance-critical path. Rules:

- **No allocations in the hot loop.** Every `simulateShard` iteration should reuse preallocated typed-array scratch buffers. New `Float64Array(n)` inside the inner loop is a bug.
- **Typed arrays over regular arrays** when sizes are known. Avoid pushing to arrays in the hot path.
- **Worker pool size** is `hardwareConcurrency / 2` by default. More isn't faster — each worker is CPU-bound.
- Before optimizing, measure. `performance.now()` around `onRun` in `useSimulation.ts` gives you wall-clock.

The UI path is less critical but: don't put non-trivial work in render. `useMemo` over the full `SimulationResult` is fine; recomputing histograms on every keystroke is not.

## Documentation

If your change affects:

- **User-visible behavior** → update `README.md`.
- **Engine architecture, data flow, or invariants** → update `docs/ARCHITECTURE.md`.
- **Dev workflow, test conventions, style** → update this file (`CONTRIBUTING.md`).
- **Individual module** → update the top-of-file module comment so future readers can orient without reading the whole file.

Keep docs accurate. Stale docs that contradict the code are worse than no docs.

## Known sharp edges

- **Next.js 16 / React 19.** APIs may differ from what most tutorials show. If something doesn't work the way you remember, check `node_modules/next/dist/docs/` for the current version before googling. See `AGENTS.md`.
- **PrimeDope compare mode** uses a second calibration path (`calibrateShelledItm` + `pdCurves`). Changes to the main calibration don't automatically propagate — check the compare run's test coverage when you touch `finishModel.ts`.
- **`samplePaths.paths.length` ≠ `samples`** — only the first ~1000 samples have stored trajectory paths. The slider cap in `ResultsView` reflects this. Changing it means also changing `wantHiResPaths` in `engine.ts`.
- **Seed slot collisions.** If two stochastic channels both call `mulberry32(mixSeed(seed, s, 0, 0))`, they'll be correlated in ways you probably didn't intend. Give each channel its own dispatch slot.

## Questions?

Open an issue or DM. If you're an AI assistant reading this — the codebase assumes you're up to speed on the architecture doc. Don't guess at file contents; read them.
