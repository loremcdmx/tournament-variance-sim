/** Component-moment transport is a structural scenario, not a sampled payoff law. */
import type { SpaceFieldBin, SpaceJointMoments } from "./types";

export interface ExposureComponents {
  cashMean: number;
  bountyMean: number;
  cashVariance: number;
  bountyVariance: number;
  cashBountyCovariance: number;
  residualCorrelation: number | null;
  roi: number;
  variance: number;
  sigma: number;
}

export interface MechanisticMomentSupport {
  format: "space-ko" | "ocean-ko";
  ticket: number;
  currency: "EUR" | "USD";
  fieldSize: number;
  capBountyBI: 25 | 100;
  latentFamily: string;
  finishProfileId: string;
  cashProfileId: string;
  bountyFraction: number;
  rakeFraction: number;
  ruleVersion: string;
  grain: "single-entry" | "player-tournament-cluster";
  terminalPayoutScale: 1;
  numericalStatus: "pilot" | "checked";
}

export interface MechanisticMomentRecord {
  moments: SpaceJointMoments;
  support: MechanisticMomentSupport;
}

export interface EmpiricalBridgeData {
  schemaVersion: 1;
  status: "experimental-paired-component-bridge-pilot" | "experimental-paired-component-bridge";
  records: (MechanisticMomentRecord & {
    theta: number;
    roomId: "space-eur10" | "ocean-usd10" | "ocean-usd100";
    diagnostics: {
      meanBountyBatchSE: number;
      secondBountyBatchSE: number;
      covarianceCashBounty: number;
      varianceCash: number;
      varianceBounty: number;
      profitSigma: number;
      varianceBatchSE: number;
      uncertaintyKind: string;
    };
  })[];
  receipt: { sourceStable: boolean };
  numericPrecision?: {
    gates: { maxResidualSdRatioRelativeSE: number; maxMeanRatioRelativeSE: number };
    passes: boolean;
    method: string;
    batches?: number;
    rows: {
      theta: number;
      capBountyBI: number;
      target: string;
      bountyMeanRatio: number;
      bountyMeanRatioPairedBatchSE: number;
      bountyMeanRatioRelativeSE: number;
      bountyResidualSdRatio: number;
      bountyResidualSdRatioPairedBatchSE: number;
      bountyResidualSdRatioRelativeSE: number;
      cashMeanRatio?: number;
      cashResidualSdRatio?: number;
      leaveOneBatchSdRatioRange?: number[];
      passes?: boolean;
    }[];
  };
}

export interface OceanTransportInput {
  anchor: SpaceJointMoments;
  capBountyBI: 25 | 100;
  anchorProfileId: string;
  anchorFieldBin: SpaceFieldBin | "all";
  source: MechanisticMomentRecord;
  target: MechanisticMomentRecord;
  allowSingleEntryBridge: boolean;
  allowRepresentativeField: boolean;
}

export type OceanTransportRejection =
  | "unsupported-anchor"
  | "unsupported-scenario"
  | "mismatched-scenarios"
  | "grain-assumption-required"
  | "field-assumption-required"
  | "invalid-moments"
  | "degenerate-source";

export type OceanTransportResult = { supported: false; reason: OceanTransportRejection } | {
  supported: true;
  status: "experimental-moment-transport";
  capSemantics: "transport-of-capped-space-moments-not-target-payoff-law";
  fullTailSupported: false;
  pathsSupported: false;
  quantilesSupported: false;
  uncertaintyKind: "structural-scenario-not-confidence-interval";
  bridgeNumericalStatus: "pilot" | "checked";
  grainTransferAssumed: boolean;
  representativeFieldAssumed: true;
  anchorProfileId: string;
  anchorFieldBin: SpaceFieldBin | "all";
  capBountyBI: 25 | 100;
  anchor: ExposureComponents;
  source: ExposureComponents;
  target: ExposureComponents;
  transported: ExposureComponents;
  meanRatios: { cash: number; bounty: number };
  residualSdRatios: { cash: number; bounty: number };
  canonicalAnchorRoiDifference: number;
};

const positiveFloor = 1e-12;
const numericTolerance = 1e-9;

function components(
  cashMean: number,
  bountyMean: number,
  cashVariance: number,
  bountyVariance: number,
  cashBountyCovariance: number,
): ExposureComponents | null {
  const values = [cashMean, bountyMean, cashVariance, bountyVariance, cashBountyCovariance];
  if (!values.every(Number.isFinite) || cashMean < 0 || bountyMean < 0) return null;
  const tolerance = numericTolerance * Math.max(1, Math.abs(cashVariance), Math.abs(bountyVariance));
  if (cashVariance < -tolerance || bountyVariance < -tolerance) return null;
  const vc = Math.max(0, cashVariance), vb = Math.max(0, bountyVariance);
  const covarianceLimit = Math.sqrt(vc * vb);
  if (Math.abs(cashBountyCovariance) > covarianceLimit + tolerance) return null;
  // Only remove cancellation-level PSD error; invalid matrices are rejected above.
  const cov = Math.max(-covarianceLimit, Math.min(covarianceLimit, cashBountyCovariance));
  const variance = Math.max(0, vc + vb + 2 * cov);
  if (!Number.isFinite(variance)) return null;
  return {
    cashMean, bountyMean, cashVariance: vc, bountyVariance: vb,
    cashBountyCovariance: cov,
    residualCorrelation: covarianceLimit > positiveFloor ? cov / covarianceLimit : null,
    roi: cashMean + bountyMean - 1, variance, sigma: Math.sqrt(variance),
  };
}

