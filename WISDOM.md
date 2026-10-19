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
- No random/time side channels in the engine modules: everything in `src/lib/sim/` except `useSimulation.ts`, `useResulthubLookup.ts` and `resulthubLookup.ts`, and only those two `use*.ts` files import React (`engineSourcePurity.test.ts` pins both lists; "the whole folder" and "the only React file" were never true).
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
- `SIGMA_ROI_MYSTERY` and `scripts/fit_beta_mystery.json` were trained on rows
  that carried `pkoHeadVar` 0.4, i.e. a per-KO log-variance of 2.4 (the stored
  grid cells at field 1000 / ROI +20 % and 5000 / +30 % match a 2.4 run within
  0.3 %). The engine now ignores `pkoHeadVar` on every row that is or infers
  Mystery / Mystery-Royale (`normalizeFormatFields` keys on `inferGameType`, not
  only on an explicit `gameType`) and compiles 2.0, and no recipe in `scripts/`
  sets it on a Mystery row any more. On the current engine (20k samples,
  `mystery-realdata-linear`, bounty share 0.5) the surface reads 1.04x, 1.11x
  and 1.12x the engine at field 100 / ROI 0, 1000 / +20 % and 5000 / +30 %,
  inside its own 13 % but well over the 2 % of the runtime band. It has no
  bounty-share input, so it is 1.17x at field 300 / ROI +10 % / share 0.3 and
  0.99x at 1000 / -10 % / share 0.7.
  It reaches no number a user sees: the chips, the prove-edge card and schedule
  mode read `formatRuntimeSigma`, `computeConvergenceRows` falls back to the
  surface only for a format with no override, and `buildRuntimeSigmaOverrides`
  always supplies one for a format that carries weight (a test in
  `formatRuntimeSigma.test.ts` pins it). The only other reader is
  `scripts/probe_afs_ceiling.ts` (through `SIGMA_COEF_BY_FORMAT`), plus tests;
  `scripts/xval_mystery.ts` keeps its own copy of the old coefficients. It was
  deliberately not refitted: do that from a fresh
  `resweep_sigma.ts FORMAT=mystery` sweep before wiring it to any card, and do
  not use the old grid to judge the current engine.
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
   - `npx tsc -p tsconfig.scripts.json` (the main config excludes `scripts/`; eslint
     ignores it too, so before this config a renamed field broke nine scripts unseen)
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

`main` is prod and takes work through PRs; `dev` is an optional integration
branch, not a rule. It has lagged and diverged from `main`, and a clone may have no
local `dev`. The docs no longer prescribe `dev >= main` or `git merge --ff-only dev`
(the command aborts without a local `dev`); check with `git fetch` and
`git log origin/main..origin/dev` / `git log origin/dev..origin/main`. Treat branch
topology as a fact to verify, not a law to assume, and never force-push to restore
an invariant.

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

## Shelled-ITM Calibration Order

In `calibrateShelledItm` (`finishModel.ts`) a repair of the pmf, such as spreading the
free-band mass the model could not place, runs AFTER the equilibrium first-place retry.
Before it, the retry reads a different `shells.first` and inputs that pass today change
bit-wise: the engine compile, the preview and `validateSchedule` all call it.

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

## Field-Size Range Is One Source

- `fieldVariants.ts` (`fieldVariantSizes`) is the only place that turns
  `fieldVariability` into field sizes. The engine compiles one entry per size,
  `validateSchedule` checks every size (a small bucket can miss the ROI target
  while the nominal field is fine, and the run used to claim the typed ROI
  anyway), and `computeRowStats` averages over them (`previewFieldMixture.ts`).
  New code must not read `row.players` as "the field" of a range row.
- Under a uniform range the engine ignores `players`.
  `normalizeGameTypeConsistency` writes the range midpoint into the effective
  row, so the preview, payout card, equilibrium ITM default and validation agree
  with the engine, and the AFS input is read-only while a range is active.
- In basic mode the Advanced expander is disabled, so a ranged row that arrives
  by a preset or an old link has a read-only AFS with no editor. The tooltip says
  the range is advanced-only and the row prints the range it plays; there is no
  public route to edit or clear it (a product decision, not made here).
- A Battle Royale row carries no range (`normalizeBrMrConsistency` clears it).
  The editor hides the control and persistence drops it on reload, so a range
  left on the row made the session simulate 140-700 entrants where a share link
  played the real 18-max.

