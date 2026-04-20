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
  | "compareWithPrimedope"
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
  compareWithPrimedope: true,
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
      // PrimeDope-equivalent: uniform-lift calibration, no shocks, no tilt,
      // no skill model nuance. This preset is the one place where forcing
      // the PD payout curve onto the comparison pane is correct — it's
      // explicitly "reproduce PD's reference σ on their own curve".
      finishModelId: "power-law",
      compareWithPrimedope: true,
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
      roiShockPerTourney: 0,
      roiShockPerSession: 0,
      roiDriftSigma: 0,
      tiltFastGain: 0,
      tiltFastScale: 0
    },
  },
  {
    id: "steady-reg",
    labelKey: "preset.steadyReg.label",
    taglineKey: "preset.steadyReg.tagline",
    patch: {
      ...ZERO_SHOCKS,
      roiStdErr: 0.02,
      roiShockPerTourney: 0,
      roiShockPerSession: 0,
      roiDriftSigma: 0,
      tiltFastGain: 0,
      tiltFastScale: 0,
      tiltSlowGain: 0,
      tiltSlowThreshold: 0,
      tiltSlowMinDuration: 500,
      tiltSlowRecoveryFrac: 0.5,
    },
  },
];

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
    compareWithPrimedope: state.compareWithPrimedope,
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
