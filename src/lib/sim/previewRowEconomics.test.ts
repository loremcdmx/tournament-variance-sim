import { describe, expect, it } from "vitest";

import {
  derivePreviewRowEconomics,
  expectedReentriesForRow,
} from "./previewRowEconomics";

describe("previewRowEconomics", () => {
  it("defaults freezeouts to one bullet and no overlay", () => {
    const economics = derivePreviewRowEconomics({
      players: 180,
      buyIn: 22,
      rake: 0.09,
    });

    expect(expectedReentriesForRow({})).toBe(0);
    expect(economics.fieldSize).toBe(180);
    expect(economics.expectedBullets).toBe(1);
    expect(economics.buyInTotal).toBe(22);
    expect(economics.totalRake).toBeCloseTo(1.98);
    expect(economics.basePool).toBe(3960);
    expect(economics.overlay).toBe(0);
  });

  it("matches late-reg, re-entry and guarantee economics used by the engine", () => {
    const economics = derivePreviewRowEconomics({
      players: 500,
      lateRegMultiplier: 1.25,
      buyIn: 10,
      rake: 0.1,
      maxEntries: 2,
      reentryRate: 1,
      guarantee: 15_000,
    });

    expect(expectedReentriesForRow({ maxEntries: 2, reentryRate: 1 })).toBe(1);
    expect(economics.fieldSize).toBe(625);
    expect(economics.expectedBullets).toBe(2);
    expect(economics.effectiveSeats).toBe(1250);
    expect(economics.buyInTotal).toBe(20);
    expect(economics.costPerTournament).toBeCloseTo(22);
    expect(economics.totalRake).toBeCloseTo(2);
    expect(economics.basePool).toBe(12_500);
    expect(economics.overlay).toBe(2500);
    expect(economics.prizePoolBeforeBounty).toBe(15_000);
  });
});