- A Field-size range row's mixed preview takes every place range from the one
  bucket nearest the mean (`mixTiers`). A tier that bucket lacks keeps its mixed
  shares and EV but carries `placesVary`, and the tooltip says the places depend
  on the field size; before, `restItm[28]` of a 258-entry field was printed next
  to a bubble at 19.
- "Fit closest inputs" on a ranged row searches for the one ROI every size can
  reach (a size that falls short caps the target, one that overshoots floors it)
  and returns `kind: "none"` with the row untouched when the bounds cross. In a
  600-row grid of ranged SNG and small-MTT rows 510 were blocked and a ROI fixes
  only 90 of them (a pinned ITM against the small sizes), so the handlers say so
  in an alert instead of rewriting the ROI back and forth. Anything but a ranged
  ROI-gap row keeps the old fallback.

## Calibration Targets, Tolerances And The Worker Cache

- `calibrateShelledItm` is the one place that says whether a pinned-ITM row hit
  its cash target (`feasible`); validation, the Shape panel and the one-click
  fix all read it. A model with no α to move (uniform, empirical) reports
  `feasible` from its locks only and `supportsTargetRoi: false`, because the free
  band lands wherever the shape puts it. Before, any ROI but the flat-equilibrium
  one blocked Run on those two models, since `applyItmTarget` always fills an ITM.
- "On target" is a share of the target (`withinTargetEv`, a thousandth), never an
  absolute dollar slack: `$0.001` was 9% of a `$0.01` ticket and 0.005% of a
  `$20` one, and the strict `1e-6` check at an α bound blocked a row the engine
  hit to 1.3e-4. The cash-target floor follows the ticket too
  (`cashTargetFloor`: `$0.01` from a `$10` ticket up, lower below), so a `$0.01`
  buy-in at -50% pays -50% instead of -9%. The floor and tolerance are mirrored in
  `compileEntry`, `validation` and `previewRowStats`; change all three together.
- A row with no `gameType` compiles, previews and validates as the type
  `inferGameType` gives (the engine used to read the raw field and play a legacy
  Mystery row with PKO bounty weights: σ 13% and 27% lower in two repros).
- A worker keeps the last compiled schedule (`compileCache.ts`), keyed by the
  whole input plus the calibration mode, and the build clears it. Never narrow the
  key to "the fields compile reads": a field added later would be served stale.
  `compileCache.test.ts` runs the hot loop and the build over a shared compile; a
  new write into a compiled schedule must keep that test green.
- `count` is `max(1, floor(count))` everywhere the engine reads it; the editor,
  the CSV import and persistence hold the field to a whole number of 1 or more,
  so a count below 1 only comes from programmatic input.

## Persistence And Stored Rows

- An over-cap payload (more than `MAX_SCHEDULE_ROWS` rows, only possible from an
  older or hand-edited save) is truncated on read, and the autosave or the next
  preset save writes the truncated state back. `loadLocal` and `loadUserPresets`
  first keep the untouched original under `tvs:state-overcap-backup` and
  `tvs:user-preset-overcap-backup:<id>` (dropped with the preset). Nothing reads
  them back yet and the user is not told; a share link keeps no backup, its
  hash is cleared on import. Only the first 300 rows are validated, so a bad row
  past the cap no longer rejects the whole payload.
- A share link carries only the `#s=` hash: `buildShareUrl` clears the sender's
  query string, so a link copied from an `?admin=1` session does not switch the
  recipient into advanced mode.
- `alphaOverride` is clamped on read to `MANUAL_ALPHA_MIN`..`MAX` (-0.5..0.5,
  also what the number field accepts). A link with 10 compiled to a mean of
  5172 against 63.7 at neutral alpha.
- A lock written from the Shape panel stamps the effective ITM onto an auto row
  so `applyItmTarget` keeps the buckets. The page remembers the stamped value per
  row (memory only) and `reconcileLockItmStamp` removes the stamp with the last
  lock, but only while the raw ITM is still exactly that value; an ITM typed
  before or after stays. A stamp that outlives a wholesale schedule replacement
  with the same row id and the same ITM is the one case it can misfire.
- A stored explicit Mystery / Battle Royale row with no `mysteryBountyVariance`
  loads with 2.0 / 1.8, what `applyGameType` writes for the type, while the
  engine alone reads a missing value as 0 (and `inputSanity` warns about 0). That
  is a deliberate restore default, like `bountyFraction` 0.5 for PKO, pinned by
  `persistence.test.ts`; rows made in the app always carry the field. Changing it
  changes what an old save or link simulates, so it is a decision, not a cleanup.
