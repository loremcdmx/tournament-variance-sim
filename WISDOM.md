# WISDOM — tournament-variance-sim

Living project memory for fresh agents and reviewers.

Read this file before touching code, running audits, or trusting older reports.
If this file and the tree disagree, the tree wins — then update this file.

## What This File Is For

This project has accumulated a lot of context in agent loops, reviews, refits,
and release-prep sessions. The biggest failures were usually not algorithmic;
they were stale assumptions:

- reviewing an old diff against a new tree;
- repeating a finding that had already been fixed;
- trusting a report instead of `git status`;
- treating a local dirty worktree as if it were the committed product;
- calling a fit "good enough" without checking its runtime policy.

Use this file as a guardrail against those mistakes.

## First Principles

1. Reality beats reports.
2. Code beats docs.
3. Product behavior beats pretty math.
4. Clean HEAD and dirty worktree are different audit targets.
5. Point estimate and numeric band are different promises.

## The Project's Hard Contracts

- Determinism is sacred: `SimulationInput + seed -> byte-identical SimulationResult`.
- No random/time side channels inside `src/lib/sim/` hot loops.
- No allocations inside inner loops.
- i18n is type-enforced; every user-visible string needs both `en` and `ru`.
- Cleanup is its own commit. Do not hide feature work inside cleanup.

## Convergence / Sigma Wisdom

This area produced the most false confidence. Remember:

- Every closed-form sigma fit must have an explicit training box.
- Runtime policy must know when it leaves that box.
- If the point is acceptable but the band is not, hide the band.
- "Looks close on average" is not enough if the UI exposes bad grid edges.
- Residuals on sigma are not the user-facing error directly; k-style quantities
  can magnify them.

### Current mental model

- Freeze is runtime-first rather than "just trust one old closed form".
- Exact schedule mode is point-first and schedule-aware.
- Mystery now centers on runtime single-row estimates and shows numeric bands
  only inside its validated UI box.
- Battle Royale also centers on runtime single-row estimates; its numeric band
  is valid only inside the fixed BR box (AFS 18, ROI +/-10%).
- Battle Royale KO EV split now centers on the row's configured
  `bountyFraction` baseline. Do not resurrect older "BR is always 50/50
  cash/KO at slider center" wording without re-checking `compileEntry.ts` (the
  bounty-split lives there now) and `previewRowStats.ts`.
- PKO keeps the promoted averaged fit band, and only inside the validated
  training box.

### Policy taxonomy to remember

Convergence warning reasons are not binary anymore. Verify current code, but the
important concept is:

- `outside-fit-box`

Older reason names such as `contains-mystery` / `contains-mystery-royale` were
real at the time, but current policy collapses unsafe bands into
`outside-fit-box`.

Do not resurrect older review text that assumed the previous multi-reason
taxonomy without re-checking `convergencePolicy.ts`.

## Stale Findings To Re-Verify Before Repeating

Several findings were true once and then got fixed. Never repeat them from
memory without reopening the file:

1. `inferRowFormat` misrouting plain Mystery into Battle Royale.
2. `normalizeBrMrConsistency` letting BR payout override explicit `gameType`.
3. Convergence copy claiming Battle Royale still had an honest numeric band.
4. `ResultsView.tsx` depending on an untracked `trajectoryHitTest.ts`.

All four existed in real history. None should be cited again without checking
the current tree.

## Audit Workflow That Actually Works Here

When asked "what is the state of the project?", do this in order:

1. `git status --short --branch`
2. `git branch -vv`
3. `git log --oneline -10`
4. Separate:
   - committed stack vs upstream;
   - current dirty worktree;
   - untracked files that tracked files already import.
5. Run the real gates:
   - `npx tsc --noEmit`
   - `npm test` or `./node_modules/.bin/vitest run`
   - `npm run build` (prefer `--webpack` when detached-worktree/Turbopack
     symlink issues muddy the signal)
   - `npx knip`

Never merge those layers into one verdict.

## Commit Hygiene Lessons

The most common local debt pattern here is not broken runtime code; it is
tracked files depending on untracked helpers/tests.

Recent recurring examples:

- tracked cash UI/engine files importing `cashInput.ts` before the file was
  added to git;
- tracked UI files importing shared row-label helpers before the helper was
  staged.

When you see this pattern, call it what it is: packaging/staging debt, not a
logic bug.

## Branch / Process Wisdom

The documented branch policy says `dev >= main`. In practice, this has drifted
before. Treat branch topology as a fact to verify, not a law to assume.

