"use client";

import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CashApp } from "@/components/CashApp";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { ControlsPanel, type ControlsState } from "@/components/ControlsPanel";
import { ResultsView } from "@/components/ResultsView";
import { PayoutStructureCard } from "@/components/PayoutStructureCard";
import { Section, Card } from "@/components/ui/Section";
import { CornerToggles } from "@/components/ui/CornerToggles";
import { FinishPMFPreview } from "@/components/charts/FinishPMFPreview";
import { ConvergenceChart } from "@/components/charts/ConvergenceChart";
import { useSimulation } from "@/lib/sim/useSimulation";
import { validateSchedule } from "@/lib/sim/validation";
import { applyItmTarget, isItmTargetActive } from "@/lib/sim/itmTarget";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import { plural, WORDS } from "@/lib/i18n/plural";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { SCENARIOS } from "@/lib/scenarios";

const scenarioDerived = new Map(
  SCENARIOS.map((s) => {
    const total = s.schedule.reduce((n, r) => n + r.count, 0);
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of s.schedule) {
      if (r.buyIn < lo) lo = r.buyIn;
      if (r.buyIn > hi) hi = r.buyIn;
    }
    const range = lo === hi ? `$${lo}` : `$${lo}–${hi}`;
    return [s.id, { total, range }] as const;
  }),
);
import type {
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import {
  addUserPreset,
  buildShareUrl,
  isValidUserPreset,
  loadFromUrlHash,
  loadLocal,
  loadUserPresets,
  removeUserPreset,
  saveLocal,
  saveUserPresets,
  type PersistedState,
  type UserPreset,
} from "@/lib/persistence";

const initialSchedule: TournamentRow[] = [
  {
    id: "r1",
    label: "тестовый турнир",
    players: 5000,
    buyIn: 50,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
  },
];

const initialControls: ControlsState = {
  scheduleRepeats: 200,
  samples: 10_000,
  bankroll: 0,
  seed: 42,
  finishModelId: "powerlaw-realdata-influenced",
  alphaOverride: null,
  compareWithPrimedope: true,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  compareMode: "primedope",
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
  modelPresetId: "naive",
  empiricalBuckets: undefined,
  itmGlobalEnabled: false,
  itmGlobalPct: 18.7,
  rakebackPct: 0,
};

interface CompareSlot {
  label: string;
  state: PersistedState;
  result: SimulationResult | null;
}

export default function Home() {
  const t = useT();
  const { locale } = useLocale();
  const { advanced } = useAdvancedMode();
  const [schedule, setSchedule] = useState<TournamentRow[]>(initialSchedule);
  const [controls, setControls] = useState<ControlsState>(initialControls);
  const [compareSlot, setCompareSlot] = useState<CompareSlot | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [userPresets, setUserPresets] = useLocalStorageState<UserPreset[]>(
    "tvs:user-presets",
    loadUserPresets,
    saveUserPresets,
    [],
  );
  const [mode, setMode] = useLocalStorageState<"mtt" | "cash">(
    "tvs:mode",
    () => {
      try {
        const v = localStorage.getItem("tvs:mode");
        return v === "cash" ? "cash" : "mtt";
      } catch {
        return "mtt";
      }
    },
    (next) => {
      try {
        localStorage.setItem("tvs:mode", next);
      } catch {
        // localStorage full / unavailable — fall through, mode resets next load.
      }
    },
    "mtt",
  );
  // Advanced mode off → force MTT view regardless of persisted state.
  const activeMode: "mtt" | "cash" = advanced ? mode : "mtt";
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);
  const abi = useMemo(() => {
    const totalCount = schedule.reduce((a, r) => a + Math.max(0, r.count), 0);
    if (totalCount <= 0) return 0;
    return schedule.reduce((a, r) => a + Math.max(0, r.count) * (r.buyIn + r.buyIn * r.rake), 0) / totalCount;
  }, [schedule]);

  const {
    status,
    progress,
    stage,
    result,
    error,
    elapsedMs,
    run,
    cancel,
    interruptBackground,
    estimateMs,
    availableRuns,
    activeRunIdx,
    selectRun,
    backgroundStatus,
    runPdOnly,
    pdStatus,
    pdProgress,
    pdResultOverride,
  } = useSimulation();
  const lastRunInputRef = useRef<SimulationInput | null>(null);

  useEffect(() => {
    const fromUrl = loadFromUrlHash();
    const fromLocal = fromUrl ?? loadLocal();
    // Fresh random seed on every mount — users shouldn't see a pinned
    // "42" or a stale saved seed in the field. Runs are re-seeded again
    // in onRun, but this keeps the UI honest about reproducibility.
    const freshSeed =
      (((Math.random() * 0xffffffff) >>> 0) ^
        ((Date.now() & 0xffffffff) >>> 0)) >>>
      0;
    startTransition(() => {
      if (fromLocal) {
        setSchedule(fromLocal.schedule);
        setControls({
          ...initialControls,
          ...fromLocal.controls,
          seed: freshSeed,
          compareWithPrimedope: true,
        });
      } else {
        // No saved state — load the PrimeDope comparison scenario by default.
        const defaultScenario = SCENARIOS.find((s) => s.id === "primedope-reference");
        if (defaultScenario) {
          setSchedule(defaultScenario.schedule);
          setControls({ ...initialControls, ...defaultScenario.controls, seed: freshSeed });
          setActiveScenarioId("primedope-reference");
        } else {
          setControls((c) => ({ ...c, seed: freshSeed }));
        }
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeoutId = window.setTimeout(() => {
      saveLocal({ v: 1, schedule, controls });
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [schedule, controls, hydrated]);

  const buildInput = useCallback(
    (s: TournamentRow[], c: ControlsState): SimulationInput => ({
      schedule: s,
      scheduleRepeats: c.scheduleRepeats,
      samples: c.samples,
      bankroll: c.bankroll,
      seed: Math.floor(Math.random() * 2 ** 30),
      finishModel: {
        id: c.finishModelId,
        alpha: c.alphaOverride ?? undefined,
        empiricalBuckets:
          c.finishModelId === "empirical" ? c.empiricalBuckets : undefined,
      },
      compareWithPrimedope: c.compareWithPrimedope,
      usePrimedopePayouts: c.usePrimedopePayouts,
      usePrimedopeFinishModel: c.usePrimedopeFinishModel,
      usePrimedopeRakeMath: c.usePrimedopeRakeMath,
      compareMode: c.compareMode,
      modelPresetId: c.modelPresetId,
      roiStdErr: c.roiStdErr,
      roiShockPerTourney: c.roiShockPerTourney,
      roiShockPerSession: c.roiShockPerSession,
      roiDriftSigma: c.roiDriftSigma,
      tiltFastGain: c.tiltFastGain,
      tiltFastScale: c.tiltFastScale,
      tiltSlowGain: c.tiltSlowGain,
      tiltSlowThreshold: c.tiltSlowThreshold,
      tiltSlowMinDuration: c.tiltSlowMinDuration,
      tiltSlowRecoveryFrac: c.tiltSlowRecoveryFrac,
      rakebackFracOfRake: c.rakebackPct / 100,
    }),
    [],
  );

  const itmTargetCfg = useMemo(
    () => ({
      enabled: controls.itmGlobalEnabled,
      pct: controls.itmGlobalPct,
    }),
    [controls.itmGlobalEnabled, controls.itmGlobalPct],
  );
  const itmTargetLocked = isItmTargetActive(itmTargetCfg);
  const effectiveSchedule = useMemo(
    () => applyItmTarget(schedule, itmTargetCfg),
    [schedule, itmTargetCfg],
  );
  // Heavy downstream widgets (FinishPMFPreview calibrates α via bisection on
  // N places; PayoutStructureCard / ConvergenceChart re-walk the schedule)
  // re-run on every keystroke and on gameType flips that rewrite 4+ row
  // fields at once. Deferring their input lets React keep the inputs /
  // selects responsive — the preview catches up in the background instead
  // of blocking the click.
  const deferredSchedule = useDeferredValue(effectiveSchedule);
  const deferredScheduleRepeats = useDeferredValue(controls.scheduleRepeats);
  const deferredControls = useDeferredValue(controls);

  const previewModel = useMemo(
    () => ({
      id: controls.finishModelId,
      alpha: controls.alphaOverride ?? undefined,
      empiricalBuckets:
        controls.finishModelId === "empirical"
          ? controls.empiricalBuckets
          : undefined,
    }),
    [controls.finishModelId, controls.alphaOverride, controls.empiricalBuckets],
  );

  // Feasibility memo drives the banner + row highlights + fixAllAuto. Heavy
  // (walks every row + calibrates α on finishBuckets rows), so feed it the
  // deferred schedule — the banner catches up a tick after typing stops.
  // The Run button gate re-validates synchronously against the *current*
  // schedule, so clicking Run during the defer window never launches an
  // invalid job.
  const feasibility = useMemo(
    () => validateSchedule(deferredSchedule, previewModel),
    [deferredSchedule, previewModel],
  );

  const onRun = useCallback(() => {
    const liveFeasibility = validateSchedule(effectiveSchedule, previewModel);
    if (!liveFeasibility.ok) return;
    const freshSeed =
      (((Math.random() * 0xffffffff) >>> 0) ^
        ((Date.now() & 0xffffffff) >>> 0)) >>>
      0;
    const nextControls = { ...controls, seed: freshSeed };
    setControls(nextControls);
    const input = buildInput(effectiveSchedule, nextControls);
    lastRunInputRef.current = input;
    run(input);
  }, [effectiveSchedule, previewModel, controls, run, buildInput]);

  const onUsePdPayoutsChange = useCallback(
    (v: boolean) => {
      setControls((c) => ({ ...c, usePrimedopePayouts: v }));
      const base = lastRunInputRef.current;
      if (!base) return;
      runPdOnly({ ...base, usePrimedopePayouts: v });
    },
    [runPdOnly],
  );
  const onUsePdFinishModelChange = useCallback(
    (v: boolean) => {
      setControls((c) => ({ ...c, usePrimedopeFinishModel: v }));
      const base = lastRunInputRef.current;
      if (!base) return;
      runPdOnly({ ...base, usePrimedopeFinishModel: v });
    },
    [runPdOnly],
  );
  const onUsePdRakeMathChange = useCallback(
    (v: boolean) => {
      setControls((c) => ({ ...c, usePrimedopeRakeMath: v }));
      const base = lastRunInputRef.current;
      if (!base) return;
      runPdOnly({ ...base, usePrimedopeRakeMath: v });
    },
    [runPdOnly],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onRun]);

  const running = status === "running";

  const loadScenario = useCallback((id: string) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setSchedule(s.schedule);
    setControls({ ...initialControls, ...s.controls });
    setActiveScenarioId(id);
  }, []);

  // Stable callbacks for ScheduleEditor / ControlsPanel / sub-controls. Without
  // these the inline arrow handlers below force a fresh reference on every
  // parent render (a single keystroke, a locale flip, a mouse hover). Memoized
  // children then re-render anyway — memo broken.
  const handleScheduleChange = useCallback(
    (s: TournamentRow[]) => {
      interruptBackground();
      setSchedule(s);
      setActiveScenarioId(null);
    },
    [interruptBackground],
  );
  const handleControlsChange = useCallback(
    (c: ControlsState) => {
      interruptBackground();
      setControls(c);
      setActiveScenarioId(null);
    },
    [interruptBackground],
  );
  const tournamentsPerSchedule = useMemo(
    () => schedule.reduce((a, r) => a + Math.max(1, Math.floor(r.count)), 0),
    [schedule],
  );
  const tournamentsPerSession = useMemo(
    () =>
      tournamentsPerSchedule * Math.max(1, controls.scheduleRepeats),
    [tournamentsPerSchedule, controls.scheduleRepeats],
  );
  const estimatedMs = useMemo(
    () =>
      estimateMs(
        controls.samples,
        controls.scheduleRepeats,
        tournamentsPerSchedule,
      ),
    [estimateMs, controls.samples, controls.scheduleRepeats, tournamentsPerSchedule],
  );
  const scheduleGlobalItmPct = useMemo(
    () => (controls.itmGlobalEnabled ? controls.itmGlobalPct : null),
    [controls.itmGlobalEnabled, controls.itmGlobalPct],
  );
  const scheduleToolbarExtras = useMemo(
    () => (
      <>
        <span className="eyebrow whitespace-nowrap text-[color:var(--color-fg-dim)]">
          {t("demo.label")}
        </span>
        <select
          value={activeScenarioId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) loadScenario(id);
          }}
          className="max-w-[200px] truncate rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1 text-xs text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
          aria-label={t("demo.label")}
        >
          <option value="">—</option>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
      </>
    ),
    [t, activeScenarioId, loadScenario],
  );
  const doneSummary = useMemo(
    () =>
      status === "done" && result
        ? {
            mean: result.stats.mean,
            median: result.stats.median,
            roi: result.stats.mean / result.totalBuyIn,
            probProfit: result.stats.probProfit,
            riskOfRuin: result.stats.riskOfRuin,
            worstDrawdown: result.stats.maxDrawdownP99,
            longestCashlessWorst: result.stats.longestCashlessWorst,
            elapsedMs,
            resultsAnchorId: "results-top",
          }
        : null,
    [status, result, elapsedMs],
  );

  const previewRow = useMemo(() => {
    if (!deferredSchedule.length) return undefined;
    const found = previewRowId
      ? deferredSchedule.find((r) => r.id === previewRowId)
      : undefined;
    return found ?? deferredSchedule[0];
  }, [deferredSchedule, previewRowId]);

  const fixRowAuto = useCallback(
    (rowId: string) => {
      setSchedule((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, finishBuckets: undefined } : r,
        ),
      );
    },
    [],
  );
  const previewRowId_ = previewRow?.id;
  const onPreviewRowChange = useCallback(
    (updates: Partial<TournamentRow>) => {
      if (!previewRowId_) return;
      interruptBackground();
      setSchedule((prev) =>
        prev.map((r) => (r.id === previewRowId_ ? { ...r, ...updates } : r)),
      );
    },
    [previewRowId_, interruptBackground],
  );
  const fixRowPreset = useCallback(
    (rowId: string) => {
      setSchedule((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, itmRate: 0.16, finishBuckets: undefined }
            : r,
        ),
      );
    },
    [],
  );
  const fixAllAuto = useCallback(() => {
    setSchedule((prev) =>
      prev.map((r) =>
        feasibility.issues.some((i) => i.rowId === r.id)
          ? { ...r, finishBuckets: undefined }
          : r,
      ),
    );
  }, [feasibility.issues]);

  const onSaveSlot = () => {
    if (!result) return;
    setCompareSlot({
      label: t("slot.saved"),
      state: { v: 1, schedule, controls },
      result,
    });
  };

  const onClearSlot = () => setCompareSlot(null);

  const onLoadSlot = () => {
    if (!compareSlot) return;
    setSchedule(compareSlot.state.schedule);
    setControls({ ...initialControls, ...compareSlot.state.controls });
  };

  const onSaveUserPreset = () => {
    const name = window.prompt(t("userPreset.promptName"));
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    addUserPreset(trimmed, { v: 1, schedule, controls });
    setUserPresets(loadUserPresets());
  };

  const onLoadUserPreset = (p: UserPreset) => {
    setSchedule(p.state.schedule);
    setControls({ ...initialControls, ...p.state.controls });
    setActiveScenarioId(p.id);
  };

  const onDeleteUserPreset = (id: string) => {
    if (!window.confirm(t("userPreset.confirmDelete"))) return;
    removeUserPreset(id);
    setUserPresets(loadUserPresets());
    if (activeScenarioId === id) setActiveScenarioId(null);
  };

  const onExportUserPresets = () => {
    const all = loadUserPresets();
    const payload = { format: "tvs.userPresets", v: 1, presets: all };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `variance-lab-presets-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [shareCopiedId, setShareCopiedId] = useState<string | null>(null);
  const onSharePreset = async (p: UserPreset) => {
    const url = buildShareUrl(p.state);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t("userPreset.shareFallback"), url);
    }
    setShareCopiedId(p.id);
    window.setTimeout(() => {
      setShareCopiedId((cur) => (cur === p.id ? null : cur));
    }, 1800);
  };

  const onImportUserPresets = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming: UserPreset[] | null =
        parsed && parsed.format === "tvs.userPresets" && Array.isArray(parsed.presets)
          ? (parsed.presets as UserPreset[])
          : null;
      if (!incoming) {
        window.alert(t("presets.importError"));
        return;
      }
      const existing = loadUserPresets();
      const byId = new Map(existing.map((p) => [p.id, p]));
      for (const p of incoming) {
        if (!isValidUserPreset(p)) continue;
        byId.set(p.id, p);
      }
      const merged = Array.from(byId.values());
      const importedCount = incoming.filter(isValidUserPreset).length;
      if (importedCount === 0) {
        window.alert(t("presets.importError"));
        return;
      }
      saveUserPresets(merged);
      setUserPresets(loadUserPresets());
      window.alert(
        t("presets.importDone")
          .replace("{n}", String(importedCount))
          .replace("{_preset}", plural(locale, importedCount, WORDS.preset)),
      );
    } catch {
      window.alert(t("presets.importError"));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-3 sm:px-6 sm:py-4 xl:max-w-[1400px] 2xl:max-w-[1700px] 3xl:max-w-[2000px] 4xl:max-w-[2400px]">
      <header className="flex flex-col gap-3">
        {/* Brand strip */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[color:var(--color-border)] pb-2">
          <div className="flex items-end gap-3">
            {/* Trajectory icon */}
            <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0 translate-y-[1px]" aria-hidden>
              <polyline points="2,22 7,18 11,20 15,10 19,14 23,4 26,8" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
              <polyline points="2,24 7,22 11,23 15,16 19,19 23,12 26,15" fill="none" stroke="var(--color-fg-dim)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
              <polyline points="2,20 7,14 11,17 15,6 19,10 23,2 26,5" fill="none" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
            </svg>
            <h1 className="flex flex-col leading-none">
              <div className="flex items-baseline gap-0">
                <span className="text-[22px] font-black tracking-[-0.02em] text-[color:var(--color-fg)] sm:text-[28px]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                  Prime
                </span>
                <span className="text-[22px] font-black tracking-[-0.02em] text-[color:var(--color-accent)] sm:text-[28px]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                  Dope
                </span>
              </div>
              <span className="text-[11px] font-bold tracking-[0.04em] text-[color:var(--color-fg-muted)] sm:text-[13px]">
                but better
              </span>
            </h1>
            <a
              href="#changelog"
              onClick={() => {
                const el = document.getElementById("changelog");
                if (el instanceof HTMLDetailsElement) el.open = true;
              }}
              className="hidden cursor-pointer rounded-sm border border-[color:var(--color-accent)]/40 px-1.5 py-0.5 font-mono text-[9px] font-bold tabular-nums text-[color:var(--color-accent)]/70 transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] sm:inline"
            >
              v0.7a
            </a>
          </div>
          <CornerToggles />
        </div>

        {compareSlot && (
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-1.5 border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-accent)]" />
              {t("slot.comparing")}
            </span>
          </div>
        )}

        {/* User-saved presets — collapsible so they don't push the schedule below the fold */}
        <details className="group border-t border-[color:var(--color-border)] pt-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-accent)]">
              <span className="eyebrow flex items-center gap-2">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                {t("userPreset.label")}
                {userPresets.length > 0 && (
                  <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                    ({userPresets.length})
                  </span>
                )}
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="eyebrow invisible">{t("userPreset.label")}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onExportUserPresets}
                  disabled={userPresets.length === 0}
                  className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:opacity-40"
                >
                  ↓ {t("presets.export")}
                </button>
                <label className="cursor-pointer border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]">
                  ↑ {t("presets.import")}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onImportUserPresets(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={onSaveUserPreset}
                  className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                >
                  + {t("userPreset.saveCurrent")}
                </button>
              </div>
            </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
                {SCENARIOS.map((s) => {
                  const d = scenarioDerived.get(s.id)!;
                  const active = activeScenarioId === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`group relative flex flex-col items-start gap-2 border px-4 py-3 text-left transition-all ${
                        active
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] hover:border-[color:var(--color-accent)]/60 hover:bg-[color:var(--color-bg-elev-2)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => loadScenario(s.id)}
                        className="flex w-full flex-col items-start gap-2 text-left"
                      >
                        <div className="flex w-full items-center justify-between">
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider ${
                              active
                                ? "text-[color:var(--color-accent)]"
                                : "text-[color:var(--color-fg-dim)]"
                            }`}
                          >
                            {t("userPreset.builtin")}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                            {d.total} × {d.range}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.icon && (
                            // eslint-disable-next-line @next/next/no-img-element -- 24px decorative preset icon from user-local scenarios; no LCP impact, no Image config payoff.
                            <img
                              src={s.icon}
                              alt=""
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          )}
                          <span
                            className={`text-[13px] font-semibold leading-tight ${
                              active
                                ? "text-[color:var(--color-accent)]"
                                : "text-[color:var(--color-fg)] group-hover:text-[color:var(--color-accent)]"
                            }`}
                          >
                            {t(s.labelKey)}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {userPresets.map((p) => {
                  const total = p.state.schedule.reduce(
                    (n, r) => n + r.count,
                    0,
                  );
                  const buyIns = p.state.schedule.map((r) => r.buyIn);
                  const lo = Math.min(...buyIns);
                  const hi = Math.max(...buyIns);
                  const range = lo === hi ? `$${lo}` : `$${lo}–${hi}`;
                  const active = activeScenarioId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`group relative flex flex-col items-start gap-2 border px-4 py-3 text-left transition-all ${
                        active
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] hover:border-[color:var(--color-accent)]/60 hover:bg-[color:var(--color-bg-elev-2)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onLoadUserPreset(p)}
                        className="flex w-full flex-col items-start gap-2 text-left"
                      >
                        <div className="flex w-full items-center justify-between">
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider ${
                              active
                                ? "text-[color:var(--color-accent)]"
                                : "text-[color:var(--color-fg-dim)]"
                            }`}
                          >
                            {t("userPreset.mine")}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                            {total} × {range}
                          </span>
                        </div>
                        <div
                          className={`text-[13px] font-semibold leading-tight ${
                            active
                              ? "text-[color:var(--color-accent)]"
                              : "text-[color:var(--color-fg)] group-hover:text-[color:var(--color-accent)]"
                          }`}
                        >
                          {p.name}
                        </div>
                      </button>
                      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => onSharePreset(p)}
                          aria-label={t("userPreset.share")}
                          title={
                            shareCopiedId === p.id
                              ? t("userPreset.shareCopied")
                              : t("userPreset.share")
                          }
                          className="flex h-5 w-5 items-center justify-center text-[11px] text-[color:var(--color-fg-dim)] transition-colors hover:text-[color:var(--color-accent)]"
                        >
                          {shareCopiedId === p.id ? "✓" : "↗"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteUserPreset(p.id)}
                          aria-label={t("userPreset.delete")}
                          className="flex h-5 w-5 items-center justify-center text-[color:var(--color-fg-dim)] transition-colors hover:text-[color:var(--color-accent)]"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
      </header>

      {advanced && (
        <div className="flex gap-1 border-b border-[color:var(--color-border)] pb-0">
          {(["mtt", "cash"] as const).map((m) => {
            const active = activeMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`border-b-2 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                  active
                    ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                    : "border-transparent text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]"
                }`}
              >
                {t(m === "mtt" ? "mode.tab.mtt" : "mode.tab.cash")}
              </button>
            );
          })}
        </div>
      )}

      {activeMode === "cash" ? <CashApp /> : null}

      {activeMode === "mtt" && (
      <>
      <Section
        number="01"
        suit="spade"
        title={t("section.schedule.title")}
      >
        <div className="mb-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <GlobalItmControl
            value={controls}
            onChange={handleControlsChange}
            disabled={running}
          />
          <GlobalRakebackControl
            value={controls}
            onChange={handleControlsChange}
            disabled={running}
          />
          <BankrollControl
            value={controls}
            onChange={handleControlsChange}
            disabled={running}
            abi={abi}
          />
        </div>
        <ScheduleEditor
          schedule={schedule}
          onChange={handleScheduleChange}
          disabled={running}
          globalItmPct={scheduleGlobalItmPct}
          toolbarExtras={scheduleToolbarExtras}
        />
      </Section>

      <Section
        number="02"
        suit="diamond"
        title={t("section.controls.title")}
      >
        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.95fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <ControlsPanel
              value={controls}
              onChange={handleControlsChange}
              onRun={onRun}
              onCancel={cancel}
              running={running}
              progress={progress}
              stage={stage}
              estimatedMs={estimatedMs}
              tournamentsPerSchedule={tournamentsPerSchedule}
              tournamentsPerSession={tournamentsPerSession}
              doneSummary={doneSummary}
            />
            <PayoutStructureCard schedule={deferredSchedule} />
          </div>
          {previewRow && (
            <Card className="data-surface-card p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
                  <span className="mr-2 text-sm" style={{ color: "var(--color-diamond)" }}>🔬</span>
                  {t("preview.title")}
                </h3>
                {schedule.length > 1 && (
                  <select
                    value={previewRow.id}
                    onChange={(e) => setPreviewRowId(e.target.value)}
                    className="max-w-[180px] border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1 text-[11px] text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
                    title={t("preview.rowPicker")}
                  >
                    {schedule.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label || r.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <FinishPMFPreview
                row={previewRow}
                model={previewModel}
                itmLocked={itmTargetLocked}
                onRowChange={onPreviewRowChange}
              />
            </Card>
          )}
        </div>
      </Section>

      {!feasibility.ok && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <div className="mb-1 font-semibold uppercase tracking-wider text-amber-100">
            {t("shape.blockedTitle")}
          </div>
          <div className="mb-3 text-[12px] text-amber-200/90">
            {t("shape.blockedHint")}
          </div>
          <ul className="mb-3 space-y-1.5">
            {feasibility.issues.map((iss) => (
              <li
                key={iss.rowId}
                className="flex flex-wrap items-center gap-2 font-mono text-[11px]"
              >
                <span className="text-amber-100">
                  {t("shape.blockedRow")} #{iss.rowIdx + 1} — {iss.label}
                </span>
                <span className="text-amber-300/80">
                  EW ${iss.currentEv.toFixed(2)} / ${iss.targetEv.toFixed(2)} ({t("shape.blockedGap")} {iss.gap >= 0 ? "+" : ""}
                  {iss.gap.toFixed(2)})
                </span>
                <button
                  type="button"
                  onClick={() => fixRowAuto(iss.rowId)}
                  className="border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-500/20"
                >
                  {t("shape.fixAuto")}
                </button>
                <button
                  type="button"
                  onClick={() => fixRowPreset(iss.rowId)}
                  className="border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-500/20"
                >
                  {t("shape.fixPreset")}
                </button>
              </li>
            ))}
          </ul>
          {feasibility.issues.length > 1 && (
            <button
              type="button"
              onClick={fixAllAuto}
              className="border border-amber-400/60 bg-amber-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-50 transition-colors hover:border-amber-300 hover:bg-amber-500/30"
            >
              {t("shape.fixAll")}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!result && (
        <Card className="p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
            {t("chart.convergence")}
          </div>
          <div className="mb-1 text-[11px] text-[color:var(--color-fg-muted)]">
            {t("chart.convergence.sub")}
          </div>
          <ConvergenceChart schedule={deferredSchedule} />
        </Card>
      )}

      {result && (
        <>
          <Card className="flex flex-wrap items-center gap-3 p-3">
            <div className="text-xs uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("slot.title")}
            </div>
            <div className="flex-1 text-sm text-[color:var(--color-fg-muted)]">
              {compareSlot
                ? `${t("slot.saved")} · ${compareSlot.state.schedule.length} ${t("slot.rows")} · ${compareSlot.state.controls.samples.toLocaleString()} ${t("app.samples")} · ${t("slot.mean")} ${compareSlot.result ? `$${compareSlot.result.stats.mean.toFixed(0)}` : "—"}`
                : t("slot.empty")}
            </div>
            <div className="flex gap-2">
              <TextBtn onClick={onSaveSlot}>{t("slot.saveCurrent")}</TextBtn>
              {compareSlot && (
                <>
                  <TextBtn onClick={onLoadSlot}>{t("slot.load")}</TextBtn>
                  <TextBtn onClick={onClearSlot}>{t("slot.clear")}</TextBtn>
                </>
              )}
            </div>
          </Card>

          <Section
            number="03"
            suit="club"
            title={t("section.results.title")}
            subtitle={`${result.samples.toLocaleString()} ${t("section.results.subtitle")}`}
            anchorId="results-top"
          >
            <ResultsView
              result={result}
              compareResult={compareSlot?.result ?? null}
              bankroll={deferredControls.bankroll}
              schedule={deferredSchedule}
              scheduleRepeats={deferredScheduleRepeats}
              compareMode={deferredControls.compareMode}
              modelPresetId={deferredControls.modelPresetId}
              finishModelId={deferredControls.finishModelId}
              settings={deferredControls}
              elapsedMs={elapsedMs}
              availableRuns={availableRuns}
              activeRunIdx={activeRunIdx}
              onSelectRun={selectRun}
              backgroundStatus={backgroundStatus}
              onUsePdPayoutsChange={onUsePdPayoutsChange}
              onUsePdFinishModelChange={onUsePdFinishModelChange}
              onUsePdRakeMathChange={onUsePdRakeMathChange}
              pdOverrideResult={pdResultOverride}
              pdOverrideStatus={pdStatus}
              pdOverrideProgress={pdProgress}
            />
          </Section>
        </>
      )}
      </>
      )}

      <footer className="mt-4 flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-fg-dim)]">
        <div>
          {t("footer.line")}{" "}
          <span className="text-[color:var(--color-fg-muted)]">
            {t("footer.state")}
          </span>
        </div>
        <details id="changelog" className="group scroll-mt-4">
          <summary className="cursor-pointer select-none text-[color:var(--color-fg-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--color-fg)]">
            {t("changelog.title")}
          </summary>
          <div className="mt-3 space-y-3 pl-2">
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v07a.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v07a.cash")}</li>
              <li>{t("changelog.v07a.mttPerf")}</li>
              <li>{t("changelog.v07a.progress")}</li>
              <li>{t("changelog.v07a.mystery")}</li>
              <li>{t("changelog.v07a.stats")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v07.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v07.formats")}</li>
              <li>{t("changelog.v07.convergence")}</li>
              <li>{t("changelog.v07.gameType")}</li>
              <li>{t("changelog.v07.rakeback")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v06b.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v06b.ev")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v06.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v06.pko")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v05.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v05.pdWidget")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v04.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v04.summary")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v03.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v03.presets")}</li>
            </ul>
          </div>
        </details>
      </footer>
    </div>
  );
}

function TextBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const GlobalItmControl = memo(function GlobalItmControl({
  value,
  onChange,
  disabled,
}: {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-2.5">
      <label className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
        <input
          type="checkbox"
          checked={value.itmGlobalEnabled}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, itmGlobalEnabled: e.target.checked })
          }
          className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-accent)]"
        />
        {t("controls.itmTarget.label")}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0.5}
          max={99}
          step={0.5}
          value={value.itmGlobalPct}
          disabled={disabled || !value.itmGlobalEnabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onChange({ ...value, itmGlobalPct: v });
          }}
          className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-center text-[12px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
        />
        <span className="text-[11px] text-[color:var(--color-fg-dim)]">%</span>
      </div>
    </div>
  );
});

const GlobalRakebackControl = memo(function GlobalRakebackControl({
  value,
  onChange,
  disabled,
}: {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-2.5">
      <span
        className="text-center text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]"
        title={t("controls.rakeback.title")}
      >
        {t("controls.rakeback.label")}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={value.rakebackPct}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onChange({
              ...value,
              rakebackPct: Math.max(0, Math.min(100, v)),
            });
          }}
          className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-center text-[12px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
        />
        <span className="text-[11px] text-[color:var(--color-fg-dim)]">%</span>
      </div>
    </div>
  );
});

const BankrollControl = memo(function BankrollControl({
  value,
  onChange,
  disabled,
  abi,
}: {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  disabled?: boolean;
  abi: number;
}) {
  const t = useT();
  const [brMode, setBrMode] = useState<"$" | "abi">("$");
  const displayVal = brMode === "$" ? value.bankroll : (abi > 0 ? Math.round(value.bankroll / abi) : 0);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-2.5">
      <span className="text-center text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
        {t("controls.bankroll")}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={brMode === "$" ? 1_000_000_000 : 100_000}
          step={brMode === "$" ? 100 : 10}
          value={displayVal}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 0) return;
            onChange({ ...value, bankroll: brMode === "$" ? v : Math.round(v * abi) });
          }}
          className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-center text-[12px] font-semibold tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
        />
        <button
          type="button"
          onClick={() => setBrMode((m) => (m === "$" ? "abi" : "$"))}
          disabled={disabled}
          className="shrink-0 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:opacity-40"
          title={brMode === "$" ? "Switch to ABI multiples" : "Switch to dollars"}
        >
          {brMode === "$" ? "$" : "ABI"}
        </button>
      </div>
    </div>
  );
});