export function exposureComponents(m: SpaceJointMoments): ExposureComponents | null {
  const values = [m.meanK, m.secondK, m.meanCash, m.secondCash, m.crossCashK,
    m.meanBounty, m.secondBounty, m.crossBountyK, m.crossCashBounty];
  if (!values.every(Number.isFinite) || values.some(v => v < 0) || m.meanK < 1) return null;
  if ((m.meanCash === 0 && m.secondCash > 0) || (m.meanBounty === 0 && m.secondBounty > 0)) return null;
  const c = m.secondCash - m.meanCash ** 2;
  const b = m.secondBounty - m.meanBounty ** 2;
  const k = m.secondK - m.meanK ** 2;
  const cb = m.crossCashBounty - m.meanCash * m.meanBounty;
  const ck = m.crossCashK - m.meanCash * m.meanK;
  const bk = m.crossBountyK - m.meanBounty * m.meanK;
  const diagonals = [[c,m.secondCash,m.meanCash], [b,m.secondBounty,m.meanBounty], [k,m.secondK,m.meanK]];
  if (diagonals.some(([v,second,mean]) => v < -numericTolerance*Math.max(1,second,mean*mean))) return null;
  const variances = [Math.max(0,c),Math.max(0,b),Math.max(0,k)];
  const correlations: number[] = [];
  for (const [i,j,cov] of [[0,1,cb],[0,2,ck],[1,2,bk]]) {
    const limit = Math.sqrt(variances[i]*variances[j]);
    const tolerance = numericTolerance*Math.sqrt(Math.max(1,variances[i])*Math.max(1,variances[j]));
    if (Math.abs(cov) > limit+tolerance) return null;
    correlations.push(limit > positiveFloor ? Math.max(-1,Math.min(1,cov/limit)) : 0);
  }
  const [rcb,rck,rbk] = correlations;
  if (1+2*rcb*rck*rbk-rcb*rcb-rck*rck-rbk*rbk < -numericTolerance) return null;
  const mc = m.meanCash / m.meanK, mb = m.meanBounty / m.meanK;
  return components(mc, mb,
    (m.secondCash - 2*mc*m.crossCashK + mc*mc*m.secondK) / m.meanK,
    (m.secondBounty - 2*mb*m.crossBountyK + mb*mb*m.secondK) / m.meanK,
    (m.crossCashBounty - mc*m.crossBountyK - mb*m.crossCashK + mc*mb*m.secondK) / m.meanK);
}

