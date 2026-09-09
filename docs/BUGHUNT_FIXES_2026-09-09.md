# Bughunt fixes in v0.7.7

Base: `64f3484dd1eefa73060c87196c4a374f8dfd5e22`. This change covers 54 confirmed groups: 26 P2 and 28 P3. Duplicates, refuted candidates and the unconfirmed E08 model-policy comparison are excluded.

## Coverage

| ID | Priority | Implemented behavior |
|---|---|---|
| E01 | P2 | All-paid schedules resolve ITM=1; fixed-ITM and binary PMFs cannot lose unpaid mass when there are no unpaid places. |
| E02 | P2 | Coincident explicit FT/top3 locks cannot leave probability mass missing. Interactive validation blocks inconsistent nested/coincident locks with `reason: inconsistent-finish-locks`; closest fix clears locks instead of changing ROI. Existing implicit constraints remain unchanged. |
| E03 | P2 | Payout exponent search brackets valid roots beyond old bounds; impossible endpoint cases/floating residuals normalize the payout pool. |
| E04 | P2 | Preview applies exactly the shared sit-through transform before computing finish tiers. All-paid no-op avoids an impossible compensation into unpaid places. |
| E05 | P2 | Historical bankroll quotes a cent strictly above the empirical loss threshold, so tied losses do not violate the advertised ruin probability. USD/ABI recommendation labels round upward and preserve cents. |
| E06 | P3 | Gaussian first-passage reflected tail avoids exponential overflow/cancellation; deterministic finite-horizon losses use the actual horizon loss. |
| E07 | P2 | Exact convergence/prove-edge fit gates inspect minimum and maximum field variants, not only their weighted mean. |
| E09 | P3 | Drawdown-free paths use a distinct sentinel and are not counted unrecovered. |
| E10 | P3 | Saved trajectories are the first 1000 global sample indices independent of shard boundaries. |
| E11 | P3 | Small convergence checkpoints multiply integers before division to avoid duplicate floored checkpoints. |
| E12 | P3 | SNG/Sunday/PD-custom payouts never exceed actual field size. |
| E13 | P3 | PD clamped targets produce typed warnings and compiled expectedProfit uses attained EV rather than impossible ROI input. |
| E14 | P3 | Prove-edge global warning follows the user's current anchor; each out-of-box candidate row keeps its existing point-only behavior. |
| RD01 | P2 | Implemented: each deterministic LB/RB transform shifts finalProfits cumulatively, so P(profit) uses the displayed combined result. |
| RD02 | P2 | Implemented: jackpot filtering now receives already shifted finals, retaining LB in its rebuilt histogram. |
| RD03 | P2 | Implemented: fixed chart domain includes both actual LB-inclusive displayed histograms and their no-RB variants. |
| RD04 | P2 | Implemented honest unavailable state: joint profitable-and-never-busted statistic is null for nonzero posthoc shifts; localized subline explains need for a rerun. |
| RD05 | P2 | Implemented with engine agent: satellite card reads exact paid-finish Uint32Array counters, independent of RB and ROI shocks. |
| RD06 | P3 | Implemented (P3): cash rate is simulated expected tickets divided by tournament count; attempts/ticket is its inverse. |
| RD07 | P2 | Implemented: parser uses complete numeric points cells, preserving embedded digits and fully numeric nicknames. |
| RD08 | P2 | Implemented atomic lookup: any failed nickname prevents successful subset from replacing existing aggregate totals. |
| RD09 | P2 | Implemented: completed response merges into latest controls; a changed nickname set discards the stale request. |
| RD10 | P2 | Implemented with coordinator: ResultsView reads the updated actual primary/comparison result; pdOverrideResult was removed. Pending flags affect only the three checkbox values, while report/logs/settings keep completed values. |
| RD11 | P2 | Implemented: relative differences divide by abs(reference); unavailable near-zero denominator gives an em dash. |
| RD12 | P2 | Implemented: lower-tail 5% row uses p05 rather than negative VaR95. |
| RD13 | P2 | Implemented: PD difference table shows unavailable ruin when bankroll is off instead of zero risk. |
| RD14 | P3 | Implemented: diagnostics read sigmaPerTournamentAnalytic through a keyof-typed helper. |
| RD15 | P3 | Implemented copy correction: breakeven tooltip describes all start-point observations, not one longest interval per run. |
| RD16 | P3 | Implemented: cash visible-run clamp permits zero. |
| RD17 | P3 | Implemented the audited locale gaps: report/diff labels, weakness tags, trajectory tooltip, ITM/captured-path tooltip and incorrect English tooltip bodies. |
| RD18 | P3 | Implemented: proxy reason wins over generic error; HTTP429 preserves retry delay through client/hook to localized control feedback. |
| RD19 | P3 | Implemented: no-data guidance describes available ResultHub history, not this month. |
| RD20 | P3 | Implemented: zero points target returns imported snapshot days with zero payouts rather than claiming no data imported. |
| RD21 | P3 | Implemented: limiter enforces cap on successful path and evicts least recently used entries. |
| RD22 | P3 | Implemented: current and observed ABI are rendered as USD prices, including drift anchors. |
| RD23 | P3 | Implemented: removed false monotone-addition drawdown invariance claim from user copy and source comment. |
| UI-P01 | P2 | Restore the selected built-in preset's canonical hidden shock/tilt profile. Preserve a complete canonical profile after a visible edit changes its id to `custom`. Continue stripping arbitrary hidden legacy knobs. |
| UI-P02 | P2 | Persistence accepts finite row counts up to MAX_SAFE_INTEGER, preserving counts produced by distance redistribution. Target input saturates at the same safe boundary. Redistribution uses exact integer largest remainders even at that boundary. |
| UI-P03 | P2 | Preserve zero global ITM, which runtime interprets as equilibrium. Row display resolves the same effective ITM as the engine, including all-paid rows. |
| UI-P04 | P3 | Share export uses the raw completed schedule so inherited ITM stays inherited. URL imports preserve the shared seed and cannot be overwritten by a repeated Strict Mode mount effect. |
| UI-P05 | P3 | Drop non-string `modelPresetId` before hydration/render. |
| UI-C01 | P3 | Disabled manual alpha for calibrated/fixed families, with visible explanation. Model change clears the previous alpha. |
| UI-C02 | P3 | All three real-data tilt models share -0.5..0.5 range, step 0.05. |
| UI-C03 | P2 | CSV import is atomic: any parse error or merged schedule above 300 rows keeps the current schedule and dialog/text. |
| UI-C04 | P3 | Validate complete buy-in grammar before conversion; commas must be complete thousands groups. |
| UI-C05 | P3 | Editing a row through the preview clears the selected scenario. |
| UI-I01 | P3 | Supplied current distance/count/alpha explanations in both locales. |
| UI-N01 | P3 | Admin availability uses a server-safe external-store snapshot, avoiding a hydration mismatch. |
| O01 | P2 | Cache effective input and raw source with the result. Header, bankroll, charts and export retain the completed settings; editor changes show a rerun notice. |
| O02 | P2 | Each cached seed keeps its own completed PrimeDope flags; selecting a sibling restores those flags. |
| O03 | P2 | Isolated reruns select the PrimeDope calibration pass, including the primary pane under the PrimeDope preset. |
| O04 | P2 | Run requests and the keyboard shortcut are gated on the active MTT mode and idle foreground/PD status. |
| O05 | P3 | Escape restores the cash field value from focus and suppresses the blur commit. |
| O06 | P3 | The cash component remains mounted across tab changes; completed results and active work survive. |

