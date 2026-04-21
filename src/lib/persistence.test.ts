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

  it("clamps persisted row knobs back into the engine/UI contract before hydration", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            itmRate: 5,
            maxEntries: 0,
            reentryRate: 2,
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
      maxEntries: 1,
      reentryRate: 1,
      bountyFraction: 0.9,
      payJumpAggression: 0,
      mysteryBountyVariance: 0,
      pkoHeadVar: 0,
      pkoHeat: 3,
    });
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