- A state with no rows is damage, not a state: `isPersistedState` refuses it (the
  editor never removes the last row), and the page starts from its default. A
  `#s=` share hash that does not decode is cleared from the address bar and
  announced (`readShareHash`); a hash for any other purpose (`#changelog`) is not
  a share link. The page does not listen for `hashchange`: importing a link into
  an open tab would overwrite the autosave, which is the open share-link-vs-
  autosave decision.
- `saveLocal` / `saveUserPresets` return false on a refused write. Autosave
  failures raise a dismissible notice (`nextStorageNotice`), a refused preset
  save or import raises an alert; none of them used to say anything.
- A saved `compareMode: "random"` is read as `"primedope"`: the results draw only
  a PrimeDope pane, so the old twin pass cost 2x CPU for a pane nobody saw.

## Basic Mode Runs The Sanitized State

`sanitizeControlsForBasicMode` is what the run uses without the advanced switch,
so everything that judges the run reads it too: `previewModel`, validation, the
sanity warnings, the ETA and the memory hint use `effectiveResultsControls`, not
the raw controls. Before, a stored `custom` model (uniform, empirical) blocked
Run and drove "Fit closest" while the engine ran the naive model. `custom` is
advanced-only like the built-in profiles, and the simulation count is capped at
`BASIC_MODE_MAX_SAMPLES` (the default every scenario uses) because only the
advanced panel can lower it. The stored state is not rewritten, so switching
back to advanced restores it.

## Text From The User In A Template

A dict template filled with user text (row label, a worker's error message) goes
through `fmt` (`results/formatters.ts`), never `String.replace("{x}", text)`: a
string replacement reads `$$`, `$&`, `` $` `` and `$'` in the text, so a row named
"$$$ Mid" printed as "$$ Mid". Number-only placeholders are safe either way.

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
- Every cash result number goes through `makeCashFormat` / `useCashFormat`
  (`cash/cashFormat.ts`): grouping and decimal mark follow the UI language, the
  `BB` and `/h` suffixes and the "Run n" label come from `dict.ts`, and a negative
  that rounds to nothing prints `0`, never `-0` / `$-0`. A bare
  `toLocaleString(undefined, ...)` in the cash tab is the old browser-locale bug.
- `rake.enabled` off means rake and rakeback are not modelled (the engine zeroes
  both per row), so the Economics card and the mix bars drop the "Rake paid" and
  "RB earned" figures and say so (`cashRakeModelled`); a printed 0 read as "no
  rake". Winrate is used as entered.
- The cash tab's number fields step with ArrowUp/ArrowDown from the current value
  (`stepNumFieldValue`): the native step grid starts at `min`, so BB 1 became 1.01
  and SD 100 became 101. The spin buttons are hidden globally; a mouse wheel over a
  focused field still takes the native, min-anchored step.
- `simulateCash` normalizes its input first, and `normalizeCashInput` clamps the path count
  to the work budget (`MAX_TOTAL_SIM_HANDS`, 200 M hands): a script that asks for 20 000 paths
  of 100 000 hands runs 2 000 and of 1 M hands runs 200. Print `result.samples`, not the
  number asked for. `scripts/cash_crosscheck.ts` used to print "NaN%" (a renamed field,
  `probBelowThresholdEver`) under a "20k paths" header; it now says how many paths ran and
  prints the z-score of the simulated mean against the analytic one.
- Open, not fixed (changing the sampler is a new numerical era): the cash sampler's mean sits
  about one standard error above the analytic mean. Twelve base seeds give a mean z of +1.2
  (se 0.3) at 2 000 paths x 100 000 hands and +1.4 (se 0.3) at 200 paths x 1 M hands (11 and
  12 of the 12 seeds positive). The same numbers come out of a bare replay of the engine's
  per-path draw (`mulberry32(mixSeed(seed, path))` into Box-Muller, no cash code), so it is
  the sampler, not the accounting. A pooled run of 1e9 draws in 10 000-draw paths showed no
  mean (z 0.6) but a variance of 1.00023 (5 se high). Do not read the "+8 %" high-volume
  mean as an RNG-period overlap: at the budgeted 200 paths it is z 2.3, and the budget is
  what keeps the paths from overlapping.
- `normalizeCashInput` caps a stake's `handShare` at `MAX_HAND_SHARE` (two shares
  of 1e308 summed to Infinity and `compileStakeSchedule` threw) and folds a seed
  outside the 32-bit window (`-2^31 <= seed < 2^32` stays as typed) onto the seed
  the hot loop actually uses, so seeds 2^32 apart no longer echo as different runs.
  Seeds inside the window still collide with their 2^32 twin (-5 and 4294967291).

