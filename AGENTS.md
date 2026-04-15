<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent orientation — tournament-variance-sim

Post-compression re-entry point. If the conversation was summarized, start here, then open the docs below.

## What this is

Next.js 16 + React 19 + TypeScript Monte Carlo simulator for poker MTT variance. Compares against PrimeDope-style calibration. Engine is pure TS in `src/lib/sim/`, runs in a Web Worker pool; UI is `src/app/page.tsx` + `src/components/`.

## Canonical docs (read these instead of guessing)

- **`docs/ARCHITECTURE.md`** — data flow, worker pool, determinism contract, hot-loop shape, storage, perf knobs, "where to start if you want to…" table. Authoritative architecture map.
- **`CONTRIBUTING.md`** — dev setup, branching, commit style, testing rules, code style, sharp edges.
- **`README.md`** — user-facing overview + short architecture section (RU primary, EN mirror).

If code and docs disagree, the code wins — fix the doc.

## Things that trip up fresh sessions

- **Determinism is a hard contract.** `SimulationInput + seed → byte-identical SimulationResult` regardless of pool size. No `Math.random()`, `Date.now()`, `performance.now()` inside `src/lib/sim/` (except `useSimulation.ts`, which is outside the engine). Only `mulberry32` seeded via `mixSeed(baseSeed, sampleIdx, rowIdx, bulletIdx)`. `sampleIdx` is the GLOBAL index in `[0, samples)`, not shard-local. New stochastic channel → fresh mixSeed slot + determinism test.
- **`samplePaths.paths.length` ≠ `samples`.** Only the first ~1000 samples of shard 0 store hi-res trajectories (`wantHiResPaths` in `engine.ts`). Slider in `ResultsView` caps at `paths.length`.
- **PrimeDope compare mode** uses a second calibration path (`calibrateShelledItm` + `pdCurves.ts`). Changes to the main calibration don't auto-propagate — check compare coverage when touching `finishModel.ts`.
- **PKO heat** in the hot loop snaps a Gaussian per-tournament to one of `HEAT_BIN_COUNT` preconcentrated `bountyByPlace` tables. Mean bounty is preserved per bin; only σ shifts.
- **ICM** capped to top-9 via Malmuth-Harville bitmask DP. Beyond that it's payoutByPlace only.
- **Dev branch invariant:** `dev` is always ≥ `main`, never behind. Run `git log dev..main` before starting work; ship via `git merge --ff-only dev`.
- **i18n is enforced by types.** Every user-visible string needs a key in `src/lib/i18n/dict.ts` with both `en` and `ru`. TS build fails on missing locale.
- **No allocations in the hot loop.** `simulateShard` reuses preallocated typed arrays. `new Float64Array(n)` inside the inner loop is a bug.

## Dev workflow

```bash
npm install
npm run dev         # http://localhost:3000 (user often runs on :3456 — check for stale servers first)
npm test            # vitest, single-digit seconds
npx tsc --noEmit    # type check
npm run lint
npm run build       # catches real Next.js errors
```

Before calling a PR done: **all four** (test + typecheck + lint + build). For UI work: also exercise the feature in a browser — type checks don't verify feature correctness.

Start/kill dev servers yourself; don't hand off to the user. Kill stale ones before spawning new. Use forward slashes in paths (git-bash on Windows), `/dev/null` not `NUL`.

## Code style in one screen

- TypeScript strict. No `any` except at external API boundaries we don't control.
- No comments that describe *what* — name things better. Only comment *why* when non-obvious. No "added for X" / "used by Y" — that rots.
- No premature abstractions. Three similar lines is fine.
- No feature flags for internal toggles.
- Error handling at boundaries only (worker messages, localStorage). Inside the engine, trust types.
- Tests live next to the file they cover. Vitest. Keep the suite fast.

## Where to start for common goals

See the table at the bottom of `docs/ARCHITECTURE.md`. Short version:

| Goal                        | File                                              |
| --------------------------- | ------------------------------------------------- |
| Payout structure            | `src/lib/sim/payouts.ts` + `types.ts` + `dict.ts` |
| Finish model                | `src/lib/sim/finishModel.ts`                      |
| New chart                   | `src/components/charts/` + `ResultsView.tsx`      |
| Noise / tilt channel        | `types.ts` + hot loop in `engine.ts`              |
| Demo scenario               | `src/lib/scenarios.ts` + `dict.ts`                |
| Language                    | `src/lib/i18n/dict.ts`                            |
| α calibration               | `finishModel.ts` → `calibrateAlpha()`             |
| Per-run stored data         | `engine.ts` → `buildResult()`                     |

## Re-entry checklist after compression

1. Read this file (you're here).
2. Skim `docs/ARCHITECTURE.md` for the data-flow diagram and determinism contract.
3. Run `git status` + `git log -5 --oneline` to see actual repo state — don't trust summary claims about what's committed.
4. If touching the engine: re-read `src/lib/sim/engine.ts` top-of-file. If touching UI: re-read the file you're about to edit before editing — `page.tsx` and `ResultsView.tsx` are large and shift often.
5. Run `npm test` before any non-trivial change to confirm baseline is green.

Do not act on summary claims about in-progress work without verifying against the filesystem. Summaries lose nuance; the tree does not.
