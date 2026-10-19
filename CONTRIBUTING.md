# Contributing

Thanks for forking. This file covers the dev workflow, what gets tested, and the conventions that keep the codebase tractable.

For the architecture map (what each file does, how the engine is wired) read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — this doc assumes you already know the layout. Then use [`docs/REPO_ATLAS.md`](docs/REPO_ATLAS.md) for a shorter "where does this change belong?" map and [`scripts/README.md`](scripts/README.md) before running offline tooling.

## Dev setup

```bash
nvm use            # Node 24 LTS (see .nvmrc)
npm ci
npm run dev         # http://localhost:3000
```

Requires Node 24 LTS. CI reads `.nvmrc`; `engines.node` selects the same major on Vercel. Use the lockfile with `npm ci` for reproducible dependencies.

```bash
npm test            # vitest
npm run test:watch  # watch mode
npx tsc --noEmit    # type check (no emit)
npm run lint        # eslint
npm run build       # prod build (catches real Next.js errors)
npx tsc -p tsconfig.scripts.json   # type check scripts/ (tsconfig.json excludes it)
```

Before a PR: run **all four** — test, typecheck, lint, build. Any one failing blocks the merge. If you changed a type or export in `src/lib/sim/`, also run the scripts type check: the tools in `scripts/` import the engine directly, and nothing else compiles them.

CI runs those four commands, plus the scripts type check, from `.github/workflows/ci.yml` on every
push to any branch, on pull requests, and on manual dispatch. If the team
starts relying on an extra local check, add it to CI as well so the canonical
green state stays the same locally and remotely.

Be honest about what that check enforces today: nothing. There is no branch
protection or ruleset on this repository, so a red `checks` job does not stop
a push to `main`, and Vercel deploys `main` on push — before CI has finished.
The status is informational. Requiring the `checks` status before `main` can
move is a one-command owner decision:

```bash
gh api -X POST repos/loremcdmx/tournament-variance-sim/rulesets --input - <<'JSON'
{"name":"main requires ci","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},"rules":[{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"checks"}]}}]}
JSON
```

With that ruleset on, `main` only moves through a PR whose `checks` job is
green, which also puts CI ahead of the Vercel deploy.

## Branching

- `main` — prod. Vercel auto-deploys from here. Work lands on it through pull requests.
- `dev` — optional integration branch for batched work. It is not kept in lockstep with `main`: it has lagged and diverged before, and a clone may have no local `dev` at all. Check it as it stands, not as a rule: `git fetch`, then `git log origin/main..origin/dev` and `git log origin/dev..origin/main`.
- Feature branches off `main` are the default; off `dev` only when `dev` is a descendant of `main`.
- Dirty exploratory work belongs on `wip/*`, not on `dev`. Keep one clean
  integration worktree that can always run all four gates end-to-end.

To ship, open a PR into `main`. If you do use `dev` and want to fast-forward `main` to it, first confirm `git merge-base --is-ancestor origin/main origin/dev`; if that fails, `main` has commits `dev` lacks, so merge or rebase them in — never force-push either branch to make the two agree.

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

Tests live next to the file they cover: `engine.test.ts` for `engine.ts`, etc. We use Vitest, and the whole suite runs in ~40s on an idle machine (166 files / 2128 tests) — keep it in that ballpark.

### What to test

- **New stochastic mechanism** → add a determinism test (same input + seed → identical `finalProfits`) and a direction test (does the mechanism move σ / mean / whatever in the expected direction).
- **New payout structure** → the existing `payouts.test.ts` loop will catch any missing normalization. Add a shape test if the structure has a particular invariant (e.g., flat = all places equal, winner-takes-all = single element). The id must also be in the `STRUCTURES`, `PAYOUT_COMPAT` and `PAYOUT_GAMETYPE_ALLOW` tables of `ScheduleEditor.tsx` and have `payout.<id>.short` / `.full` keys in `dict.ts`; `persistence.ts` holds it in a `Record<PayoutStructureId, true>`, so a missing entry there fails `tsc`.
- **New finish model** → at minimum, assert `sum(pmf) == 1` and that α calibration converges (or that the model short-circuits it explicitly).
- **UI component** → vitest runs in a node environment with no DOM, so put the logic in a pure function (`src/lib/ui/`, `src/lib/results/`) and test that, or render the component as a function with `src/lib/testing/hookHarness.ts`. `src/lib/ui/simulationInput.ts` (what Run sends to the engine) is an example; the click-to-worker wiring in `page.tsx` itself is only exercised in a browser.