## Result Toolbar Re-Run Wisdom

- A PrimeDope-only re-run survives edits, so it must not block Run: `run()` drops
  it itself and recomputes both panes from the live controls (`canStartRun`).
  Switching to another cached run while it computes would drop it with the toggle
  already on the controls and the pane on the old data, so the selector is
  disabled until it finishes (`canSwitchRun`, `seedBatch.pdBusy`).

- `interruptBackground` aborts only the sibling-seed precompute (`bgAbortRef`) and
  never a PD-only job (`pdJobIdRef`): the re-run works from the cached run's input
  snapshot, so a field edit cannot change it, and cancelling it dropped the toggle
  with no message. `runPdOnly` aborts the sibling loop itself.
- Under the "Like PrimeDope" preset the PD result is the LEFT pane. The PD toggles,
  the diagnostics button and "Open PrimeDope" follow `pdComparePaneKeys(...).pdPane`,
  never "the right pane"; captions come from the same function.
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

The same class, other doors, all closed the same way:

- Save preset blurs the focused field, asks for the name in the click (the modal
  prompt keeps React from rendering, so a pending edit lands only afterwards) and
  takes the snapshot in an effect keyed on a transition-lane request, like Run.
  `blurFocusedField` is shared by both.
- Run, Stop and the blocked state are one unkeyed `<button>` (`RunActionButton`),
  so keyboard focus survives Enter on Run; the second click of a double-click is
  caught by the 500 ms Stop-click grace, not by remounting. Distinct `key`s
  looked harmless and dropped focus to `body` on every transition.
- `BuyInInput` decides each keystroke against the ticket it last committed (a
  ref), not against its props: the props lag while the previous keystroke's
  transition is pending, so typing "1" then "10" over a stored 10 dropped the 10.
  While focused, only its own commits move that ref; the canonical text of the
  committed ticket (spaces and `$` aside) is never re-read, in either phase.
