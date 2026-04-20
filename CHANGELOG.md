# Changelog

Only user-facing changes are listed here. Small refactors, bench refreshes,
internal scripts, and other low-signal maintenance are intentionally omitted.

## Unreleased

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
