import { describe, expect, it } from "vitest";
import { exposureComponents, oceanTransportDistance, transportOceanMoments } from "./oceanTransport";
import type { MechanisticMomentSupport, OceanTransportInput } from "./oceanTransport";
import type { SpaceJointMoments } from "./types";
import profile from "./space-runtime-profile.json";

type Atom = { p: number; c: number; b: number; k: number };
function moments(atoms: Atom[]): SpaceJointMoments {
  const sum = (f: (a: Atom) => number) => atoms.reduce((v, a) => v + a.p * f(a), 0);
  return {
    meanK: sum(a => a.k), secondK: sum(a => a.k*a.k),
    meanCash: sum(a => a.c), secondCash: sum(a => a.c*a.c), crossCashK: sum(a => a.c*a.k),
    meanBounty: sum(a => a.b), secondBounty: sum(a => a.b*a.b), crossBountyK: sum(a => a.b*a.k), crossCashBounty: sum(a => a.c*a.b),
    meanProfit: sum(a => a.c+a.b-a.k), secondProfit: sum(a => (a.c+a.b-a.k)**2), crossProfitK: sum(a => (a.c+a.b-a.k)*a.k),
  };
}
const anchorAtoms = [{p:.5,c:0,b:0,k:1},{p:.25,c:2,b:4,k:1},{p:.25,c:8,b:2,k:2}];
const sourceAtoms = [{p:.5,c:0,b:0,k:1},{p:.5,c:2,b:4,k:1}];
const support: MechanisticMomentSupport = {
  format: "space-ko", ticket: 10, currency: "EUR", fieldSize: 1000, capBountyBI: 100,
  latentFamily: "uniform-killer", finishProfileId: "frozen-pmf", cashProfileId: "shared-payout-curve",
  bountyFraction: .5, rakeFraction: .1, ruleVersion: "space-test-rule", grain: "single-entry",
  terminalPayoutScale: 1, numericalStatus: "checked",
};
function input(): OceanTransportInput {
  return {
    anchor: moments(anchorAtoms), capBountyBI: 100, anchorProfileId: "space-ko-tt-eur10-field500-1999-v1", anchorFieldBin: "all",
    source: { moments: moments(sourceAtoms), support: { ...support } },
    target: { moments: moments(sourceAtoms), support: { ...support, format: "ocean-ko", currency: "USD", ticket: 100, rakeFraction: .08, ruleVersion: "ocean-test-rule" } },
    allowSingleEntryBridge: true, allowRepresentativeField: true,
  };
}