- The bounty-share and top-heavy sliders remember which biases they sent
  (`biasDraft.ts`). A stored bias that matches one of them is that commit
  landing; any other value is an outside change (scenario reload, BR "Apply
  reported ROI") and replaces the draft. A row-id key alone only resets on a row
  switch.
- A cleared number box or a lone "-" (a number input reports "") is not a
  number: `commitDraftValue` / `parseNumericDraft` return null and the box
  reverts. `Number("")` is 0 and used to commit the clamp minimum on the
  convergence card and a 0% reference line. `NumInput` in `ControlsPanel`
  cancels a blank draft the same way; a new number box takes its commit from
  `commitDraftValue`, never from `Number(draft)`.
- Row operations in `ScheduleEditor` (edit, add, duplicate, remove, import) are
  functional updaters from `scheduleOps.ts`, never arrays built from the rendered
  `schedule`: a blur commit still waiting in a transition has not reached it, so an
  array overwrote that edit. `ScheduleEditor.rowOps.test.tsx` renders the editor
  on a stale base and fires its real handlers.

What Run sends is `buildSimulationInput(applyItmTarget(schedule, cfg), controls, advanced)`
(`src/lib/ui/simulationInput.ts`; the page's `buildInput` is a one-line wrapper). Tests that
need "the input a run would use" call it, as `scenarios.test.ts` and `simulationInput.test.ts`
do; a hand-rebuilt copy skipped the ITM stamp and the basic-mode sanitizer and so
tested a run nobody makes. The click-to-worker wiring itself is browser-only.

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

`mixSeed` (`src/lib/sim/rng.ts`) was changed in commit `3eb91fb` (2026-09-02, first
released in v0.7.7; `CHANGELOG.md` carries the note) so the seed is
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

## Chart Transforms And Per-Day Readouts

- `stripJackpots` (the "hide jackpots" chart filter) must not rebuild the lower
  extremes from the ~1000 stored hi-res paths: that drew the aggregated worst
  line 14-30% shallower than the engine's all-sample minimum and froze it as the
  sample count grew. A jackpot only adds money, so the engine's `min` and the
  real worst run stay; the lower percentiles stay while the filter hides at most
  `JACKPOT_AUTO_HIDE_MAX_SHARE` of the runs, past which the removed runs shift
  every quantile and the paths-based rebuild is used. The upper side (max, upper
  percentiles, mean, best run) is always rebuilt from kept paths.
- `stripJackpots` mixes two sample sets: the engine's lower tail (every sample)
  and an upper side rebuilt from the kept stored paths. At an early checkpoint
  the rebuilt p85 could land under the engine's p15 (by $3-4 on a $50 Mystery
  row, 3000 tournaments), so the rebuilt bands are raised to the band below
  them; the engine's lower tail never moves. The engine's own `min` and `p0015`
  differ by about 1e-14, so an ordering check needs a tolerance.
- `recoveryMedian` / `recoveryP90` are NaN when no sample recovered (as in the
  cash engine), never 0: a 0 reads as an instant recovery. Every reader must
  tolerate NaN; the stat cards print a dash.
- A run that comes back to its old peak without passing it is recovered (`profit === runningMax`
  in the hot loop, `>=` in the cash engine). The strict `>` counted it as "Never recovered":
  on the test's heads-up winner-takes-all schedule (zero rake, 8 entries, 600 runs) 73.5 %
  of runs read as never recovered against 58.3 % by the definition. `engine.test.ts` ("recovery on a lattice")
  recomputes the share from the stored paths. Runs with no drawdown at all store -2 and are
  in neither group.
- `scheduleRepeats` is a sample-length multiplier, not a number of days (the
  tournament-target field forces it to 1). The BR promo card's per-day figures
  use the leaderboard anchor's own `tournamentsPerDay`; observed totals and a
  bare manual $/tournament have no day length, so those figures are `null` and
  hidden.

## Result Chart Plumbing

Small things that looked like glitches in the browser. Do not undo these without re-checking:

- `UplotChart` syncs its callback refs in layout effects declared before the plot's:
  uPlot fires its `setScale` hook inside the constructor, so a passive-effect sync
  sent that call to the previous render's handler (a "Reset zoom" button over an
  unzoomed chart after the distance changed).
- A uPlot is rebuilt when its `options` change identity, which drops zoom and hover.
  `DistributionChart` keys its memos on the overlay's edges, counts and label (callers
  pass a fresh overlay object every render); the cash histogram / odds / convergence
  charts memoize their options. The trajectory plot is built on the untrimmed range of
  every drawn run (`builtYRange`), and the range of the runs actually shown
  (`effectiveYRange`, which follows the slider and the trims) is pushed onto the live
  plot as `yRange` with `setScale("y")`; building on it rebuilt the chart on every
  slider tick. A unit flip reaches the axis through a ref, so `TrajectoryPlot` asks
  uPlot to recompute the tick labels (`redraw(false, true)`).
- Envelope percentiles and the mean are sorted on the K <= 240 checkpoint grid and
  interpolated onto the hi-res grid; min and max are exact there, so `buildResult`
  clamps every curve into `[hiResMin, hiResMax]` (`clampEnvelopesToExtrema`). Before,
  p0.15 dipped under the worst run at 9 of 301 plotted points (by up to $57, about one
  buy-in) of a 500-sample, 300-tournament, $50 freezeout run, seed 7. Curves already
  inside the range are bit-for-bit unchanged.
- Hover titles come from the dictionary (`trajectoryLabels.ts`): a path line carries its
  `runNumber`, the zero line a `titleKey`, an overlay extreme its `overlayLabel`; the
  `label` field stays an identifier. The 0.15% tail prints as 0.15 from both sides.
- Under the "Like PrimeDope" preset the first pass is binary-ITM and the comparison is
  our own model: `pdOverlayLabelKeys` is the one place that says what the overlay, the
  PD badges and the first-pass legend are called. The overlay series is still drawn on
  the first pane while its checkbox shows disabled and unchecked (not changed).
