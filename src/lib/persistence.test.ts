import { describe, expect, it, vi } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "./sim/types";
import {
  decodeState,
  encodeState,
  isValidUserPreset,
  loadLocal,
  loadUserPresets,
  saveUserPresets,
  type PersistedState,
  type UserPreset,
} from "./persistence";

const row: TournamentRow = {
  id: "r1",
  players: 500,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
};

const controls = {} as ControlsState;

function encoded(payload: unknown): string {
  return encodeState(payload as PersistedState);
}

describe("persistence validation", () => {
  it("decodes valid persisted state", () => {
    const state = decodeState(encoded({ v: 1, schedule: [row], controls }));

    expect(state?.schedule).toHaveLength(1);
    expect(state?.controls).toBeTruthy();
  });

  it("rejects malformed share state instead of returning a crashy shape", () => {
    expect(decodeState(encoded({ v: 1, schedule: null, controls: {} }))).toBeNull();
    expect(decodeState(encoded({ v: 1, schedule: [null], controls: {} }))).toBeNull();
    expect(decodeState(encoded({ v: 1, schedule: [row], controls: null }))).toBeNull();
  });

  it("clamps oversized persisted row counts back to the editor max", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [{ ...row, count: 1_000_000_000 }],
        controls: { ...controls, samples: 1_000_000_000 },
      }),
    );

    expect(state?.schedule[0]?.count).toBe(100_000);
    expect(state?.controls.samples).toBe(1_000_000);
  });

  it("clamps oversized persisted field sizes back to the editor max", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [{ ...row, players: 20_000_000 }],
        controls,
      }),
    );

    expect(state?.schedule[0]?.players).toBe(1_000_000);
  });

  it("clamps persisted rake back into the engine's [0,1] contract", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "high", rake: 100 },
          { ...row, id: "low", rake: -5 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.rake).toBe(1);
    expect(state?.schedule[1]?.rake).toBe(0);
  });

  it("clamps persisted ROI back into the editor range to avoid infinite EV targets", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "hi", roi: 1e308 },
          { ...row, id: "lo", roi: -5 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.roi).toBe(100);
    expect(state?.schedule[1]?.roi).toBe(-0.99);
  });

  it("raises non-positive persisted buy-ins to a minimal positive ticket", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "neg", buyIn: -5 },
          { ...row, id: "zero", buyIn: 0 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.buyIn).toBe(0.01);
    expect(state?.schedule[1]?.buyIn).toBe(0.01);
  });

  it("drops malformed persisted custom payout arrays instead of keeping a fake zero-payout custom row", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            payoutStructure: "custom",
            customPayouts: ["oops"],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-standard");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("promotes legacy Battle Royale payout rows to canonical 18-max Mystery Royale", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 500,
            payoutStructure: "battle-royale",
            gameType: "oops",
            fieldVariability: { kind: "uniform", min: 100, max: 900, buckets: 5 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.gameType).toBe("mystery-royale");
    expect(state?.schedule[0]?.payoutStructure).toBe("battle-royale");
    expect(state?.schedule[0]?.players).toBe(18);
    expect(state?.schedule[0]?.fieldVariability).toBeUndefined();
  });

  it("repairs invalid persisted payoutStructure from a valid explicit gameType", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "mystery",
            payoutStructure: "oops",
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.gameType).toBe("mystery");
    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-gg-mystery");
  });

  it("repairs persisted Battle Royale split-brain before hydration", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "mystery",
            payoutStructure: "battle-royale",
          },
          {
            ...row,
            id: "br",
            players: 36,
            gameType: "mystery-royale",
            payoutStructure: "mtt-standard",
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "mystery",
      payoutStructure: "mtt-gg-mystery",
      players: 500,
    });
    expect(state?.schedule[1]).toMatchObject({
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      players: 18,
    });
  });

  it("drops zero-sum persisted custom payout arrays instead of simulating a no-prize tournament", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            payoutStructure: "custom",
            customPayouts: [0, 0, 0],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-standard");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("trims persisted legacy custom payout tails that exceed the field size", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 3,
            payoutStructure: "custom",
            customPayouts: [50, 30, 20, 10],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.customPayouts).toEqual([50, 30, 20]);
  });

  it("drops hidden custom payout arrays on non-custom rows before they can skew paid-place logic", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 100,
            payoutStructure: "mtt-primedope",
            customPayouts: [50, 30, 20],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-primedope");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("drops hidden bounty and re-entry knobs when persisted gameType is explicit freezeout", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "freezeout",
            maxEntries: 4,
            reentryRate: 0.75,
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            pkoHeadVar: 0.4,
            pkoHeat: 1.2,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "freezeout",
      maxEntries: 1,
      reentryRate: undefined,
      bountyFraction: undefined,
      mysteryBountyVariance: undefined,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("restores required engine knobs for persisted explicit non-freezeout game types", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            id: "re",
            gameType: "freezeout-reentry",
          },
          {
            ...row,
            id: "pko",
            gameType: "pko",
          },
          {
            ...row,
            id: "mystery",
            gameType: "mystery",
            pkoHeadVar: 0.9,
            pkoHeat: 1.1,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "freezeout-reentry",
      maxEntries: 2,
      reentryRate: 1,
      bountyFraction: undefined,
    });
    expect(state?.schedule[1]).toMatchObject({
      gameType: "pko",
      maxEntries: 1,
      reentryRate: undefined,
      bountyFraction: 0.5,
      pkoHeadVar: 0.4,
    });
    expect(state?.schedule[2]).toMatchObject({
      gameType: "mystery",
      maxEntries: 1,
      reentryRate: undefined,
      bountyFraction: 0.5,
      mysteryBountyVariance: 2,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("migrates legacy Battle Royale default bounty share from 50% to 45%", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            players: 18,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      bountyFraction: 0.45,
    });
  });

  it("clamps persisted row knobs back into the engine/UI contract before hydration", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            itmRate: 5,
            bountyFraction: 5,
            payJumpAggression: -1,
            mysteryBountyVariance: -3,
            pkoHeadVar: -4,
            pkoHeat: 10,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      itmRate: 1,
      bountyFraction: 0.9,
      payJumpAggression: 0,
      mysteryBountyVariance: 0,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("drops non-boolean persisted sit-through flags so string values cannot silently enable the transform", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            sitThroughPayJumps: "false",
            payJumpAggression: 0.8,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.sitThroughPayJumps).toBeUndefined();
    expect(state?.schedule[0]?.payJumpAggression).toBe(0.8);
  });

  it("preserves persisted re-entry row knobs when they are still valid product inputs", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "freezeout-reentry",
            maxEntries: 4,
            reentryRate: 0.75,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.gameType).toBe("freezeout-reentry");
    expect(state?.schedule[0]?.maxEntries).toBe(4);
    expect(state?.schedule[0]?.reentryRate).toBe(0.75);
  });

  it("drops hidden persisted row knobs that are no longer user-visible", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 500,
            guarantee: 1_000_000,
            lateRegMultiplier: 1_000_000_000,
            maxEntries: 0,
            reentryRate: 5,
            bountyFraction: 0.5,
            bountyEvBias: 999,
            itmRate: 0.18,
            itmTopHeavyBias: -999,
            pkoHeadVar: 9,
            pkoHeat: 9,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      lateRegMultiplier: undefined,
      guarantee: undefined,
      maxEntries: 1,
      reentryRate: 1,
      bountyEvBias: 0.25,
      itmTopHeavyBias: -1,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("drops malformed persisted finish-bucket locks instead of hydrating impossible shell constraints", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            itmRate: 0.16,
            finishBuckets: { first: 5, top3: 0.1 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.finishBuckets).toBeUndefined();
  });

  it("drops stale persisted finish-bucket locks when itmRate is absent", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            finishBuckets: { first: 0.01 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.finishBuckets).toBeUndefined();
  });

  it("clamps persisted field-variability ranges and bucket counts back to editor limits", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            fieldVariability: {
              kind: "uniform",
              min: 100,
              max: 20_000_000,
              buckets: 200,
            },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.fieldVariability).toEqual({
      kind: "uniform",
      min: 100,
      max: 1_000_000,
      buckets: 20,
    });
  });

  it("drops malformed persisted field-variability objects before they reach engine compile", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            fieldVariability: { kind: "uniform", min: "oops", max: 5000 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.fieldVariability).toBeUndefined();
  });

  it("drops non-numeric persisted run controls so defaults can win on hydration", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: { samples: "oops", scheduleRepeats: "bad", bankroll: 500 },
    });

    expect((state?.controls as unknown as Record<string, unknown>).samples).toBeUndefined();
    expect((state?.controls as unknown as Record<string, unknown>).scheduleRepeats).toBeUndefined();
    expect(state?.controls.bankroll).toBe(500);
  });

  it("drops malformed persisted control enums and strings before they can crash the UI", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        finishModelId: "oops",
        compareMode: "oops",
        alphaOverride: "oops",
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.finishModelId).toBeUndefined();
    expect(loaded.compareMode).toBeUndefined();
    expect(loaded.alphaOverride).toBeUndefined();
  });

  it("drops malformed persisted empirical buckets and non-boolean flags", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        finishModelId: "empirical",
        empiricalBuckets: ["oops"],
        compareWithPrimedope: "yes",
        usePrimedopePayouts: 1,
        usePrimedopeFinishModel: "true",
        usePrimedopeRakeMath: "true",
        itmGlobalEnabled: "true",
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.empiricalBuckets).toBeUndefined();
    expect(loaded.compareWithPrimedope).toBeUndefined();
    expect(loaded.usePrimedopePayouts).toBeUndefined();
    expect(loaded.usePrimedopeFinishModel).toBeUndefined();
    expect(loaded.usePrimedopeRakeMath).toBeUndefined();
    expect(loaded.itmGlobalEnabled).toBeUndefined();
  });

  it("normalizes persisted observed BR leaderboard controls", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        battleRoyaleLeaderboard: {
          mode: "observed",
          observedTotalPrizes: -100,
          observedTotalTournaments: 1234.9,
          observedPointsByStake: {
            "0.25": -1,
            "1": 80,
            "3": "bad",
            "10": 120,
            "25": null,
          },
        },
      },
    });

    expect(state?.controls.battleRoyaleLeaderboard).toMatchObject({
      mode: "observed",
      observedTotalPrizes: 0,
      observedTotalTournaments: 1234,
      observedPointsByStake: {
        "0.25": 0,
        "1": 80,
        "3": 0,
        "10": 120,
        "25": 0,
      },
    });
  });

  it("drops persisted BR row leaderboard split on all rows", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [
        {
          ...row,
          id: "br-row",
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          battleRoyaleLeaderboardEnabled: true,
          battleRoyaleLeaderboardShare: 2,
        },
        {
          ...row,
          id: "freeze-row",
          battleRoyaleLeaderboardEnabled: true,
          battleRoyaleLeaderboardShare: 0.5,
        },
      ],
      controls: {},
    });

    expect(state?.schedule[0].battleRoyaleLeaderboardEnabled).toBeUndefined();
    expect(state?.schedule[0].battleRoyaleLeaderboardShare).toBeUndefined();
    expect(state?.schedule[1].battleRoyaleLeaderboardEnabled).toBeUndefined();
    expect(state?.schedule[1].battleRoyaleLeaderboardShare).toBeUndefined();
  });

  it("drops hidden persisted shock and tilt knobs so invisible state cannot silently alter runs", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        roiShockPerTourney: 0.25,
        roiShockPerSession: 0.5,
        roiDriftSigma: 0.1,
        tiltFastGain: 0.8,
        tiltFastScale: 100,
        tiltSlowGain: 0.5,
        tiltSlowThreshold: 200,
        tiltSlowMinDuration: 20,
        tiltSlowRecoveryFrac: 0.75,
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.roiShockPerTourney).toBeUndefined();
    expect(loaded.roiShockPerSession).toBeUndefined();
    expect(loaded.roiDriftSigma).toBeUndefined();
    expect(loaded.tiltFastGain).toBeUndefined();
    expect(loaded.tiltFastScale).toBeUndefined();
    expect(loaded.tiltSlowGain).toBeUndefined();
    expect(loaded.tiltSlowThreshold).toBeUndefined();
    expect(loaded.tiltSlowMinDuration).toBeUndefined();
    expect(loaded.tiltSlowRecoveryFrac).toBeUndefined();
  });

  it("ignores malformed localStorage state", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ v: 1, schedule: null, controls: {} }),
    });

    expect(loadLocal()).toBeNull();

    vi.unstubAllGlobals();
  });

  it("filters malformed user presets before they can reach UI state", () => {
    let stored = "";
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });

    const good: UserPreset = {
      id: "good",
      name: "Good",
      createdAt: 1,
      state: { v: 1, schedule: [row], controls },
    };
    const bad = {
      id: "bad",
      name: "Bad",
      createdAt: 2,
      state: { v: 1, schedule: null, controls: {} },
    } as unknown as UserPreset;

    expect(isValidUserPreset(good)).toBe(true);
    expect(isValidUserPreset(bad)).toBe(false);

    saveUserPresets([good, bad]);

    expect(loadUserPresets()).toEqual([good]);

    vi.unstubAllGlobals();
  });

  it("normalizes oversized row counts inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big",
            name: "Big",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [{ ...row, count: 1_000_000_000 }],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.count).toBe(100_000);

    vi.unstubAllGlobals();
  });

  it("normalizes oversized field sizes inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big-field",
            name: "Big field",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [{ ...row, players: 20_000_000 }],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.players).toBe(1_000_000);

    vi.unstubAllGlobals();
  });

  it("normalizes oversized field-variability ranges inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big-range",
            name: "Big range",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [
                {
                  ...row,
                  fieldVariability: {
                    kind: "uniform",
                    min: 100,
                    max: 20_000_000,
                    buckets: 200,
                  },
                },
              ],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.fieldVariability).toEqual({
      kind: "uniform",
      min: 100,
      max: 1_000_000,
      buckets: 20,
    });

    vi.unstubAllGlobals();
  });
});

function loadLocalFromPayload(payload: unknown) {
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify(payload),
  });
  const loaded = loadLocal();
  vi.unstubAllGlobals();
  return loaded;
}
