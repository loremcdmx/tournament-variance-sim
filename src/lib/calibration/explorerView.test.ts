import { describe, expect, it } from "vitest";
import bridgeProfile from "./ocean-bridge-profile.json";
import profile from "./space-runtime-profile.json";
import { transportOceanMoments, type EmpiricalBridgeData } from "./oceanTransport";
import { DISTANCE_SD_STEP_BI, passesPrecisionGate, precisionCount, precisionRowFor, roundSignificant, roundToStep, sigmaRange, type SigmaScenario } from "./explorerView";

const bridge = bridgeProfile as unknown as EmpiricalBridgeData;
const precision = bridge.numericPrecision!;

function scenarios(cap: 25 | 100, ticket: 10 | 100): SigmaScenario[] {
  const anchor = profile.anchors.find(model => model.capBountyBI === cap)!;
  return [0.5, 1, 2].map(theta => {
    const pick = (roomId: string) => bridge.records.find(record => record.theta === theta && record.roomId === roomId && record.support.capBountyBI === cap)!;
    const result = transportOceanMoments({ anchor: anchor.moments, capBountyBI: cap, anchorProfileId: profile.profileId, anchorFieldBin: "1000-1499",
      source: pick("space-eur10"), target: pick(`ocean-usd${ticket}`), allowSingleEntryBridge: true, allowRepresentativeField: true });
    if (!result.supported) throw new Error("scenario must be supported");
    return { theta, sigma: result.transported.sigma };
  });
}

describe("rounding of the result SD and of counts", () => {
  it("rounds the result SD to tens, so Space and Ocean stay distinguishable", () => {
    expect(roundToStep(1001.4412, DISTANCE_SD_STEP_BI)).toBe(1000);
    expect(roundToStep(1045.0554, DISTANCE_SD_STEP_BI)).toBe(1050);
    expect(roundToStep(839.4538, DISTANCE_SD_STEP_BI)).toBe(840);
    expect(roundToStep(Number.NaN, DISTANCE_SD_STEP_BI)).toBeNaN();
  });

  it("keeps two significant digits for counts", () => {
    expect(roundSignificant(1001.4412)).toBe(1000);
    expect(roundSignificant(1045.0554)).toBe(1000);
    expect(roundSignificant(1059.4061)).toBe(1100);
    expect(roundSignificant(839.4538)).toBe(840);
    expect(roundSignificant(224.04)).toBe(220);
    expect(roundSignificant(7081.2)).toBe(7100);
    expect(roundSignificant(-1234)).toBe(-1200);
    expect(roundSignificant(0)).toBe(0);
  });

  it("rounds the published player count to hundreds for the cohort line", () => {
    expect(roundSignificant(profile.training.playersAllFields)).toBe(1100);
    expect(roundSignificant(profile.training.playersAllFields, 3)).toBe(1090);
  });
});

describe("the numerical-precision verdict of the scenarios that set the σ range", () => {
  it("flags the θ = 0.5 upper end at the 100 BI threshold, for both Ocean tickets", () => {
    for (const ticket of [10, 100] as const) {
      const range = sigmaRange(scenarios(100, ticket), precision, 100, ticket)!;
      expect(range.upper.theta).toBe(0.5);
      expect(range.upper.meetsPrecision).toBe(false);
      expect(range.lower.theta).toBe(2);
      expect(range.lower.meetsPrecision).toBe(true);
      expect(range.upper.sigma).toBeGreaterThan(range.lower.sigma);
    }
  });

  it("flags nothing at the 25 BI threshold, where every scenario meets the gates", () => {
    for (const ticket of [10, 100] as const) {
      const range = sigmaRange(scenarios(25, ticket), precision, 25, ticket)!;
      expect(range.lower.meetsPrecision).toBe(true);
      expect(range.upper.meetsPrecision).toBe(true);
    }
  });

  it("reads the verdict from the table instead of a fixed θ", () => {
    const worse = structuredClone(precision);
    const row = worse.rows.find(item => item.theta === 2 && item.capBountyBI === 100 && item.target === "ocean-usd100")!;
    row.bountyMeanRatioRelativeSE = worse.gates.maxMeanRatioRelativeSE * 2;
    const range = sigmaRange(scenarios(100, 100), worse, 100, 100)!;
    expect(range.lower.theta).toBe(2);
    expect(range.lower.meetsPrecision).toBe(false);
    expect(range.upper.meetsPrecision).toBe(false);
    const better = structuredClone(precision);
    for (const item of better.rows) item.bountyResidualSdRatioRelativeSE = 0;
    expect(sigmaRange(scenarios(100, 100), better, 100, 100)!.upper.meetsPrecision).toBe(true);
  });

  it("gives no verdict when there is no table or no row for the scenario", () => {
    const none = sigmaRange(scenarios(100, 100), undefined, 100, 100)!;
    expect([none.lower.meetsPrecision, none.upper.meetsPrecision]).toEqual([null, null]);
    const partial = { ...precision, rows: precision.rows.filter(row => row.theta !== 0.5) };
    const range = sigmaRange(scenarios(100, 100), partial, 100, 100)!;
    expect(range.upper.theta).toBe(0.5);
    expect(range.upper.meetsPrecision).toBeNull();
    expect(sigmaRange([], precision, 100, 100)).toBeNull();
  });
});

describe("how many bridge scenarios meet the numerical gates", () => {
  it("counts ten of twelve in the published table and names the two that fail", () => {
    expect(precisionCount(precision)).toEqual({ passed: 10, total: 12 });
    const failing = precision.rows.filter(row => !passesPrecisionGate(row, precision.gates));
    expect(failing.map(row => [row.theta, row.capBountyBI, row.target])).toEqual([
      [0.5, 100, "ocean-usd10"], [0.5, 100, "ocean-usd100"],
    ]);
    expect(precisionRowFor(precision, 0.5, 100, 100)).toBe(failing[1]);
    expect(precisionRowFor(undefined, 0.5, 100, 100)).toBeUndefined();
  });

});
