import { describe, expect, it } from "vitest";

import { derivePreviewRowEconomics } from "./previewRowEconomics";

describe("previewRowEconomics", () => {
  it("defaults freezeouts to a single entry and no overlay", () => {
    const economics = derivePreviewRowEconomics({
      players: 180,
      buyIn: 22,
      rake: 0.09,
    });

    expect(economics.fieldSize).toBe(180);
    expect(economics.buyInTotal).toBe(22);
    expect(economics.totalRake).toBeCloseTo(1.98);
    expect(economics.basePool).toBe(3960);
    expect(economics.overlay).toBe(0);
  });

  it("matches late-reg and guarantee economics used by the engine", () => {
    const economics = derivePreviewRowEconomics({
      players: 500,
      lateRegMultiplier: 1.25,
      buyIn: 10,
      rake: 0.1,
      guarantee: 15_000,
    });

    expect(economics.fieldSize).toBe(625);
    expect(economics.effectiveSeats).toBe(625);
    expect(economics.buyInTotal).toBe(10);
    expect(economics.costPerTournament).toBeCloseTo(11);
    expect(economics.totalRake).toBeCloseTo(1);
    expect(economics.basePool).toBe(6250);
    expect(economics.overlay).toBe(8750);
    expect(economics.prizePoolBeforeBounty).toBe(15_000);
  });
});