## Verification

- Full Vitest suite, TypeScript, ESLint and production build are release gates. Focused regressions live alongside the engine, UI, results and persistence modules.
- `npm run smoke:bughunt`: real workers, completed-input isolation, first-click input commits, raw share inheritance and seed reproduction, shortcuts during a run, PD cache/preset reruns, atomic CSV, cash Escape/tab retention, desktop and mobile result overflow/console checks.
- `npm run smoke:cash`: default desktop, mixed stakes, disabled hourly lens and mobile cash checks. Set `SMOKE_BASE_URL` to the exact candidate or production URL; optionally set `SMOKE_BROWSER_CHANNEL=chrome`.
- ResultHub failure cases use synthetic responses. No private profile data or provider credentials are included in tests.

## Boundaries

Empirical bankroll recommendations satisfy the selected risk threshold on the simulated sample, not a guarantee on unseen outcomes. Joint profitable-and-never-busted statistics are unavailable after a nonzero posthoc path shift because the full shifted minima are not retained. Other path-risk cards retain their explicitly labeled engine calculation. Numeric convergence bands are suppressed outside the validated field bounds; point estimates remain available.

Repository CI and the Vercel deployment must be checked separately for the final commit. Production status is recorded in the release receipt after publication; this document does not certify a deployment by itself.
