import { describe, it, expect } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS } from "@/lib/sim/battleRoyaleLeaderboardUi";
import { SCENARIOS } from "@/lib/scenarios";
import { DICT } from "@/lib/i18n/dict";
import { decodeState, encodeState, PERSISTED_STATE_VERSION, type PersistedState } from "@/lib/persistence";
import {
  BASIC_MODE_MAX_SAMPLES,
  ROI_STD_ERR_MAX,
  STANDARD_PRESETS,
  applyModelPatch,
  sanitizeControlsForBasicMode,
  withSupportedAlpha,
} from "./modelPresets";
import { tiltChannelsActive } from "./convergencePolicy";

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
    expect(next.roiStdErr).toBe(0);
    expect(next.roiShockPerTourney).toBe(0);
    expect(next.roiShockPerSession).toBe(0);
    expect(next.roiDriftSigma).toBe(0);
    expect(next.tiltFastGain).toBe(0);
    expect(next.tiltFastScale).toBe(0);
    expect(next.tiltSlowGain).toBe(0);
    expect(next.tiltSlowThreshold).toBe(0);
  });

  it("does not honour a hand-picked finish model that basic mode cannot show or change", () => {
    const naive = STANDARD_PRESETS.find((preset) => preset.id === "naive")!.patch;
    for (const finishModelId of ["uniform", "empirical", "power-law", "pko-realdata-tilt"] as const) {
      const next = sanitizeControlsForBasicMode({
        ...baseState,
        modelPresetId: "custom",
        finishModelId,
        alphaOverride: finishModelId === "pko-realdata-tilt" ? 0.2 : null,
        usePrimedopePayouts: false,
        usePrimedopeFinishModel: false,
        usePrimedopeRakeMath: false,
      });
      expect(next.modelPresetId, finishModelId).toBe("naive");
      expect(next.finishModelId, finishModelId).toBe(naive.finishModelId);
      expect(next.alphaOverride, finishModelId).toBeNull();
      expect(next.usePrimedopePayouts, finishModelId).toBe(naive.usePrimedopePayouts);
      expect(next.usePrimedopeFinishModel, finishModelId).toBe(naive.usePrimedopeFinishModel);
      expect(next.usePrimedopeRakeMath, finishModelId).toBe(naive.usePrimedopeRakeMath);
    }
  });

  it("leaves the stored state alone", () => {
    const stored = { ...baseState, modelPresetId: "custom", finishModelId: "uniform" as const };
    sanitizeControlsForBasicMode(stored);
    expect(stored.modelPresetId).toBe("custom");
    expect(stored.finishModelId).toBe("uniform");
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

describe("sanitizeControlsForBasicMode and the hidden simulation count", () => {
  it("caps a stored count that basic mode has no field to lower", () => {
    const next = sanitizeControlsForBasicMode({ ...baseState, samples: 1_000_000 });
    expect(next.samples).toBe(BASIC_MODE_MAX_SAMPLES);
  });

  it("keeps a count at or under the cap, so a lighter run stays lighter", () => {
    for (const samples of [100, 2_000, BASIC_MODE_MAX_SAMPLES]) {
      expect(sanitizeControlsForBasicMode({ ...baseState, samples }).samples).toBe(samples);
    }
  });

  it("covers every demo scenario, which basic users can load", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.controls.samples, scenario.id).toBeLessThanOrEqual(BASIC_MODE_MAX_SAMPLES);
    }
  });
});

describe("withSupportedAlpha", () => {
  it("drops a hand-set alpha that the model ignores", () => {
    const next = withSupportedAlpha({ ...baseState, finishModelId: "power-law", alphaOverride: 3 });
    expect(next.alphaOverride).toBeNull();
    expect(next.finishModelId).toBe("power-law");
  });

  it("keeps the alpha of a real-data tilt model", () => {
    const state = { ...baseState, finishModelId: "pko-realdata-tilt" as const, alphaOverride: 0.2 };
    expect(withSupportedAlpha(state)).toBe(state);
  });

  it("hands back the same object when there is nothing to drop", () => {
    expect(withSupportedAlpha(baseState)).toBe(baseState);
  });
});


describe("ROI uncertainty bound", () => {
  const roiStdErrAfterDecode = (roiStdErr: number) =>
    decodeState(
      encodeState({
        v: PERSISTED_STATE_VERSION,
        schedule: [{ id: "r", label: "r", players: 500, buyIn: 10, rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", count: 1 }],
        controls: { roiStdErr },
      } as unknown as PersistedState),
    )?.controls.roiStdErr;

  it("a saved state or link above the field's bound loads at the bound", () => {
    expect(roiStdErrAfterDecode(5)).toBe(ROI_STD_ERR_MAX);
    expect(roiStdErrAfterDecode(ROI_STD_ERR_MAX + 0.01)).toBe(ROI_STD_ERR_MAX);
    expect(roiStdErrAfterDecode(0.05)).toBe(0.05);
  });

  it("every preset sits inside it", () => {
    for (const preset of STANDARD_PRESETS) {
      expect(preset.patch.roiStdErr, preset.id).toBeLessThanOrEqual(ROI_STD_ERR_MAX);
    }
  });
});

describe("tilt presets say what the hot loop does", () => {
  const patch = (id: string) => STANDARD_PRESETS.find((p) => p.id === id)!.patch;
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

  it("realistic-solo names its fast-tilt size and dollar scale instead of calling it mild", () => {
    const solo = patch("realistic-solo");
    const tagline = DICT["preset.realisticSolo.tagline"];
    expect(tagline.en).toContain(`${Math.round(-solo.tiltFastGain * 100)} pp`);
    expect(tagline.en).toContain(usd(solo.tiltFastScale));
    expect(tagline.en).not.toMatch(/mild/i);
    expect(tagline.ru).not.toMatch(/мягк/i);
  });

  it("steady-reg says the slow tilt also lifts ROI on an upswing", () => {
    const steady = patch("steady-reg");
    const tagline = DICT["preset.steadyReg.tagline"].en;
    expect(tagline).toContain(usd(steady.tiltSlowThreshold));
    expect(tagline).toContain(`${steady.tiltSlowMinDuration} tournaments`);
    expect(tagline).toContain(`rises by ${Math.round(steady.tiltSlowGain * 100)} pp`);
    expect(tagline).not.toMatch(/only appears/);
  });

  it("both session-noise presets say a session is one pass", () => {
    for (const key of ["preset.realisticSolo.tagline", "preset.steadyReg.tagline"] as const) {
      expect(DICT[key].en).toContain("A session is one pass of the schedule");
    }
  });

  it("tiltChannelsActive follows the hot loop's gates", () => {
    const off = { tiltFastGain: 0, tiltSlowGain: 0, tiltSlowThreshold: 0, tiltSlowMinDuration: 500 };
    expect(tiltChannelsActive(off)).toBe(false);
    expect(tiltChannelsActive(patch("realistic-solo"))).toBe(true);
    expect(tiltChannelsActive(patch("steady-reg"))).toBe(true);
    expect(tiltChannelsActive(patch("naive"))).toBe(false);
    expect(tiltChannelsActive({ ...off, tiltSlowGain: 0.05 })).toBe(false);
    expect(tiltChannelsActive({ ...off, tiltSlowGain: 0.05, tiltSlowThreshold: 100, tiltSlowMinDuration: 0.5 })).toBe(false);
    // An unset streak length is the engine's 500, as noiseChannelsActive reads it.
    expect(tiltChannelsActive({ tiltSlowGain: 0.05, tiltSlowThreshold: 100 })).toBe(true);
  });
});
