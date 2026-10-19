import { describe, expect, it } from "vitest";
import { runSimulation } from "./engine";
import { clampEnvelopesToExtrema } from "./resultEnvelopes";
import type { SimulationInput } from "./types";

const array = (...values: number[]) => Float64Array.from(values);

describe("clampEnvelopesToExtrema", () => {
  it("pulls an interpolated curve back inside the exact minimum and maximum", () => {
    const env = {
      mean: array(0, 5, 40),
      p05: array(0, -20, 10),
      p95: array(0, 20, 12),
      p15: array(0, 1, 2),
      p85: array(0, 2, 3),
      p025: array(0, -30, 4),
      p975: array(0, 30, 6),
      p0015: array(0, -60, 8),
      p9985: array(0, 60, 99),
    };
    clampEnvelopesToExtrema(env, array(0, -50, 0), array(0, 50, 20));
    expect(env.p0015).toEqual(array(0, -50, 8));
    expect(env.p9985).toEqual(array(0, 50, 20));
    expect(env.mean).toEqual(array(0, 5, 20));
    expect(env.p15).toEqual(array(0, 1, 2));
  });

  it("leaves a curve that already lies inside the extrema untouched, bit for bit", () => {
    const p0015 = array(0, -1.25, -2.5);
    const env = {
      mean: array(0, 0, 0),
      p05: array(0, 0, 0),
      p95: array(0, 0, 0),
      p15: array(0, 0, 0),
      p85: array(0, 0, 0),
      p025: array(0, 0, 0),
      p975: array(0, 0, 0),
      p0015,
      p9985: array(0, 0, 0),
    };
    clampEnvelopesToExtrema(env, array(0, -9, -9), array(0, 9, 9));
    expect(env.p0015).toBe(p0015);
    expect(Array.from(env.p0015)).toEqual([0, -1.25, -2.5]);
  });
});

describe("result envelopes", () => {
  it("keeps every percentile and the mean between the exact minimum and maximum at every plotted point", () => {
    // 300 tournaments on a 240-point checkpoint grid read onto a 300-point plot
    // grid: the percentiles are interpolated, the extrema are exact.
    const input: SimulationInput = {
      schedule: [
        {
          id: "a",
          players: 1000,
          buyIn: 50,
          rake: 0.1,
          roi: 0.1,
          payoutStructure: "mtt-standard",
          count: 300,
        },
      ],
      scheduleRepeats: 1,
      samples: 500,
      bankroll: 0,
      seed: 7,
      finishModel: { id: "power-law" },
    };
    const { envelopes: e } = runSimulation(input);
    const curves = [e.p0015, e.p025, e.p05, e.p15, e.p85, e.p95, e.p975, e.p9985, e.mean];
    for (let i = 0; i < e.x.length; i++) {
      for (const curve of curves) {
        expect(curve[i]).toBeGreaterThanOrEqual(e.min[i]);
        expect(curve[i]).toBeLessThanOrEqual(e.max[i]);
      }
      expect(e.p0015[i]).toBeLessThanOrEqual(e.p025[i]);
      expect(e.p025[i]).toBeLessThanOrEqual(e.p05[i]);
      expect(e.p05[i]).toBeLessThanOrEqual(e.p15[i]);
      expect(e.p15[i]).toBeLessThanOrEqual(e.p85[i]);
      expect(e.p85[i]).toBeLessThanOrEqual(e.p95[i]);
      expect(e.p95[i]).toBeLessThanOrEqual(e.p975[i]);
      expect(e.p975[i]).toBeLessThanOrEqual(e.p9985[i]);
    }
  });
});
