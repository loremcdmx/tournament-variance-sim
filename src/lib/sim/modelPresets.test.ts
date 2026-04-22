import { describe, it, expect, beforeEach } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS } from "@/lib/sim/battleRoyaleLeaderboardUi";
import {
  STANDARD_PRESETS,
  applyModelPatch,
  extractModelPatch,
  parsePresetFile,
  loadUserPresets,
  saveUserPresets,
  addUserPreset,
  deleteUserPreset,
} from "./modelPresets";

const baseState: ControlsState = {
  scheduleRepeats: 100,
  samples: 10_000,
  bankroll: 0,
  seed: 1,
  finishModelId: "power-law",
  alphaOverride: null,
  compareWithPrimedope: false,
  usePrimedopePayouts: false,
  usePrimedopeFinishModel: false,
  usePrimedopeRakeMath: false,
  compareMode: "primedope",
  roiStdErr: 0.02,
  roiShockPerTourney: 0.01,
  roiShockPerSession: 0,
  roiDriftSigma: 0,
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  tiltSlowMinDuration: 500,
  tiltSlowRecoveryFrac: 0.5,
  modelPresetId: "naive",
  empiricalBuckets: undefined,
  itmGlobalEnabled: false,
  itmGlobalPct: 18.7,
  rakebackPct: 5,
  battleRoyaleLeaderboard: DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
};

describe("applyModelPatch", () => {
  it("only overwrites model fields, preserves run controls", () => {
    const patch = STANDARD_PRESETS[0].patch;
    const next = applyModelPatch(baseState, patch, "primedope");
    expect(next.scheduleRepeats).toBe(baseState.scheduleRepeats);
    expect(next.samples).toBe(baseState.samples);
    expect(next.seed).toBe(baseState.seed);
    expect(next.bankroll).toBe(baseState.bankroll);
    expect(next.modelPresetId).toBe("primedope");
    expect(next.finishModelId).toBe(patch.finishModelId);
    expect(next.roiStdErr).toBe(patch.roiStdErr);
  });
});

describe("extractModelPatch", () => {
  it("round-trips through apply", () => {
    const patch = extractModelPatch(baseState);
    const next = applyModelPatch(baseState, patch, "custom");
    expect(extractModelPatch(next)).toEqual(patch);
  });

  it("only captures model fields", () => {
    const patch = extractModelPatch(baseState) as Record<string, unknown>;
    expect(patch).not.toHaveProperty("scheduleRepeats");
    expect(patch).not.toHaveProperty("samples");
    expect(patch).not.toHaveProperty("bankroll");
    expect(patch).not.toHaveProperty("seed");
    expect(patch).not.toHaveProperty("modelPresetId");
  });
});

describe("STANDARD_PRESETS", () => {
  it("all ids are unique", () => {
    const ids = STANDARD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset produces a valid patch shape", () => {
    for (const p of STANDARD_PRESETS) {
      const next = applyModelPatch(baseState, p.patch, p.id);
      expect(typeof next.finishModelId).toBe("string");
      expect(typeof next.roiStdErr).toBe("number");
      expect(Number.isFinite(next.roiStdErr)).toBe(true);
    }
  });
});

describe("parsePresetFile", () => {
  it("rejects malformed JSON", () => {
    expect(parsePresetFile("{not json")).toBeNull();
  });

  it("rejects missing version", () => {
    expect(parsePresetFile(JSON.stringify({ type: "tvs-preset", name: "x", patch: {} }))).toBeNull();
  });

  it("rejects wrong type tag", () => {
    expect(
      parsePresetFile(JSON.stringify({ v: 1, type: "other", name: "x", patch: {} })),
    ).toBeNull();
  });

  it("rejects non-string name", () => {
    expect(
      parsePresetFile(JSON.stringify({ v: 1, type: "tvs-preset", name: 42, patch: {} })),
    ).toBeNull();
  });

  it("rejects missing patch", () => {
    expect(parsePresetFile(JSON.stringify({ v: 1, type: "tvs-preset", name: "x" }))).toBeNull();
  });

  it("accepts a well-formed preset file", () => {
    const data = {
      v: 1,
      type: "tvs-preset",
      name: "My Preset",
      patch: extractModelPatch(baseState),
    };
    const parsed = parsePresetFile(JSON.stringify(data));
    expect(parsed?.name).toBe("My Preset");
    expect(parsed?.patch.finishModelId).toBe(baseState.finishModelId);
  });
});

describe("user-preset localStorage round-trip", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mock = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as unknown as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = mock;
  });

  it("returns [] when storage is empty", () => {
    expect(loadUserPresets()).toEqual([]);
  });

  it("returns [] on malformed JSON", () => {
    localStorage.setItem("tvs.userPresets.v1", "{broken");
    expect(loadUserPresets()).toEqual([]);
  });

  it("returns [] when stored value is not an array", () => {
    localStorage.setItem("tvs.userPresets.v1", JSON.stringify({ not: "an array" }));
    expect(loadUserPresets()).toEqual([]);
  });

  it("drops malformed elements and keeps good ones (element guard)", () => {
    const good = {
      id: "user:abc",
      name: "good",
      createdAt: 1,
      patch: extractModelPatch(baseState),
    };
    const raw = [
      good,
      null,
      42,
      { id: "no-patch", name: "x", createdAt: 1 },
      { id: 0, name: "bad-id", createdAt: 1, patch: extractModelPatch(baseState) },
    ];
    localStorage.setItem("tvs.userPresets.v1", JSON.stringify(raw));
    const list = loadUserPresets();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("user:abc");
  });

  it("addUserPreset persists", () => {
    const p = addUserPreset("first", extractModelPatch(baseState));
    expect(p.id).toMatch(/^user:/);
    const loaded = loadUserPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("first");
  });

  it("addUserPreset produces unique ids even in the same millisecond", () => {
    const a = addUserPreset("a", extractModelPatch(baseState));
    const b = addUserPreset("b", extractModelPatch(baseState));
    expect(a.id).not.toBe(b.id);
  });

  it("deleteUserPreset removes by id", () => {
    const a = addUserPreset("a", extractModelPatch(baseState));
    addUserPreset("b", extractModelPatch(baseState));
    deleteUserPreset(a.id);
    const remaining = loadUserPresets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("b");
  });

  it("saveUserPresets overwrites cleanly", () => {
    addUserPreset("a", extractModelPatch(baseState));
    saveUserPresets([]);
    expect(loadUserPresets()).toEqual([]);
  });
});
