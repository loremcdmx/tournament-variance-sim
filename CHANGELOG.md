# Changelog

Only user-facing changes are listed here. Small refactors, bench refreshes,
internal scripts, and other low-signal maintenance are intentionally omitted.

## Unreleased

- **Every number changes for an existing seed: the random generator was
  replaced.** The old one (`mulberry32`) does not produce small values at the
  right rate, and the simulator maps small values to the top finishing places,
  so every tournament run drew first place about 0.3% too often: the average
  result sat 0.10 to 0.23 points of ROI above the ROI you typed (at +10%, on
  fields of 180 to 50,000), at every seed and for any number of simulations.
  The cash simulator's hands had a variance of 1.00022 instead of 1 for the
  same reason, and about 2% of full-size cash runs contained one impossible
  +37-sigma hand. All streams were also stretches of one short cycle, so very
  large runs replayed parts of each other. The new generator (xoshiro128**)
  has none of these. A saved link or seed still reproduces the same
  distribution, minus that bias, but not the same individual runs.
- Runs are faster. The pause after the progress bar reaches the end is 3 to 5
  times shorter at any size, and a run of up to about a thousand tournaments
  per sample takes 1.6 to 4 times less CPU overall (the percentile bands and
  the "playing for nothing" statistics are computed a cheaper way with
  identical results). Very long schedules (5,000 tournaments per sample and
  up) simulate at about the old speed.
- Three histograms at the bottom of the results (breakeven stretches, cashless
  streaks, recovery) no longer draw over each other when the window is
  narrower than the one the charts were first drawn in.
- Visual refresh without a redesign: cards have rounded corners and a soft
  shadow instead of a hard top rule, dropdowns have a themed arrow in place
  of the browser's, text fields in the light theme are white rather than grey,
  and every field, button and checkbox shows the same focus ring.

The entries below come from an audit of the maths and logic on 19 November
2026 (84 confirmed defects). Where a fix changes what a run samples or prints
for the same inputs, the entry says for which rows.

### Numbers that move for some rows

- Empirical finish model: a pasted finish history now plays over the whole
  field with its own ITM, instead of being squeezed into the paid places at
  the row's ITM.
- PrimeDope comparison with 'PD finish model' off: a row whose ITM cannot pay
  its ROI on PrimeDope's table and pool (9-max and 6-max SNGs, heads-up,
  winner-takes-all, 30-player MTTs, a stripped Battle Royale or small PKO)
  now plays that ROI with the ITM left free, so the pane simulates the ROI it
  prints. Before, a 9-max SNG at +5 % earned +145 % there, and a heads-up
  65/35 SNG won every match. Rows that already reached their ROI are
  unchanged. A row that no ITM can bring to its ROI gets its own notice and
  keeps whichever of the two solutions lands closer.
- Rows with a fixed ITM (the global ITM target or a per-row ITM) no longer
  change their variance in one step when the ROI crosses -rake/(1+rake)
  (-9.09 % at 10 % rake). The no-skill first-place share now fades in over
  the last tenth of the no-skill cash winnings below break-even, so σ and
  the planning-card volumes move smoothly with ROI: PKO 200 at a 25 % ITM
  target needs x1.04 the volume between -9.5 % and -9.0 %, where it needed
  x2.49. Numbers move only for pinned-ITM rows just below break-even (about
  -18 % to -9 % ROI at 10 % rake) and for bounty rows whose cash share falls
  there, where σ is now higher than before. Rows at or above break-even are
  unchanged unless the ITM top-heaviness slider is off centre, and no row
  changes between blocked and runnable.
- With the ITM top-heaviness slider off centre, a fixed-ITM row no longer
  steps in variance above break-even either (up to 14 % between two
  neighbouring ROIs on small Mystery fields, where first place reaches its
  no-skill share).
- A top-3 or final-table share typed below 1/N is now kept as typed; the
  no-skill first-place share used to override it.
- The ITM top-heaviness slider now affects only the power-law models (and
  Battle Royale rows); for other finish models it is disabled with a short
  reason, and the engine ignores it.
