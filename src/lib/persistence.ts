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

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isTournamentRowLike(v: unknown): v is TournamentRow {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    isFiniteNumber(v.players) &&
    isFiniteNumber(v.buyIn) &&
    isFiniteNumber(v.rake) &&
    isFiniteNumber(v.roi) &&
    typeof v.payoutStructure === "string" &&
    isFiniteNumber(v.count)
  );
}

function isPersistedState(v: unknown): v is PersistedState {
  if (!isRecord(v)) return false;
  if (v.v !== 1) return false;
  if (!Array.isArray(v.schedule) || !v.schedule.every(isTournamentRowLike)) {
    return false;
  }
  if (!isRecord(v.controls)) return false;
  return true;
}

// Warn dev if a loaded row has BR/mystery-royale flags out of sync — the
// compile boundary will fix it silently, but surfacing here helps catch
// bad imports or stale JSON before engine behavior depends on the fix.
function warnOnBrMrDrift(schedule: readonly TournamentRow[] | undefined, source: string) {
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
const PERSISTED_ROW_COUNT_MAX = 100_000;

function clampPersistedCount(count: number): number {
  return Math.min(PERSISTED_ROW_COUNT_MAX, Math.max(1, count));
}

function normalizePersistedState(state: PersistedState): PersistedState {
  let changed = false;
  const schedule = state.schedule.map((row) => {
    const nextCount = clampPersistedCount(row.count);
    if (nextCount === row.count) return row;
    changed = true;
    return { ...row, count: nextCount };
  });
  return changed ? { ...state, schedule } : state;
}

export function encodeState(state: PersistedState): string {
  return compressToEncodedURIComponent(JSON.stringify(state));
}

export function decodeState(encoded: string): PersistedState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (isPersistedState(parsed)) {
      warnOnBrMrDrift(parsed.schedule, "decodeState");
      return normalizePersistedState(parsed);
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
    if (isPersistedState(parsed)) {
      warnOnBrMrDrift(parsed.schedule, "loadLocal");
      return normalizePersistedState(parsed);
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

export function isValidUserPreset(v: unknown): v is UserPreset {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  if (typeof o.name !== "string") return false;
  if (typeof o.createdAt !== "number") return false;
  return isPersistedState(o.state);
}

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const safe = parsed.filter(isValidUserPreset);
    return safe.map((preset) => {
      warnOnBrMrDrift(preset.state.schedule, `preset "${preset.name}"`);
      const state = normalizePersistedState(preset.state);
      return state === preset.state ? preset : { ...preset, state };
    });
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: UserPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.filter(isValidUserPreset)));
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
