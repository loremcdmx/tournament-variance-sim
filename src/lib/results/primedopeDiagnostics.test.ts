import { describe, expect, it } from "vitest";
import type { SimulationResult } from "@/lib/sim/types";
import { relativeDifferencePct, summarizePdStats } from "./primedopeDiagnostics";

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
