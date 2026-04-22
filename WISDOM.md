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

- Freeze is now runtime-first rather than "just trust one old closed form".
- Exact schedule mode is point-first and schedule-aware.
- Mystery is point-only until policy says otherwise.
- Battle Royale is also point-only for convergence right now; do not assume it
  still has an honest averaged residual band.
- PKO is the only averaged bounty tab that currently keeps a numeric band, and
  only inside the validated training box.

### Policy taxonomy to remember

Convergence warning reasons are not binary anymore. Verify current code, but the
important concept is:

- `contains-mystery`
- `contains-mystery-royale`
- `outside-fit-box`

Do not resurrect older review text that assumed only `contains-mystery`.

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
