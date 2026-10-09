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

- Every numeric band must have an explicit box: the grid it was measured on.
- Runtime policy must know when it leaves that box.
- If the point is acceptable but the band is not, hide the band.
- "Looks close on average" is not enough if the UI exposes bad grid edges.
- Residuals on sigma are not the user-facing error directly; k-style quantities
  can magnify them.

### Current mental model

- Exact schedule mode is point-first and schedule-aware.
- All four single-format planning cards (freeze, PKO, Mystery, Battle Royale)
  take their point σ from `formatRuntimeSigma`: the format's default one-row
  schedule, built the way the editor builds it (`applyGameType` +
  `applyItmTarget`) and compiled by the engine. The ConvergenceChart chips and
  the prove-edge card call the same function, and a test ties both to
  `buildExactBreakdown` of that row. Do not add a hand-built synthetic row
  to a card: the old BR chip used a $50 buy-in (so the engine picked the $25
  envelope table, 5.8 BI vs 7.8) and the old Mystery chip added a PKO
  head-size channel the editor's row does not have, and nothing noticed for
  months.
- The band around that point is the gap between the analytic σ and the engine's
  own Monte Carlo, measured by `scripts/fit_runtime_sigma_bands.ts` and kept in
  `runtimeSigmaBands.ts` (resid per format and the box it holds on; a test pins it
  to `scripts/fit_runtime_sigma_bands.json`). The chips, the prove-edge card and
  schedule mode all read that one number. The earlier constants (freeze ±50 % /
  ±6 %, PKO ±11 %, Mystery ±3 % / ±13 %, BR ±10 %) belonged to closed-form
  surfaces that no longer feed the cards; do not bring them back. The gap
  itself is small (under 1 % for freeze, PKO and Mystery over the whole slider
  range), so the band is mostly 2 SE of Monte-Carlo noise, and BR's 6 % is
  noise-limited (the 10 000x envelope), not a measured error. The band does not
  cover the gap between the model and real play, and the footnotes say so.
- Battle Royale KO EV split now centers on the row's configured
  `bountyFraction` baseline. Do not resurrect older "BR is always 50/50
  cash/KO at slider center" wording without re-checking `compileEntry.ts` (the
  bounty-split lives there now) and `previewRowStats.ts`.
- The closed-form surfaces (`SIGMA_ROI_*`) are only the fallback of
  `computeConvergenceRows` when no runtime override is passed; their `resid` is
  their own error against their own grid, not a card's band.
- A card's σ is only as honest as the ITM it assumes. The run path pins every
  row's ITM (`applyItmTarget`: the payout table's paid share unless the row or
  the global target says otherwise); a free-α row gives 3-5% lower σ (Mystery
  field 1000, ROI +10%: 6.03 vs 6.33 BI). The global target (run settings,
  `itmGlobalEnabled` / `itmGlobalPct`) reaches the cards through
  `VolumePlanningPanel` (a required prop at every layer, so a new call site
  cannot forget it); at 18.7 % it moves σ by -7 % / -25 % / -13 % for freeze /
  PKO / Mystery at field 1000, ROI +10 %. A BR row carries its own ITM, so the
  target does not touch it.

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

- Isolated result-toolbar re-runs must compose patches with the pending input
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
`input.schedule` / `scheduleRepeats` off the shard requests. The results header
now uses completed inputs too, but worker requests are the direct execution proof.

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

## Completed Result Ownership And Boundary Proofs

- `useSimulation` caches the result, effective worker input and raw share source together for each seed. Results must never read live editor controls. PrimeDope-only reruns replace the pass whose calibration is PrimeDope, including the primary pane under the PD preset; pending checkbox flags are separate from completed report inputs.
- A normalized PMF does not prove that explicit finish locks are satisfiable. Coincident paid/top3/FT boundaries need equal cumulative probabilities. Validation excludes only the nine fixed reference models; `powerlaw-realdata-influenced` still supports locks.
- Ruin includes equality with the bankroll. An empirical minimum bankroll must exceed tied losses, and its displayed USD/ABI amount must not round back below that bound. Test the formatted recommendation as well as the scalar.
- Saved trajectories now select the first 1000 global sample indices. Do not reintroduce proportional per-shard rounding; both the selected paths and aggregate results must be independent of shard boundaries/order.
- `smoke:cash` uses the actual `?admin=1` route. Browser readiness waits for product elements, not `networkidle`; dev HMR and analytics can keep the network active. `SMOKE_BROWSER_CHANNEL=chrome` uses an installed Chrome when Playwright's bundled browser is unavailable.

## Space → Ocean Explorer Readouts

The 8 October 2026 audit found the page showing less uncertainty than the
anchor really has. Do not undo these without re-measuring:

