import { describe, expect, it } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "@/lib/sim/types";
import { decodeState, encodeState } from "@/lib/persistence";
import { buildRunShareState, buildRunStatsCsv } from "./runExport";

const row: TournamentRow = {
  id: "r1",
  players: 500,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
};

const controls = { seed: 42, samples: 10_000 } as ControlsState;

describe("buildRunShareState", () => {
  it("pins the displayed run's seed instead of the live controls seed", () => {
    const state = buildRunShareState([row], controls, 777);

    expect(state.controls.seed).toBe(777);
    expect(controls.seed).toBe(42);
  });

  it("survives the share-URL encode/decode round trip", () => {
    const state = buildRunShareState([row], controls, 0xdeadbeef);
    const decoded = decodeState(encodeState(state));

    expect(decoded?.controls.seed).toBe(0xdeadbeef);
    expect(decoded?.schedule[0].buyIn).toBe(50);
  });
});

describe("buildRunStatsCsv", () => {
  it("emits every headline metric in a stable order", () => {
    const csv = buildRunStatsCsv({
      samples: 10_000,
      seed: 7,
      mean: 1234.5678901,
      median: -12,
      p05: -4200,
      p95: 7800,
      stdDev: 3900.5,
      probProfit: 0.6123,
      riskOfRuin: 0.0042,
    });

    expect(csv.split("\n")).toEqual([
      "metric,value",
      "samples,10000",
      "seed,7",
      "mean,1234.56789",
      "median,-12",
      "p05,-4200",
      "p95,7800",
      "stdDev,3900.5",
      "probProfit,0.6123",
      "riskOfRuin,0.0042",
    ]);
  });

  it("leaves risk of ruin blank when ruin was never modelled", () => {
    const csv = buildRunStatsCsv({
      samples: 100,
      seed: 1,
      mean: 0,
      median: 0,
      p05: 0,
      p95: 0,
      stdDev: 0,
      probProfit: 0.5,
      riskOfRuin: null,
    });

    expect(csv).toContain("\nriskOfRuin,");
    expect(csv.endsWith("riskOfRuin,")).toBe(true);
  });
});
