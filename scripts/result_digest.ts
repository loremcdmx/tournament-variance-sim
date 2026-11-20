/**
 * Digest of the whole `SimulationResult` over a matrix of inputs: the proof
 * that a change which should not move a number did not. The test suite
 * compares runs with each other, so a statistic that moves for every seed
 * passes it; this script compares two builds.
 *
 *   npx tsx scripts/result_digest.ts > before.txt   # on the base commit
 *   npx tsx scripts/result_digest.ts > after.txt    # on the change
 *   cmp before.txt after.txt
 *
 * One line per case: name, digest of the whole result, then a digest per
 * top-level field and per stat, so a difference names the field that moved.
 * Typed arrays are hashed by their bytes and numbers keep -0, NaN and both
 * infinities apart. Shards are run uneven and in reverse order.
 */
import { createHash } from "node:crypto";

import {
  buildResult,
  compileSchedule,
  makeCheckpointGrid,
  mergeShards,
  runSimulation,
  simulateShard,
} from "../src/lib/sim/engine";
import { battleRoyaleRowFromTotalTicket } from "../src/lib/sim/battleRoyaleTicket";
import { DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION } from "../src/lib/sim/gameType";
import { applyItmTarget } from "../src/lib/sim/itmTarget";
import type {
  CalibrationMode,
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "../src/lib/sim/types";
import { SCENARIOS } from "../src/lib/scenarios";
import { buildSimulationInput } from "../src/lib/ui/simulationInput";

function digest(value: unknown): string {
  const hash = createHash("sha1");
  const walk = (x: unknown): void => {
    if (x === null) return void hash.update("null;");
    if (x === undefined) return void hash.update("undef;");
    if (typeof x === "number") {
      return void hash.update(`n:${Object.is(x, -0) ? "-0" : String(x)};`);
    }
    if (typeof x === "string" || typeof x === "boolean") {
      return void hash.update(`${typeof x}:${x};`);
    }
    if (ArrayBuffer.isView(x)) {
      hash.update(`${x.constructor.name}:${x.byteLength}:`);
      hash.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      return void hash.update(";");
    }
    if (Array.isArray(x)) {
      hash.update(`[${x.length}:`);
      for (const item of x) walk(item);
      return void hash.update("]");
    }
    if (typeof x === "object") {
      hash.update("{");
      for (const key of Object.keys(x).sort()) {
        hash.update(`${key}=`);
        walk((x as Record<string, unknown>)[key]);
      }
      return void hash.update("}");
    }
    hash.update(`?:${String(x)};`);
  };
  walk(value);
  return hash.digest("hex").slice(0, 16);
}

function fieldDigests(record: object, width: number): string {
  return Object.entries(record)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${digest(value).slice(0, width)}`)
    .join(" ");
}

function report(name: string, result: SimulationResult): void {
  console.log(
    `${name}\t${digest(result)}\t${fieldDigests(result, 8)}\t${fieldDigests(result.stats, 6)}`,
  );
}

function runSharded(input: SimulationInput, cuts: number[]): SimulationResult {
  const mode: CalibrationMode = input.calibrationMode ?? "alpha";
  const compiled = compileSchedule(input, mode);
  const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
  const samples = input.samples;
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < samples), samples];
  const shards = [];
  for (let i = bounds.length - 2; i >= 0; i--) {
    shards.push(simulateShard(input, compiled, bounds[i], bounds[i + 1], grid));
  }
  const merged = mergeShards(shards, samples, grid.K + 1, input.schedule.length);
  return buildResult(input, compiled, merged, mode, grid);
}

function row(id: string, extra: Partial<TournamentRow>): TournamentRow {
  return {
    id,
    players: 1000,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    count: 1,
    ...extra,
  };
}

const NO_ITM_TARGET = { enabled: false, pct: 15 };

for (const scenario of SCENARIOS) {
  const schedule = applyItmTarget(scenario.schedule, {
    enabled: scenario.controls.itmGlobalEnabled,
    pct: scenario.controls.itmGlobalPct,
  });
  const controls = {
    ...scenario.controls,
    samples: 1200,
    scheduleRepeats: Math.min(scenario.controls.scheduleRepeats, 12),
    bankroll: 500,
  };
  for (const advanced of [false, true]) {
    const input = buildSimulationInput(schedule, controls, advanced);
    report(`scenario:${scenario.id}:advanced=${advanced}`, runSharded(input, [100, 777]));
    if (!advanced) continue;
    report(
      `scenario:${scenario.id}:primedope`,
      runSimulation({ ...input, calibrationMode: "primedope-binary-itm" }),
    );
    const noise: SimulationInput = {
      ...input,
      roiStdErr: 0.05,
      roiShockPerTourney: 0.02,
      roiShockPerSession: 0.03,
      roiDriftSigma: 0.02,
      tiltFastGain: 0.03,
      tiltFastScale: 500,
      tiltSlowGain: 0.02,
      tiltSlowThreshold: 300,
      tiltSlowMinDuration: 20,
      tiltSlowRecoveryFrac: 0.5,
      rakebackFracOfRake: 0.3,
      collectDownsideReport: true,
    };
    report(`scenario:${scenario.id}:noise`, runSharded(noise, [333]));
    // The app sends tilt windows; an engine API caller that leaves them out
    // gets the extremes of the whole sample, a path of its own.
    report(
      `scenario:${scenario.id}:noise-all-time`,
      runSharded({ ...noise, tiltFastWindow: undefined, tiltSlowWindow: undefined }, [333]),
    );
  }
}

const FORMATS: Record<string, Partial<TournamentRow>> = {
  freeze: {},
  headsUp: { players: 2, payoutStructure: "winner-takes-all" },
  pko: {
    players: 3000,
    payoutStructure: "mtt-gg-bounty",
    bountyFraction: 0.5,
    gameType: "pko",
    pkoHeat: 0.35,
  },
  mystery: {
    players: 2000,
    payoutStructure: "mtt-gg-bounty",
    bountyFraction: 0.5,
    mysteryBountyVariance: 2.0,
    gameType: "mystery",
  },
  range: {
    players: 600,
    fieldVariability: { kind: "uniform", min: 200, max: 1000, buckets: 5 },
  },
  satellite: { players: 200, payoutStructure: "satellite-ticket" },
};

// Schedule lengths on both sides of the checkpoint grid (240) and the hi-res
// grid (4000); sample counts down to one.
for (const [name, extra] of Object.entries(FORMATS)) {
  for (const tournaments of [1, 2, 5, 239, 240, 241, 997, 4001, 6000]) {
    for (const samples of tournaments > 1000 ? [300] : [1, 2, 3, 257, 1500]) {
      const input: SimulationInput = {
        schedule: applyItmTarget([row(name, extra)], NO_ITM_TARGET),
        scheduleRepeats: tournaments,
        samples,
        bankroll: name === "headsUp" ? 55 : 300,
        seed: 7 + tournaments,
        finishModel: { id: "power-law" },
      };
      const label = `${name}:tournaments=${tournaments}:samples=${samples}`;
      try {
        report(
          label,
          runSharded(input, [1, Math.floor(samples / 3), Math.floor(samples / 2) + 1]),
        );
      } catch (error) {
        console.log(`${label}\tERROR ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// Whole buy-ins at zero rake: exact ties at the old peak and at break-even.
report(
  "lattice",
  runSharded(
    {
      schedule: [
        row("lattice", { players: 2, rake: 0, roi: 0, payoutStructure: "winner-takes-all" }),
      ],
      scheduleRepeats: 500,
      samples: 3000,
      bankroll: 100,
      seed: 3,
      finishModel: { id: "power-law" },
    },
    [1000, 2000],
  ),
);

// Above the envelope subsample cap (200 000 samples).
report(
  "aboveEnvelopeCap",
  runSharded(
    {
      schedule: applyItmTarget([row("cap", { players: 100 })], NO_ITM_TARGET),
      scheduleRepeats: 12,
      samples: 200_500,
      bankroll: 100,
      seed: 5,
      finishModel: { id: "power-law" },
    },
    [50_000, 150_001],
  ),
);

report(
  "mixed20k",
  runSharded(
    {
      schedule: applyItmTarget(
        [
          row("mixed-freeze", {}),
          row("mixed-pko", {
            players: 3000,
            buyIn: 55,
            payoutStructure: "mtt-gg-bounty",
            bountyFraction: 0.5,
            gameType: "pko",
          }),
        ],
        NO_ITM_TARGET,
      ),
      scheduleRepeats: 400,
      samples: 20_000,
      bankroll: 1000,
      seed: 9,
      finishModel: { id: "power-law" },
    },
    [3000, 9000, 15_000],
  ),
);

// PKO fields under 45 play the elimination tree with their over-spread places
// shrunk (2nd in fields of 4 to 44, 3rd in 5 to 10), which no PKO row above
// (1,200 to 3,000 players) reaches; the range crosses that edge (33 to 57 entrants).
// Ranged Mystery and Battle Royale rows go through the engine's own
// normalization, which drops the Battle Royale range.
const PKO: Partial<TournamentRow> = {
  payoutStructure: "mtt-gg-bounty",
  bountyFraction: 0.5,
  gameType: "pko",
};
const SMALL_FIELD_BOUNTY: Record<string, Partial<TournamentRow>> = {
  ...Object.fromEntries([4, 6, 9, 18, 44, 45].map((players) => [`pko${players}`, { ...PKO, players }])),
  pkoRange: {
    ...PKO,
    players: 45,
    fieldVariability: { kind: "uniform", min: 30, max: 60, buckets: 5 },
  },
  mysteryRange: {
    players: 300,
    payoutStructure: "mtt-gg-mystery",
    bountyFraction: 0.5,
    mysteryBountyVariance: 2.0,
    gameType: "mystery",
    fieldVariability: { kind: "uniform", min: 100, max: 500, buckets: 4 },
  },
  battleRoyaleRange: {
    ...battleRoyaleRowFromTotalTicket(10),
    players: 18,
    payoutStructure: "battle-royale",
    bountyFraction: DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
    mysteryBountyVariance: 1.8,
    gameType: "mystery-royale",
    roi: 0.03,
    itmRate: 0.18,
    fieldVariability: { kind: "uniform", min: 12, max: 24, buckets: 3 },
  },
};
for (const [name, extra] of Object.entries(SMALL_FIELD_BOUNTY)) {
  for (const calibrationMode of ["alpha", "primedope-binary-itm"] as const) {
    const label = `bounty:${name}:${calibrationMode}`;
    try {
      report(
        label,
        runSharded(
          {
            schedule: applyItmTarget([row(name, extra)], NO_ITM_TARGET),
            scheduleRepeats: 300,
            samples: 1500,
            bankroll: 300,
            seed: 11,
            finishModel: { id: "power-law" },
            calibrationMode,
          },
          [1, 500, 751],
        ),
      );
    } catch (error) {
      console.log(`${label}\tERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