- The ± next to the Space σ and ROI is a delete-one-month jackknife of the
  training months (`scripts/anchor_uncertainty.ts` writes it into
  `space-runtime-profile.json`; `--check` verifies it). It is about 2-3% of σ
  and about 2 percentage points of ROI, three to ten times the spread of the
  θ range and the bridge SE. Regenerate it with the script, never by hand.
- Display is rounded to what that error supports: σ and ROI to one decimal, the
  distance SD to tens of BI (hundreds printed Space and Ocean as the same
  "≈ 1 000"), the SD of the average ROI to 0.1 percentage point, and the θ
  block to two decimals (it shows differences of a few hundredths). The
  unrounded values behind them did not change.
- An end of the θ range may come from a scenario that fails the numerical
  gates (θ = 0.5 at the 100 BI threshold does). The note is derived from the
  precision table; do not type the θ into the text.
- Every bridge record is a pilot run. The status is shown together with the
  count of scenarios that pass the gates, whether or not the table is present.
- The 1,087 players in the profile are the whole 500–1,999 field window; the
  published 1000–1499 bin is a subset of them and its own count is not stored.
- Realised σ and ROI of Ocean over thousands of simulated careers are unstable
  (heavy tail), so the downside report's σ column is an analytic bound and the
  caption says so. Do not compare it with a sample σ.

## Ocean Downside Report Readouts

The 8 October 2026 audit found the arithmetic of the Ocean tab correct and its
presentation misleading. Do not undo these without re-measuring:

- The longest spell below EV has a P95 of about the whole distance in every format
  (arcsine law: 0.975-1.000 of the distance at 1k, 5k and 20k entries). Advice to
  "extend the horizon" is wrong for it; the card shows the median, and tables
  print "≈ full distance" from 97% of the distance. The spell below the previous
  peak is different: at 1k entries its P95 is also about the whole distance
  (0.97-1.00 in all four formats), but its share of the distance falls to about
  0.7-0.96 at 5k and 0.33-0.69 at 20k, so a longer horizon does show more there.
- Ratios between formats carry Monte Carlo noise in the second digit and change
  with the distance (Ocean / PKO drawdown P95 about 1.2 / 1.4 / 1.4-1.5x at 1k / 5k / 20k).
  Show one digit.
- Risk curves use one dynamic grid per metric, shared by every format in a chart
  and ending at a round number strictly above the deepest career. A fixed 0-1000 BI
  grid cut 12% of the freezeout careers (drawdown) and 34-37% (EV shortfall) at 20k.
- All formats share the seed, so their careers are positively correlated (Spearman
  0.56-0.89 of final profit). Monte Carlo intervals are per format, not for differences.
- Streak ties use a tolerance of 1e-9 of a ticket: a Battle Royale break-even entry
  can sum to -1.78e-15 and must not count as a loss.

## Heavy-Tail Readouts And Fixed Shapes

The 8 October 2026 audit found readouts that were arithmetically right and
statistically misleading. Do not undo these without re-measuring:

- `stats.mcSeStdDev` is σ/2·√((κ−1)/(S−1)) with the sample's own kurtosis. The
  normal-theory σ/√(2(S−1)) showed 0.7% for an Ocean KO run (10 000 samples ×
  1000 entries) whose σ moved by 12% between seeds (7.05-10.13 BI over 10 seeds);
  the kurtosis form reports about 10%. The plug-in κ is itself noisy on a heavy
  tail, so the UI prints it as "±X%", never as a precise figure.
- Kelly (σ²/μ) and the Gaussian 1% / 5% bankrolls are marked unstable / overstated
  when the excess kurtosis is above 6 (`sigmaReliability.ts`, i.e. σ at least
  twice as uncertain as the normal formula says). The path-based risk of ruin and
  minimum bankroll are the stable ones and stay unmarked.
- Models that ignore the row ROI (uniform, empirical, `*-realdata-*`, a pinned α)
  report `expectedProfit` from their own finish pmf; a bounty row on such a model
  still reads cost × ROI because the bounty channel closes the gap. A test that
  expects cost × ROI for a fixed-shape model without a bounty is wrong.
- The diagnostic σ (the preview's `payoutStd` and `stats.sigmaPerTournamentAnalytic`)
  is `compiledEntryMoments`; do not write a second σ formula next to it. The old
  place-only σ was 2.5% low for PKO, 23% for Mystery and 3.8x for Battle Royale.
- The default Battle Royale bounty share is computed from GG's envelope table
  (`battleRoyaleBountyShareOfNetPool`, 21/46 = 0.4565), which leaves exactly the
  published 40/30/20 cash split. Do not put a rounded literal back.
- `mystery-realdata-*` is a splice of the PKO cash zone and the freezeout tail, not
  measured Mystery data; keep the labels saying so.

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
