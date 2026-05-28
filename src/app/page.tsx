"use client";

import {
  type CSSProperties,
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
import { BattleRoyaleLeaderboardControl } from "@/components/BattleRoyaleLeaderboardControl";
import { ControlsPanel, type ControlsState } from "@/components/ControlsPanel";
import { ResultsView } from "@/components/ResultsView";
import { PayoutStructureCard } from "@/components/PayoutStructureCard";
import { Section, Card } from "@/components/ui/Section";
import { CornerToggles } from "@/components/ui/CornerToggles";
import { FinishPMFPreview } from "@/components/charts/FinishPMFPreview";
import { ConvergenceChart } from "@/components/charts/ConvergenceChart";
import { ProveEdgeCard } from "@/components/charts/ProveEdgeCard";
import { useSimulation } from "@/lib/sim/useSimulation";
import { validateSchedule } from "@/lib/sim/validation";
import { chooseClosestFeasibilityFix } from "@/lib/sim/feasibilityFix";
import { checkInputSanity } from "@/lib/sim/inputSanity";
import { noiseChannelsActive } from "@/lib/sim/convergencePolicy";
import { applyItmTarget, isItmTargetActive } from "@/lib/sim/itmTarget";
import { inferGameType } from "@/lib/sim/gameType";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  battleRoyaleLeaderboardPromoPerTournament,
  buildBattleRoyaleLeaderboardPromoConfig,
  isBattleRoyaleRow,
  scheduleHasBattleRoyaleRows,
} from "@/lib/sim/battleRoyaleLeaderboardUi";
import {
  countScheduleTournaments,
  redistributeScheduleCounts,
} from "@/lib/sim/scheduleTarget";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import { plural, WORDS } from "@/lib/i18n/plural";
import { normalizeNumericDraft } from "@/lib/ui/numberDraft";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { getTournamentRowDisplayLabel } from "@/lib/ui/tournamentRowLabel";
import { SCENARIOS } from "@/lib/scenarios";
import { ScheduleToolbarExtras } from "@/components/ScheduleToolbarExtras";
import { sanitizeControlsForBasicMode } from "@/lib/sim/modelPresets";

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
const APP_VERSION = "v0.7.4";
import type {
  SimulationInput,
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
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  compareEnabled: false,
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
  rakebackPct: 20,
  battleRoyaleLeaderboard: DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
};

const DEFAULT_BR_GLOBAL_ITM_PCT = 20;

function isPureBattleRoyaleSchedule(schedule: TournamentRow[]): boolean {
  return (
    schedule.length > 0 &&
    schedule.every((row) => inferGameType(row) === "mystery-royale")
  );
}

