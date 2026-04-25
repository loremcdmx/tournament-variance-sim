import type { ControlsState } from "@/components/ControlsPanel";
import type { DictKey } from "@/lib/i18n/dict";

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

const ADVANCED_ONLY_PRESET_IDS = new Set(
  STANDARD_PRESETS.filter((preset) => preset.id !== "naive").map((preset) => preset.id),
);

/** Apply a model patch to a ControlsState, returning a new state. */
export function applyModelPatch(
  state: ControlsState,
  patch: ModelPatch,
  presetId: string,
): ControlsState {
  return { ...state, ...patch, modelPresetId: presetId };
}

/** Extract just the model fields from a ControlsState — used for save-as. */
export function extractModelPatch(state: ControlsState): ModelPatch {
  return {
    finishModelId: state.finishModelId,
    alphaOverride: state.alphaOverride,
    usePrimedopePayouts: state.usePrimedopePayouts,
    usePrimedopeFinishModel: state.usePrimedopeFinishModel,
    usePrimedopeRakeMath: state.usePrimedopeRakeMath,
    roiStdErr: state.roiStdErr,
    roiShockPerTourney: state.roiShockPerTourney,
    roiShockPerSession: state.roiShockPerSession,
    roiDriftSigma: state.roiDriftSigma,
    tiltFastGain: state.tiltFastGain,
    tiltFastScale: state.tiltFastScale,
    tiltSlowGain: state.tiltSlowGain,
    tiltSlowThreshold: state.tiltSlowThreshold,
    tiltSlowMinDuration: state.tiltSlowMinDuration,
    tiltSlowRecoveryFrac: state.tiltSlowRecoveryFrac,
  };
}

/**
 * Basic mode intentionally ignores the experimental variance-profile layer.
 * Users can keep advanced presets in local state, but once advanced mode is
 * off we zero the extra noise/tilt channels and drop built-in profile ids
 * back to the clean baseline so normal-mode runs stay unchanged.
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
  };
  if (!ADVANCED_ONLY_PRESET_IDS.has(state.modelPresetId)) return stripped;
  return {
    ...stripped,
    ...NAIVE_PRESET.patch,
    modelPresetId: "naive",
  };
}

// -------- User presets in localStorage ---------------------------------

export interface UserPreset {
  id: string; // "user:<uuid>" or stable name
  name: string;
  createdAt: number;
  patch: ModelPatch;
}

const USER_PRESETS_KEY = "tvs.userPresets.v1";

function isValidUserPreset(v: unknown): v is UserPreset {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.createdAt === "number" &&
    !!o.patch &&
    typeof o.patch === "object"
  );
}

export function loadUserPresets(): UserPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidUserPreset);
  } catch {}
  return [];
}

export function saveUserPresets(list: UserPreset[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
  } catch {}
}

export function addUserPreset(name: string, patch: ModelPatch): UserPreset {
  const list = loadUserPresets();
  // Two presets saved in the same millisecond used to share an id — deleting
  // either one then removed both. Mix in a short random suffix.
  const suffix = Math.random().toString(36).slice(2, 6);
  const preset: UserPreset = {
    id: `user:${Date.now().toString(36)}-${suffix}`,
    name,
    createdAt: Date.now(),
    patch,
  };
  list.push(preset);
  saveUserPresets(list);
  return preset;
}

export function deleteUserPreset(id: string) {
  saveUserPresets(loadUserPresets().filter((p) => p.id !== id));
}

// -------- File export / import ----------------------------------------

export interface PresetFileFormat {
  v: 1;
  type: "tvs-preset";
  name: string;
  patch: ModelPatch;
}

export function parsePresetFile(text: string): PresetFileFormat | null {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.v === 1 &&
      parsed.type === "tvs-preset" &&
      typeof parsed.name === "string" &&
      parsed.patch &&
      typeof parsed.patch === "object"
    ) {
      return parsed as PresetFileFormat;
    }
  } catch {}
  return null;
}
