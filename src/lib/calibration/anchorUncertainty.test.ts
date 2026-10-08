import { describe, expect, it } from "vitest";
import { mulberry32 } from "../sim/rng";
import { monthJackknife, pooledMoments, type MonthlyMomentSums } from "./anchorUncertainty";
import { exposureComponents, oceanTransportDistance, transportOceanMoments, type EmpiricalBridgeData } from "./oceanTransport";
import bridgeProfile from "./ocean-bridge-profile.json";
import profile from "./space-runtime-profile.json";

interface Cluster { c: number; b: number; k: number }

/** Heavy-tailed player/tournament clusters, 1-3 entries each, month by month. */
function syntheticMonths(monthCount: number): Cluster[][] {
  const rng = mulberry32(20261008);
  return Array.from({ length: monthCount }, (_, month) => Array.from({ length: 120 + 17 * month }, () => {
    const k = 1 + Math.floor(rng() * 3);
    const cash = rng() < 0.18 ? 10 * k * -Math.log(1 - rng()) : 0;
    const bounty = rng() < 0.12 ? 15 * Math.pow(1 - rng(), -0.5) : 0;
    return { c: cash, b: bounty, k };
  }));
}

function sums(month: string, clusters: Cluster[]): MonthlyMomentSums {
  const add = (pick: (cluster: Cluster) => number) => clusters.reduce((total, cluster) => total + pick(cluster), 0);
  return {
    month, n: clusters.length, sk: add(x => x.k), sk2: add(x => x.k * x.k),
    sx: add(x => x.c + x.b - x.k), sx2: add(x => (x.c + x.b - x.k) ** 2), sxk: add(x => (x.c + x.b - x.k) * x.k),
    sc: add(x => x.c), sc2: add(x => x.c * x.c), sck: add(x => x.c * x.k),
    sb: add(x => x.b), sb2: add(x => x.b * x.b), sbk: add(x => x.b * x.k), scb: add(x => x.c * x.b),
  };
}

/** σ and ROI straight from clusters: sigma^2 = E[(X - rho K)^2] / E[K], rho = E[X] / E[K], X = cash + bounty. */
function direct(clusters: Cluster[]): { sigma: number; roi: number } {
  const meanK = clusters.reduce((total, x) => total + x.k, 0) / clusters.length;
  const rho = clusters.reduce((total, x) => total + x.c + x.b, 0) / clusters.length / meanK;
  const variance = clusters.reduce((total, x) => total + (x.c + x.b - rho * x.k) ** 2, 0) / clusters.length / meanK;
  return { sigma: Math.sqrt(variance), roi: rho - 1 };
}

function bruteForceJackknife(months: Cluster[][]) {
  const leaveOut = months.map((_, drop) => direct(months.filter((__, index) => index !== drop).flat()));
  const se = (values: number[]) => {
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return Math.sqrt((values.length - 1) / values.length * values.reduce((total, value) => total + (value - mean) ** 2, 0));
  };
  return { sigmaSE: se(leaveOut.map(x => x.sigma)), roiSE: se(leaveOut.map(x => x.roi)) };
}

describe("month jackknife of the Space anchor", () => {
  const months = syntheticMonths(9);
  const rows = months.map((clusters, index) => sums(`2025-${String(index + 1).padStart(2, "0")}`, clusters));

  it("pools months into the moments of the whole window", () => {
    const pooled = pooledMoments(rows);
    const all = months.flat();
    expect(pooled.meanK).toBeCloseTo(all.reduce((total, x) => total + x.k, 0) / all.length, 12);
    expect(pooled.secondBounty).toBeCloseTo(all.reduce((total, x) => total + x.b * x.b, 0) / all.length, 9);
    const components = exposureComponents(pooled)!;
    const reference = direct(all);
    expect(components.sigma).toBeCloseTo(reference.sigma, 10);
    expect(components.roi).toBeCloseTo(reference.roi, 12);
  });

  it("matches a brute-force leave-one-month-out recomputation from the clusters", () => {
    const result = monthJackknife(rows);
    const reference = bruteForceJackknife(months);
    expect(result.months).toBe(9);
    expect(result.sigmaSE).toBeCloseTo(reference.sigmaSE, 10);
    expect(result.roiSE).toBeCloseTo(reference.roiSE, 12);
    expect(result.sigmaLeaveOneOut).toHaveLength(9);
    expect(result.sigma).toBeCloseTo(direct(months.flat()).sigma, 10);
    expect(result.sigmaSE).toBeGreaterThan(0);
  });

  it("does not depend on the order of the months", () => {
    const shuffled = [...rows].reverse();
    expect(monthJackknife(shuffled).sigmaSE).toBeCloseTo(monthJackknife(rows).sigmaSE, 12);
  });

  it("is zero when every month is the same and refuses to guess from too few months", () => {
    const same = ["2025-01", "2025-02", "2025-03", "2025-04"].map(month => ({ ...rows[0], month }));
    expect(monthJackknife(same).sigmaSE).toBeCloseTo(0, 12);
    expect(monthJackknife(same).roiSE).toBeCloseTo(0, 12);
    expect(() => monthJackknife(rows.slice(0, 2))).toThrow("at least three months");
    expect(() => monthJackknife([...rows.slice(0, 3), { ...rows[0] }])).toThrow("one row per month");
  });
});

