# Ocean KO downside comparison

The second MTT tab compares the mechanical engine's downside paths. The first tab remains the full mechanical calculator. The report runs only on request, uses one cancellable worker and reports the configuration actually executed, including seed, number of careers and number of entries per career.

The primary form contains ticket, field, ROI and horizon, with horizon presets. Sample count, seed and Mystery spread remain in the accuracy disclosure. Results show their own scenario snapshot and warn when the draft changes. On narrow screens, depth and duration tables switch between below-peak and below-EV metrics. Recovery, Battle Royale and model diagnostics remain available in disclosures.

## What is compared

Freezeout, PKO, Mystery and Ocean KO use the same full ticket, field, target ROI, horizon and sample count. The controlled presets use an 8% fee; cash/bounty allocations and native payout shapes remain format-specific and are shown in the report. Equal ROI is a counterfactual comparison, not a claim that one player's skill earns equal ROI in every format. PKO uses head variance 0.4 and no heat; the Mystery log-variance parameter is configurable. No leaderboard, rakeback, re-entry, tilt or changing skill is added.

Mystery Battle Royale is a separate reference with its native 18-player field and $10 ticket. Its cash/bounty/fee split is 50%/42%/8%. It is not included in equal-field rankings against the four larger MTT formats. Space KO is shown separately through the existing published moment anchors; no empirical trajectories are invented from those moments.

## Path metrics

Let `P_t` be cumulative profit after entry `t`, `E_t` its analytic expectation and `H_t=max(0,P_1,...,P_t)` its running high. One BI is the full ticket including the fee.

- Maximum drawdown: `max_t(H_t-P_t)`.
- Maximum EV shortfall: `max_t(max(0,E_t-P_t))`.
- Longest below-EV streak: consecutive entry endpoints with `P_t<E_t`.
- Longest underwater streak: consecutive entry endpoints below the prior profit high.
- Longest losing-entry streak: consecutive entries with negative net profit, including bounty and the full cost.
- Fraction below EV: the number of endpoints with `P_t<E_t`, divided by the career length.
- Final loss: `P_N<0`. Final underperformance: `P_N<E_N`. A zero-profit career is not a loss.

The collector observes every entry of every simulated career. It does not depend on the visible trajectory subset or the checkpoint grid. Maxima and streak lengths are calculated per career before computing their median, P90, P95 or P99. Ties with EV or the previous high end their respective streaks.

Recovery reuses the engine's existing definition: from the trough of the deepest drawdown to the first **strictly higher** profit peak. Its duration summary is conditional on recovery within the selected horizon. The report separately shows the fraction whose deepest drawdown has not recovered by that horizon and the count with no drawdown. This is right censoring, not proof that a career will never recover. It is different from the longest underwater streak, which includes the descent and ends on equality with the old high.

## Uncertainty

Probability estimates include Wilson 95% intervals for Monte Carlo sampling uncertainty, conditional on the model. They do not include model error or uncertainty in a player's ROI. An observed zero count still has a positive upper bound. P99 and the largest observed drawdown are particularly unstable with a small sample; the maximum is not a worst-case guarantee.

The lower trajectory graph uses pointwise P05 profit minus EV at selected endpoints. P05 is not an actual career or a band containing 95% of entire careers. Exact path maxima are reported separately. Independent simulated entries with a fixed player model do not establish serial independence of real tournament results.

The aggregate best/worst comparison uses pointwise minimum and maximum profit across **all** simulated careers. Up to 201 actual engine checkpoints are retained, including both endpoints; no synthetic interpolation is used to create observations. The two panes have separate vertical scales so rare jackpots do not compress the downside. Profit/EV-deviation controls, format toggles and a shared checkpoint selector expose the exact values. These envelopes combine different careers and become more extreme as the sample size grows; neither is an actual path or a guaranteed bound.

Threshold-risk curves count each career's exact maximum against 101 thresholds from 0 to 1000 BI in steps of 10. Each point uses `maximum >= threshold`; lines simply join observed probabilities. The default display ends one real point after **every** shown format reaches 0.5% or less. If that never happens, it retains the full range. A full-tail checkbox restores 1000 BI, and the data table always retains all 101 points and their Wilson intervals. This display cutoff does not remove outcomes, cap payouts or change probabilities.

Analytic standard deviation is supplementary. Ocean's lower/upper variance bounds are model bounds, not a fitted point estimate or confidence interval. Variance ratios describe final-profit variance or mean-estimation precision under independence; they are not ratios of drawdown depth or streak duration.

## Jackpots and empirical evidence

The wheel cutoff table replaces one ordinary Ocean wheel multiplier `M` by `min(M,cap)` without restoring the removed EV. It is not a capped-tournament ROI or drawdown simulation: applying a cutoff throughout the inherited bounty tree changes later head sizes and tier transitions. No full jackpot ROI attribution is claimed.

The public Space anchor caps total bounty per player/event while retaining cash and all paid entries. Its joint moments support exposure-adjusted means, variances and cash/bounty covariance. They contain no ordered tournament sequences, so they cannot validate the mechanical streak lengths. The Ocean moment transfer is a separate structural scenario and does not force the same ROI as the mechanical report. Its existing support limits and precision warnings remain visible. See [the empirical model](OCEAN_EMPIRICAL_MODEL.md).