If `AGENTS.md`, `BACKLOG.md`, and `git branch -vv` disagree about the active
branch or promotion path:

- cite the mismatch;
- treat it as process debt;
- do not infer product breakage from it automatically.

## Docs Hygiene Wisdom

`BACKLOG.md` is operational truth only if someone keeps it current.

Common stale-doc patterns here:

- header says active branch is `dev` while work happens on `main`;
- cleanup section still says `knip clean` after new unused exports appear;
- shipping notes describe an older convergence policy than current code.

So: use docs for orientation, not proof.

## What Counts As Real Tech Debt Here

Usually real debt falls into one of four buckets:

1. **Packaging debt** — tracked imports rely on untracked files.
2. **Dead-code debt** — `knip` reports exports nobody actually uses.
3. **Process debt** — branch/docs policy no longer matches reality.
4. **Model-policy debt** — math and UI promise drift apart.

Not every dirty worktree is debt; sometimes it is just active feature work.
The question is whether the current state is misleading, fragile, or expensive
to safely continue from.

## Stale Copy Trap

`src/components/results/ResultsPanels.tsx` (`OurModelWeaknessCard` and
`PrimeDopeWeaknessCard`) has hard-coded Russian explanatory text — not i18n
keyed, not type-enforced. Nothing in the build will catch when a recent
commit closes a gap that the card still claims is open.

Whenever you touch convergence policy, schedule-mode bands, or path-metric
inclusion (BR leaderboard, rakeback, etc.), re-read both cards and update
the wording in the same change. Treat these cards the same way you'd treat
docs that drift: code wins, fix the copy.

Recent examples that drifted before being caught: the SCHEDULE block
claiming schedule-mode is point-only after `99c5f2d` already shipped a
banded mode; the PATHS block claiming BR leaderboard hadn't been folded
into trajectory after `43ff237` did exactly that.

## Three Validation Layers

Inputs to the simulator pass through three independent guards. Don't
confuse them:

1. **`validateSchedule`** (`src/lib/sim/validation.ts`) — engine-blocking.
   Catches inputs the α-calibration physically can't satisfy (e.g. a
   fixed-ITM row whose pinned shells leave no room to hit the ROI). Run is
   gated on `feasibility.ok`.
2. **`getConvergenceBandPolicy`** (`src/lib/sim/convergencePolicy.ts`) —
   band-only. Suppresses the convergence numeric ±band when any sample
   sits outside the per-format fit-box. The point estimate stays.
3. **`checkInputSanity`** (`src/lib/sim/inputSanity.ts`) — soft warnings.
   Catches *internally inconsistent* inputs the engine would compute
   honestly but the user almost certainly didn't mean (PKO row with
   `bountyFraction = 0`, tilt with `gain ≠ 0` and `scale = 0`, empirical
   model with too few buckets, etc.). Never blocks a run.

When adding a new input field, decide which layer it belongs in. A new
"my edge is genuinely uncertain" handle goes in sanity if it has a
coherent dead-handle case. A new ROI calibration target may need
feasibility coverage. A new convergence channel needs its own fit-box and
residual coefficient before being band-eligible.

## Cash-Mode Release Wisdom

- `npm run smoke:cash` is now the canonical pre-release smoke for the advanced
  cash tab. It auto-detects a live local server when possible, otherwise tries
  to boot a temporary dev server, then writes screenshots and `report.json` to
  `scripts/smoke-out/cash-release/`.
- The useful cash edge-case is not just "does the page render?" but "does a
  disabled optional lens stay disabled after normalization, rerun, and
  persistence?" A real bug here let `hoursBlock` disappear from the input UI
  while silently reappearing in results as `EV / час`.
- For cash audits, test at least these four paths before making release claims:
  desktop default, desktop mixed-stakes with share renorm, desktop
  hourly-disabled, and mobile default with overflow check.
- If a cash smoke fails, inspect whether the problem is in UI state hydration,
  serialization, or engine snapshot normalization before blaming charts. This
  product already had one bug where first paint looked honest but `runSim()`
  rebuilt a default optional block underneath the user.

## Result Toolbar Re-Run Wisdom

- Isolated result-toolbar re-runs must update the stored `lastRunInputRef`
  before dispatching. A real bug let sequential PrimeDope checkboxes update the
  visible React state while the second worker re-run started from an older
  input snapshot and silently re-enabled the first checkbox's flag.
- PrimeDope "faithful" has two separate meanings here. The UI/preset should
  borrow PD's payout/finish/rake distribution mechanics but keep the app's
  full buy-in+rake ROI basis. Byte-for-byte live-site parity also needs
  `primedopeStyleEV: true`, and that should stay a diagnostic-script opt-in.