export default function Home() {
  const t = useT();
  const { locale } = useLocale();
  const { advanced } = useAdvancedMode();
  const [schedule, setSchedule] = useState<TournamentRow[]>(initialSchedule);
  const [controls, setControls] = useState<ControlsState>(initialControls);
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
  const pureBattleRoyaleSchedule = useMemo(
    () => isPureBattleRoyaleSchedule(schedule),
    [schedule],
  );
  const prevPureBattleRoyaleRef = useRef(pureBattleRoyaleSchedule);
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
    activeSeed,
    selectRun,
    backgroundStatus,
    runPdOnly,
    pdStatus,
    pdProgress,
    pdResultOverride,
  } = useSimulation();
  const lastRunInputRef = useRef<SimulationInput | null>(null);
  const pendingInterruptRef = useRef<number | null>(null);

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
        });
      } else {
        // No saved state — start from the neutral one-chart app state.
        setControls((c) => ({ ...c, seed: freshSeed }));
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

  useEffect(() => {
    const wasPureBattleRoyale = prevPureBattleRoyaleRef.current;
    prevPureBattleRoyaleRef.current = pureBattleRoyaleSchedule;
    if (!pureBattleRoyaleSchedule || wasPureBattleRoyale) return;
    const timeoutId = window.setTimeout(() => {
      setControls((prev) => {
        const hasGenericItmDefault =
          Math.abs(prev.itmGlobalPct - initialControls.itmGlobalPct) < 1e-9;
        if (!hasGenericItmDefault) return prev;
        if (
          prev.itmGlobalEnabled &&
          Math.abs(prev.itmGlobalPct - DEFAULT_BR_GLOBAL_ITM_PCT) < 1e-9
        ) {
          return prev;
        }
        return {
          ...prev,
          itmGlobalEnabled: true,
          itmGlobalPct: DEFAULT_BR_GLOBAL_ITM_PCT,
        };
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [pureBattleRoyaleSchedule]);

  const clearPendingInterrupt = useCallback(() => {
    if (pendingInterruptRef.current == null) return;
    window.clearTimeout(pendingInterruptRef.current);
    pendingInterruptRef.current = null;
  }, []);

  const queueInterruptBackground = useCallback(() => {
    clearPendingInterrupt();
    pendingInterruptRef.current = window.setTimeout(() => {
      pendingInterruptRef.current = null;
      interruptBackground();
    }, 120);
  }, [clearPendingInterrupt, interruptBackground]);

  useEffect(() => clearPendingInterrupt, [clearPendingInterrupt]);

  const buildInput = useCallback(
    (s: TournamentRow[], c: ControlsState): SimulationInput => {
      const effectiveControls = advanced ? c : sanitizeControlsForBasicMode(c);
      return {
        schedule: s,
        scheduleRepeats: effectiveControls.scheduleRepeats,
        samples: effectiveControls.samples,
        bankroll: effectiveControls.bankroll,
        seed: effectiveControls.seed >>> 0,
        finishModel: {
          id: effectiveControls.finishModelId,
          alpha: effectiveControls.alphaOverride ?? undefined,
          empiricalBuckets:
            effectiveControls.finishModelId === "empirical"
              ? effectiveControls.empiricalBuckets
              : undefined,
        },
        usePrimedopePayouts: effectiveControls.usePrimedopePayouts,
        usePrimedopeFinishModel: effectiveControls.usePrimedopeFinishModel,
        usePrimedopeRakeMath: effectiveControls.usePrimedopeRakeMath,
        compareMode: effectiveControls.compareEnabled
          ? effectiveControls.compareMode
          : undefined,
        modelPresetId: effectiveControls.modelPresetId,
        roiStdErr: effectiveControls.roiStdErr,
        roiShockPerTourney: effectiveControls.roiShockPerTourney,
        roiShockPerSession: effectiveControls.roiShockPerSession,
        roiDriftSigma: effectiveControls.roiDriftSigma,
        tiltFastGain: effectiveControls.tiltFastGain,
        tiltFastScale: effectiveControls.tiltFastScale,
        tiltSlowGain: effectiveControls.tiltSlowGain,
        tiltSlowThreshold: effectiveControls.tiltSlowThreshold,
        tiltSlowMinDuration: effectiveControls.tiltSlowMinDuration,
        tiltSlowRecoveryFrac: effectiveControls.tiltSlowRecoveryFrac,
        rakebackFracOfRake: effectiveControls.rakebackPct / 100,
        battleRoyaleLeaderboardPromo: buildBattleRoyaleLeaderboardPromoConfig(
          effectiveControls.battleRoyaleLeaderboard,
          s,
        ),
      };
    },
    [advanced],
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
  const effectiveResultsControls = useMemo(
    () => (advanced ? controls : sanitizeControlsForBasicMode(controls)),
    [advanced, controls],
  );
  const deferredResultsControls = useDeferredValue(effectiveResultsControls);

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
  const deferredPreviewModel = useMemo(
    () => ({
      id: deferredControls.finishModelId,
      alpha: deferredControls.alphaOverride ?? undefined,
      empiricalBuckets:
        deferredControls.finishModelId === "empirical"
          ? deferredControls.empiricalBuckets
          : undefined,
    }),
    [
      deferredControls.finishModelId,
      deferredControls.alphaOverride,
      deferredControls.empiricalBuckets,
    ],
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

  const sanityFindings = useMemo(
    () =>
      checkInputSanity(
        {
          tiltFastGain: deferredControls.tiltFastGain,
          tiltFastScale: deferredControls.tiltFastScale,
          tiltSlowGain: deferredControls.tiltSlowGain,
          tiltSlowThreshold: deferredControls.tiltSlowThreshold,
          bankroll: deferredControls.bankroll,
          finishModelId: deferredControls.finishModelId,
          empiricalBuckets: deferredControls.empiricalBuckets,
        },
        deferredSchedule,
      ),
    [
      deferredControls.tiltFastGain,
      deferredControls.tiltFastScale,
      deferredControls.tiltSlowGain,
      deferredControls.tiltSlowThreshold,
      deferredControls.bankroll,
      deferredControls.finishModelId,
      deferredControls.empiricalBuckets,
      deferredSchedule,
    ],
  );

  const onRun = useCallback(() => {
    clearPendingInterrupt();
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
  }, [clearPendingInterrupt, effectiveSchedule, previewModel, controls, run, buildInput]);

  const runPdOnlyWithLatestInput = useCallback(
    (
      patch: Partial<
        Pick<
          SimulationInput,
          | "usePrimedopePayouts"
          | "usePrimedopeFinishModel"
          | "usePrimedopeRakeMath"
        >
      >,
    ) => {
      const base = lastRunInputRef.current;
      if (!base) return;
      const next = { ...base, ...patch };
      lastRunInputRef.current = next;
      runPdOnly(next);
    },
    [runPdOnly],
  );

  const onUsePdPayoutsChange = useCallback(
    (v: boolean) => {
      clearPendingInterrupt();
      setControls((c) => ({ ...c, usePrimedopePayouts: v }));
      runPdOnlyWithLatestInput({ usePrimedopePayouts: v });
    },
    [clearPendingInterrupt, runPdOnlyWithLatestInput],
  );
  const onUsePdFinishModelChange = useCallback(
    (v: boolean) => {
      clearPendingInterrupt();
      setControls((c) => ({ ...c, usePrimedopeFinishModel: v }));
      runPdOnlyWithLatestInput({ usePrimedopeFinishModel: v });
    },
    [clearPendingInterrupt, runPdOnlyWithLatestInput],
  );
  const onUsePdRakeMathChange = useCallback(
    (v: boolean) => {
      clearPendingInterrupt();
      setControls((c) => ({ ...c, usePrimedopeRakeMath: v }));
      runPdOnlyWithLatestInput({ usePrimedopeRakeMath: v });
    },
    [clearPendingInterrupt, runPdOnlyWithLatestInput],
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
    queueInterruptBackground();
    setSchedule(s.schedule);
    setControls({ ...initialControls, ...s.controls });
    setActiveScenarioId(id);
  }, [queueInterruptBackground]);

  // Stable callbacks for ScheduleEditor / ControlsPanel / sub-controls. Without
  // these the inline arrow handlers below force a fresh reference on every
  // parent render (a single keystroke, a locale flip, a mouse hover). Memoized
  // children then re-render anyway — memo broken.
  const handleScheduleChange = useCallback(
    (s: TournamentRow[]) => {
      queueInterruptBackground();
      setSchedule(s);
      setActiveScenarioId(null);
    },
    [queueInterruptBackground],
  );
  const handleControlsChange = useCallback(
    (c: ControlsState) => {
      queueInterruptBackground();
      setControls(c);
      setActiveScenarioId(null);
    },
    [queueInterruptBackground],
  );
  const handleTournamentTargetChange = useCallback(
    (target: number) => {
      queueInterruptBackground();
      setSchedule((prev) => redistributeScheduleCounts(prev, target));
      setControls((prev) =>
        prev.scheduleRepeats === 1 ? prev : { ...prev, scheduleRepeats: 1 },
      );
      setActiveScenarioId(null);
    },
    [queueInterruptBackground],
  );
  const tournamentsPerSchedule = useMemo(
    () => countScheduleTournaments(schedule),
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
        deferredSchedule,
      ),
    [estimateMs, controls.samples, controls.scheduleRepeats, deferredSchedule],
  );
  const scheduleGlobalItmPct = useMemo(
    () => (controls.itmGlobalEnabled ? controls.itmGlobalPct : null),
    [controls.itmGlobalEnabled, controls.itmGlobalPct],
  );
  const hasBattleRoyaleRows = useMemo(
    () => scheduleHasBattleRoyaleRows(effectiveSchedule),
    [effectiveSchedule],
  );
  const brLeaderboardPreview = useMemo(() => {
    const repeats = Math.max(1, controls.scheduleRepeats);
    let tournaments = 0;
    let totalBuyIn = 0;
    for (const row of effectiveSchedule) {
      if (!isBattleRoyaleRow(row)) continue;
      const rowTournaments = Math.max(0, row.count) * repeats;
      tournaments += rowTournaments;
      totalBuyIn += rowTournaments * Math.max(0, row.buyIn);
    }
    return { tournaments, totalBuyIn };
  }, [effectiveSchedule, controls.scheduleRepeats]);
  const brLeaderboardPromoPerTournament = useMemo(
    () =>
      battleRoyaleLeaderboardPromoPerTournament(
        deferredControls.battleRoyaleLeaderboard,
        deferredSchedule,
      ),
    [deferredControls.battleRoyaleLeaderboard, deferredSchedule],
  );
  const handleScheduleReset = useCallback(() => {
    queueInterruptBackground();
    setSchedule([
      {
        id: crypto.randomUUID(),
        label: "",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        payoutStructure: "mtt-standard",
        gameType: "freezeout",
        count: 1,
      },
    ]);
    setActiveScenarioId(null);
  }, [queueInterruptBackground]);
  const scheduleToolbarExtras = useMemo(
    () =>
      advanced ? (
        <ScheduleToolbarExtras
          t={t}
          activeScenarioId={activeScenarioId}
          loadScenario={loadScenario}
          onReset={handleScheduleReset}
          disabled={running}
        />
      ) : null,
    [advanced, t, activeScenarioId, loadScenario, handleScheduleReset, running],
  );
  const doneSummary = useMemo(
    () =>
      status === "done" && result
        ? (() => {
            const observedPromo =
              result.battleRoyaleLeaderboardPromo?.expectedPayout ?? 0;
            const mean = result.stats.mean + observedPromo;
            return {
              mean,
              median: result.stats.median + observedPromo,
              roi: mean / result.totalBuyIn,
              probProfit: result.stats.probProfit,
              riskOfRuin: result.stats.riskOfRuin,
              worstDrawdown: result.stats.maxDrawdownP99,
              longestCashlessWorst: result.stats.longestCashlessWorst,
              elapsedMs,
              resultsAnchorId: "results-top",
            };
          })()
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
  const previewSourceRow = useMemo(() => {
    if (!previewRow) return undefined;
    return schedule.find((r) => r.id === previewRow.id);
  }, [previewRow, schedule]);

  const previewRowId_ = previewRow?.id;
  const onPreviewRowChange = useCallback(
    (updates: Partial<TournamentRow>) => {
      if (!previewRowId_) return;
      queueInterruptBackground();
      setSchedule((prev) =>
        prev.map((r) => (r.id === previewRowId_ ? { ...r, ...updates } : r)),
      );
    },
    [previewRowId_, queueInterruptBackground],
  );
  const fitRowClosest = useCallback(
    (rowId: string) => {
      queueInterruptBackground();
      setSchedule((prev) => {
        const liveSchedule = applyItmTarget(prev, itmTargetCfg);
        const issue = validateSchedule(liveSchedule, previewModel).issues.find(
          (i) => i.rowId === rowId,
        );
        if (!issue) return prev;
        return prev.map((r) =>
          r.id === rowId
            ? chooseClosestFeasibilityFix(r, issue, previewModel, itmTargetCfg)
                .row
            : r,
        );
      });
      setActiveScenarioId(null);
    },
    [itmTargetCfg, previewModel, queueInterruptBackground],
  );

  const fitAllClosest = useCallback(() => {
    queueInterruptBackground();
    setSchedule((prev) =>
      (() => {
        const liveSchedule = applyItmTarget(prev, itmTargetCfg);
        const issues = validateSchedule(liveSchedule, previewModel).issues;
        if (issues.length === 0) return prev;
        const issueByRow = new Map(issues.map((i) => [i.rowId, i]));
        return prev.map((r) => {
          const issue = issueByRow.get(r.id);
          return issue
            ? chooseClosestFeasibilityFix(r, issue, previewModel, itmTargetCfg)
                .row
            : r;
        });
      })(),
    );
    setActiveScenarioId(null);
  }, [itmTargetCfg, previewModel, queueInterruptBackground]);

  const onSaveUserPreset = () => {
    const name = window.prompt(t("userPreset.promptName"));
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    addUserPreset(trimmed, { v: 1, schedule, controls });
    setUserPresets(loadUserPresets());
  };

  const onLoadUserPreset = (p: UserPreset) => {
    queueInterruptBackground();
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
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-3 sm:px-6 sm:py-4 xl:max-w-[1800px] 2xl:max-w-[2200px] 3xl:max-w-[2500px] 4xl:max-w-[2900px] min-[2560px]:!max-w-[3400px]">
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
              {APP_VERSION}
            </a>
          </div>
          <CornerToggles />
        </div>

        {/* User-saved presets — collapsible so they don't push the schedule below the fold */}
        {advanced && (
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
        )}
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
      {/* Schedule infeasibility — sticky-top banner only when MULTIPLE rows
          are broken (single-row issues live inline inside the row card; see
          ScheduleRow). The condensed banner just summarizes the count and
          offers a one-click bulk fix; the run-button block in ControlsPanel
          carries the precise reason for any single broken row. */}
      {feasibility.issues.length > 1 && (
        <div
          id="feasibility-banner"
          className="sticky top-2 z-30 flex flex-wrap items-center gap-3 rounded-xl border-2 border-rose-500/70 bg-gradient-to-br from-rose-950/85 to-rose-900/70 px-4 py-3 shadow-[0_8px_24px_-6px_rgba(244,63,94,0.4)] backdrop-blur"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/30 text-base font-bold text-rose-100">
            !
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-bold uppercase tracking-wider text-rose-50">
              {t("shape.blockedTitle")}
            </div>
            <div className="text-[12px] leading-snug text-rose-100/85">
              {t("shape.blockedHint")} ·{" "}
              <span className="font-mono text-rose-200/90">
                {feasibility.issues.length} {t("shape.blockedRow").toLowerCase()}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={fitAllClosest}
            className="rounded-md border border-rose-300/70 bg-rose-500/30 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-50 transition-colors hover:border-rose-200 hover:bg-rose-500/45"
          >
            {t("shape.fixAllClosest")}
          </button>
        </div>
      )}

      <section className="flex min-w-0 flex-col gap-3">
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
          <div className="flex min-w-0 flex-col gap-3">
            <CompactPanelHeader
              number="01"
              title={t("section.schedule.title")}
              accent="var(--color-spade)"
              mark="♠"
            />
            <ScheduleEditor
              schedule={schedule}
              onChange={handleScheduleChange}
              disabled={running}
              globalItmPct={scheduleGlobalItmPct}
              globalRakebackPct={controls.rakebackPct}
              toolbarExtras={scheduleToolbarExtras}
              feasibilityIssues={feasibility.issues}
              onFixRowClosest={fitRowClosest}
            />
            {hasBattleRoyaleRows && (
              <BattleRoyaleLeaderboardControl
                value={controls}
                onChange={handleControlsChange}
                disabled={running}
                advanced={advanced}
                previewTournaments={brLeaderboardPreview.tournaments}
                previewBuyIn={brLeaderboardPreview.totalBuyIn}
              />
            )}

            <CompactPanelHeader
              number="02"
              title={t("section.controls.title")}
              accent="var(--color-diamond)"
              mark="♦"
            />
            <ControlsPanel
              value={controls}
              onChange={handleControlsChange}
              onTournamentTargetChange={handleTournamentTargetChange}
              onRun={onRun}
              onCancel={cancel}
              globalControls={
                <>
                  <GlobalItmControl
                    value={controls}
                    onChange={handleControlsChange}
                    disabled={running}
                  />
                  <GlobalRakebackControl
                    value={controls}
                    onChange={handleControlsChange}
                    disabled={running}
                    showBattleRoyalePreset={hasBattleRoyaleRows}
                  />
                  <BankrollControl
                    value={controls}
                    onChange={handleControlsChange}
                    disabled={running}
                    abi={abi}
                  />
                </>
              }
              running={running}
              progress={progress}
              stage={stage}
              estimatedMs={estimatedMs}
              tournamentsPerSchedule={tournamentsPerSchedule}
              tournamentsPerSession={tournamentsPerSession}
              activeSeed={activeSeed}
              doneSummary={doneSummary}
              runBlockedReason={
                feasibility.ok ? null : t("shape.blockedTitle")
              }
              runBlockedScrollTarget={
                feasibility.ok
                  ? null
                  : feasibility.issues.length === 1
                    ? `schedule-row-${feasibility.issues[0].rowId}`
                    : "feasibility-banner"
              }
            />

            <PayoutStructureCard schedule={deferredSchedule} />
          </div>

          <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-3 xl:self-start">
            {hydrated && sanityFindings.length > 0 && (
              <Card className="border-amber-400/40 bg-amber-400/5 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/30 text-[11px] font-bold text-amber-100">
                    !
                  </span>
                  <span className="font-display text-[12px] font-bold uppercase tracking-wider text-amber-100">
                    {t("sanity.title")}
                  </span>
                </div>
                <div className="mb-2 text-[10px] leading-snug text-amber-100/70">
                  {t("sanity.subtitle")}
                </div>
                <ul className="flex flex-col gap-1.5 text-[11px] leading-snug text-amber-200/95">
                  {sanityFindings.map((f, i) => {
                    const raw = t(`sanity.${f.id}`);
                    const msg = f.rowLabel
                      ? raw.replace("{row}", f.rowLabel)
                      : raw;
                    return (
                      <li
                        key={`${f.id}-${f.rowIdx ?? "g"}-${i}`}
                        className="flex gap-2"
                      >
                        <span className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>{msg}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {previewRow && (
              <Card className="data-surface-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
                    <span className="mr-2 text-xs" style={{ color: "var(--color-diamond)" }}>🔬</span>
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
                          {getTournamentRowDisplayLabel(r, t)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <FinishPMFPreview
                  row={previewRow}
                  model={previewModel}
                  rakebackPct={deferredControls.rakebackPct}
                  leaderboardPromoPerEntry={
                    isBattleRoyaleRow(previewRow) ? brLeaderboardPromoPerTournament : 0
                  }
                  itmLocked={itmTargetLocked && previewSourceRow?.itmRate == null}
                  onRowChange={onPreviewRowChange}
                />
              </Card>
            )}
          </aside>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!result && (
        <div className="grid gap-4 4xl:grid-cols-2 4xl:items-start">
          <Card className="min-w-0 p-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
              {t("chart.convergence")}
            </div>
            <div className="mb-1 text-[11px] text-[color:var(--color-fg-muted)]">
              {t("chart.convergence.sub")}
            </div>
            <ConvergenceChart
              schedule={deferredSchedule}
              finishModel={deferredPreviewModel}
              noiseActive={noiseChannelsActive(deferredResultsControls)}
            />
          </Card>

          <Card className="min-w-0 p-5">
            <ProveEdgeCard
              schedule={deferredSchedule}
              finishModel={deferredPreviewModel}
              noiseActive={noiseChannelsActive(deferredResultsControls)}
            />
          </Card>
        </div>
      )}

      {result && (
        <>
          <Section
            number="03"
            suit="club"
            title={t("section.results.title")}
            subtitle={t("section.results.subtitle")
              .replace("{samples}", result.samples.toLocaleString(locale === "ru" ? "ru-RU" : "en-US"))
              .replace("{tourneys}", tournamentsPerSession.toLocaleString(locale === "ru" ? "ru-RU" : "en-US"))}
            anchorId="results-top"
          >
            <ResultsView
              result={result}
              bankroll={deferredResultsControls.bankroll}
              schedule={deferredSchedule}
              scheduleRepeats={deferredScheduleRepeats}
              compareMode={
                deferredResultsControls.compareEnabled
                  ? deferredResultsControls.compareMode
                  : undefined
              }
              modelPresetId={deferredResultsControls.modelPresetId}
              finishModelId={deferredResultsControls.finishModelId}
              finishModel={deferredPreviewModel}
              settings={deferredResultsControls}
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
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v076.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v076.summary")}</li>
              <li>{t("changelog.v076.pdWeakness")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v075.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v075.summary")}</li>
              <li>{t("changelog.v075.inputs")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v074v073.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v074v073.summary")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v07x.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v07x.summary")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.early.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.early.summary")}</li>
            </ul>
          </div>
        </details>
      </footer>
    </div>
  );
}

function CompactPanelHeader({
  number,
  title,
  accent,
  mark,
  actions,
}: {
  number: string;
  title: string;
  accent: string;
  mark?: string;
  actions?: React.ReactNode;
}) {
  const headerStyle = {
    "--section-accent": accent,
    background:
      "linear-gradient(135deg, color-mix(in oklab, var(--c-bg-elev-2) 86%, transparent), color-mix(in oklab, var(--c-bg) 72%, transparent))",
  } as CSSProperties;

  return (
    <div
      className="relative isolate flex min-w-0 flex-wrap items-stretch justify-between overflow-hidden rounded-xl border border-[color:var(--color-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_12px_34px_rgba(0,0,0,0.16)]"
      style={headerStyle}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--section-accent),color-mix(in_srgb,var(--section-accent)_18%,transparent),transparent)] opacity-80"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[color:var(--section-accent)] opacity-90"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--section-accent)_16%,transparent)_0%,transparent_68%)]"
      />

      <div className="flex min-w-0 flex-1 items-stretch">
        <div className="relative flex w-[6.5rem] shrink-0 items-center justify-center pl-3 pr-4 sm:w-[8rem] sm:pl-4 sm:pr-5">
          <span className="section-num text-[48px] tabular-nums sm:text-[58px]">
            {number}
          </span>
          <span
            aria-hidden
            className="absolute right-0 top-1/2 h-14 w-px -translate-y-1/2 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--section-accent)_54%,var(--color-border-strong)),transparent)]"
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5">
          <div className="relative hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border-strong)]/80 bg-[color:var(--color-bg)]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_color-mix(in_srgb,var(--section-accent)_9%,transparent)] sm:flex">
            {mark && (
              <span
                aria-hidden
                className="text-[23px] font-black leading-none text-[color:var(--section-accent)] drop-shadow-[0_0_14px_color-mix(in_srgb,var(--section-accent)_28%,transparent)]"
              >
                {mark}
              </span>
            )}
            <span
              aria-hidden
              className="absolute -bottom-1 left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-[color:var(--section-accent)]"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              {mark && (
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border-strong)]/75 bg-[color:var(--color-bg)]/55 text-[15px] font-black leading-none text-[color:var(--section-accent)] sm:hidden"
                >
                  {mark}
                </span>
              )}
              <h2 className="min-w-0 bg-transparent text-[21px] font-black uppercase leading-none tracking-[0.105em] text-[color:var(--color-fg)] [background:none] [box-shadow:none] sm:text-[28px]">
                {title}
              </h2>
            </div>
            <div className="mt-3 flex max-w-[24rem] items-center gap-3">
              <span className="h-[4px] w-[min(10rem,42%)] shrink-0 rounded-full bg-[color:var(--section-accent)] shadow-[0_0_22px_color-mix(in_srgb,var(--section-accent)_30%,transparent)]" />
              <span className="h-[2px] min-w-12 flex-1 rounded-full bg-[color:var(--section-accent)] opacity-30" />
            </div>
          </div>
        </div>
      </div>
      {actions && (
        <div className="flex min-w-0 items-center px-4 py-3">{actions}</div>
      )}
    </div>
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
      <label className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-accent)]/90">
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
            const raw = normalizeNumericDraft(e.target.value);
            if (raw !== e.target.value) e.target.value = raw;
            const v = Number(raw);
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
  showBattleRoyalePreset,
}: {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  disabled?: boolean;
  showBattleRoyalePreset: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-2.5">
      <span
        className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-accent)]/90"
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
            const raw = normalizeNumericDraft(e.target.value);
            if (raw !== e.target.value) e.target.value = raw;
            const v = Number(raw);
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
      {showBattleRoyalePreset && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, rakebackPct: 40 })}
          title={t("controls.rakeback.avgBrTitle")}
          aria-pressed={value.rakebackPct === 40}
          className={
            "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 " +
            (value.rakebackPct === 40
              ? "bg-[color:var(--color-accent)]/18 text-[color:var(--color-accent)] ring-1 ring-inset ring-[color:var(--color-accent)]/70"
              : "border border-dashed border-[color:var(--color-accent)]/55 text-[color:var(--color-accent)]/80 hover:border-solid hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)]")
          }
        >
          {value.rakebackPct === 40 ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12l5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 19V5M6 11l6-6 6 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {t("controls.rakeback.avgBr")}
        </button>
      )}
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
      <span className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-accent)]/90">
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
