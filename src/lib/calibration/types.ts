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

/** Only the two runtime anchors are published; research evaluations stay local. */
export interface PublicSpaceProfile {
  profileId: string;
  fieldBin: "1000-1499";
  trainingEvents: number;
  trainingEntries: number;
  anchors: { capBountyBI: 25 | 100; moments: SpaceJointMoments }[];
}
