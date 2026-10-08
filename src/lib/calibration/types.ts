export type SpaceFieldBin = "500-999" | "1000-1499" | "1500-1999";

export interface SpaceJointMoments {
  meanK: number;
  secondK: number;
  meanProfit: number;
  secondProfit: number;
  crossProfitK: number;
  meanCash: number;
  secondCash: number;
  crossCashK: number;
  meanBounty: number;
  secondBounty: number;
  crossBountyK: number;
  crossCashBounty: number;
}

/** Sampling error of an anchor's σ and ROI. It is a standard error from leaving out one month of the training window at a time, not a confidence interval. */
export interface AnchorUncertainty {
  method: "delete-one-month-jackknife";
  months: number;
  /** BI per tournament. */
  sigmaSE: number;
  /** Fraction of the full ticket: 0.02 is 2 percentage points. */
  roiSE: number;
}

/** Where the anchor's data come from. */
export interface SpaceTrainingWindow {
  /** First and last day of the training window, ISO dates. */
  from: string;
  through: string;
  months: number;
  /** Distinct players in the window across every field in `allFieldsRange`; the published 1000-1499 bin is a part of them. */
  playersAllFields: number;
  allFieldsRange: string;
  /** Mean field size per paid entry in the 1000-1499 bin. */
  meanFieldEntries: number;
}

/** Only the two runtime anchors are published; research evaluations stay local. */
export interface PublicSpaceProfile {
  profileId: string;
  fieldBin: "1000-1499";
  trainingEvents: number;
  trainingEntries: number;
  training: SpaceTrainingWindow;
  anchors: { capBountyBI: 25 | 100; moments: SpaceJointMoments; uncertainty: AnchorUncertainty }[];
}
