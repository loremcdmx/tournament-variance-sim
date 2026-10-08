# Space-based Ocean comparison

The default MTT view is the mechanical simulator for all formats, configurable ROI, trajectories and distributional metrics. The second Ocean KO tab contains a [downside comparison report](OCEAN_DOWNSIDE_REPORT.md), followed by the empirical Space KO anchor and experimental Ocean KO moment transfer documented here. Existing shared scenarios open in the mechanical simulator.

## Scope

The published anchor contains two joint-moment records for Space KO €10, fields 1000–1499, with total player/event bounty capped at 25 or 100 full-ticket buy-ins. All ordinary prizes and paid-entry costs remain. The source cohort includes named Space events and TRIDENT; its ROI is a historical reference, not an estimate of a visitor's skill.

Detailed research evaluations and raw observations are not part of this repository or the public site. Only the runtime parameters needed for the comparison are included.

The training window is 2 February 2025 to 30 June 2026 (17 months). It covers FF players on Winamax.fr; named Space events and TRIDENT (3-max) are both in. An "event" is all entries of one player in one tournament. The window holds 1,087 distinct players across every field from 500 to 1,999; the published 1000–1499 bin is a part of them, and its own player count is not stored. The mean field of that bin is 1,236 per paid entry, while the mechanical bridge uses one calculation at 1,000. `training` in `space-runtime-profile.json` carries these facts and the page prints them.

## Calculation

For each player/tournament cluster, K is the number of paid entries and Y=(C,B) contains ordinary cash and capped bounty. Set beta_i=E[Y_i]/E[K] and

    S_ij = E[(Y_i - beta_i K)(Y_j - beta_j K)] / E[K].

ROI is beta_C+beta_B−1. The variance coefficient is S_CC+S_BB+2S_CB. This retains re-entry and cash/bounty covariance. Distance scaling uses the stationary independent-cluster renewal approximation.

The paired mechanical bridge holds finishing-place probabilities and the relative cash payout shape fixed at N=1000. Room-specific wheel probabilities, monetary thresholds, inherited heads and the winner's final spin follow [Space rules](https://www.winamax.fr/space-ko) and [Ocean rules](https://br-1.ggpoker.com/tournaments/ocean-ko/). Space uses 40% cash / 50% bounty / 10% fee; Ocean uses 42% / 50% / 8%. Native currencies are not converted. Random bounty payouts are not rescaled to force a requested ROI.

For each component, empirical means are multiplied by the target/source mechanical mean ratio. With d_i=sqrt(S_target,ii/S_source,ii), the covariance becomes D S_empirical D. This preserves positive semidefiniteness and the empirical residual correlation. The hero's knockout weight theta=0.5, 1 or 2 provides structural sensitivity; it is not fitted player strength or a confidence interval.

## Limits

- This transports capped Space moments. It does not identify a capped Ocean payoff law or the full jackpot variance.
- Ocean observations have not validated the transfer. Applying single-entry mechanical ratios to re-entry clusters and representing a field bin by N=1000 are assumptions.
- The reference ROI is computed with capped bounties, so it is lower than the uncapped ROI: on the training window by 2.3 percentage points at the 100 BI cap and 10.1 at the 25 BI cap (audit of 8 October 2026). The UI states the meaning, not these numbers.
- Two moments do not determine trajectories, quantiles, loss probability or required bankroll. These are not reported in this view.
- Numerical precision and model accuracy are separate. Ten of twelve coefficient scenarios meet the fixed numerical thresholds; both theta=0.5/cap100 cases narrowly fail. The UI retains those warnings.
- The page marks the bridge as preliminary (every record is a pilot run) together with the number of scenarios that meet the thresholds, and says when an end of the displayed θ range comes from a scenario that does not. Both are read from the precision table, not typed into the text.
- The shape of Ocean's regular-prize table is assumed to be Space's; only its scale (42% of the ticket against 40%) is transported, for the mean and for the SD alike. Shrinking that ratio to 1.00 lowers the Ocean σ by about 3%, raising it to 1.10 adds about 3%.

The full mechanical mode is a separate model, not a continuation of the empirical moment calculation.

## Sampling error of the anchor

The anchor is a historical cohort over 17 months, and its σ is carried by a few large bounties: at the 100 BI threshold the cap binds in only 23 of 64,136 events. The page therefore shows a standard error next to the Space σ and ROI (for example 7.1 ± 0.2 BI), from a delete-one-month jackknife: σ and ROI are recomputed 17 times, each time without one month, with SE = sqrt((M−1)/M · Σ(θ_i − mean)²). σ and ROI are those of `exposureComponents`, the same S_ij the page computes from the raw moments. Neither the SE nor the θ range is a confidence interval, and the θ range does not contain this error; the same error carries into the Ocean scenario.

`scripts/anchor_uncertainty.ts` produces `training` and `anchors[*].uncertainty` in `space-runtime-profile.json` from the monthly moment table and the QA export, and refuses to write unless the training months add up to the published moments (relative difference below 1e-12) and to the QA event and entry counts:

    npx tsx scripts/anchor_uncertainty.ts --csv <calibration-monthly.csv> --qa <calibration-qa.json>
    npx tsx scripts/anchor_uncertainty.ts --csv <calibration-monthly.csv> --qa <calibration-qa.json> --check

Displayed precision: σ, its SE and the ROI to one decimal, the SD of the result over a distance to two significant digits (tens below 1,000 BI, hundreds above), the SD of the average ROI to 0.1 percentage point. Rounding is for display only; every figure comes from the same unrounded values.