describe("published anchor uncertainty", () => {
  const bridge = bridgeProfile as unknown as EmpiricalBridgeData;

  it("carries one entry per threshold over the whole training window", () => {
    expect(profile.training.months).toBe(17);
    for (const anchor of profile.anchors) {
      expect(anchor.uncertainty.method).toBe("delete-one-month-jackknife");
      expect(anchor.uncertainty.months).toBe(profile.training.months);
      const components = exposureComponents(anchor.moments)!;
      const relative = anchor.uncertainty.sigmaSE / components.sigma;
      expect(relative).toBeGreaterThan(0.01);
      expect(relative).toBeLessThan(0.05);
      expect(anchor.uncertainty.roiSE * 100).toBeGreaterThan(1);
      expect(anchor.uncertainty.roiSE * 100).toBeLessThan(3);
    }
  });

  it("describes a window that the training counts and the first/last day agree with", () => {
    expect(profile.training.from).toBe("2025-02-02");
    expect(profile.training.through).toBe("2026-06-30");
    expect(profile.trainingEvents).toBe(64136);
    expect(profile.trainingEntries).toBe(73383);
    expect(profile.training.allFieldsRange).toBe("500-1999");
    expect(profile.training.playersAllFields).toBeGreaterThan(0);
    expect(profile.training.meanFieldEntries).toBeGreaterThan(1000);
    expect(profile.training.meanFieldEntries).toBeLessThan(1500);
  });

  it("leaves the internal σ, ROI and distance SD of the anchor and the default Ocean scenario untouched", () => {
    const cap100 = exposureComponents(profile.anchors.find(model => model.capBountyBI === 100)!.moments)!;
    const cap25 = exposureComponents(profile.anchors.find(model => model.capBountyBI === 25)!.moments)!;
    expect(cap100.sigma).toBeCloseTo(7.081258676384147, 12);
    expect(cap100.roi).toBeCloseTo(0.30988343298892085, 12);
    expect(cap100.sigma * Math.sqrt(20000)).toBeCloseTo(1001.4412058814613, 9);
    expect(cap25.sigma).toBeCloseTo(5.935835027319315, 12);
    expect(cap25.roi).toBeCloseTo(0.23194369384952918, 12);
    const anchor = profile.anchors.find(model => model.capBountyBI === 100)!;
    const pick = (roomId: string) => bridge.records.find(record => record.theta === 1 && record.roomId === roomId && record.support.capBountyBI === 100)!;
    const ocean = transportOceanMoments({ anchor: anchor.moments, capBountyBI: 100, anchorProfileId: profile.profileId, anchorFieldBin: "1000-1499",
      source: pick("space-eur10"), target: pick("ocean-usd100"), allowSingleEntryBridge: true, allowRepresentativeField: true });
    expect(ocean.supported).toBe(true);
    if (!ocean.supported) return;
    expect(ocean.transported.sigma).toBeCloseTo(7.389657430590404, 12);
    expect(ocean.transported.roi).toBeCloseTo(0.3360801847888446, 12);
    expect(oceanTransportDistance(ocean, 20000)!.profitSdBI).toBeCloseTo(1045.0553759632069, 9);
  });
});
