import { describe, expect, it } from "vitest";
import type { SimulationResult } from "@/lib/sim/types";
import { runSimulation } from "@/lib/sim/engine";
import { pdDiagnosticPasses, relativeDifferencePct, summarizePdStats } from "./primedopeDiagnostics";

describe("PrimeDope diagnostic statistics", () => {
  it("handles signed loss measures and undefined relative changes at zero", () => {
    expect(relativeDifferencePct(-90, -100)).toBe(10);
    expect(relativeDifferencePct(-110, -100)).toBe(-10);
    expect(relativeDifferencePct(110, 100)).toBe(10);
    expect(relativeDifferencePct(1, 0)).toBeNull();
    expect(relativeDifferencePct(0, 0)).toBe(0);
  });

  it("exports the actual analytic sigma field", () => {
    const result = { stats: { sigmaPerTournamentAnalytic: 38.4187, sigmaPerTournamentEmpirical: 38.99,
      minBankrollRoR1pct: 11.01, minBankrollRoR5pct: 11.01 } } as SimulationResult;
    expect(summarizePdStats(result)).toMatchObject({ sigmaPerTourneyMath: 38.42, sigmaPerTourneyEmpirical: 38.99,
      minBankrollRoR1pct: 11.01, minBankrollRoR5pct: 11.01 });
  });
});

describe("which pass the PrimeDope dump calls PrimeDope", () => {
  const input = {
    schedule: [{ id: "r", players: 500, buyIn: 10, rake: 0.1, roi: 0.2,
      payoutStructure: "mtt-standard" as const, count: 200 }],
    samples: 300, scheduleRepeats: 1, seed: 42, bankroll: 0, finishModel: { id: "power-law" as const },
  };
  const ours = runSimulation(input);
  const pd = runSimulation({ ...input, calibrationMode: "primedope-binary-itm" });

  it("finds the PrimeDope pass by its calibration in either pane order", () => {
    expect(pd.stats.itmRate).not.toBe(ours.stats.itmRate);
    const plain = pdDiagnosticPasses(ours, pd);
    expect(plain.pd).toBe(pd);
    expect(plain.ours).toBe(ours);
    // "Like PrimeDope" preset: the primary pass is PrimeDope's.
    const flipped = pdDiagnosticPasses(pd, ours);
    expect(flipped.pd).toBe(pd);
    expect(flipped.ours).toBe(ours);
    expect(pdDiagnosticPasses(ours, null).pd).toBeNull();
  });

  it("names the calibration in every summary", () => {
    expect(summarizePdStats(pd)?.calibrationMode).toBe("primedope-binary-itm");
    expect(summarizePdStats(ours)?.calibrationMode).toBe("alpha");
  });
});