## Run Must Read Settled State

"I changed the distance, clicked Run, the bar ran, nothing changed" was real
and had three legs, all reproduced from the worker requests, not from the UI:

- `ScheduleEditor` commits blur drafts inside `startTransition`. A mouse click
  on Run blurs the field on mousedown and fires `onRun` on click; the click's
  closure still held the previous schedule, so the engine ran N=1000 while the
  results header (live state) already said 2 000.
- Cmd/Ctrl+Enter is a `window` keydown; a `commitMode="blur"` field that still
  has focus has not committed at all, so the shortcut ran the old value.
- `ControlsPanel` disables its `<fieldset>` while running. Chrome drops focus
  from a disabled field **without a blur event**, so the draft stayed on screen
  and stayed uncommitted; every later Run repeated the stale value until the
  user touched the field again.

Stable seeds made this visible (identical result), they did not cause it —
before the seed became stable the same bug produced a *different* result for
the *wrong* N, which is worse. The fix in `page.tsx`: Run blurs the focused
form field, then requests the run as a transition-lane state change; an effect
builds `SimulationInput` from the state that request rendered against. Do not
"simplify" it back to calling `run()` from the click handler. When checking
this class of bug, patch `Worker.prototype.postMessage` and read
`input.schedule` / `scheduleRepeats` off the shard requests — the results
header is derived from live state and will lie.

## Timeout Signature vs Determinism Failure

A red full-suite run with an inflated duration (155s or 415s against the normal
~35-40s) is a **timeout signature**, not a determinism failure. Before suspecting
the engine, check that every error line says `Error: Test timed out in Nms` and
that there are zero `AssertionError` / numeric mismatches.

This was actually investigated once: 17 failures under artificial CPU contention
were 100% timeouts, and the `bountyEvBias` scenario produced byte-identical
17-significant-digit output across three quiet runs and three runs under 36 CPU
hogs. CPU load cannot move a seeded number.

The real defect was config, not code: ~20 Monte Carlo tests sat at 0.5-1.4s
against Vitest's unconfigured 5s default `testTimeout`, and contention costs
7-10x. `vitest.config.ts` now pins `testTimeout`/`hookTimeout` to 30s. Do not
"fix" a slow red run by lowering that or by adding `retry` — retries would hide
genuine hangs and cost the most time under exactly the load that triggers this.

Corollary for the other direction: if an engine test ever fails with a real
numeric mismatch, do **not** widen the tolerance. That is the determinism
contract breaking, and the root cause is in `src/lib/sim/`.

## Seed Era And Reproducibility

`mixSeed` (`src/lib/sim/rng.ts`) was changed in v0.7.x so the seed is
finalized before it meets the sample index. The old construction XOR-ed them
raw, which made seeds differing only in low bits the same simulation with
samples permuted: seeds 1, 2, 3, 7 had byte-identical `stats.mean/stdDev`.
The cached sibling batch was unaffected only because `deriveSiblingSeed`
strides by `0x9e3779b1` (high bits change), but a user typing seed 1 then
seed 2 saw "the same run".

Consequences to remember:

- Every simulation output changed with that commit — a new numerical era.
  Old share links and stored runs reproduce the same *distributions* (σ fits
  were re-checked: freeze N=500, 30k samples, field 1000/5000 at ROI +10%
  landed within 2% of `evalSigma`, against a 6% residual) but not the same
  individual paths, best/worst samples, or downswing catalog entries.
- Do not treat a stored-vs-fresh numeric mismatch from before/after that commit
  as a determinism failure. Determinism is still `input + seed -> bytes`
  within one era, and the pool-invariance tests compare runs against each
  other, not against pinned values.
- If a stored fit grid (`scripts/fit_*.json`) is used to judge the current
  engine, remember it was measured under the previous seed era; refit before
  calling small drifts a regression.

## Good Defaults For New Agents

- Start read-only.
- Assume old findings may be stale.
- Verify before escalating.
- Prefer small, typed helper modules over growing giant UI files.
- Keep cleanup separate from feature changes.
- When in doubt, leave a better ledger than the one you inherited.

## Minimum Handoff Standard

If you finish a meaningful audit or refactor, update this file when you learn a
new recurring lesson that future agents are likely to trip over.

Good additions are:

- a class of stale finding people keep repeating;
- a policy/runtime mismatch that created false confidence;
- a branch/process habit that keeps surprising new sessions;
- a testing/build caveat that changes how to verify the code honestly.
