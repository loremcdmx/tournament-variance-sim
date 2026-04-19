"use client";

/**
 * localStorage + share-URL persistence. Stores only serializable input
 * state (schedule + controls) — never `SimulationResult`, never worker
 * state. All reads validate and fall back cleanly on schema drift; this
 * is a boundary where defensive parsing is intentional.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { TournamentRow } from "./sim/types";
import type { ControlsState } from "@/components/ControlsPanel";

// Warn dev if a loaded row has BR/mystery-royale flags out of sync — the
// compile boundary will fix it silently, but surfacing here helps catch
// bad imports or stale JSON before engine behavior depends on the fix.
function warnOnBrMrDrift(schedule: TournamentRow[] | undefined, source: string) {
  if (!schedule) return;
  for (const r of schedule) {
    const isBR = r.payoutStructure === "battle-royale";
    const isMR = r.gameType === "mystery-royale";
    if (isBR !== isMR) {
      console.warn(
        `[persistence/${source}] row "${r.label || r.id}" has BR/mystery-royale flags out of sync (gameType=${r.gameType}, payoutStructure=${r.payoutStructure}); compiler will normalize.`,
      );
    }
  }
}

export interface PersistedState {
  v: 1;
  schedule: TournamentRow[];
  controls: ControlsState;
}

const LS_KEY = "tvs:state";

export function encodeState(state: PersistedState): string {
  return compressToEncodedURIComponent(JSON.stringify(state));
}

export function decodeState(encoded: string): PersistedState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && parsed.v === 1) {
      warnOnBrMrDrift(parsed.schedule, "decodeState");
      return parsed as PersistedState;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocal(state: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / SSR
  }
}

export function loadLocal(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.v === 1) {
      warnOnBrMrDrift(parsed.schedule, "loadLocal");
      return parsed as PersistedState;
    }
    return null;
  } catch {
    return null;
  }
}

export function loadFromUrlHash(): PersistedState | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#s=/, "");
  if (!hash) return null;
  return decodeState(hash);
}

// User-defined presets — saved schedules + controls, named by the user.
export interface UserPreset {
  id: string;
  name: string;
  createdAt: number;
  state: PersistedState;
}

const PRESETS_KEY = "tvs:user-presets";

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const p of parsed as UserPreset[]) {
        warnOnBrMrDrift(p?.state?.schedule, `preset "${p?.name ?? "?"}"`);
      }
      return parsed as UserPreset[];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: UserPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // ignore quota
  }
}

export function addUserPreset(name: string, state: PersistedState): UserPreset {
  const preset: UserPreset = {
    id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Untitled",
    createdAt: Date.now(),
    state,
  };
  const all = loadUserPresets();
  all.push(preset);
  saveUserPresets(all);
  return preset;
}

export function removeUserPreset(id: string) {
  saveUserPresets(loadUserPresets().filter((p) => p.id !== id));
}

export function buildShareUrl(state: PersistedState): string {
  if (typeof window === "undefined") return "";
  const enc = encodeState(state);
  const url = new URL(window.location.href);
  url.hash = `s=${enc}`;
  return url.toString();
}
