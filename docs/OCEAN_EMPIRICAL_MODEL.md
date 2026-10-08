# Space-based Ocean comparison

The default MTT view compares an empirical Space KO anchor with an experimental Ocean KO scenario. The mechanical simulator remains available for all formats, configurable ROI, trajectories and distributional metrics. Existing shared scenarios open in that simulator.

## Scope

The published anchor contains two joint-moment records for Space KO €10, fields 1000–1499, with total player/event bounty capped at 25 or 100 full-ticket buy-ins. All ordinary prizes and paid-entry costs remain. The source cohort includes named Space events and TRIDENT; its ROI is a historical reference, not an estimate of a visitor's skill.

Detailed research evaluations and raw observations are not part of this repository or the public site. Only the runtime parameters needed for the comparison are included.

## Calculation

For each player/tournament cluster, K is the number of paid entries and Y=(C,B) contains ordinary cash and capped bounty. Set beta_i=E[Y_i]/E[K] and

    S_ij = E[(Y_i - beta_i K)(Y_j - beta_j K)] / E[K].

ROI is beta_C+beta_B−1. The variance coefficient is S_CC+S_BB+2S_CB. This retains re-entry and cash/bounty covariance. Distance scaling uses the stationary independent-cluster renewal approximation.

The paired mechanical bridge holds finishing-place probabilities and the relative cash payout shape fixed at N=1000. Room-specific wheel probabilities, monetary thresholds, inherited heads and the winner's final spin follow [Space rules](https://www.winamax.fr/space-ko) and [Ocean rules](https://br-1.ggpoker.com/tournaments/ocean-ko/). Space uses 40% cash / 50% bounty / 10% fee; Ocean uses 42% / 50% / 8%. Native currencies are not converted. Random bounty payouts are not rescaled to force a requested ROI.

For each component, empirical means are multiplied by the target/source mechanical mean ratio. With d_i=sqrt(S_target,ii/S_source,ii), the covariance becomes D S_empirical D. This preserves positive semidefiniteness and the empirical residual correlation. The hero's knockout weight theta=0.5, 1 or 2 provides structural sensitivity; it is not fitted player strength or a confidence interval.

## Limits

- This transports capped Space moments. It does not identify a capped Ocean payoff law or the full jackpot variance.
- Ocean observations have not validated the transfer. Applying single-entry mechanical ratios to re-entry clusters and representing a field bin by N=1000 are assumptions.
- Two moments do not determine trajectories, quantiles, loss probability or required bankroll. These are not reported in this view.
- Numerical precision and model accuracy are separate. Ten of twelve coefficient scenarios meet the fixed numerical thresholds; both theta=0.5/cap100 cases narrowly fail. The UI retains those warnings.

The full mechanical mode is a separate model, not a continuation of the empirical moment calculation.