### The determinism contract

Described in detail in `docs/ARCHITECTURE.md`. Summary:

- Same `SimulationInput` + same `seed` → byte-identical `SimulationResult`, regardless of worker pool size or shard order.
- `engine.test.ts` enforces this with a direct comparison. Do not regress it.
- Consequence: never use `Math.random()`, `Date.now()`, `new Date()` or any time/env-dependent API in the engine modules (everything in `src/lib/sim/` except the browser-side `useSimulation.ts`, `useResulthubLookup.ts` and `resulthubLookup.ts`; `engineSourcePurity.test.ts` enforces it). Only `mulberry32` seeded via `mixSeed(seed, sampleIdx)` (separate XOR-offset streams per stochastic channel).
- `sampleIdx` is the **global** index in `[0, samples)`, not shard-local. This is what makes parallel runs reproducible.

Adding a new stochastic channel? Pick a `mixSeed` slot that doesn't collide with existing ones, and add a 3-line test that runs the same input twice and asserts equality.

### The suite is CPU-bound, and that changes how you read a red run

About 20 engine tests are real Monte Carlo runs (millions of tournaments). On an
idle 18-core box the slowest is ~1.1s; under heavy contention — a parallel
`next build`, a shared CI runner, another agent's job — the same tests measure
7-10x slower. Nothing about the *result* changes: the engine is seed-deterministic
and the assertions are load-invariant. Only wall time moves.

Because of that, `vitest.config.ts` sets `testTimeout`/`hookTimeout` to 30s
instead of Vitest's 5s default. At 5s the slow tail had barely 4x headroom, so
any competing process turned the suite red with a scatter of unrelated-looking
failures. Don't lower it back.

If you do see a red full-suite run, check the duration and the error text first:

- total duration far above the usual ~35-40s **and** every error line reading
  `Error: Test timed out in Nms` → that is contention, not a regression. Re-run
  on an idle machine before treating it as a bug.
- any `AssertionError` / numeric mismatch → that is real, and for engine tests it
  means the determinism contract is broken. Investigate the engine, not the test.

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
- **Worker pool size** is `min(16, hardwareConcurrency − 2)` by default (`poolSize()` in `useSimulation.ts`). More isn't faster — each worker is CPU-bound.
- Before optimizing, measure. `performance.now()` around `run` in `useSimulation.ts` gives you wall-clock.

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
- **PrimeDope compare mode** (`calibrationMode: "primedope-binary-itm"`) uses a second calibration path: `buildBinaryItmAssets` in `finishModel.ts` builds the binary-ITM pmf with no α search (`compileEntry.ts` falls back to `calibrateShelledItm` / `calibrateAlpha` only when the PD finish-model flag is off; `pdCurves.ts` is PD's payout tables). Changes to the main calibration don't automatically propagate — check the compare run's test coverage when you touch `finishModel.ts`.
- **`samplePaths.paths.length` ≠ `samples`** — only the first 1000 global sample indices have stored trajectory paths. The slider cap in `ResultsView` reflects this. The prefix length is `HI_RES_GLOBAL_CAP` in `simulateShard` (`hotLoop.ts`); changing it means also changing the `Math.min(1000, …)` caps in `ResultsView.tsx`.
- **Seed slot collisions.** If two stochastic channels both call `mulberry32(mixSeed(seed, s))` with the same seed, they'll be correlated in ways you probably didn't intend. Give each channel its own XOR-offset of the seed (e.g. `seed ^ 0xbeef`).

## Questions?

Open an issue or DM. If you're an AI assistant reading this — the codebase assumes you're up to speed on the architecture doc. Don't guess at file contents; read them.