describe("Ocean moment transport", () => {
  it("matches direct cluster residual enumeration and preserves an identity bridge", () => {
    const result = transportOceanMoments(input());
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    const direct = anchorAtoms.reduce((v,a) => v+a.p*(a.c+a.b-a.k-2.2*a.k)**2,0)/1.25;
    expect(result.transported.variance).toBeCloseTo(direct,12);
    expect(result.transported.cashVariance).toBeCloseTo(4.8,12);
    expect(result.transported.bountyVariance).toBeCloseTo(2.176,12);
    expect(result.transported.cashBountyCovariance).toBeCloseTo(.64,12);
    expect(result.transported).toEqual(result.anchor);
    expect(result.canonicalAnchorRoiDifference).toBeCloseTo(0,12);
  });

  it("applies component variance ratios once and retains residual covariance", () => {
    const data = input();
    data.target.moments = moments(sourceAtoms.map(a => ({...a,c:3*a.c,b:.5*a.b})));
    const result = transportOceanMoments(data);
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.transported.cashMean).toBeCloseTo(6,12);
    expect(result.transported.bountyMean).toBeCloseTo(.6,12);
    expect(result.transported.cashVariance).toBeCloseTo(4.8*9,12);
    expect(result.transported.bountyVariance).toBeCloseTo(2.176*.25,12);
    expect(result.transported.cashBountyCovariance).toBeCloseTo(.64*1.5,12);
    expect(result.transported.residualCorrelation).toBeCloseTo(result.anchor.residualCorrelation!,12);
    expect(result.transported.variance).toBeCloseTo(45.664,12);
  });

  it("preserves negative covariance cancellation instead of summing independent risks", () => {
    const data = input();
    data.anchor = moments([{p:.5,c:4,b:0,k:1},{p:.5,c:0,b:4,k:1}]);
    const result = transportOceanMoments(data);
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.transported.variance).toBe(0);
    expect(result.transported.residualCorrelation).toBe(-1);
  });

  it("retains canonical rounding reconciliation and agrees with real joint cap moments", () => {
    for (const cap of [25,100]) {
      const row = profile.anchors.find(r => r.capBountyBI === cap)!;
      const data = input(); data.anchor = row.moments;
      data.capBountyBI=cap as 25 | 100;
      data.source.support.capBountyBI=data.capBountyBI;
      data.target.support.capBountyBI=data.capBountyBI;
      const result = transportOceanMoments(data);
      expect(result.supported).toBe(true);
      if (!result.supported) continue;
      const m=data.anchor, mu=(m.meanCash+m.meanBounty-m.meanK)/m.meanK;
      const q=m.secondCash+m.secondBounty+m.secondK+2*m.crossCashBounty-2*m.crossCashK-2*m.crossBountyK;
      const xk=m.crossCashK+m.crossBountyK-m.secondK;
      expect(result.transported.variance).toBeCloseTo((q-2*mu*xk+mu*mu*m.secondK)/m.meanK,10);
      expect(Math.abs(result.canonicalAnchorRoiDifference)).toBeLessThan(.0018);
      expect(result.fullTailSupported).toBe(false);
      expect(result.pathsSupported).toBe(false);
      expect(result.quantilesSupported).toBe(false);
    }
  });

  it("requires explicit cluster-grain and representative-field assumptions", () => {
    expect(transportOceanMoments({...input(),allowSingleEntryBridge:false})).toEqual({supported:false,reason:"grain-assumption-required"});
    expect(transportOceanMoments({...input(),allowRepresentativeField:false})).toEqual({supported:false,reason:"field-assumption-required"});
  });

  it("rejects invalid PSD moments and unresolved zero denominators", () => {
    const data=input(); data.anchor.crossCashBounty=100;
    expect(transportOceanMoments(data)).toEqual({supported:false,reason:"invalid-moments"});
    const zero=input(); zero.source.moments=moments([{p:1,c:1,b:1,k:1}]);
    expect(transportOceanMoments(zero)).toEqual({supported:false,reason:"degenerate-source"});
    const bad=input(); bad.source.moments.secondBounty=Infinity;
    expect(transportOceanMoments(bad)).toEqual({supported:false,reason:"invalid-moments"});
    expect(exposureComponents({...moments(anchorAtoms),secondK:1})).toBeNull();
    const extremeCash=moments(anchorAtoms.map(a=>({...a,c:a.c*1e6})));
    expect(exposureComponents({...extremeCash,secondK:1})).toBeNull();
  });

  it("rejects unsupported caps or mismatched source-target finish and field scenarios", () => {
    const field=input(); field.target.support.fieldSize=1500;
    expect(transportOceanMoments(field)).toEqual({supported:false,reason:"mismatched-scenarios"});
    const finish=input(); finish.target.support.finishProfileId="different-pmf";
    expect(transportOceanMoments(finish)).toEqual({supported:false,reason:"mismatched-scenarios"});
    const cap=input(); cap.target.support.capBountyBI=25;
    expect(transportOceanMoments(cap)).toEqual({supported:false,reason:"mismatched-scenarios"});
    const ticket=input(); ticket.source.support.ticket=100;
    expect(transportOceanMoments(ticket)).toEqual({supported:false,reason:"unsupported-scenario"});
    const bin=input(); bin.anchorFieldBin="1500-1999";
    expect(transportOceanMoments(bin)).toEqual({supported:false,reason:"unsupported-anchor"});
    const fee=input(); fee.target.support.rakeFraction=.55;
    expect(transportOceanMoments(fee)).toEqual({supported:false,reason:"unsupported-scenario"});
  });

  it("only returns moment distance scaling and keeps pilot status explicit", () => {
    const data=input(); data.target.support.numericalStatus="pilot";
    const result=transportOceanMoments(data);
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.bridgeNumericalStatus).toBe("pilot");
    const distance=oceanTransportDistance(result,10000)!;
    expect(distance.profitSdBI).toBeCloseTo(result.transported.sigma*100,12);
    expect(distance.expectedProfitBI).toBeCloseTo(22000,8);
    expect(oceanTransportDistance(result,999)).toBeNull();
    expect(oceanTransportDistance(result,NaN)).toBeNull();
    expect(oceanTransportDistance(result,1000.5)).toBeNull();
    expect(oceanTransportDistance(result,1_000_001)).toBeNull();
  });
});
