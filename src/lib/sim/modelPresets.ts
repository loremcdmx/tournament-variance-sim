import type { ControlsState } from "@/components/ControlsPanel";
import type { DictKey } from "@/lib/i18n/dict";
import { supportsManualAlpha } from "./finishModel";

/**
 * Model presets — bundled snapshots of the *modelling* knobs only. They
 * never touch run controls (samples, scheduleRepeats, bankroll, seed) and
 * never touch the schedule. Selecting a preset patches the model fields
 * onto the current state; users can then hand-tune (which flips
 * modelPresetId → "custom").
 *
 * Adding a new preset: add it to STANDARD_PRESETS and the corresponding
 * dict keys (preset.<id>.label / preset.<id>.tagline).
 */

export type ModelFieldKey =
  | "finishModelId"
  | "alphaOverride"
  | "usePrimedopePayouts"
  | "usePrimedopeFinishModel"
  | "usePrimedopeRakeMath"
  | "roiStdErr"
  | "roiShockPerTourney"
  | "roiShockPerSession"
  | "roiDriftSigma"
  | "tiltFastGain"
  | "tiltFastScale"
  | "tiltSlowGain"
  | "tiltSlowThreshold"
  | "tiltSlowMinDuration"
  | "tiltSlowRecoveryFrac";

export type ModelPatch = Pick<ControlsState, ModelFieldKey>;

export interface ModelPreset {
  id: string;
  labelKey: DictKey;
  taglineKey: DictKey;
  patch: ModelPatch;
}

// Canonical "all-zero shocks" baseline. Individual presets override only
// the fields they care about, so we keep new fields backwards-compat by
// extending here.
const ZERO_SHOCKS: ModelPatch = {
  finishModelId: "powerlaw-realdata-influenced",
  alphaOverride: null,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  roiStdErr: 0,
  roiShockPerTourney: 0,
  roiShockPerSession: 0,
  roiDriftSigma: 0,
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  tiltSlowMinDuration: 500,
  tiltSlowRecoveryFrac: 0.5,
};

export const STANDARD_PRESETS: ModelPreset[] = [
  {
    id: "primedope",
    labelKey: "preset.primedope.label",
    taglineKey: "preset.primedope.tagline",
    patch: {
      ...ZERO_SHOCKS,
      // PrimeDope-style distribution: uniform-lift calibration, PD payout
      // curve, no shocks, no tilt, no skill model nuance. It still keeps the
      // app's full buy-in+rake ROI basis; exact live-site EV parity is a
      // diagnostic script-only opt-in.
      finishModelId: "power-law",
      usePrimedopePayouts: true,
    },
  },
  {
    id: "naive",
    labelKey: "preset.naive.label",
    taglineKey: "preset.naive.tagline",
    patch: {
      ...ZERO_SHOCKS,
    },
  },
  {
    id: "realistic-solo",
    labelKey: "preset.realisticSolo.label",
    taglineKey: "preset.realisticSolo.tagline",
    patch: {
      ...ZERO_SHOCKS,
      roiStdErr: 0.03,
      roiShockPerTourney: 0.3,
      roiShockPerSession: 0.05,
      roiDriftSigma: 0.01,
      tiltFastGain: -0.15,
      // Historical solo-mode scale used ABI-like semantics; keep the preset
      // meaningful under the current "$ drawdown" engine by using a
      // conservative absolute threshold instead of the old raw "50".
      tiltFastScale: 2500,
    },
  },
  {
    id: "steady-reg",
    labelKey: "preset.steadyReg.label",
    taglineKey: "preset.steadyReg.tagline",
    patch: {
      ...ZERO_SHOCKS,
      roiStdErr: 0.02,
      roiShockPerTourney: 0.25,
      roiShockPerSession: 0.04,
      roiDriftSigma: 0.015,
      tiltFastGain: 0,
      tiltFastScale: 0,
      tiltSlowGain: 0.05,
      tiltSlowThreshold: 5000,
      tiltSlowMinDuration: 500,
      tiltSlowRecoveryFrac: 0.5,
    },
  },
];

const NAIVE_PRESET = (() => {
  const preset = STANDARD_PRESETS.find((entry) => entry.id === "naive");
  if (!preset) {
    throw new Error('STANDARD_PRESETS must include a "naive" preset');
  }
  return preset;
})();

// "custom" is what the finish-model picker writes, and that picker is advanced
// only, so a custom model reaching basic mode (a stale autosave, an advanced
// user's link) is one nobody there can see or change.
const ADVANCED_ONLY_PRESET_IDS = new Set([
  ...STANDARD_PRESETS.filter((preset) => preset.id !== "naive").map((preset) => preset.id),
  "custom",
]);

/** The simulation count every demo scenario and the first visit start from; basic mode has no field to change it. */
export const BASIC_MODE_MAX_SAMPLES = 10_000;

/** Apply a model patch to a ControlsState, returning a new state. */
export function applyModelPatch(
  state: ControlsState,
  patch: ModelPatch,
  presetId: string,
): ControlsState {
  return { ...state, ...patch, modelPresetId: presetId };
}

/**
 * Basic mode intentionally ignores the experimental variance-profile layer.
 * Users can keep advanced presets in local state, but once advanced mode is
 * off we zero the extra noise/tilt channels and drop built-in and custom
 * profile ids back to the clean baseline so normal-mode runs stay unchanged.
 * A simulation count above the default is capped for the same reason: only the
 * advanced panel can lower it.
 */
export function sanitizeControlsForBasicMode(
  state: ControlsState,
): ControlsState {
  const stripped: ControlsState = {
    ...state,
    roiStdErr: 0,
    roiShockPerTourney: 0,
    roiShockPerSession: 0,
    roiDriftSigma: 0,
    tiltFastGain: 0,
    tiltFastScale: 0,
    tiltSlowGain: 0,
    tiltSlowThreshold: 0,
    tiltSlowMinDuration: 500,
    tiltSlowRecoveryFrac: 0.5,
    compareEnabled: false,
    samples: Math.min(state.samples, BASIC_MODE_MAX_SAMPLES),
  };
  if (!ADVANCED_ONLY_PRESET_IDS.has(state.modelPresetId)) return stripped;
  return {
    ...stripped,
    ...NAIVE_PRESET.patch,
    modelPresetId: "naive",
  };
}

/**
 * A hand-set α only reaches the three real-data tilt models; on any other
 * model it is ignored. Settings that outlive a model switch (autosave, an
 * old share link) can still carry one, so the run input and the settings
 * snapshot kept with its results drop it instead of claiming a pinned α.
 */
export function withSupportedAlpha(state: ControlsState): ControlsState {
  if (state.alphaOverride == null || supportsManualAlpha(state.finishModelId)) {
    return state;
  }
  return { ...state, alphaOverride: null };
}