- Bounty rows can no longer pay more knockout EV than the table's bounty pool
  holds for one entry (field x buy-in x bounty share x the chance of not
  finishing last), on any game type, field size or finish model, and in the
  PrimeDope comparison too. A KO share past that limit stops at it and the
  cash side is asked for the rest; a row whose cash side cannot pay the rest
  is blocked with the reachable EV shown. This includes rows on the uniform,
  empirical and real-data finish models, which used to reach any ROI through
  knockouts the pool could not pay (mostly on two- to six-player tables). A
  heads-up bounty row with a blank ITM keeps the zero-skill ITM only where
  that needs no more KO EV than the pool holds.
- 'Fit closest inputs' no longer writes an ROI that is still blocked; when
  nothing fits it leaves the row as it is and says so.
- Winner-takes-all, ticket satellites, small-field tables that pay one place,
  and heads-up bounty rows now default to the ITM your ROI implies, so a
  winning ROI runs instead of being blocked (finish models that ignore the ROI
  keep the table's own ITM).
- Heads-up Mystery: the bounty now goes to the winner only; before, both
  players got a share, which halved the variance.
- GG Freezeout (2026) and PokerStars SCOOP (2026) payout tables no longer pay
  one place too few at round field sizes (for example 200, 400, 800 and 3000
  runners on GG Freezeout; 3000, 5000 and 10 000 on PokerStars), so the
  default ITM matches the documented 14.5 % / 14.3 %.
- Payout tables on mid-size fields (roughly 80-560 runners, depending on the
  structure) no longer jump at one field size: σ used to change by 5-9 %
  between neighbouring field sizes, and Mystery flipped between two shapes at
  553-562 runners. In that range 1st place now pays somewhat less (Mystery at
  500 runners 15.9 % -> 13.2 %), so σ and required volume there are lower than
  before.
- The 'Uncertainty about your true ROI' field now stops at 0.5 (±50 pp);
  larger values from older saves or links load as 0.5.
- In the advanced 'Solo player, real life' and 'Steady regular' models, the
  session shock and the slow ROI drift are now redrawn every 50 tournaments of
  the run. Before, a session was one pass of the schedule, so after any
  distance edit the whole run was one session and the ROI spread was
  overstated (about 5.9 pp instead of 3 pp for the solo model over 10 000
  tournaments). A warning appears only when the whole run fits into one
  session.
- The tilt depths in both advanced models are now measured in average buy-ins,
  so a model means the same player at every stake (before, 'Solo player, real
  life' took up to 15 pp of ROI off from about $20 buy-ins), and both tilts
  look back over a fixed stretch of recent tournaments instead of the whole
  run, so how often they fire no longer grows with the distance. Before, a
  long run ended up tilted most of the time ('Steady regular' about 40 % of a
  50,000-tournament run on 1,000-player fields; the solo tilt held a
  break-even or losing player at its full drag).
- 'Solo player, real life': the fast tilt measures your drawdown from your
  best point of the last 250 tournaments and takes up to 2 pp off your ROI,
  half of that at about 70 buy-ins down. On a 1,000-player schedule at +10 %
  ROI the runs average about 0.9 pp of ROI below the expected profit over
  1,000, 10,000 or 50,000 tournaments, at any stake (about 0.8 pp at 500
  players and 1.2 pp at 3,000).
- 'Steady regular': the slow tilt counts its swings against your
  expected-profit line over the last 1,000 tournaments, so a winning player
  no longer sits in the upswing state for most of a run and a losing player
  not in the downswing state. It fires after 500 tournaments straight more
  than 600 buy-ins below your best point of that stretch, or above your
  lowest point, and usually ends when that point drops out of the last 1,000
  tournaments, typically after 400 to 500 tournaments. At +10 % ROI a
  1,000-player regular is tilted about 1 % of a run and a 3,000-player
  regular 6-7 %, the same over 10,000 or 100,000 tournaments; it fires more
  in bigger fields and at higher ROI. The Expected profit card says 'before
  tilt' while a tilt is on.
- Saved setups, share links and user presets from before these changes keep
  their model: a 'Solo player, real life' or 'Steady regular' profile saved
  with the old dollar or all-time tilt values loads with the new settings.
- PKO rows now play every knockout on the model's own elimination tree
  instead of drawing a Poisson knockout count with a flat head-size noise. A
  tournament winner always collects at least their own final head; before, a
  heads-up winner got no bounty in 37 % of wins and a 6-max winner in 10 %.
- PKO standard deviation per tournament now equals the exact elimination tree
  at every field size, bounty share and ROI, place by place: the runner-up in
  fields of 4 to 44 players and 3rd place in fields of 5 to 10, which kept up
  to 3.8 % too much bounty spread, now have their knockout hauls pulled toward
  their average, while the chance of finishing there without a knockout stays
  as it is. Before, it was
  overstated by about 39 % heads-up, 13 % at 6-max, 10 % at 9-max, 5 % at 18
  players and 4 % at 50 players, and by more at a high ROI or a high bounty
  share. Required volume, bankroll and risk figures for single-table and
  small-field PKO come out accordingly lower; expected results do not change.
  The PKO planning card's σ drops by about 3-4.5 % at field 50, 1.5-3 % at
  100, 0.3-0.9 % at 1 000, and is unchanged from 10 000 up.
- The Ocean KO downside report's PKO column moves slightly: below-EV median
  347 -> 346 at the default seed, Ocean / PKO drawdown ratio 1.14 / 1.20 /
  1.37 at 1 000 / 5 000 / 20 000 entries.
- "Avg flatline" now measures the first return at every tournament. Above 240
  tournaments it used to be read on the chart's checkpoint grid, which made it
  1.4x too long at 1 000 tournaments and 4.6x at 20 000.
- The cashless-streak, break-even and recovery charts now give every bar the
  same number of whole streak lengths and start at the shortest streak. The
  first bar is no longer short (or empty), so the false rise at the left of
  the chart is gone, and the recovery chart no longer shows gaps on short
  runs. Hovering a bar shows which lengths it holds.
- The minimum bankroll for a given risk of ruin is no longer quoted one cent
  too low when the worst runs tie on a loss like $18.40.
- Runs where every sample ends on the same result now show zero spread, skew,
  kurtosis and Sharpe, and 0 tournaments to reach ±5% ROI, instead of values
  computed from rounding error.
- The mixed GG demo with Battle Royale now plays its Battle Royale row at the
  editor's 18% ITM instead of the global 15%, which had pushed four of every
  five cashes onto first place.
- The GG Mystery payout description now says its 9–12.5% first-place range
  holds from about 550 entries, and that smaller fields pay first place more
  (29% at 50).
- A simulation run outside the app on a row whose fixed ITM cannot reach its
  ROI now carries a calibration warning, and its expected profit is the
  modelled one instead of cost x ROI. The results screen explains such a
  warning without blaming PrimeDope.

- A row with a field-size range now raises one calibration notice instead of
  one per field size. It names the field size that misses the ROI the most,
  with that size's requested and modelled payout (the size Run's check
  reports); the PrimeDope comparison listed such a row three to five times.
  Nothing simulated changes.
- Run's feasibility check now aims at the same Battle Royale cash/KO split as
  the simulation. A Battle Royale row with a first-place, top-3 or final-table
  lock (or, in scripts, late registration) whose cash prizes alone would pay
  more than its ROI is now blocked, instead of running above the ROI it
  printed. Rows on the standard 18-max table without locks are unaffected.
- A row with a field-size range and no pinned ITM (scripts and the engine
  API; the app pins every row's ITM) is now blocked when one of its field
  sizes cannot reach the ROI, as pinned-ITM rows already were.

### Results screen

- The risk-of-ruin card shows its "within N tournaments" caption again once a
  bankroll is set.
- The Battle Royale leaderboard promo card prints per-tournament and per-day
  amounts with enough digits ($0.0375, 0.0156 ABI) instead of rounding them to
  $0 / 0.0 ABI, and its Formula now multiplies out to the projected total; the
  PrimeDope clamp notice shows cents too.
- The PrimeDope comparison without bounties now says it differs in two ways,
  PrimeDope's model and the stripped bounties, including under the "Like
  PrimeDope" preset with a bounty schedule.
- The hide-jackpots filter now reads the jackpot share from the pane that
  keeps its bounties, so it no longer starts on with a 0% share under the
  "Like PrimeDope" preset.
- The PrimeDope cheat sheet quotes the field and the paid places the PrimeDope
  pass actually simulated (late registration and PD payouts included), with
  the count as well as the share.
- PrimeDope finish-model and rake-math hints now quote the numbers the engine
  computes (≈22% vs 15% ITM, 1.7/1.2/1.0/0.9× base, $100 × 1000 vs $91 × 1000
  pools).
- The leaderboard promo notes now say the promo is drawn into trajectories,
  the profit distribution, the mean and the chance to be up while "with LB
  cashflow" is ticked, and left out of drawdowns, streaks and risk of ruin.
- ITM pills and the PrimeDope diagnostics dump now name the right pass when
  PrimeDope's pane has its bounties stripped.
- The never-recovered tooltip now describes what the card counts: samples that
  never got back above the peak of their deepest drawdown.
- The Done summary under Run now counts "Up chance" with the Battle Royale
  leaderboard promo included, like its own average profit and ROI and the
  results card; on the BR leaderboard demo it read about 61% against the
  card's 68.7%.
- Demo rows no longer carry a hidden prize-pool guarantee, and editing a row's
  players, buy-in, field range, game type or payout table drops a guarantee
  left over from an older save, so a smaller field no longer turns into an
  invisible overlay that understated the spread or blocked Run. The PrimeDope
  comparison pane of the five affected demos and the main pass of three of
  them (romeo-pro, GG mix with BR, Sunday majors) move slightly.
- The 20% ITM target the app switches on for a pure Battle Royale schedule is
  switched off again when the schedule stops being pure BR, unless you changed
  it; later freezeout, PKO and Mystery rows used to inherit it and run with a
  10-19% lower spread.
- The bankroll box in ABI multiples no longer garbles digits typed one by one
  on schedules with an average ticket under $1 (typing 100 at a $0.25 ABI
  stored $0), and stores the multiple to the cent.
- With a tilt channel on, the Expected profit card, the trajectory EV line and
  the PrimeDope comparison call cost × ROI the expected profit before tilt.
  The trajectory legend and the PrimeDope diff also show the simulated mean
  the runs actually averaged.
- The PrimeDope report now says its 70 / 95 / 99.7% intervals are a normal
  approximation (mean ± 1.04 / 1.96 / 3 SD), as PrimeDope prints them.
- Stat cards and cash figures use the right plural form for tournament and
  hand counts ("1 tournament", "2 турнира", "24 турнира").
- The "copy PD logs" button is translated.
- The hover range on the streak histograms no longer shows the shared edge in
  both neighbouring bars when the schedule length is a multiple of 240.

### Schedule editor and row preview

- Battle Royale "incl. RB" ROI buttons now land on the reported ROI printed on
  them at any rakeback (at the default 20% the "3" button gave 2.6%), and
  their tooltip shows the real field ROI.
- Schedule import refuses a thousands comma in the players column ("Sunday,
  2,500, 55, 10") with a message, instead of importing a 2-player $500
  tournament.
- The bounty-share box keeps what you type to one decimal (33% stays 33%, not
  35%), and Ocean KO / Battle Royale shares show as 54.3% / 45.7%.
- The advanced row options keep what you type: Mystery σ² holds two decimals
  (2.25 stays 2.25, not 2.3; 0.04 no longer becomes 0) and sit-through
  pay-jump aggression whole percent (33 stays 33, not 35). The arrow keys
  still step by 0.1 and 5.
- In the row preview, the KO-share and top-heaviness boxes keep what you type
  instead of jumping to the slider's grid. A typed KO share now lands exactly
  on small fields, field ranges and ITM-pinned rows, where it could miss by
  several points, and the KO-share readout shows the share the row will
  really get while you drag. Moving either slider back to its stored value
  while the previous change is still being applied now takes effect.
- A reference line's ROI box on the results chart keeps hundredths of a
  percent: a typed 7.5 is drawn, shown and labelled as 7.5 %, not shown as 8
  and labelled 'ROI +8%'. Lines saved before relabel themselves on load.
- The row preview of a heads-up Mystery row now shows its bounty EV and the
  ROI you typed, instead of a cash-only EV and about -55%.
- On a Battle Royale row, the last line of the preview table is now called
  'Places 10-18' instead of 'Not ITM': the bubble and 5th-9th are split out
  above it.
- In the Finish shape panel, the FT and top-3 lock rows read 'P(ITM)' on rows
  that pay fewer than 9 (or 3) places, because that is what those locks pin
  there.
- A break-even row no longer shows 'ROI -0.0%' or '-$0' in the loss colour in
  the preview, and a $0 tier cell is no longer coloured as a loss or a gain.
- Locking P(1st), P(top-3) or P(FT) in the Finish shape panel with 'Sit
  through pay jumps' on no longer changes what is simulated: the lock stores
  the value the solver pinned.
- On a Field-size range row the preview's 'First min-cash' line now shows its
  real chance (it used to be about half of it when some field sizes pay 27
  places or fewer).
- The KO-share slider in the preview now says it is a share of winnings (cash
  + KOs); the EV mix above it also counts rakeback and promo.
- The odds in the tier popup keep one decimal below 1 in 10, so 88% reads '1
  in 1.1' instead of '1 in 1'.
- Under the 'Like PrimeDope' preset, the row preview and the payout card say
  that they show the app's own model and the row's own payout table, not the
  PrimeDope pass.
- CSV import: a players cell with thousands commas suggests the full joined
  number. A single comma such as "100,109" offers both readings (100,109
  players, or 100 players at $109).
- The tier popup on a heads-up Mystery row no longer shows a zero KO count
  next to a paid bounty, and it drops the "1 in N" odds for events more likely
  than even.
- The tournament preview's ROI and EV-profit chips always agree on sign. A
  break-even row is shown neutral, without a plus.
- The "Like PrimeDope" notes no longer claim PrimeDope's payout table or flat
  finishes when those PD toggles are off.
- Escape in the bankroll box now restores the bankroll from before the edit,
  instead of keeping the last digit typed.

### Volume planning cards

- The freezeout planning cards show a narrower range and the Battle Royale
  ones a slightly wider one, both re-measured against the simulator's own
  Monte Carlo on the current engine: freezeout σ ±2 % instead of ±3 % (about
  ±4 % instead of ±6 % on the volume), Battle Royale ±7 % instead of ±6 %
  (about ±14 % instead of ±12 %). Mix and Schedule mode ranges move in
  proportion to the freezeout and Battle Royale share of the variance. The
  volumes themselves do not change.
- Volume needed to verify a chosen ROI is now sized for the confidence you
  pick: at 95 %, a player with exactly the tested ROI clears the bar 95 % of
  the time (it was sized for 97.5 %). Every volume on the prove-edge card, on
  every tab and in Schedule mode, ranges included, is smaller: by about 15 %
  at 95 %, 21 % at 90 %, 37 % at 75 % and 75 % at 50 % confidence. The
  reading guide says how far the real chance can sit from this normal-curve
  figure.
- The Ocean KO tab of the Convergence and prove-edge cards now pins the row's
  ITM the way Run does (including the global ITM target), so its σ and volumes
  match Schedule mode for the same tournament.
- In Schedule mode with a finish model that ignores the typed ROI (uniform,
  empirical, real-data shapes, a pinned α), the prove-edge answer now uses the
  ROI the engine actually plays.
- A losing ROI or schedule no longer highlights the +0.1 % row on the
  winning-only prove-edge grid.
- When the chosen ROI is one Run would block at this field size, fee and ITM,
  the planning cards now hide the volume and say so instead of printing a
  number for a different ROI.

### Cash, Ocean comparison and leaderboard lookup

- Cash: a run that never drops below its previous peak no longer counts as
  "recovered in 0 hands". The recovery median, p90 and chart now cover only
  runs that had a drawdown and recovered, and when no run had a drawdown the
  chart says so.
- Ocean comparison: the note on Mystery bounty log-variance no longer says σ
  always more than doubles. That holds at 1,000 players; the effect fades in
  larger fields (about 1.6× at 10,000, 1.1× at 100,000).
- Ocean comparison: the recovery notes now say what the engine counts: getting
  back to the old peak is a recovery, it does not have to be passed.
- Space → Ocean explorer: the σ gap sentence prints two decimals, so it no
  longer contradicts the two σ cards above it (it said 0.2 BI under cards of
  5.9 and 6.2).
- Battle Royale leaderboard lookup: a click with several nicks is now one
  request and is rate-limited as a whole. After "try again in N seconds",
  waiting that long now works, and a refused click no longer uses up the
  limit.
- The Ocean comparison report no longer prints -0.
- The cash Economics card no longer stretches into an empty box when rake is
  off.

### Earlier in this cycle

- A tournament run that returns exactly to its previous peak without passing
  it now counts as recovered, as in the cash simulator. It used to be listed
  under "Never recovered" and left out of the recovery median and 90th
  percentile. Only exact ties are affected (for example heads-up or
  winner-takes-all at zero rake, where a run lands on its old peak to the
  cent); those three readouts move there and nothing else does.

## v0.7.8 — 2026-09-09

- Refreshed sliders within the existing design: filled tracks, larger handles,
  larger touch targets, and visible keyboard focus, including the EV controls.
- Numeric fields now share clearer focus and invalid-value states; schedule
  field labels are associated with their inputs.
- Fixed EV slider changes sometimes remaining an uncommitted preview after a
  quick key press or pointer release. Numeric draft and commit behavior is unchanged.

## v0.7.7 — 2026-09-09 (note added later)

This version has no entry of its own here; the README and
`docs/BUGHUNT_FIXES_2026-09-09.md` list its fixes. One change in it moves every
number and needs saying:

- The seed is now mixed into each simulated career differently (commit
  `3eb91fb`, 2026-09-02, first released in v0.7.7). Before, two seeds that
  differed only in their low bits were the same simulation with the careers
  shuffled (seeds 1, 2, 3 and 7 gave identical mean and standard deviation).
  Every simulation output changed with it: a share link or stored run from
  before v0.7.7 reproduces the same distributions but not the same best and
  worst paths, downswing catalog entries or other per-career numbers.

## v0.7.4 - 2026-04-20

- Fixed Battle Royale fixed-ITM profit routing: when cash-side ROI grows, the
  model now strengthens 1st place before it starts reallocating extra mass
  across the rest of top-3.
- Cleaned up the Battle Royale fixed-ITM path so the engine, validation, and
  single-tournament microscope all use the same winner-first logic.
- ROI editing is responsive again: number fields stop re-solving on every
  keystroke, snap back to valid step values, and no longer leak `.04` style
  tails into whole-percent ROI boxes.

## v0.7.3 — 2026-04-20

- Made the KO-share control easier to audit: the midpoint now resets to the
  neutral cash-vs-KO balance, numeric entry is bounded to the valid EV range,
  and gross EV cards show cash / regular KO / jackpot percentages.
- Battle Royale ROI-with-rakeback presets now split added ROI profit from the
  breakeven finish baseline between cash and KOs before the KO-share slider
  moves it either way.
- Combined the microscope EV and EV-profit readouts into one cleaner expected
  return card.

## v0.7.2 — 2026-04-20

- Removed the unused ICM controls and engine path.
- Reworked the EV-source slider into a KO-share control: it now reports how
  much gross EV comes from knockouts instead of implying a place-vs-KO toggle.
- Fixed fixed-ITM Battle Royale KO-share edges so total ROI stays pinned: low
  KO share shifts EV into deeper finishes, while high KO share increases
  expected KO count without inflating the average Battle Royale envelope.

## v0.7.1 — 2026-04-18

- Advanced mode now includes a separate cash-game variance simulator with mixed
  limits and parallel workers.
- MTT became more responsive: less lag on edits, cleaner chart behavior, and a
  batch of small UI fixes.
- Progress bar and ETA now follow the real run phases much more closely and
  freeze less in the middle.
- Mystery / Battle Royale received a bounty-window fix, a jackpot-hide toggle,
  and refreshed convergence coefficients after the model fix.
- Streak and convergence widgets were cleaned up: exact mode now uses per-row
  rake and the stats block shows an average "any streak" metric.

## v0.7 — 2026-04-17

- The model moved beyond plain freezeouts: Mystery, Battle Royale, and exact
  schedule mode became first-class parts of the app.
- The convergence widget turned into a real planning tool with format tabs,
  wider CI range, and schedule-aware calculations.
- Schedule controls became clearer: explicit game types, better trim/filter
  controls, and fewer compare-mode surprises.
- Rakeback became part of the results view instead of a side note: profit,
  streak, and recovery widgets react to it much more consistently.

## v0.6b — 2026-04-16

- A polish release: line presets, overlay styling, better controls, and smaller
  fixes around EV and global ITM behavior.

## v0.6 — 2026-04-15

- PKO support, a redesigned first screen, EV breakdowns, and a much more
  realistic payout model landed together here.

## v0.5 — 2026-04-15

- PrimeDope comparison became a separate feature: overlay, toggles, and the
  first serious convergence widget all appeared in this cycle.

## v0.4 — 2026-04-14

- The app shifted from "profit only" to "what kind of downswings and
  recoveries can actually happen".

## v0.3 — 2026-04-13

- The first usable simulator build: presets, trajectory styling, unit switcher,
  and import/export.