export function transportOceanMoments(input: OceanTransportInput): OceanTransportResult {
  const fail = (reason: OceanTransportRejection): OceanTransportResult => ({ supported: false, reason });
  if (input.anchorProfileId !== "space-ko-tt-eur10-field500-1999-v1" || ![25,100].includes(input.capBountyBI)) return fail("unsupported-anchor");
  const s = input.source.support, t = input.target.support;
  const fieldRanges = { all: [500,1999], "500-999": [500,999], "1000-1499": [1000,1499], "1500-1999": [1500,1999] } as const;
  const fieldRange = fieldRanges[input.anchorFieldBin];
  if (!fieldRange || s.fieldSize < fieldRange[0] || s.fieldSize > fieldRange[1]) return fail("unsupported-anchor");
  const validSupport = (x: MechanisticMomentSupport) =>
    Number.isFinite(x.ticket) && x.ticket > 0 && Number.isInteger(x.fieldSize) && x.fieldSize >= 500 && x.fieldSize <= 1999
    && [25,100].includes(x.capBountyBI) && x.terminalPayoutScale === 1
    && Number.isFinite(x.bountyFraction) && x.bountyFraction > 0 && x.bountyFraction < 1
    && Number.isFinite(x.rakeFraction) && x.rakeFraction >= 0 && x.rakeFraction < 1 - x.bountyFraction
    && !!x.latentFamily && !!x.finishProfileId && !!x.cashProfileId && !!x.ruleVersion
    && ["pilot", "checked"].includes(x.numericalStatus)
    && ["single-entry", "player-tournament-cluster"].includes(x.grain);
  if (!validSupport(s) || !validSupport(t) || s.format !== "space-ko" || s.ticket !== 10 || s.currency !== "EUR"
    || t.format !== "ocean-ko" || t.currency !== "USD" || s.rakeFraction !== .1 || t.rakeFraction !== .08
    || s.bountyFraction !== .5 || t.bountyFraction !== .5) return fail("unsupported-scenario");
  if (s.capBountyBI !== input.capBountyBI || t.capBountyBI !== input.capBountyBI || s.fieldSize !== t.fieldSize
    || s.latentFamily !== t.latentFamily || s.finishProfileId !== t.finishProfileId || s.cashProfileId !== t.cashProfileId
    || s.grain !== t.grain) return fail("mismatched-scenarios");
  const grainTransferAssumed = s.grain === "single-entry";
  if (grainTransferAssumed && !input.allowSingleEntryBridge) return fail("grain-assumption-required");
  if (!input.allowRepresentativeField) return fail("field-assumption-required");
  if (grainTransferAssumed && [input.source.moments, input.target.moments].some(m => m.meanK !== 1 || m.secondK !== 1)) return fail("invalid-moments");
  const anchor = exposureComponents(input.anchor), source = exposureComponents(input.source.moments), target = exposureComponents(input.target.moments);
  if (!anchor || !source || !target || !Number.isFinite(input.anchor.meanProfit)) return fail("invalid-moments");
  if (source.cashMean <= positiveFloor || source.bountyMean <= positiveFloor
    || source.cashVariance <= positiveFloor || source.bountyVariance <= positiveFloor) return fail("degenerate-source");
  const meanRatios = { cash: target.cashMean / source.cashMean, bounty: target.bountyMean / source.bountyMean };
  const residualSdRatios = { cash: Math.sqrt(target.cashVariance / source.cashVariance), bounty: Math.sqrt(target.bountyVariance / source.bountyVariance) };
  const transported = components(anchor.cashMean * meanRatios.cash, anchor.bountyMean * meanRatios.bounty,
    anchor.cashVariance * residualSdRatios.cash ** 2,
    anchor.bountyVariance * residualSdRatios.bounty ** 2,
    anchor.cashBountyCovariance * residualSdRatios.cash * residualSdRatios.bounty);
  if (!transported) return fail("invalid-moments");
  return {
    supported: true, status: "experimental-moment-transport",
    capSemantics: "transport-of-capped-space-moments-not-target-payoff-law",
    fullTailSupported: false, pathsSupported: false, quantilesSupported: false,
    uncertaintyKind: "structural-scenario-not-confidence-interval",
    bridgeNumericalStatus: s.numericalStatus === "checked" && t.numericalStatus === "checked" ? "checked" : "pilot",
    grainTransferAssumed, representativeFieldAssumed: true,
    anchorProfileId: input.anchorProfileId, anchorFieldBin: input.anchorFieldBin, capBountyBI: input.capBountyBI,
    anchor, source, target, transported, meanRatios, residualSdRatios,
    canonicalAnchorRoiDifference: anchor.roi - input.anchor.meanProfit / input.anchor.meanK,
  };
}

export function oceanTransportDistance(result: OceanTransportResult, entries: number) {
  if (!result.supported || !Number.isSafeInteger(entries) || entries < 1000 || entries > 1_000_000) return null;
  return {
    expectedProfitBI: result.transported.roi * entries,
    profitSdBI: result.transported.sigma * Math.sqrt(entries),
    roiSd: result.transported.sigma / Math.sqrt(entries),
    assumption: "stationary-independent-cluster-renewal-approximation" as const,
  };
}

export interface OceanSigmaGap {
  anchorSigma: number;
  /** σ if only the regular-prize components were scaled to Ocean and the bounty components stayed Space's. */
  prizeOnlySigma: number;
  transportedSigma: number;
  /** transportedSigma - anchorSigma, BI per tournament. */
  gap: number;
  /** Share of the gap that the prize scale alone produces; the rest is the bounties. */
  prizeShare: number;
  /** Ocean / Space mean regular prize. */
  cashMeanRatio: number;
  /** Regular prizes as a fraction of the full ticket. */
  cashPoolSource: number;
  cashPoolTarget: number;
}

/** Splits the σ difference between the Space anchor and the transported Ocean
 * scenario. The prize part is the σ obtained when only the regular-prize
 * variance and its covariance with the bounty are rescaled; the full transport
 * rescales the bounty variance as well. */
export function oceanSigmaGap(
  result: OceanTransportResult, source: MechanisticMomentSupport, target: MechanisticMomentSupport,
): OceanSigmaGap | null {
  if (!result.supported) return null;
  const { anchor, transported } = result;
  const gap = transported.sigma - anchor.sigma;
  if (!(Math.abs(gap) > 1e-9 * anchor.sigma)) return null;
  const cashScale = result.residualSdRatios.cash;
  const prizeOnlyVariance = anchor.cashVariance * cashScale ** 2 + anchor.bountyVariance
    + 2 * anchor.cashBountyCovariance * cashScale;
  const prizeOnlySigma = Math.sqrt(Math.max(0, prizeOnlyVariance));
  return {
    anchorSigma: anchor.sigma, prizeOnlySigma, transportedSigma: transported.sigma, gap,
    prizeShare: (prizeOnlySigma - anchor.sigma) / gap,
    cashMeanRatio: result.meanRatios.cash,
    cashPoolSource: 1 - source.bountyFraction - source.rakeFraction,
    cashPoolTarget: 1 - target.bountyFraction - target.rakeFraction,
  };
}
