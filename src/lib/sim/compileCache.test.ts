import { describe, expect, it, vi } from "vitest";
import { compileSchedule } from "./compile";
import { createCompileCache } from "./compileCache";
import { buildResult, makeCheckpointGrid, mergeShards, simulateShard } from "./engine";
import type { CalibrationMode, SimulationInput, TournamentRow } from "./types";

const base: TournamentRow = {
  id: "base",
  players: 200,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 4,
};

const schedule: TournamentRow[] = [
  { ...base, id: "ranged", fieldVariability: { kind: "uniform", min: 100, max: 400, buckets: 3 } },
  {
    ...base,
    id: "pko",
    payoutStructure: "mtt-gg-bounty",
    gameType: "pko",
    bountyFraction: 0.5,
    pkoHeadVar: 0.4,
    pkoHeat: 1,
    count: 3,
  },
  {
    ...base,
    id: "mystery",
    payoutStructure: "mtt-gg-mystery",
    gameType: "mystery",
    bountyFraction: 0.5,
    mysteryBountyVariance: 2,
    count: 2,
  },
  { ...base, id: "ocean", payoutStructure: "mtt-gg-bounty", gameType: "ocean-ko", buyIn: 18, rake: 0.08, count: 2 },
  { ...base, id: "br", players: 18, buyIn: 10, rake: 0.08, payoutStructure: "battle-royale", gameType: "mystery-royale", bountyFraction: 0.45, mysteryBountyVariance: 1.8, itmRate: 0.18, count: 5 },
];

function input(over: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule,
    scheduleRepeats: 2,
    samples: 240,
    bankroll: 0,
    seed: 11,
    finishModel: { id: "power-law" },
    ...over,
  };
}

describe("createCompileCache", () => {
  const fakeCompile = () => vi.fn((i: SimulationInput) => ({ tag: i.seed }) as never);

  it("compiles once for the same input and mode", () => {
    const compile = fakeCompile();
    const cache = createCompileCache(compile);
    const a = cache.get(input(), "alpha");
    const b = cache.get(input(), "alpha");
    expect(compile).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("compiles again when anything the compile could read differs", () => {
    const compile = fakeCompile();
    const cache = createCompileCache(compile);
    cache.get(input(), "alpha");
    cache.get(input({ seed: 12 }), "alpha");
    cache.get(input({ seed: 12 }), "primedope-binary-itm" as CalibrationMode);
    cache.get(input({ seed: 12, finishModel: { id: "linear-skill" } }), "primedope-binary-itm" as CalibrationMode);
    cache.get(
      input({ seed: 12, schedule: [{ ...schedule[0], roi: 0.11 }], finishModel: { id: "linear-skill" } }),
      "primedope-binary-itm" as CalibrationMode,
    );
    expect(compile).toHaveBeenCalledTimes(5);
  });

  it("tells a non-finite number from the null JSON would make of it", () => {
    const compile = fakeCompile();
    const cache = createCompileCache(compile);
    const withGuarantee = (guarantee: number | null) =>
      input({ schedule: [{ ...base, guarantee: guarantee as number }] });
    cache.get(withGuarantee(Infinity), "alpha");
    cache.get(withGuarantee(null), "alpha");
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("holds one entry and lets go of it on clear", () => {
    const compile = fakeCompile();
    const cache = createCompileCache(compile);
    cache.get(input({ seed: 1 }), "alpha");
    cache.get(input({ seed: 2 }), "alpha");
    cache.get(input({ seed: 1 }), "alpha");
    expect(compile).toHaveBeenCalledTimes(3);
    cache.clear();
    cache.get(input({ seed: 1 }), "alpha");
    expect(compile).toHaveBeenCalledTimes(4);
  });

  it("keeps nothing when the compile throws", () => {
    const compile = vi.fn((): never => {
      throw new Error("bad row");
    });
    const cache = createCompileCache(compile);
    expect(() => cache.get(input(), "alpha")).toThrow("bad row");
    expect(() => cache.get(input(), "alpha")).toThrow("bad row");
    expect(compile).toHaveBeenCalledTimes(2);
  });
});

describe("a compiled schedule shared between shards and the build", () => {
  const args = input();
  const grid = (n: number) => makeCheckpointGrid(n);

  it("gives the same shards as a fresh compile for each request", () => {
    const shared = compileSchedule(args, "alpha");
    const g = grid(shared.tournamentsPerSample);
    const ranges: Array<[number, number]> = [[0, 100], [100, 240], [0, 100]];
    for (const [sStart, sEnd] of ranges) {
      const fresh = compileSchedule(args, "alpha");
      expect(simulateShard(args, shared, sStart, sEnd, g)).toEqual(
        simulateShard(args, fresh, sStart, sEnd, grid(fresh.tournamentsPerSample)),
      );
    }
  });

  it("builds the same result from a compile that already served the shards", () => {
    const shared = compileSchedule(args, "alpha");
    const g = grid(shared.tournamentsPerSample);
    const K1 = g.K + 1;
    const shards = [simulateShard(args, shared, 0, 120, g), simulateShard(args, shared, 120, 240, g)];
    const built = buildResult(args, shared, mergeShards(shards, 240, K1, schedule.length), "alpha", g);

    const fresh = compileSchedule(args, "alpha");
    const g2 = grid(fresh.tournamentsPerSample);
    const freshShards = [simulateShard(args, fresh, 0, 120, g2), simulateShard(args, fresh, 120, 240, g2)];
    const rebuilt = buildResult(args, fresh, mergeShards(freshShards, 240, K1, schedule.length), "alpha", g2);
    expect(built).toEqual(rebuilt);

    const again = buildResult(args, shared, mergeShards(shards, 240, K1, schedule.length), "alpha", g);
    expect(again).toEqual(built);
  });
});
