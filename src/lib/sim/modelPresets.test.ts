import { describe, it, expect } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS } from "@/lib/sim/battleRoyaleLeaderboardUi";
import {
  STANDARD_PRESETS,
  applyModelPatch,
  sanitizeControlsForBasicMode,
} from "./modelPresets";

const baseState: ControlsState = {
  scheduleRepeats: 100,
  samples: 10_000,
  bankroll: 0,
  seed: 1,
  finishModelId: "power-law",
  alphaOverride: null,
  usePrimedopePayouts: false,
  usePrimedopeFinishModel: false,
  usePrimedopeRakeMath: false,
  compareEnabled: false,
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

describe("sanitizeControlsForBasicMode", () => {
  it("strips variance-profile noise from custom/basic runs", () => {
    const next = sanitizeControlsForBasicMode({
      ...baseState,
      modelPresetId: "custom",
      roiStdErr: 0.07,
      roiShockPerTourney: 0.11,
      roiShockPerSession: 0.09,
      roiDriftSigma: 0.03,
      tiltFastGain: -0.25,
      tiltFastScale: 1400,
      tiltSlowGain: 0.05,
      tiltSlowThreshold: 4500,
    });
    expect(next.modelPresetId).toBe("custom");
    expect(next.finishModelId).toBe(baseState.finishModelId);
    expect(next.roiStdErr).toBe(0);
    expect(next.roiShockPerTourney).toBe(0);
    expect(next.roiShockPerSession).toBe(0);
    expect(next.roiDriftSigma).toBe(0);
    expect(next.tiltFastGain).toBe(0);
    expect(next.tiltFastScale).toBe(0);
    expect(next.tiltSlowGain).toBe(0);
    expect(next.tiltSlowThreshold).toBe(0);
  });

  it("drops built-in advanced presets back to naive in basic mode", () => {
    const steady = STANDARD_PRESETS.find((preset) => preset.id === "steady-reg");
    expect(steady).toBeTruthy();
    const advanced = applyModelPatch(baseState, steady!.patch, steady!.id);
    const next = sanitizeControlsForBasicMode(advanced);
    expect(next.modelPresetId).toBe("naive");
    expect(next.finishModelId).toBe(
      STANDARD_PRESETS.find((preset) => preset.id === "naive")!.patch.finishModelId,
    );
    expect(next.roiStdErr).toBe(0);
    expect(next.roiShockPerTourney).toBe(0);
    expect(next.tiltSlowGain).toBe(0);
  });
});