- A formatter takes the sign and the unit from the rounded value: no `−$0`, `−0.0 ABI`
  or `$1000k`. `money` and `intFmt` take the UI number locale (`en-US` by default,
  never the browser's); `UnitScope` and `ResultsView` build their pair with
  `makeUsdMoney`.
- The satellite seats histogram bins on whole numbers (`integerHistogram`): bars are
  centred on a seat count and the hover prints the counts a bar holds.
- No DOM in vitest: `src/lib/testing/hookHarness.ts` renders a component as a function
  with call-order hook cells (layout effects before passive ones). Mock `react` with
  `reactHookMocks`, call the component, read the returned element tree.

## Preview, Planning And Empty-State Readouts

Small numbers that read as exact. Do not undo these without re-measuring:

- The empirical finish model integrates each pasted bucket over its own cell for
  every N. The old N >= M branch point-sampled a linear interpolation, which gave
  the end buckets half a cell (first-place share 0.397 against 0.526 on a spike
  histogram) and jumped at N = M. Test: `finishModel.test.ts`, "empirical finish
  model resampling".
- The Shape panel's `shellFeasible` on a bounty row uses `validateSchedule`'s rule
  (a cash side that overshoots its own target is fine while it stays under the
  total target; the engine shrinks the KO budget). The two used to disagree and
  the panel said the ROI was unreachable on a row Run accepted.
- The zero-skill ("equilibrium") column rescales the row's bounty place shape to
  the bounty pool's per-seat share, so every row sums to -rake (+ overlay / N).
  Reading the skill-calibrated bounty weights there put it 12 % of the cost off.
- A tier's printed range ("4th-9th", "10th-27th") is the dictionary label only when
  the row pays that many places; `tierLabel` prints the real places otherwise.
- `ciToZ` is exact (Newton on erf, seeded by Winitzki): 1.959964 at 95 %, not 1.959.
- Prove-edge schedule mode holds σ at the schedule's own ROI for every candidate row
  (single-format tabs recompute σ per ROI); the card says so. On a one-row freeze
  schedule (field 1000, +10 %) the +30 % row uses σ 8.26 where the runtime σ at +30 %
  is 9.69, so that row is about 27 % short of the volume.
  Re-evaluating σ per candidate is a modelling choice (what does a mixed schedule's
  "+30 %" mean per row?) and a cost, not a one-line fix.
- A candidate row outside the validated zone while the anchor is inside prints a bare
  point under a table that otherwise shows ranges; the row carries a mark and a
  footnote (`rowIsPointOnly`). The synthetic tabs' starting ROI is cost-weighted
  (`scheduleEffectiveRoi`), as the prove-edge anchor is.
- Histograms keep `binEdges.length === counts.length + 1` even when empty (no
  streak, no recovery). A zero-length streak is not counted, in tournament and cash
  mode alike; the cash streaks card shows a sentence instead of an empty hands axis,
  and the median / p90 recovery readouts say they are over the recovered runs only.

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

## Light-Theme Status Colours

A Tailwind palette class has one value for both themes, so `text-amber-200` on a
pale card measured 1.0-2.3:1 in the light theme (the done summary, out-of-box
and noise warnings, tail-fragility pill, convergence tabs and boxes, blocked-run
banners). The theme toggle is public, so this was a user-facing defect, not a
dark-mode-only nicety. Do not undo these without re-measuring:

- Status text takes its colour from `--c-*` tokens that exist in both blocks of
  `globals.css` (`ok`, `warn`, `bad`, `err`, `info`, the `*-label` accents, the
  `tab-*` format tabs, `pd-*`). The dark value is the exact palette shade the
  component used before (a test pins it); the light value is a 700-950 shade.
  Use them as `text-[color:var(--c-warn-fg-soft)]`, with an opacity modifier
  only where the light shade keeps 4.5:1 under it.
- `src/lib/ui/themeContrast.ts` lists every (token, surface) pair the components
  use and `themeContrast.test.ts` holds each at 4.5:1 in both themes, also on the
  bare page colour. It also fails on any `text-<palette>-N` class, `text-[#hex]`
  or a `bg/from/to-rose-9xx` panel fill in a `.tsx`. A new status colour needs a
  token in both blocks and a row in `STATUS_SITES`.
- Text on the solid accent fill (gold in dark, purple in light) comes from
  `--c-on-accent`; the Run button label from `--c-run-fg` / `--c-run-fg-hover`.
  The main Run button read 2.5:1 (top of its gradient) and 1.2:1 (bottom) in the
  light theme because it kept a dark label on the purple gradient.
  `runButtonSites(css)` parses the `.primary-run-button` rules (both gradient
  stops, the label token) and measures the label and the ETA pill at rest and on
  hover; a literal label colour there throws. The ETA pill keeps `bg-black/15`
  in both themes (a darkening wash), only its text moved to the token.
- The PrimeDope overlay legend and tooltip text on the histogram cards use
  `OVERLAY_SERIES[...].textColor` (`--c-pd-theirs-fg`, `--c-overlay-*-fg`); the
  series hex stays on the swatch and the canvas line.
- Not touched, on purpose: slider `accent-*` and `focus:border-*` colours,
  canvas series colours, the Stop button (white on a rose gradient, 3.8-4.5:1 in
  both themes). One dark value is still under 4.5:1: the PD matching-delta pill
  (4.2:1, text at 75% alpha); it is the only entry with a lowered `minRatio`.

## Battle Royale Leaderboard Readouts

Small numbers that read as exact. Do not undo these without re-measuring:

- Only `battleRoyaleLeaderboardPromo` is built from the page. The simulated
  leaderboard (`SimulationInput.battleRoyaleLeaderboard`, `battleRoyaleLeaderboard.ts`)
  is reachable from the engine API and tests, not from the UI.
- The rank draw for a settled window is an exact binomial (`sampleBinomial`, an
  inverse-CDF walk outward from the mode on one `rng()`), so the sampled payouts
  and the exact `expectedLeaderboardPayoutFromBeatProb` describe one process. The
  old Poisson (variance n p, not n p q) and rounded-normal shortcuts did not:
  at 100 participants and beat probability 0.15 the mean sampled payout of a
  $10 prize sat $0.17 off the exact expectation (about 1.8%, 14 standard errors
  over 60 000 windows). Fields of 48 or fewer opponents still draw n Bernoulli
  coins. The expected payout falls back to a log-space sum only where `q^nOpp`
  is no longer a normal double (about 1000 opponents at beat probability 0.5,
  5000 at 0.13), where it used to read exactly 0; elsewhere it is the old
  recurrence, bit for bit.
- A payout tier that starts beyond the field is dropped, not clamped onto last place.
- `isBattleRoyaleRow` in `battleRoyaleLeaderboardUi.ts` reads a row the way
  `compileSchedule` normalizes it: an explicit `gameType` wins over a drifted
  `payoutStructure`. A test walks every pairing against `normalizeGameTypeConsistency`.
- The Manual panel's "of current buy-ins" divides by the full ticket
  (`buyIn x (1 + rake)`, `battleRoyaleLeaderboardPreview.ticketCost`), as the
  result card does; the manual stake is still read from the net buy-in, as the
  engine's stake inference does.
- `manualPayoutPerTournament` no longer exists: the panel had no field for it and
  it applied a promo the panel showed as $0.00. A stake with no built-in days
  (`$3`, `$10`) gets no Manual promo; use Lookup.
- Imported leaderboard days store rank, points and prize only (no nicknames, no
  label; the "Day N" label is built when shown). Share links also drop the
  sender's `observedResultHubUsernames`. Observed prize and point totals,
  bankroll and row labels do travel in a link.
- `parseGgBrStakeResponse` returns null for a payload that left the documented
  shape (the route then answers 502 `resulthub-bad-json`, the client shows the
  "report this" copy); `[]` is what ResultHub sends for an unknown nick and stays
  "no data". It is strict about number types: a stake row whose totals are null
  or strings now reads as drift, not as zero.

## Editor Inputs, CSV Import And Control Names

Small things that read as exact or silently change what was typed. Do not undo
these without re-checking:

- The row ROI box prints and holds the stored ROI to four decimals of a percent
  (`decimals` on `NumInput`, not the step grid, which only drives the arrow
  keys). A whole-percent box showed 2.5 % as "3", turned a typed 7.5 into 8, and
  took a typed 3 for "no change" against the engine's 2.5.
- CSV import splits a line on tabs, else on `;` when it has two or more, else on
  commas. Only the ROI cell may carry a decimal comma, and only on the first two
  routes. On a comma line, `12,5` with no space between ROI and count, in a line
  that spaces its other commas, is refused as a probable decimal comma, and more
  than six cells is refused (the sixth was ignored before). A fully compact
  `Name,500,50+5,12,5` is still read as ROI 12, count 5: nothing separates the
  two readings. ROI outside -99..10000 is refused, since the editor box and a
  saved link hold only that range.
- Every row control carries an `aria-label`: the visible captions are `2xl:hidden`
  (display none, and screen readers differ on naming from a hidden label), and a
  caption that wraps its help button either names the control "Samples Help" or,
  with no `for`, names the button instead. `Field` keeps the help button beside its
  label, and a read-only value gets no label.
- A flex row cannot shrink a range input below its 129 px intrinsic width unless it
  has `min-width: 0` (`globals.css`). This was fixed from the arithmetic of the 320 px
  rows; the EV-breakdown grid (its columns add up to about 300 px at the base
  breakpoint) and the section titles at 320 px were not measured in a browser.
- A cleared number box is not a number on any card: `commitDraftValue` and its
  wrappers in `convergenceInputs.ts` cover CI, ROI, rake and the mix shares.

## Counts, Placeholders And Accessible Names

Copy that reads as precise but is not, and controls a screen reader cannot
describe. Do not undo these without re-checking:

- A count printed next to a noun takes the noun from a `{_word}` placeholder
  (`withPlural`, `WORDS` in `i18n/plural.ts`), never a fixed form: "1 ранов",
  "21 турниров" and "1 runs" shipped from `{n} ранов` / `{n} runs`. The Russian
  forms are nominative, so a template either puts the number where the nominative
  fits ("{n} {_run}", "длилась {n} {_tournament}") or words the sentence so no case
  is needed ("горизонт: {n} {_tournament}", "Сохранённых траекторий, не более: {n}").
  `plural.test.ts` lists the templates that must carry the placeholder. Counts that
  are ranges ("500–800" in the prove-edge anchor) or fixed Ocean distances were left
  alone.
- A dict string never carries a placeholder no code fills in ("every N runs",
  `%s`); `dict.test.ts` scans for printf leftovers and pins the two that shipped.
- Uniform and Empirical (and every realdata model) do not apply the row ROI. On the
  run path the row's ITM is pinned (`applyItmTarget`), so Uniform puts the same mass
  on every paid place and lands at -rake/(1+rake) at the table's own ITM, and far
  from it at any other ITM (+51 % at 25 % ITM on a 10 % rake row). The help text and
  `emp.none` say so; "PrimeDope-style" belongs to the compare path
  (`buildBinaryItmAssets`, a binary-ITM pmf with no α search), not to this model.
- The CSV import builds its messages from dict keys (`ImportMessage`,
  `importMessageFor(t)`). `parseImportCSV(raw)` with no formatter still returns the
  English text the tests read; the editor passes the live `t` and drops the shown
  errors on a language switch, so they never sit in the other language. User text
  (`$$abc`) goes through `fmt`.
- A segmented toggle (language, $/ABI, cash BB/$, format tabs) carries
  `aria-pressed`; colour alone does not say which choice is on. The scenario picker
  is a disclosure of buttons (`aria-expanded`, `aria-current` on the loaded one), not a
  listbox: its options sat in `ul > li`, which a listbox does not own. Closing it from
  the keyboard puts focus back on the trigger (`closeMenu`).
- A live region is always in the page and only its text comes and goes
  (`RecomputingStatus`, the `role="status"` in `RunProgress`): one that is mounted
  with its text is not reliably announced, and one that is only faded to opacity 0 is
  read aloud while nothing happens. The ETA ticks every 250 ms and stays out of the
  live region; it announces the stage and "Done".
- Run started from a field (Cmd/Ctrl+Enter) blurs it to commit the draft, and the
  disabled fieldset would leave focus on `<body>` for good. `blurFocusedField` returns
  the field and `restoreFocusedField` gives it back when the run ends, unless the user
  has put focus elsewhere. `scrollIntoView` goes through `preferredScrollBehavior`.
- The reset buttons on the convergence card quote where they land: the AFS grid is
  50..50,000 and the ROI bounds belong to the format on screen, so a schedule outside
  them resets to the nearest end and the title says so
  (`convergenceResetTargets`). The band policy still sees only the clamped values.
- Dark `--c-fg-dim` is #7d8c98: 5.5:1 on the page, 5.2:1 on a card, 4.95:1 on
  bg-elev and 4.6:1 on bg-elev-2/70, where the old #6b7c8a gave 4.41 / 4.16 / 3.97 /
  3.67. `themeContrast.test.ts` measures it in both themes (`DIM_TEXT_SITES`); the
  light `--c-fg-dim` (#6e687d) was never below 4.6:1 on those surfaces, so an audit
  note that it fails there was wrong. A solid bg-elev-2 fill (hover state of an
  editor input) is 4.3:1 in the dark theme and is not in the measured set.

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
