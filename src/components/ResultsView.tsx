"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactEventHandler,
} from "react";
import type {
  FinishModelId,
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import { type RunMode } from "@/lib/trajectorySelection";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import type { DictKey } from "@/lib/i18n/dict";
import { STANDARD_PRESETS } from "@/lib/sim/modelPresets";
import {
  DEFAULT_EXTREME_STYLES,
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  LINE_STYLE_PRESET_META,
  LINE_STYLE_PRESET_ORDER,
  PRIMEDOPE_PANE_PRESET,
  applyLineStyleOverrides,
  isLineEnabled,
  loadExtremeStyles,
  loadLineStylePreset,
  loadLineStyleOverrides,
  saveExtremeStyles,
  saveLineStylePreset,
  saveLineStyleOverrides,
  type ExtremeKey,
  type ExtremeStyles,
  type LineStylePreset,
  type LineStylePresetId,
  type LineStyleOverrides,
  type OverridableLineKey,
} from "@/lib/lineStyles";
import {
  DEFAULT_REF_LINES,
  loadRefLines,
  roiLabel,
  saveRefLines,
  type RefLineConfig,
} from "@/lib/results/refLines";
import {
  computeSatelliteStats,
  hasSatelliteRow,
  isSatelliteOnlySchedule,
} from "@/lib/results/satellite";
import {
  computeExpectedRakebackCurve,
  shiftResultByRakeback,
  stripJackpots,
} from "@/lib/results/trajectoryTransforms";
import type { ControlsState } from "./ControlsPanel";
import { DistributionChart } from "./charts/DistributionChart";
import { ConvergenceChart } from "./charts/ConvergenceChart";
import { DecompositionChart } from "./charts/DecompositionChart";
import {
  BigStat,
  MiniStat,
  StatGroup,
} from "./results/StatCards";
import {
  OurModelWeaknessCard,
  PrimeDopeWeaknessCard,
  SettingsDumpCard,
} from "./results/ResultsPanels";
import {
  TrajectoryPlot,
  buildTrajectoryAssets,
  computeYRange,
} from "./results/TrajectoryPlot";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";

// Typed map FinishModelId → DictKey. Adding a new FinishModelId without
// a dict entry is a compile error instead of a runtime "Cannot read
// properties of undefined (reading 'ru')" crash in LocaleProvider.
const FINISH_MODEL_LABEL_KEY: Record<FinishModelId, DictKey> = {
  "power-law": "model.power-law",
  "linear-skill": "model.linear-skill",
  "stretched-exp": "model.stretched-exp",
  "plackett-luce": "model.plackett-luce",
  uniform: "model.uniform",
  empirical: "model.empirical",
  "freeze-realdata-step": "model.freeze-realdata-step",
  "freeze-realdata-linear": "model.freeze-realdata-linear",
  "freeze-realdata-tilt": "model.freeze-realdata-tilt",
  "pko-realdata-step": "model.pko-realdata-step",
  "pko-realdata-linear": "model.pko-realdata-linear",
  "pko-realdata-tilt": "model.pko-realdata-tilt",
  "mystery-realdata-step": "model.mystery-realdata-step",
  "mystery-realdata-linear": "model.mystery-realdata-linear",
  "mystery-realdata-tilt": "model.mystery-realdata-tilt",
  "powerlaw-realdata-influenced": "model.powerlaw-realdata-influenced",
};

interface Props {
  result: SimulationResult;
  compareResult?: SimulationResult | null;
  bankroll?: number;
  schedule?: TournamentRow[];
  scheduleRepeats?: number;
  compareMode?: "random" | "primedope";
  modelPresetId?: string;
  finishModelId?: FinishModelId;
  finishModel?: SimulationInput["finishModel"];
  settings?: ControlsState;
  elapsedMs?: number | null;
  availableRuns?: number;
  activeRunIdx?: number;
  onSelectRun?: (idx: number) => void;
  backgroundStatus?: "idle" | "computing" | "full";
  onUsePdPayoutsChange?: (v: boolean) => void;
  onUsePdFinishModelChange?: (v: boolean) => void;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideResult?: SimulationResult | null;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
}

function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const compactMoney = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(0)}`;
};
const money = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// Unit-aware money formatters. The module-level `money` / `compactMoney`
// defined above stay as the USD defaults; the Context lets ResultsView
// swap them for ABI-denominated versions without threading props through
// every helper card.
function makeAbiMoney(abi: number) {
  const safe = abi > 0 ? abi : 1;
  const fmt = (v: number, digits: number) => {
    const sign = v < 0 ? "−" : "";
    const n = Math.abs(v) / safe;
    return `${sign}${n.toFixed(digits)} ABI`;
  };
  return {
    money: (v: number) => fmt(v, Math.abs(v) / safe >= 100 ? 0 : 1),
    compactMoney: (v: number) => {
      const sign = v < 0 ? "−" : "";
      const n = Math.abs(v) / safe;
      if (n >= 1000) return `${sign}${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k ABI`;
      if (n >= 100) return `${sign}${n.toFixed(0)} ABI`;
      if (n === 0) return "0 ABI";
      return `${sign}${n.toFixed(1)} ABI`;
    },
  };
}

interface MoneyFmt {
  money: (v: number) => string;
  compactMoney: (v: number) => string;
}

type UnitMode = "money" | "abi";

interface UnitCtxValue extends MoneyFmt {
  unit: UnitMode;
  setUnit: (v: UnitMode) => void;
}

const defaultMoneyFmt: MoneyFmt = { money, compactMoney };
const MoneyFmtContext = createContext<UnitCtxValue>({
  ...defaultMoneyFmt,
  unit: "abi",
  setUnit: () => {},
});
const useMoneyFmt = () => useContext(MoneyFmtContext);

// ABI value for the current result — exposed via context so per-widget
// UnitScope providers can build their own ABI-denominated formatters
// without threading the scalar through every sub-component.
const AbiContext = createContext<number>(1);

function loadUnitMode(key: string): UnitMode {
  if (typeof localStorage === "undefined") return "abi";
  try {
    const v = localStorage.getItem(key);
    return v === "money" || v === "abi" ? v : "abi";
  } catch {
    return "abi";
  }
}
function saveUnitMode(key: string, v: UnitMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, v);
  } catch {}
}

const GLOBAL_UNIT_KEY = "tvs.unit.global.v1";

/**
 * Per-widget unit toggle scope. Owns its own `money`/`abi` state, defaulting
 * to ABI, persisted under `tvs.unit.<id>.v1`. Any InlineUnitToggle rendered
 * inside will flip only this scope — sibling widgets stay independent.
 */
function UnitScope({ id, children }: { id: string; children: ReactNode }) {
  const abi = useContext(AbiContext);
  const storageKey = `tvs.unit.${id}.v1`;
  const [unit, setUnit] = useLocalStorageState<UnitMode>(
    storageKey,
    () => loadUnitMode(storageKey),
    (v) => saveUnitMode(storageKey, v),
    "abi",
  );
  const value = useMemo<UnitCtxValue>(() => {
    const fmt = unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt;
    return { ...fmt, unit, setUnit };
    // setUnit identity rotates on every render of useLocalStorageState — depend
    // on storageKey instead so the memo only refreshes when scope or unit change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, abi, storageKey]);
  return (
    <MoneyFmtContext.Provider value={value}>
      {children}
    </MoneyFmtContext.Provider>
  );
}
const intFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Delta displayed on the PD-badge row: how much PD's value differs from ours,
 * relative to ours. Positive ⇒ PD is higher (PD row shows ▲X%, matching how a
 * reader naturally parses "freezeouts are 13% more").
 */
function pctDelta(cur: number, pd: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(pd)) return null;
  const anchor = Math.abs(cur) > 1e-9 ? Math.abs(cur) : Math.abs(pd);
  if (anchor < 1e-9) return null;
  return (pd - cur) / anchor;
}

function mergedHistogramDomain(
  ...histograms: Array<{ binEdges: readonly number[] } | null | undefined>
): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const hist of histograms) {
    const edges = hist?.binEdges;
    if (!edges || edges.length < 2) continue;
    lo = Math.min(lo, edges[0]);
    hi = Math.max(hi, edges[edges.length - 1]);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
  return [lo, hi];
}

function ResultsViewImpl({
  result,
  compareResult,
  bankroll = 0,
  schedule,
  scheduleRepeats,
  compareMode = "primedope",
  modelPresetId,
  finishModelId,
  finishModel,
  settings,
  elapsedMs,
  availableRuns = 0,
  activeRunIdx = 0,
  onSelectRun,
  backgroundStatus = "idle",
  onUsePdPayoutsChange,
  onUsePdFinishModelChange,
  onUsePdRakeMathChange,
  pdOverrideResult,
  pdOverrideStatus = "idle",
  pdOverrideProgress = 0,
}: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();

  const pdChart = pdOverrideResult ?? result.comparison;
  // When comparing against PrimeDope on a PKO schedule, the right pane
  // actually shows "same schedule, bounties stripped" because PrimeDope
  // has no PKO support — useSimulation swaps the pass. Detect from the
  // schedule so we can relabel the pane and explain the substitution.
  const hasPko = (schedule ?? []).some(
    (r) => (r.bountyFraction ?? 0) > 0,
  );
  const pdPkoFallback = compareMode === "primedope" && hasPko;
  const overlayLabel = pdPkoFallback ? t("chart.overlay.freezeouts") : "PrimeDope";

  // Default ON in compare mode: the whole point of the side-by-side view is
  // to see how the two models differ, and the tail-level differences live in
  // the histograms (max-DD, final profit), not the trajectory fan.
  const [overlayPd, setOverlayPd] = useState(true);

  // Shared RB view switch — drives trajectory + profit-histogram + scalar-
  // shiftable stats (BigStat expectedProfit / probProfit, and their PD twins).
  // Engine bakes RB into everything, so default matches engine output when
  // RB > 0; toggling OFF reveals the game-only view. Drawdown / streak stats
  // stay as engine output since RB reshapes those nonlinearly.
  const rbFrac = Math.max(0, (settings?.rakebackPct ?? 0) / 100);
  // Rakeback %, schedule, and repeats all feed a chain of heavy post-hoc
  // memos below (share-curve rebuild + shifted trajectory/distribution
  // clones on the stored chart assets).
  // Typing in the rakeback field or clicking through the buy-in / format
  // dropdown would otherwise block the keystroke on that whole chain.
  // Defer the values so the input frame commits first; React then re-runs
  // the heavy memos behind the input. `rbRecomputing` drives a small
  // "пересчёт…" badge so the gap between click and visible update isn't
  // read as "frozen".
  const deferredRbFrac = useDeferredValue(rbFrac);
  const deferredSchedule = useDeferredValue(schedule);
  const deferredScheduleRepeats = useDeferredValue(scheduleRepeats);
  const rbRecomputing =
    rbFrac !== deferredRbFrac ||
    schedule !== deferredSchedule ||
    scheduleRepeats !== deferredScheduleRepeats;
  const rakebackCurve = useMemo(
    () =>
      deferredSchedule && deferredScheduleRepeats != null
        ? computeExpectedRakebackCurve(
            deferredSchedule,
            deferredScheduleRepeats,
            deferredRbFrac,
            result.samplePaths.x,
          )
        : null,
    [deferredSchedule, deferredScheduleRepeats, deferredRbFrac, result.samplePaths.x],
  );
  const pdRakebackCurve = useMemo(
    () =>
      pdChart && deferredSchedule && deferredScheduleRepeats != null
        ? computeExpectedRakebackCurve(
            deferredSchedule,
            deferredScheduleRepeats,
            deferredRbFrac,
            pdChart.samplePaths.x,
          )
        : null,
    [pdChart, deferredSchedule, deferredScheduleRepeats, deferredRbFrac],
  );
  // Four independent region toggles — each controls whether its region
  // shows RB baked in (engine default) or subtracts it for the game-only view.
  // All default to rbFrac > 0 so initial view matches engine output.
  const [rbTraj, setRbTraj] = useState<boolean>(rbFrac > 0);
  const [rbStats, setRbStats] = useState<boolean>(rbFrac > 0);
  const [rbDist, setRbDist] = useState<boolean>(rbFrac > 0);
  // Mystery / mystery-royale jackpot runs are a handful of samples out of
  // hundreds of thousands, but their ratio ≥ 100× mean envelope blows up
  // the distribution x-axis and the trajectory y-axis. Toggle strips them
  // from both charts using the deterministic `jackpotMask` stored on the
  // result. Only surfaced when the schedule contains a mystery row so
  // non-mystery runs don't see a dead checkbox.
  const hasMysteryRow = useMemo(
    () =>
      schedule?.some(
        (r) =>
          r.gameType === "mystery" || r.gameType === "mystery-royale",
      ) ?? false,
    [schedule],
  );
  const hideJackpotsTouchedRef = useRef(false);
  const [hideJackpots, setHideJackpotsState] = useState<boolean>(true);
  const deferredHideJackpots = useDeferredValue(hideJackpots);
  const setHideJackpots = useCallback((next: boolean) => {
    hideJackpotsTouchedRef.current = true;
    setHideJackpotsState(next);
  }, []);
  useEffect(() => {
    // Mystery/BR tails are real data, but one early jackpot can make the
    // default fan unreadable. Sync the default with the detected schedule
    // format until the user explicitly toggles it (ref-guarded so we don't
    // re-stomp their choice).
    if (hasMysteryRow && !hideJackpotsTouchedRef.current) {
      setHideJackpotsState(true);
    }
  }, [hasMysteryRow]);
  // rbFrac change resets each region toggle back to default. Users can flip
  // individual regions after; a new rbFrac (e.g. rakeback % edit in controls)
  // wipes those overrides. Three sets in one pass — React batches them.
  useEffect(() => {
    const on = rbFrac > 0;
    setRbTraj(on);
    setRbStats(on);
    setRbDist(on);
  }, [rbFrac]);
  // Build chart-facing variants separately from stats-facing variants so chart
  // filters like "hide jackpots" never leak into the scalar stats panels.
  const resultForCharts = useMemo(
    () => (deferredHideJackpots ? stripJackpots(result) : result),
    [result, deferredHideJackpots],
  );
  const pdChartForCharts = useMemo(
    () => (deferredHideJackpots && pdChart ? stripJackpots(pdChart) : pdChart),
    [pdChart, deferredHideJackpots],
  );
  const resultChartsNoRb = useMemo(
    () =>
      rakebackCurve
        ? shiftResultByRakeback(resultForCharts, rakebackCurve, -1)
        : resultForCharts,
    [resultForCharts, rakebackCurve],
  );
  const pdChartChartsNoRb = useMemo(
    () =>
      pdChartForCharts && pdRakebackCurve
        ? shiftResultByRakeback(pdChartForCharts, pdRakebackCurve, -1)
        : pdChartForCharts,
    [pdChartForCharts, pdRakebackCurve],
  );
  const resultStatsNoRb = useMemo(
    () => (rakebackCurve ? shiftResultByRakeback(result, rakebackCurve, -1) : result),
    [result, rakebackCurve],
  );
  const pdChartStatsNoRb = useMemo(
    () =>
      pdChart && pdRakebackCurve
        ? shiftResultByRakeback(pdChart, pdRakebackCurve, -1)
        : pdChart,
    [pdChart, pdRakebackCurve],
  );
  const pickChartResult = (on: boolean) =>
    on ? resultForCharts : resultChartsNoRb;
  const pickChartPd = (on: boolean) =>
    on ? pdChartForCharts : pdChartChartsNoRb;
  const displayResultTraj = pickChartResult(rbTraj);
  const displayPdChartTraj = pickChartPd(rbTraj);
  const displayResultStats = rbStats ? result : resultStatsNoRb;
  const displayPdChartStats = rbStats ? pdChart : pdChartStatsNoRb;
  const displayResultDist = pickChartResult(rbDist);
  const displayPdChartDist = pickChartPd(rbDist);
  // Keep drawdown / streak / recovery views on the engine's full-sample
  // output. Recomputing them from stored hi-res paths would silently switch
  // the UI from "all samples" to "~1000 saved samples" and overstate
  // precision.
  const displayResultStreaks = result;
  const displayPdChartStreaks = pdChart;

  // Freeze the profit-dist x domain across both RB states so toggling
  // rbDist translates the bars inside a stable axis instead of auto-rescaling.
  const distProfitXDomain = useMemo<[number, number] | undefined>(() => {
    if (!rakebackCurve) return undefined;
    return mergedHistogramDomain(
      result.histogram,
      resultChartsNoRb.histogram,
      pdChart?.histogram,
      pdChartChartsNoRb?.histogram,
    );
  }, [
    rakebackCurve,
    result,
    resultChartsNoRb,
    pdChart,
    pdChartChartsNoRb,
  ]);
  const streakDrawdownXDomain = useMemo<[number, number] | undefined>(
    () =>
      mergedHistogramDomain(
        displayResultStreaks.drawdownHistogram,
        displayPdChartStreaks?.drawdownHistogram,
      ),
    [displayResultStreaks, displayPdChartStreaks],
  );
  const streakBreakevenXDomain = useMemo<[number, number] | undefined>(() => {
    return mergedHistogramDomain(
      displayResultStreaks.longestBreakevenHistogram,
      displayPdChartStreaks?.longestBreakevenHistogram,
    );
  }, [displayResultStreaks, displayPdChartStreaks]);
  const streakRecoveryXDomain = useMemo<[number, number] | undefined>(() => {
    return mergedHistogramDomain(
      displayResultStreaks.recoveryHistogram,
      displayPdChartStreaks?.recoveryHistogram,
    );
  }, [displayResultStreaks, displayPdChartStreaks]);

  const shiftedStats = displayResultStats.stats;
  const shiftedPdStats = displayPdChartStats?.stats;
  const observedPromoShift =
    result.battleRoyaleLeaderboardPromo?.expectedPayout ?? 0;
  const totalExpectedProfit =
    displayResultStats.expectedProfit + observedPromoShift;
  const totalMean = shiftedStats.mean + observedPromoShift;
  const totalMedian = shiftedStats.median + observedPromoShift;
  const totalMin = shiftedStats.min + observedPromoShift;
  const totalMax = shiftedStats.max + observedPromoShift;
  const s = result.stats;
  const pdStats = pdChart?.stats;
  const pdObservedPromoShift =
    pdChart?.battleRoyaleLeaderboardPromo?.expectedPayout ?? 0;
  const pdExpectedProfit =
    displayPdChartStats != null
      ? displayPdChartStats.expectedProfit + pdObservedPromoShift
      : undefined;
  const pdBadgeLabel = pdPkoFallback ? t("stat.pd.badge.freezeouts") : undefined;
  const roi = totalMean / displayResultStats.totalBuyIn;
  const expectedProfitRangeRatio =
    Math.abs(totalMax - totalMin) > 1e-9
      ? (totalExpectedProfit - totalMin) /
        (totalMax - totalMin)
      : 0.5;
  const bankrollSafetyRatio =
    Number.isFinite(s.minBankrollRoR5pct) &&
    Number.isFinite(s.minBankrollRoR1pct) &&
    s.minBankrollRoR1pct > s.minBankrollRoR5pct
      ? (bankroll - s.minBankrollRoR5pct) /
        (s.minBankrollRoR1pct - s.minBankrollRoR5pct)
      : 0.5;
  const modelPreset = modelPresetId
    ? STANDARD_PRESETS.find((p) => p.id === modelPresetId)
    : undefined;
  const modelLabel = modelPreset
    ? t(modelPreset.labelKey)
    : finishModelId
    ? t(FINISH_MODEL_LABEL_KEY[finishModelId])
    : t("twin.runA");

  const abi = useMemo(() => {
    const xs = result.samplePaths.x;
    const lastX = xs[xs.length - 1] || 1;
    return result.totalBuyIn / lastX;
  }, [result]);
  const [unit, setUnit] = useLocalStorageState<UnitMode>(
    GLOBAL_UNIT_KEY,
    () => loadUnitMode(GLOBAL_UNIT_KEY),
    (v) => saveUnitMode(GLOBAL_UNIT_KEY, v),
    "abi",
  );
  const moneyFmt = useMemo<UnitCtxValue>(() => {
    const fmt = unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt;
    return { ...fmt, unit, setUnit };
    // setUnit identity rotates on every render of useLocalStorageState — see
    // UnitScope's comment for why depending on it would re-create the memo each
    // render and rerender the entire MoneyFmtContext subtree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, abi]);
  // Shadow the module-level formatter inside ResultsView so existing
  // money(...) call sites pick up the unit-aware pair.
  const { money } = moneyFmt;
  const tourneysWord = t("unit.tourneys");

  const [lineStylePresetId, setLineStylePresetId] =
    useLocalStorageState<LineStylePresetId>(
      "tvs.lineStylePreset.v1",
      loadLineStylePreset,
      saveLineStylePreset,
      DEFAULT_LINE_STYLE_PRESET,
    );
  const [lineOverrides, setLineOverrides] =
    useLocalStorageState<LineStyleOverrides>(
      "tvs.lineStyleOverrides.v1",
      loadLineStyleOverrides,
      saveLineStyleOverrides,
      {},
    );
  const linePreset = useMemo(
    () => applyLineStyleOverrides(LINE_STYLE_PRESETS[lineStylePresetId], lineOverrides),
    [lineStylePresetId, lineOverrides],
  );
  const maxRunsAvailable = displayResultTraj.samplePaths.paths.length;
  const runsCap = Math.min(1000, maxRunsAvailable);
  const maxRuns = runsCap;
  // Desired slider value is preserved even when a new sim lowers maxRuns
  // temporarily — we re-clamp on each render instead of mutating state in
  // an effect (which would trip react-hooks/set-state-in-effect).
  const [desiredVisibleRuns, setDesiredVisibleRuns] = useState(Math.min(100, maxRuns));
  const visibleRuns = Math.min(desiredVisibleRuns, maxRuns);
  const setVisibleRuns = setDesiredVisibleRuns;
  const [runMode, setRunMode] = useState<RunMode>("random");
  const deferredRunMode = useDeferredValue(runMode);
  const [trimTopPct, setTrimTopPct] = useState<number>(0);
  const [trimBotPct, setTrimBotPct] = useState<number>(0);
  const effectiveTrimTopPct = advanced ? trimTopPct : 0;
  const effectiveTrimBotPct = advanced ? trimBotPct : 0;
  const deferredTrimTopPct = useDeferredValue(effectiveTrimTopPct);
  const deferredTrimBotPct = useDeferredValue(effectiveTrimBotPct);
  // Heavy trajectory rebuild (uPlot series allocation + path binding) lags
  // on every drag tick when maxRuns is in the hundreds. useDeferredValue keeps
  // the slider input responsive by letting the chart catch up asynchronously.
  const deferredVisibleRuns = useDeferredValue(visibleRuns);

  const [refLines, setRefLines] = useLocalStorageState<RefLineConfig[]>(
    "tvs.refLines.v1",
    loadRefLines,
    saveRefLines,
    DEFAULT_REF_LINES,
  );

  // Stabilize the TrajectoryCard toolbar so unrelated re-renders (schedule
  // keystrokes, language switches) don't recreate this JSX subtree — combined
  // with memo(TrajectoryCard) this skips reconciliation for the whole card.
  const trajectoryToolbar = useMemo(
    () => (
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg-elev)]/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
            {t("lineStyle.label")}
          </div>
          <LineStylePresetPicker
            value={lineStylePresetId}
            onChange={setLineStylePresetId}
          />
          <LineStyleCustomizer
            preset={LINE_STYLE_PRESETS[lineStylePresetId]}
            overrides={lineOverrides}
            onChange={setLineOverrides}
            t={t}
          />
          <RefLineCustomizer value={refLines} onChange={setRefLines} t={t} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg-elev)]/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          {advanced && (
            <>
              <TrimPctSlider
                label={t("runs.trim.worst")}
                value={trimBotPct}
                onChange={setTrimBotPct}
              />
              <TrimPctSlider
                label={t("runs.trim.best")}
                value={trimTopPct}
                onChange={setTrimTopPct}
              />
            </>
          )}
          <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
            {t("runs.label")}
          </div>
          <input
            type="range"
            min={0}
            max={maxRuns}
            step={1}
            value={visibleRuns}
            onChange={(e) => setVisibleRuns(Number(e.target.value))}
            className="h-1.5 w-28 cursor-pointer accent-[color:var(--color-accent)]"
            aria-label={t("runs.label")}
          />
          {advanced ? (
            <>
              <input
                type="number"
                min={0}
                max={maxRuns}
                step={1}
                value={visibleRuns}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  setVisibleRuns(Math.max(0, Math.min(maxRuns, Math.round(raw))));
                }}
                className="w-14 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/75 px-1 py-1 text-center font-mono text-[11px] tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
                aria-label={t("runs.label")}
                title={`max ${maxRuns} (captured paths)`}
              />
              <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                /{maxRuns}
              </span>
            </>
          ) : (
            <span className="min-w-[4.5rem] rounded-sm border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-2 py-1 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
              {visibleRuns}/{maxRuns}
            </span>
          )}
          <RunModeSlider value={runMode} onChange={setRunMode} t={t} />
          <InlineUnitToggle />
        </div>
      </div>
    ),
    [
      t,
      lineStylePresetId,
      setLineStylePresetId,
      lineOverrides,
      setLineOverrides,
      refLines,
      setRefLines,
      advanced,
      trimBotPct,
      setTrimBotPct,
      trimTopPct,
      setTrimTopPct,
      maxRuns,
      visibleRuns,
      setVisibleRuns,
      runMode,
      setRunMode,
    ],
  );

  return (
    <AbiContext.Provider value={abi}>
    <MoneyFmtContext.Provider value={moneyFmt}>
    <div className="flex flex-col gap-5">
      {advanced && availableRuns > 0 && onSelectRun ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-fg-dim)]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
            {t("seedBatch.label")}
          </span>
          <button
            type="button"
            onClick={() => onSelectRun(Math.max(0, activeRunIdx - 1))}
            disabled={activeRunIdx <= 0}
            className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("seedBatch.prev")}
          >
            ‹
          </button>
          <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
            {activeRunIdx + 1}/{availableRuns}
          </span>
          <button
            type="button"
            onClick={() =>
              onSelectRun(Math.min(availableRuns - 1, activeRunIdx + 1))
            }
            disabled={activeRunIdx >= availableRuns - 1}
            className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("seedBatch.next")}
          >
            ›
          </button>
          {backgroundStatus === "computing" ? (
            <span className="italic">{t("seedBatch.computing")}</span>
          ) : backgroundStatus === "full" ? (
            <span>{t("seedBatch.full")}</span>
          ) : null}
        </div>
      ) : null}
      {(rakebackCurve || hasMysteryRow || rbRecomputing) && (
        <div className="flex items-center justify-between gap-4 -mb-1">
          <div
            className={`flex items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)] transition-opacity duration-150 ${
              rbRecomputing ? "opacity-100" : "opacity-0"
            }`}
            aria-live="polite"
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400"
              aria-hidden
            />
            <span className="uppercase tracking-wider text-indigo-300/80">
              {t("chart.recomputing")}
            </span>
          </div>
          <div className="flex items-center gap-4">
          {hasMysteryRow && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
              title={t("chart.hideJackpots.title")}
            >
              <input
                type="checkbox"
                checked={hideJackpots}
                onChange={(e) => setHideJackpots(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-400"
              />
              <span className="uppercase tracking-wider text-amber-400/80">
                {t("chart.hideJackpots")}
              </span>
            </label>
          )}
          {rakebackCurve && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
              title={t("chart.trajectory.withRakeback.title")}
            >
              <input
                type="checkbox"
                checked={rbTraj}
                onChange={(e) => setRbTraj(e.target.checked)}
                className="h-3.5 w-3.5 accent-lime-400"
              />
              <span className="uppercase tracking-wider text-lime-400/80">
                {t("chart.trajectory.withRakeback")}
              </span>
            </label>
          )}
          </div>
        </div>
      )}
      <UnitScope id="trajectory">
        <TrajectoryCard
          settings={settings}
          result={result}
          displayResult={displayResultTraj}
          compareResult={compareResult ?? null}
          bankroll={bankroll}
          overlayPd={overlayPd}
          setOverlayPd={setOverlayPd}
          pdChart={pdChart ?? null}
          displayPdChart={displayPdChartTraj ?? null}
          showWithRakeback={rbTraj}
          pdPkoFallback={pdPkoFallback}
          compareMode={compareMode}
          schedule={schedule}
          scheduleRepeats={scheduleRepeats}
          modelLabel={modelLabel}
          linePreset={linePreset}
          lineOverrides={lineOverrides}
          visibleRuns={deferredVisibleRuns}
          runMode={deferredRunMode}
          trimTopPct={deferredTrimTopPct}
          trimBotPct={deferredTrimBotPct}
          refLines={refLines}
          toolbar={trajectoryToolbar}
          pdPresetFlip={modelPresetId === "primedope" && compareMode === "primedope"}
          honestLabel={
            finishModelId
              ? t(FINISH_MODEL_LABEL_KEY[finishModelId])
              : t("twin.runB")
          }
          modelPresetId={modelPresetId}
          usePdPayouts={settings?.usePrimedopePayouts ?? true}
          onUsePdPayoutsChange={onUsePdPayoutsChange}
          usePdFinishModel={settings?.usePrimedopeFinishModel ?? true}
          onUsePdFinishModelChange={onUsePdFinishModelChange}
          usePdRakeMath={settings?.usePrimedopeRakeMath ?? true}
          onUsePdRakeMathChange={onUsePdRakeMathChange}
          pdOverrideStatus={pdOverrideStatus}
          pdOverrideProgress={pdOverrideProgress}
        />
      </UnitScope>

      {hasSatelliteRow(schedule) &&
        !isSatelliteOnlySchedule(schedule) &&
        scheduleRepeats != null && (
          <SatelliteCard
            result={result}
            schedule={schedule!}
            scheduleRepeats={scheduleRepeats}
            bankroll={bankroll}
            allSatellite={false}
          />
        )}


      {advanced && (
        <CollapsibleSection
          id="pdReport"
          title={t("section.primedopeReport")}
          showUnitToggle={false}
        >
          <PrimedopeReportCard result={result} />
        </CollapsibleSection>
      )}

      {advanced && (
        <CollapsibleSection
          id="settingsDump"
          title={t("section.settingsDump")}
          showUnitToggle={false}
        >
          <SettingsDumpCard settings={settings} schedule={schedule} result={result} elapsedMs={elapsedMs} />
        </CollapsibleSection>
      )}

      {advanced && result.comparison && compareMode === "primedope" && (
        <CollapsibleSection
          id="pdDiff"
          title={pdPkoFallback ? t("section.pdDiff.freezeouts") : t("section.pdDiff")}
        >
          <PrimedopeDiff
            primary={result}
            other={result.comparison}
            theirsLabel={pdPkoFallback ? t("chart.overlay.freezeouts") : undefined}
            title={pdPkoFallback ? t("pd.title.freezeouts") : undefined}
            subtitle={pdPkoFallback ? t("pd.subtitle.freezeouts") : undefined}
            hasBounty={hasPko}
          />
        </CollapsibleSection>
      )}

      {rakebackCurve && (
        <div className="flex items-center justify-end -mb-1">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
            title={t("chart.rakeback.profitOnly.title")}
          >
            <input
              type="checkbox"
              checked={rbStats}
              onChange={(e) => setRbStats(e.target.checked)}
              className="h-3.5 w-3.5 accent-lime-400"
            />
            <span className="uppercase tracking-wider text-lime-400/80">
              {t("chart.trajectory.withRakeback")}
            </span>
          </label>
        </div>
      )}
      {rakebackCurve && (
        <div className="-mt-1 mb-1 text-right text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("chart.rakeback.fullSampleNote")}
        </div>
      )}

      <div className="-mb-1 flex items-center justify-end">
        <InlineUnitToggle />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BigStat
          suit="club"
          label={t("stat.expectedProfit")}
          value={money(totalExpectedProfit)}
          rangeSubline={{
            label: t("stat.range.spread"),
            fromLabel: t("stat.range.from"),
            toLabel: t("stat.range.to"),
            pointLabel: t("stat.range.pointEv"),
            pointHint: t("stat.range.pointHint"),
            minValue: money(totalMin),
            maxValue: money(totalMax),
            anchorRatio: expectedProfitRangeRatio,
          }}
          sub={t("stat.expectedProfit.sub")
            .replace("{min}", money(totalMin))
            .replace("{max}", money(totalMax))}
          tip={t("stat.expectedProfit.tip")
            .replace("{mean}", money(totalMean))
            .replace("{roi}", `${(roi * 100).toFixed(1)}%`)
            .replace("{median}", money(totalMedian))}
          tone={totalExpectedProfit >= 0 ? "pos" : "neg"}
          pdValue={pdExpectedProfit != null ? money(pdExpectedProfit) : undefined}
          pdDelta={
            pdExpectedProfit != null
              ? pctDelta(totalExpectedProfit, pdExpectedProfit)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <BigStat
          suit="spade"
          label={t("stat.probProfit")}
          value={pct(shiftedStats.probProfit)}
          outcomeSubline={{
            label: t("stat.probProfit.outcome"),
            leftLabel: t("stat.probProfit.outcome.down"),
            rightLabel: t("stat.probProfit.outcome.up"),
            leftValue: pct(1 - shiftedStats.probProfit),
            rightValue: pct(shiftedStats.probProfit),
            ratio: shiftedStats.probProfit,
          }}
          sub={t("stat.probProfit.sub").replace(
            "{n}",
            intFmt(shiftedStats.tournamentsFor95ROI),
          )}
          tip={t("stat.tFor95.sub")}
          pdValue={shiftedPdStats ? pct(shiftedPdStats.probProfit) : undefined}
          pdDelta={
            shiftedPdStats
              ? pctDelta(shiftedStats.probProfit, shiftedPdStats.probProfit)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <BigStat
          suit="heart"
          label={t("stat.riskOfRuin")}
          value={pct(s.riskOfRuin)}
          rangeSubline={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? undefined
              : {
                  label: t("stat.riskOfRuin.range"),
                  fromLabel: t("stat.riskOfRuin.range.from"),
                  toLabel: t("stat.riskOfRuin.range.to"),
                  pointLabel: t("stat.riskOfRuin.range.point"),
                  pointHint: t("stat.riskOfRuin.range.hint"),
                  minValue: money(s.minBankrollRoR5pct),
                  maxValue: money(s.minBankrollRoR1pct),
                  anchorRatio: bankrollSafetyRatio,
                }
          }
          sub={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? t("stat.bankrollOff")
              : t("stat.riskOfRuin.sub")
          }
          tip={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? undefined
              : t("stat.riskOfRuin.tip")
                  .replace("{br1}", money(s.minBankrollRoR1pct))
                  .replace("{br5}", money(s.minBankrollRoR5pct))
          }
          tone={s.riskOfRuin > 0.05 ? "neg" : undefined}
          pdValue={pdStats ? pct(pdStats.riskOfRuin) : undefined}
          pdDelta={pdStats ? pctDelta(s.riskOfRuin, pdStats.riskOfRuin) : null}
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </div>

      {result.battleRoyaleLeaderboardPromo && (
        <BattleRoyaleLeaderboardPromoSection
          promo={result.battleRoyaleLeaderboardPromo}
        />
      )}

      <StatGroup title={t("statGroup.drawdowns")}>
        <MiniStat
          suit="heart"
          label={t("stat.ddWorst")}
          value={money(s.maxDrawdownWorst)}
          detail={
            unit === "abi"
              ? `${Math.round(s.longestBreakevenMean)} ${tourneysWord}`
              : `${(s.maxDrawdownWorst / abi).toFixed(1)} ABI · ${Math.round(s.longestBreakevenMean)} ${tourneysWord}`
          }
          tone="neg"
          tip={t("stat.ddWorst.tip")}
          pdValue={
            pdStats
              ? money(pdStats.maxDrawdownWorst)
              : undefined
          }
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownWorst, pdStats.maxDrawdownWorst) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddMedian")}
          value={money(s.maxDrawdownMedian)}
          tip={t("stat.ddMedian.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownMedian) : undefined}
          pdDelta={
            pdStats
              ? pctDelta(s.maxDrawdownMedian, pdStats.maxDrawdownMedian)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP95")}
          value={money(s.maxDrawdownP95)}
          tone="neg"
          tip={t("stat.ddP95.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownP95) : undefined}
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownP95, pdStats.maxDrawdownP95) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP99")}
          value={money(s.maxDrawdownP99)}
          tone="neg"
          tip={t("stat.ddP99.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownP99) : undefined}
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownP99, pdStats.maxDrawdownP99) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </StatGroup>

      <StatGroup title={t("statGroup.streaks")}>
        <MiniStat
          suit="diamond"
          label={t("stat.longestBE")}
          value={`${Math.round(s.longestBreakevenMean)} ${tourneysWord}`}
          tip={t("stat.longestBE.tip")}
          pdValue={
            pdStats
              ? `${Math.round(pdStats.longestBreakevenMean)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestBreakevenMean, pdStats.longestBreakevenMean)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.avgBEStreak")}
          value={`${Math.round(s.breakevenStreakMean)} ${tourneysWord}`}
          tip={t("stat.avgBEStreak.tip")}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.cashlessMean")}
          value={`${Math.round(s.longestCashlessMean)} ${tourneysWord}`}
          tip={t("stat.cashlessMean.tip")}
          pdValue={
            pdStats
              ? `${Math.round(pdStats.longestCashlessMean)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestCashlessMean, pdStats.longestCashlessMean)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.cashlessWorst")}
          value={`${s.longestCashlessWorst} ${tourneysWord}`}
          tone="neg"
          tip={t("stat.cashlessWorst.tip")}
          pdValue={
            pdStats ? `${pdStats.longestCashlessWorst} ${tourneysWord}` : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestCashlessWorst, pdStats.longestCashlessWorst)
              : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.recoveryMedian")}
          value={
            Number.isFinite(s.recoveryMedian)
              ? `${Math.round(s.recoveryMedian)} ${tourneysWord}`
              : "—"
          }
          tip={t("stat.recoveryMedian.tip")}
          pdValue={
            pdStats && Number.isFinite(pdStats.recoveryMedian)
              ? `${Math.round(pdStats.recoveryMedian)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats ? pctDelta(s.recoveryMedian, pdStats.recoveryMedian) : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryP90")}
          value={
            Number.isFinite(s.recoveryP90)
              ? `${Math.round(s.recoveryP90)} ${tourneysWord}`
              : "—"
          }
          tone="neg"
          tip={t("stat.recoveryP90.tip")}
          pdValue={
            pdStats && Number.isFinite(pdStats.recoveryP90)
              ? `${Math.round(pdStats.recoveryP90)} ${tourneysWord}`
              : undefined
          }
          pdDelta={pdStats ? pctDelta(s.recoveryP90, pdStats.recoveryP90) : null}
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryUnrecovered")}
          value={pct(s.recoveryUnrecoveredShare)}
          tone={s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined}
          tip={t("stat.recoveryUnrecovered.tip")}
          pdValue={pdStats ? pct(pdStats.recoveryUnrecoveredShare) : undefined}
          pdDelta={
            pdStats
              ? pctDelta(
                  s.recoveryUnrecoveredShare,
                  pdStats.recoveryUnrecoveredShare,
                )
              : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </StatGroup>

      {rakebackCurve && (
        <div className="flex items-center justify-end -mb-1">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
            title={t("chart.rakeback.profitOnly.title")}
          >
            <input
              type="checkbox"
              checked={rbDist}
              onChange={(e) => setRbDist(e.target.checked)}
              className="h-3.5 w-3.5 accent-lime-400"
            />
            <span className="uppercase tracking-wider text-lime-400/80">
              {t("chart.trajectory.withRakeback")}
            </span>
          </label>
        </div>
      )}
      {rakebackCurve && (
        <div className="-mt-3 mb-1 text-right text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("chart.rakeback.fullSampleNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <UnitScope id="dist.profit">
          <MoneyDistributionCard
            title={t("chart.dist")}
            subtitle={`${result.samples.toLocaleString()} ${t("app.samples")} · 60 bins`}
            binEdges={displayResultDist.histogram.binEdges}
            counts={displayResultDist.histogram.counts}
            color="#34d399"
            yAsPct
            xDomain={distProfitXDomain}
            overlay={
              overlayPd && displayPdChartDist
                ? {
                    binEdges: displayPdChartDist.histogram.binEdges,
                    counts: displayPdChartDist.histogram.counts,
                    label: overlayLabel,
                  }
                : null
            }
          />
        </UnitScope>
        <UnitScope id="dist.drawdown">
          <div className="flex flex-col gap-1.5">
            <MoneyDistributionCard
              title={t("chart.ddDist")}
              subtitle={t("chart.ddDist.sub")}
              binEdges={displayResultStreaks.drawdownHistogram.binEdges}
              counts={displayResultStreaks.drawdownHistogram.counts}
              color="#f87171"
              yAsPct
              xDomain={streakDrawdownXDomain}
              overlay={
                overlayPd && displayPdChartStreaks
                  ? {
                      binEdges: displayPdChartStreaks.drawdownHistogram.binEdges,
                      counts: displayPdChartStreaks.drawdownHistogram.counts,
                      label: overlayLabel,
                    }
                  : null
              }
            />
          </div>
        </UnitScope>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.convergence")}
            subtitle={t("chart.convergence.sub")}
            showUnitToggle={false}
          />
          <ConvergenceChart schedule={schedule} finishModel={finishModel} />
        </Card>
        {result.downswings.length > 0 && (
          <UnitScope id="downswings">
            <div className="flex flex-col gap-1.5">
            <DownswingsCard
              downswings={displayResultStreaks.downswings}
              upswings={displayResultStreaks.upswings}
              tourneysWord={tourneysWord}
              streaks={
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:grid-rows-[auto_1fr_auto_auto]">
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.longestBE")}
                      showUnitToggle={false}
                      tip={t("chart.longestBE.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.longestBreakevenHistogram.binEdges}
                      counts={displayResultStreaks.longestBreakevenHistogram.counts}
                      color="#fbbf24"
                      unitLabel="tourneys"
                      yAsPct
                      xDomain={streakBreakevenXDomain}
                      overlay={
                        overlayPd && displayPdChartStreaks
                          ? {
                              binEdges:
                                displayPdChartStreaks.longestBreakevenHistogram.binEdges,
                              counts:
                                displayPdChartStreaks.longestBreakevenHistogram.counts,
                              color: "#f472b6",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.longestBE.sub")}
                    </div>
                    <div />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.longestCashless")}
                      showUnitToggle={false}
                      tip={t("chart.longestCashless.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.longestCashlessHistogram.binEdges}
                      counts={displayResultStreaks.longestCashlessHistogram.counts}
                      color="#f87171"
                      unitLabel="tourneys"
                      yAsPct
                      overlay={
                        overlayPd && pdChart
                          ? {
                              binEdges:
                                pdChart.longestCashlessHistogram.binEdges,
                              counts:
                                pdChart.longestCashlessHistogram.counts,
                              color: "#38bdf8",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.longestCashless.sub")}
                      {rakebackCurve && (
                        <>
                          {" · "}
                          <span className="text-[color:var(--color-fg-muted)]">
                            {t("chart.longestCashless.rbNote")}
                          </span>
                        </>
                      )}
                    </div>
                    <div />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.recovery")}
                      showUnitToggle={false}
                      tip={t("chart.recovery.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.recoveryHistogram.binEdges}
                      counts={displayResultStreaks.recoveryHistogram.counts}
                      color="#34d399"
                      unitLabel="tourneys"
                      yAsPct
                      xDomain={streakRecoveryXDomain}
                      overlay={
                        overlayPd && displayPdChartStreaks
                          ? {
                              binEdges: displayPdChartStreaks.recoveryHistogram.binEdges,
                              counts: displayPdChartStreaks.recoveryHistogram.counts,
                              color: "#e879f9",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.recovery.sub")}
                      {" · "}
                      {fmt(t("chart.recovery.unrecovered"), {
                        pct: pct(displayResultStreaks.stats.recoveryUnrecoveredShare),
                      })}
                    </div>
                    <div />
                  </div>
                </div>
              }
            />
            </div>
          </UnitScope>
        )}
      </div>


      {advanced && (
        <CollapsibleSection id="decomp" title={t("chart.decomp")} showUnitToggle={false}>
          <Card className="p-5">
            <ChartHeader
              title={t("chart.decomp")}
              subtitle={t("chart.decomp.sub")}
              showUnitToggle={false}
            />
            <DecompositionChart rows={result.decomposition} />
            <ChartHelp text={t("chart.decomp.help")} />
          </Card>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="pdWeakness"
        title={t("section.pdWeakness")}
        showUnitToggle={false}
      >
        <PrimeDopeWeaknessCard />
      </CollapsibleSection>

      <CollapsibleSection
        id="ourWeakness"
        title={t("section.ourWeakness")}
        showUnitToggle={false}
      >
        <OurModelWeaknessCard />
      </CollapsibleSection>
    </div>
    </MoneyFmtContext.Provider>
    </AbiContext.Provider>
  );
}

export const ResultsView = memo(ResultsViewImpl);

// ---------------------------------------------------------------------
// Satellite mode
// ---------------------------------------------------------------------
// Ticket-cliff satellites pay the same ticket to every cashing place and
// nothing to everyone else. Per-sample trajectories become step functions
// (long flat losses punctuated by vertical cash spikes), which reads as
// "broken" in the bankroll trajectory chart even though the math is right.
// When the run's schedule is entirely made of satellite rows we swap the
// TrajectoryCard for this alternate widget: KPI strip (expected seats,
// cash rate, shots per seat, net $) + a seats-per-session histogram.

function SatelliteCard({
  result,
  schedule,
  scheduleRepeats,
  bankroll,
  allSatellite,
}: {
  result: SimulationResult;
  schedule: TournamentRow[];
  scheduleRepeats: number;
  bankroll: number;
  allSatellite: boolean;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const stats = useMemo(
    () => computeSatelliteStats(result, schedule, scheduleRepeats),
    [result, schedule, scheduleRepeats],
  );
  if (!stats) return null;
  return (
    <Card className="p-5">
      <ChartHeader
        title={t("chart.satellite")}
        subtitle={
          bankroll > 0
            ? `${t("chart.satellite.sub")} · bankroll ${money(bankroll)}`
            : t("chart.satellite.sub")
        }
        showUnitToggle={false}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          label={t("sat.kpi.expectedSeats")}
          value={stats.expectedSeats.toFixed(1)}
          suit="spade"
        />
        <MiniStat
          label={t("sat.kpi.cashRate")}
          value={`${(stats.cashRate * 100).toFixed(2)}%`}
          suit="heart"
        />
        <MiniStat
          label={t("sat.kpi.shotsPerSeat")}
          value={
            Number.isFinite(stats.shotsPerSeat)
              ? stats.shotsPerSeat.toFixed(1)
              : "∞"
          }
          suit="club"
        />
        <MiniStat
          label={t("sat.kpi.netPerSession")}
          value={money(stats.netPerSession)}
          tone={stats.netPerSession >= 0 ? "pos" : "neg"}
          suit="diamond"
        />
      </div>
      <div className="mb-2 flex items-end justify-between gap-3 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        <span>{t("chart.satellite.hist")}</span>
        <span className="normal-case tracking-normal">
          {stats.tourneysPerSession.toLocaleString("ru-RU")}{" "}
          {t("sat.perSession")}
        </span>
      </div>
      <DistributionChart
        binEdges={stats.histogram.binEdges}
        counts={stats.histogram.counts}
        color="#4ade80"
        height={260}
        unitLabel="seats"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="text-[color:var(--color-fg-dim)]">
          {allSatellite
            ? t("chart.satellite.note")
            : t("chart.satellite.mixedNote")}
        </div>
        <div className="font-mono text-[color:var(--color-fg-muted)]">
          P5–P95: {stats.seatsP05.toFixed(0)}–{stats.seatsP95.toFixed(0)}{" "}
          <span className="text-[color:var(--color-fg-dim)]">·</span>{" "}
          {t("sat.kpi.seats")}: {stats.seats}
          {stats.rowCount > 1 ? ` ×${stats.rowCount}` : ""}{" "}
          <span className="text-[color:var(--color-fg-dim)]">·</span>{" "}
          {t("sat.kpi.seatPrice")}: {money(stats.seatPrice)}
        </div>
      </div>
    </Card>
  );
}

function BattleRoyaleLeaderboardPromoSection({
  promo,
}: {
  promo: NonNullable<SimulationResult["battleRoyaleLeaderboardPromo"]>;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const isObserved = promo.mode === "observed";
  const isLookup = promo.mode === "lookup";
  const confidenceTone = isObserved
    ? promo.confidence.level === "aligned"
      ? "border-[color:var(--color-accent)]/45 bg-[color:var(--color-accent)]/8 text-[color:var(--color-accent)]"
      : promo.confidence.level === "approximate"
        ? "border-[color:var(--c-diamond)]/45 bg-[color:var(--c-diamond)]/8 text-[color:var(--c-diamond)]"
        : promo.confidence.level === "mismatch"
          ? "border-[color:var(--color-danger)]/45 bg-[color:var(--color-danger)]/8 text-[color:var(--color-danger)]"
          : "border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 text-[color:var(--color-fg-dim)]"
    : "";

  const subtitle = t("chart.brLeaderboardObserved.sub")
    .replace(
      "{tourneysPerDay}",
      promo.current.tournamentsPerDay.toFixed(1),
    )
    .replace("{days}", promo.current.activeDays.toLocaleString("ru-RU"));

  return (
    <CollapsibleSection
      id="battleRoyaleLeaderboardPromo"
      title={t("chart.brLeaderboardObserved.title")}
      showUnitToggle={false}
      defaultOpen
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.brLeaderboardObserved.title")}
            subtitle={subtitle}
            showUnitToggle={false}
            tip={t(
              isObserved
                ? "chart.brLeaderboardObserved.tip"
                : isLookup
                  ? "chart.brLeaderboardLookup.tip"
                  : "chart.brLeaderboardManual.tip",
            )}
          />
          <div className="mb-4 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
            {t(
              isObserved
                ? "chart.brLeaderboardObserved.note"
                : isLookup
                  ? "chart.brLeaderboardLookup.note"
                  : "chart.brLeaderboardManual.note",
            )}
          </div>
          <StatGroup title={t("chart.brLeaderboardObserved.groupCurrent")}>
            <MiniStat
              suit="diamond"
              label={t("chart.brLeaderboardObserved.expectedPayout")}
              value={money(promo.expectedPayout)}
              tone={promo.expectedPayout >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="club"
              label={t("chart.brLeaderboardObserved.perTournament")}
              value={money(promo.payoutPerTournament)}
              tone={promo.payoutPerTournament >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="club"
              label={t("chart.brLeaderboardObserved.perDay")}
              value={money(promo.payoutPerDay)}
              tone={promo.payoutPerDay >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboardObserved.currentPct")}
              value={pct(promo.pctOfCurrentBuyIns)}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboardObserved.currentAbi")}
              value={
                promo.current.abi == null ? "—" : `${promo.current.abi.toFixed(2)} ABI`
              }
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboardObserved.currentVolume")}
              value={promo.current.tournaments.toLocaleString("ru-RU")}
              detail={t("chart.brLeaderboardObserved.currentVolumeDetail").replace(
                "{perDay}",
                promo.current.tournamentsPerDay.toFixed(1),
              )}
            />
          </StatGroup>
          <div className="mt-4" />
          {promo.mode === "observed" ? (
            <>
              <StatGroup title={t("chart.brLeaderboardObserved.groupObserved")}>
                <MiniStat
                  suit="diamond"
                  label={t("chart.brLeaderboardObserved.observedPrizes")}
                  value={money(promo.observed.totalPrizes)}
                  tone={promo.observed.totalPrizes >= 0 ? "pos" : "neg"}
                />
                <MiniStat
                  suit="club"
                  label={t("chart.brLeaderboardObserved.observedTournaments")}
                  value={promo.observed.totalTournaments.toLocaleString("ru-RU")}
                />
                <MiniStat
                  suit="spade"
                  label={t("chart.brLeaderboardObserved.observedAbi")}
                  value={
                    promo.observed.reconstructedAbi == null
                      ? "—"
                      : `${promo.observed.reconstructedAbi.toFixed(2)} ABI`
                  }
                />
                <MiniStat
                  suit="spade"
                  label={t("chart.brLeaderboardObserved.observedPct")}
                  value={
                    promo.observed.pctOfObservedBuyIns == null
                      ? "—"
                      : pct(promo.observed.pctOfObservedBuyIns)
                  }
                />
                <MiniStat
                  suit="spade"
                  label={t("chart.brLeaderboardObserved.observedPoints")}
                  value={promo.observed.totalPoints.toLocaleString("ru-RU")}
                />
              </StatGroup>
              <div
                className={`mt-4 rounded-md border px-3 py-2 text-[11px] leading-snug ${confidenceTone}`}
              >
                <div className="font-semibold">
                  {t(
                    `chart.brLeaderboardObserved.confidence.${promo.confidence.level}` as DictKey,
                  )}
                </div>
                <div className="mt-1">
                  {promo.confidence.abiDriftPct == null
                    ? t("chart.brLeaderboardObserved.confidence.noAbiDrift")
                    : t("chart.brLeaderboardObserved.confidence.abiDrift").replace(
                        "{value}",
                        pct(promo.confidence.abiDriftPct),
                      )}
                  {/* When ABI drift is large, the % alone isn't actionable —
                      show both anchors inline so the user sees WHICH end is
                      off, and offer the concrete next step (match schedule
                      to observed mix, or switch to Manual / Lookup). */}
                  {promo.current.abi != null &&
                    promo.observed.reconstructedAbi != null && (
                      <span className="ml-1 font-mono opacity-80">
                        ({t("chart.brLeaderboardObserved.currentAbi")}{" "}
                        {promo.current.abi.toFixed(2)} ABI →{" "}
                        {t("chart.brLeaderboardObserved.observedAbi")}{" "}
                        {promo.observed.reconstructedAbi.toFixed(2)} ABI)
                      </span>
                    )}
                </div>
                {promo.confidence.level === "mismatch" && (
                  <div className="mt-2 text-[10.5px] opacity-90">
                    {t("chart.brLeaderboardObserved.confidence.mismatchHint")}
                  </div>
                )}
              </div>
            </>
          ) : promo.mode === "manual" ? (
            <StatGroup title={t("chart.brLeaderboardManual.groupAnchor")}>
              <MiniStat
                suit="club"
                label={t("chart.brLeaderboardManual.perTournament")}
                value={money(promo.manual.payoutPerTournament)}
                tone={promo.manual.payoutPerTournament >= 0 ? "pos" : "neg"}
              />
              {promo.manual.averageDailyPrize != null && (
                <MiniStat
                  suit="diamond"
                  label={t("chart.brLeaderboardManual.avgPrize")}
                  value={money(promo.manual.averageDailyPrize)}
                />
              )}
              {promo.manual.targetPoints != null && (
                <MiniStat
                  suit="spade"
                  label={t("chart.brLeaderboardManual.targetPoints")}
                  value={Math.round(promo.manual.targetPoints).toLocaleString(
                    "ru-RU",
                  )}
                  detail={
                    promo.manual.tournamentsPerDay != null &&
                    promo.manual.pointsPerTournament != null
                      ? t("chart.brLeaderboardLookup.targetDetail")
                          .replace(
                            "{tournaments}",
                            promo.manual.tournamentsPerDay.toLocaleString("ru-RU"),
                          )
                          .replace(
                            "{points}",
                            promo.manual.pointsPerTournament.toLocaleString("ru-RU"),
                          )
                      : undefined
                  }
                />
              )}
              {promo.manual.snapshotCount != null && (
                <MiniStat
                  suit="spade"
                  label={t("chart.brLeaderboardManual.days")}
                  value={promo.manual.snapshotCount.toLocaleString("ru-RU")}
                  detail={t("chart.brLeaderboardLookup.daysDetail").replace(
                    "{paid}",
                    (promo.manual.paidDays ?? 0).toLocaleString("ru-RU"),
                  )}
                />
              )}
              <MiniStat
                suit="diamond"
                label={t("chart.brLeaderboardManual.formula")}
                value={t("chart.brLeaderboardManual.formulaValue")
                  .replace("{perTournament}", money(promo.manual.payoutPerTournament))
                  .replace(
                    "{tournaments}",
                    promo.current.tournaments.toLocaleString("ru-RU"),
                )}
              />
            </StatGroup>
          ) : (
            <StatGroup title={t("chart.brLeaderboardLookup.groupAnchor")}>
              <MiniStat
                suit="club"
                label={t("chart.brLeaderboardLookup.perTournament")}
                value={money(promo.lookup.payoutPerTournament)}
                tone={promo.lookup.payoutPerTournament >= 0 ? "pos" : "neg"}
              />
              <MiniStat
                suit="diamond"
                label={t("chart.brLeaderboardLookup.avgPrize")}
                value={money(promo.lookup.averageDailyPrize)}
              />
              <MiniStat
                suit="spade"
                label={t("chart.brLeaderboardLookup.targetPoints")}
                value={Math.round(promo.lookup.targetPoints).toLocaleString("ru-RU")}
                detail={t("chart.brLeaderboardLookup.targetDetail")
                  .replace(
                    "{tournaments}",
                    promo.lookup.tournamentsPerDay.toLocaleString("ru-RU"),
                  )
                  .replace(
                    "{points}",
                    promo.lookup.pointsPerTournament.toLocaleString("ru-RU"),
                  )}
              />
              <MiniStat
                suit="spade"
                label={t("chart.brLeaderboardLookup.days")}
                value={promo.lookup.snapshotCount.toLocaleString("ru-RU")}
                detail={t("chart.brLeaderboardLookup.daysDetail").replace(
                  "{paid}",
                  promo.lookup.paidDays.toLocaleString("ru-RU"),
                )}
              />
            </StatGroup>
          )}
        </Card>

        <Card className="p-5">
          <ChartHeader
            title={t("chart.brLeaderboardObserved.rows")}
            subtitle={t("chart.brLeaderboardObserved.rowsSub")}
            showUnitToggle={false}
          />
          <div className="space-y-2">
            {promo.rows.map((row) => (
              <div
                key={row.rowId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 px-3 py-2 text-[11px]"
              >
                <div className="font-medium text-[color:var(--color-fg)]">
                  {row.label}
                </div>
                <div className="text-[color:var(--color-fg-dim)]">
                  {t("chart.brLeaderboardObserved.rowLine")
                    .replace("{count}", row.tournaments.toLocaleString("ru-RU"))
                    .replace("{buyIn}", money(row.buyIn))
                    .replace("{payout}", money(row.payout))}
                </div>
              </div>
            ))}
          </div>
          {promo.mode === "observed" ? (
            <div className="mt-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                {t("chart.brLeaderboardObserved.observedMix")}
              </div>
              <div className="mt-2 space-y-2">
                {promo.observed.pointsByStake
                  .filter((row) => row.points > 0)
                  .map((row) => (
                    <div
                      key={row.stake}
                      className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="font-medium text-[color:var(--color-fg)]">
                        ${row.stake}
                      </div>
                      <div className="text-[color:var(--color-fg-dim)]">
                        {t("chart.brLeaderboardObserved.observedMixLine")
                          .replace("{points}", row.points.toLocaleString("ru-RU"))
                          .replace("{share}", pct(row.share))
                          .replace("{tournaments}", row.tournaments.toFixed(0))
                          .replace("{buyIn}", money(row.buyIn))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : promo.mode === "manual" ? (
            <div className="mt-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 p-3 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
              {t("chart.brLeaderboardManual.anchorNote")
                .replace("{perTournament}", money(promo.manual.payoutPerTournament))
                .replace(
                  "{tournaments}",
                  promo.current.tournaments.toLocaleString("ru-RU"),
                )
                .replace("{payout}", money(promo.expectedPayout))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 p-3 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
              {t("chart.brLeaderboardLookup.anchorNote")
                .replace("{perTournament}", money(promo.lookup.payoutPerTournament))
                .replace(
                  "{days}",
                  promo.lookup.snapshotCount.toLocaleString("ru-RU"),
                )
                .replace("{dailyPrize}", money(promo.lookup.averageDailyPrize))
                .replace("{payout}", money(promo.expectedPayout))}
            </div>
          )}
        </Card>
      </div>
    </CollapsibleSection>
  );
}

/**
 * Trajectory Card. Lives inside its own UnitScope so flipping the unit
 * toggle in the card header only affects this widget's formatters (the
 * trajectory hover tooltip and bankroll/subtitle text).
 */
const TrajectoryCard = memo(function TrajectoryCard({
  settings,
  result,
  displayResult,
  compareResult,
  bankroll,
  overlayPd,
  setOverlayPd,
  pdChart,
  displayPdChart,
  showWithRakeback,
  pdPkoFallback,
  compareMode,
  schedule,
  scheduleRepeats,
  modelLabel,
  linePreset,
  lineOverrides,
  visibleRuns,
  runMode,
  trimTopPct,
  trimBotPct,
  refLines,
  pdPresetFlip,
  honestLabel,
  modelPresetId,
  usePdPayouts,
  onUsePdPayoutsChange,
  usePdFinishModel,
  onUsePdFinishModelChange,
  usePdRakeMath,
  onUsePdRakeMathChange,
  pdOverrideStatus,
  pdOverrideProgress,
  toolbar,
}: {
  settings?: ControlsState;
  result: SimulationResult;
  displayResult: SimulationResult;
  compareResult: SimulationResult | null;
  bankroll: number;
  overlayPd: boolean;
  setOverlayPd: (v: boolean) => void;
  pdChart: SimulationResult | null;
  displayPdChart: SimulationResult | null;
  showWithRakeback: boolean;
  pdPkoFallback: boolean;
  compareMode: "random" | "primedope";
  schedule: TournamentRow[] | undefined;
  scheduleRepeats: number | undefined;
  modelLabel: string;
  linePreset: LineStylePreset;
  lineOverrides: LineStyleOverrides;
  visibleRuns: number;
  runMode: RunMode;
  trimTopPct: number;
  trimBotPct: number;
  refLines: RefLineConfig[];
  pdPresetFlip: boolean;
  honestLabel: string;
  modelPresetId?: string;
  usePdPayouts: boolean;
  onUsePdPayoutsChange?: (v: boolean) => void;
  usePdFinishModel: boolean;
  onUsePdFinishModelChange?: (v: boolean) => void;
  usePdRakeMath: boolean;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
  toolbar?: React.ReactNode;
}) {
  const t = useT();
  const { compactMoney } = useMoneyFmt();
  const { advanced } = useAdvancedMode();
  const overlayLabel = pdPkoFallback ? t("chart.overlay.freezeouts") : "PrimeDope";
  const overlayLegendKey: DictKey = pdPkoFallback
    ? "chart.legend.noKoOverlay"
    : compareMode === "primedope"
      ? "chart.legend.pdOverlay"
      : "chart.legend.genericOverlay";
  const overlayLegend =
    overlayPd && !pdPresetFlip ? (
      <OverlayLegendChip label={t(overlayLegendKey)} />
    ) : null;
  const hasBounty = (schedule ?? []).some(
    (r) => (r.bountyFraction ?? 0) > 0,
  );
  const [extremeStyles, setExtremeStyles] = useLocalStorageState<ExtremeStyles>(
    "tvs.extremeStyles.v1",
    loadExtremeStyles,
    saveExtremeStyles,
    DEFAULT_EXTREME_STYLES,
  );
  const setExtremeKey = (k: ExtremeKey, patch: Partial<ExtremeStyles[ExtremeKey]>) =>
    setExtremeStyles({ ...extremeStyles, [k]: { ...extremeStyles[k], ...patch } });
  // Y-axis fits exactly the visible series (#96). Toggling an extreme line
  // expands the axis to fit it; toggling off snaps back to the main mass.
  // Without this uPlot would auto-scale over all series we feed it — including
  // the 1000 sample paths, whose jackpot outliers on Mystery/BR stretch the
  // axis even when extremes are hidden.
  const effectiveYRange = useMemo(
    () =>
      computeYRange(
        displayPdChart ? [displayResult, displayPdChart] : [displayResult],
        extremeStyles,
        visibleRuns,
        runMode,
        trimTopPct,
        trimBotPct,
      ),
    [displayResult, displayPdChart, extremeStyles, visibleRuns, runMode, trimTopPct, trimBotPct],
  );
  const oursCapKey: DictKey =
    modelPresetId === "naive"
      ? "chart.trajectory.ours.cap.naive"
      : modelPresetId === "realistic-solo"
        ? "chart.trajectory.ours.cap.realisticSolo"
        : modelPresetId === "steady-reg"
          ? "chart.trajectory.ours.cap.steadyReg"
          : modelPresetId && modelPresetId !== "primedope"
            ? "chart.trajectory.ours.cap.custom"
            : "chart.trajectory.ours.cap";
  // Build chart assets with the full cap, NOT the current slider value —
  // the slider is applied imperatively in TrajectoryPlot. Keeping it out
  // of the memo deps is the whole point of this refactor: dragging the
  // slider must not tear down and rebuild uPlot.
  // Stable axis formatter ref — avoids rebuilding the entire chart when
  // unit mode toggles (compactMoney identity changes). The formatter is
  // only called by uPlot during paint, so a ref indirection is safe.
  const axisFmtRef = useRef(compactMoney);
  useLayoutEffect(() => {
    axisFmtRef.current = compactMoney;
  }, [compactMoney]);
  // uPlot reads this during paint, not React render — the ref indirection is
  // intentional so a unit-mode toggle doesn't rebuild the whole chart.
  const stableAxisFmt = useMemo(() => (v: number) => axisFmtRef.current(v), []);
  // `displayResult` / `displayPdChart` / `showWithRakeback` are owned by the
  // parent (ResultsView) so the toggle is shared with BigStats + profit
  // histogram. Only `compareResult` (an internal twin-run input) needs its
  // own shift pipeline here.
  const rbFrac = Math.max(0, (settings?.rakebackPct ?? 0) / 100);
  const compareRakebackCurve = useMemo(
    () =>
      compareResult && schedule && scheduleRepeats != null
        ? computeExpectedRakebackCurve(
            schedule,
            scheduleRepeats,
            rbFrac,
            compareResult.samplePaths.x,
          )
        : null,
    [compareResult, schedule, scheduleRepeats, rbFrac],
  );
  const displayCompareResult = useMemo(
    () =>
      compareResult && !showWithRakeback && compareRakebackCurve
        ? shiftResultByRakeback(compareResult, compareRakebackCurve, -1)
        : compareResult,
    [compareResult, showWithRakeback, compareRakebackCurve],
  );
  const maxPathCount = Math.min(1000, displayResult.samplePaths.paths.length);
  const primary = useMemo(
    () =>
      buildTrajectoryAssets(
        displayResult,
        "felt",
        effectiveYRange,
        overlayPd ? displayPdChart : null,
        // eslint-disable-next-line react-hooks/refs
        stableAxisFmt,
        linePreset,
        maxPathCount,
        refLines,
        lineOverrides,
        runMode,
        extremeStyles,
        overlayLabel,
      ),
    [displayResult, effectiveYRange, overlayPd, displayPdChart, stableAxisFmt, linePreset, maxPathCount, refLines, lineOverrides, runMode, extremeStyles, overlayLabel],
  );
  const pdPanePreset = PRIMEDOPE_PANE_PRESET;
  const secondaryMaxPathCount = displayPdChart
    ? Math.min(1000, displayPdChart.samplePaths.paths.length)
    : 0;
  const secondary = useMemo(
    () =>
      displayPdChart
        ? buildTrajectoryAssets(
            displayPdChart,
            "magenta",
            effectiveYRange,
            undefined,
            // eslint-disable-next-line react-hooks/refs
            stableAxisFmt,
            pdPanePreset,
            secondaryMaxPathCount,
            refLines,
            lineOverrides,
            runMode,
            extremeStyles,
          )
        : null,
    [displayPdChart, effectiveYRange, stableAxisFmt, pdPanePreset, secondaryMaxPathCount, refLines, lineOverrides, runMode, extremeStyles],
  );
  const compareMaxPathCount = displayCompareResult
    ? Math.min(500, displayCompareResult.samplePaths.paths.length)
    : 0;
  const slotOverlay = useMemo(
    () =>
      displayCompareResult
        ? buildTrajectoryAssets(
            displayCompareResult,
            "magenta",
            undefined,
            undefined,
            // eslint-disable-next-line react-hooks/refs
            stableAxisFmt,
            pdPanePreset,
            compareMaxPathCount,
            refLines,
            lineOverrides,
            runMode,
            extremeStyles,
          )
        : null,
    [displayCompareResult, stableAxisFmt, pdPanePreset, compareMaxPathCount, refLines, lineOverrides, runMode, extremeStyles],
  );

  const extremeRows: Array<{ key: ExtremeKey; labelKey: DictKey }> = [
    { key: "realBest", labelKey: "chart.traj.extreme.realBest" },
    { key: "realWorst", labelKey: "chart.traj.extreme.realWorst" },
    { key: "aggBest", labelKey: "chart.traj.extreme.aggBest" },
    { key: "aggWorst", labelKey: "chart.traj.extreme.aggWorst" },
  ];
  const extremesToggles = (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
      {extremeRows.map(({ key, labelKey }) => {
        const s = extremeStyles[key];
        const hex = /^#([0-9a-f]{3}){1,2}$/i.test(s.color) ? s.color : "#22c55e";
        return (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-colors"
            style={{
              borderColor: s.enabled
                ? `${hex}66`
                : "color-mix(in srgb, var(--color-border) 88%, transparent)",
              backgroundColor: s.enabled
                ? "color-mix(in srgb, var(--color-bg-elev) 82%, transparent)"
                : "color-mix(in srgb, var(--color-bg) 62%, transparent)",
              color: s.enabled
                ? "var(--color-fg)"
                : "var(--color-fg-muted)",
            }}
          >
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setExtremeKey(key, { enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded-sm accent-[color:var(--color-accent)]"
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/10"
              style={{ backgroundColor: hex }}
              aria-hidden
            />
            <span className="whitespace-nowrap">{t(labelKey)}</span>
            <DebouncedColorInput
              value={hex}
              disabled={!s.enabled}
              onChange={(v) => setExtremeKey(key, { color: v })}
              aria-label={t(labelKey)}
            />
          </label>
        );
      })}
    </div>
  );

  // All-satellite schedules swap the $ trajectory for a seats-per-session
  // histogram + KPI strip (trajectories are step functions for flat payouts
  // and read as "broken"). Hooks above still run; this branch only changes
  // the rendered tree.
  if (isSatelliteOnlySchedule(schedule) && scheduleRepeats != null) {
    return (
      <SatelliteCard
        result={result}
        schedule={schedule}
        scheduleRepeats={scheduleRepeats}
        bankroll={bankroll}
        allSatellite
      />
    );
  }

  if (secondary) {
    // Overlay-checkbox block — same JSX shape as the always-rendered one below
    // the grid, used here to inject between the two stacked panes when the
    // grid collapses to 1 column. Splitting into two render sites instead of
    // moving on resize keeps the layout shift instant + flicker-free.
    const overlayCheckbox = (
      <label
        className={`flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)] ${
          pdPresetFlip ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          checked={overlayPd && !pdPresetFlip}
          disabled={pdPresetFlip}
          onChange={(e) => setOverlayPd(e.target.checked)}
          className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
        />
        <span className="font-semibold text-[color:var(--color-fg)]">
          {pdPkoFallback
            ? t("chart.trajectory.overlayNoKo")
            : t("chart.trajectory.overlay")}
        </span>
        <span className="text-[color:var(--color-fg-dim)]">
          —{" "}
          {pdPkoFallback
            ? t("chart.trajectory.overlayNoKoHint")
            : t("chart.trajectory.overlayHint")}
        </span>
      </label>
    );
    return (
      <Card className="p-5">
        <ChartHeader
          title={t("chart.trajectory")}
          subtitle=""
          showUnitToggle={false}
        />
        {toolbar}
        {extremesToggles}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartPane
            label={modelLabel}
            sublabel={null}
            hueDot="#34d399"
            itmRate={result.stats.itmRate}
            itmCashOnly={hasBounty}
            caption={
              compareMode === "primedope"
                ? t(oursCapKey)
                : t("twin.runA.cap")
            }
            action={overlayLegend}
          >
            <TrajectoryPlot assets={primary} height={540} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} compactMoney={compactMoney} />
          </ChartPane>
          {/* When the grid collapses to one column (below `lg`), inject the
              overlay-checkbox here so it sits between the two panes — the
              relationship "this toggle controls how A is overlaid by B" is
              easier to read than an orphan toggle below the second pane. */}
          <div className="lg:hidden -my-1 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-bg)]/40 px-3 py-2">
            {overlayCheckbox}
          </div>
          <ChartPane
            label={
              pdPresetFlip
                ? honestLabel
                : pdPkoFallback
                ? t("chart.trajectory.noKoLabel")
                : "PrimeDope"
            }
            hueDot="#60a5fa"
            itmRate={pdChart?.stats.itmRate}
            itmCashOnly={hasBounty && !pdPkoFallback}
            caption={
              pdPresetFlip
                ? t("twin.runB.cap")
                : pdPkoFallback
                ? t("chart.trajectory.noKoCap")
                : compareMode === "primedope"
                ? t("chart.trajectory.theirs.cap")
                : t("twin.runB.cap")
            }
            action={
              compareMode === "primedope" &&
              !pdPkoFallback &&
              schedule &&
              scheduleRepeats ? (
                <div className="flex items-center gap-2">
                  <PdCompareToggles
                    usePdPayouts={usePdPayouts}
                    onUsePdPayoutsChange={onUsePdPayoutsChange}
                    usePdFinishModel={usePdFinishModel}
                    onUsePdFinishModelChange={onUsePdFinishModelChange}
                    usePdRakeMath={usePdRakeMath}
                    onUsePdRakeMathChange={onUsePdRakeMathChange}
                    pdOverrideStatus={pdOverrideStatus}
                    pdOverrideProgress={pdOverrideProgress}
                  />
                  {advanced && (
                    <CopyPdDiagButton
                      settings={settings}
                      schedule={schedule}
                      scheduleRepeats={scheduleRepeats}
                      bankroll={bankroll}
                      result={result}
                      pdChart={pdChart}
                      pdOverrideStatus={pdOverrideStatus ?? "idle"}
                      usePdPayouts={usePdPayouts}
                      usePdFinishModel={usePdFinishModel}
                      usePdRakeMath={usePdRakeMath}
                    />
                  )}
                </div>
              ) : null
            }
          >
            <TrajectoryPlot assets={secondary} height={540} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} compactMoney={compactMoney} />
            {compareMode === "primedope" && !pdPkoFallback && schedule && scheduleRepeats != null && scheduleRepeats > 0 && (
              <div className="mt-1 flex justify-start">
                <PrimedopeReproduceButton
                  schedule={schedule}
                  scheduleRepeats={scheduleRepeats}
                />
              </div>
            )}
          </ChartPane>
        </div>
        {/* On wide screens (lg+) the overlay-checkbox sits below the side-by-
            side panes; on narrower viewports the inline copy above (between the
            two stacked panes) takes over instead. Same state, different slot. */}
        <div className="mt-3 hidden flex-wrap items-center gap-3 lg:flex">
          {overlayCheckbox}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <ChartHeader
        title={t("chart.trajectory")}
        subtitle=""
        showUnitToggle={false}
      />
      {toolbar}
      {extremesToggles}
      {compareMode === "primedope" && !pdPkoFallback && schedule && scheduleRepeats ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <PdCompareToggles
            usePdPayouts={usePdPayouts}
            onUsePdPayoutsChange={onUsePdPayoutsChange}
            usePdFinishModel={usePdFinishModel}
            onUsePdFinishModelChange={onUsePdFinishModelChange}
            usePdRakeMath={usePdRakeMath}
            onUsePdRakeMathChange={onUsePdRakeMathChange}
            pdOverrideStatus={pdOverrideStatus}
            pdOverrideProgress={pdOverrideProgress}
          />
        </div>
      ) : null}
      <TrajectoryPlot assets={primary} height={440} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} compactMoney={compactMoney} />
      {slotOverlay && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#60a5fa]" />
            {t("slot.saved")}
          </div>
          <TrajectoryPlot assets={slotOverlay} height={240} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} compactMoney={compactMoney} />
        </div>
      )}
    </Card>
  );
});

/**
 * Money-denominated histogram card. Reads the current unit from its
 * enclosing UnitScope so the header toggle and the scaleBy arg stay
 * in lockstep for this single widget.
 */
function MoneyDistributionCard({
  title,
  subtitle,
  binEdges,
  counts,
  color,
  overlay,
  yAsPct,
  xDomain,
}: {
  title: string;
  subtitle: string;
  binEdges: number[];
  counts: number[];
  color: string;
  overlay: {
    binEdges: number[];
    counts: number[];
    label: string;
  } | null;
  yAsPct?: boolean;
  xDomain?: [number, number];
}) {
  const abi = useContext(AbiContext);
  const { unit } = useMoneyFmt();
  return (
    <Card className="p-5">
      <ChartHeader title={title} subtitle={subtitle} />
      <DistributionChart
        binEdges={binEdges}
        counts={counts}
        color={color}
        scaleBy={unit === "abi" ? abi : undefined}
        unitLabel={unit === "abi" ? "ABI" : "$"}
        overlay={overlay}
        yAsPct={yAsPct}
        xDomain={xDomain}
      />
    </Card>
  );
}

function DownswingsCard({
  downswings,
  upswings,
  tourneysWord,
  streaks,
}: {
  downswings: SimulationResult["downswings"];
  upswings: SimulationResult["upswings"];
  tourneysWord: string;
  streaks?: React.ReactNode;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const renderRow = (
    rank: number,
    magnitude: number,
    magnitudeColor: string,
    finalProfit: number,
    longestBreakeven: number,
  ) => (
    <tr
      key={rank}
      className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
    >
      <td className="py-2 pr-3 text-[color:var(--color-fg-muted)]">#{rank}</td>
      <td
        className="py-2 px-3 text-right tabular-nums whitespace-nowrap"
        style={{ color: magnitudeColor }}
      >
        {money(magnitude)}
      </td>
      <td
        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${finalProfit >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-fg)]"}`}
      >
        {money(finalProfit)}
      </td>
      <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap text-[color:var(--color-fg-muted)]">
        {Math.round(longestBreakeven)} {tourneysWord}
      </td>
    </tr>
  );
  return (
    <Card className="p-5">
      <ChartHeader title={t("dd.title")} subtitle={t("dd.sub")} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="overflow-x-auto">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-danger)]">
            {t("dd.worstDown")}
          </div>
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b-2 border-[color:var(--color-border)] text-[11px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                <th className="py-2 pr-3 text-left font-semibold">{t("dd.rank")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.depth")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.final")}</th>
                <th className="py-2 pl-3 text-right font-semibold">
                  {t("dd.breakeven")}
                </th>
              </tr>
            </thead>
            <tbody>
              {downswings.map((d) =>
                renderRow(
                  d.rank,
                  -d.depth,
                  "var(--color-danger)",
                  d.finalProfit,
                  d.longestBreakeven,
                ),
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-success)]">
            {t("dd.bestUp")}
          </div>
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b-2 border-[color:var(--color-border)] text-[11px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                <th className="py-2 pr-3 text-left font-semibold">{t("dd.rank")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.height")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.final")}</th>
                <th className="py-2 pl-3 text-right font-semibold">
                  {t("dd.breakeven")}
                </th>
              </tr>
            </thead>
            <tbody>
              {upswings.map((u) =>
                renderRow(
                  u.rank,
                  u.height,
                  "var(--color-success)",
                  u.finalProfit,
                  u.longestBreakeven,
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
      {streaks && <div className="mt-6">{streaks}</div>}
    </Card>
  );
}

function TrimPctSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 px-2 py-1"
      title={label}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={40}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-16 cursor-pointer accent-[color:var(--color-accent)]"
        aria-label={label}
      />
      <span className="min-w-[2.5rem] whitespace-nowrap text-right font-mono text-[10px] tabular-nums text-[color:var(--color-fg-muted)]">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function RunModeSlider({
  value,
  onChange,
  t,
}: {
  value: RunMode;
  onChange: (v: RunMode) => void;
  t: ReturnType<typeof useT>;
}) {
  const modes: RunMode[] = ["worst", "random", "best"];
  return (
    <div
      className="inline-flex max-w-full overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 shadow-sm"
      role="radiogroup"
      aria-label={t("runs.mode.title")}
      title={t("runs.mode.title")}
    >
      {modes.map((m, i) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={
              "px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors " +
              (active
                ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
                : "bg-transparent text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]") +
              (i > 0 ? " border-l border-[color:var(--color-border)]" : "")
            }
          >
            {t(`runs.mode.${m}` as DictKey)}
          </button>
        );
      })}
    </div>
  );
}

function LineStylePresetPicker({
  value,
  onChange,
}: {
  value: LineStylePresetId;
  onChange: (v: LineStylePresetId) => void;
}) {
  const t = useT();
  const active = LINE_STYLE_PRESETS[value];
  const activeMeta = LINE_STYLE_PRESET_META[value];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LineStylePresetId)}
        className="min-w-[8.5rem] rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm outline-none hover:border-[color:var(--color-accent)] focus:border-[color:var(--color-accent)]"
        title={t(activeMeta.descriptionKey)}
      >
        {LINE_STYLE_PRESET_ORDER.map((id) => (
          <option key={id} value={id}>
            {t(LINE_STYLE_PRESET_META[id].labelKey)}
          </option>
        ))}
      </select>
      {/* Mini preview: mean stroke + dashed EV stroke so you can see the
          style without running a sim. */}
      <span className="inline-flex shrink-0 items-center rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 shadow-sm">
        <svg
          width="42"
          height="14"
          viewBox="0 0 42 14"
          aria-hidden
          className="shrink-0"
        >
          <line
            x1="1"
            y1="9"
            x2="41"
            y2="5"
            stroke={active.mean.stroke}
            strokeWidth={active.mean.width}
            strokeLinecap="round"
          />
          <line
            x1="1"
            y1="11"
            x2="41"
            y2="8"
            stroke={active.ev.stroke}
            strokeWidth={active.ev.width}
            strokeDasharray={active.ev.dash?.join(" ") ?? "0"}
            strokeLinecap="round"
          />
        </svg>
      </span>
    </div>
  );
}

function LineStyleCustomizer({
  preset,
  overrides,
  onChange,
  t,
}: {
  preset: LineStylePreset;
  overrides: LineStyleOverrides;
  onChange: (ov: LineStyleOverrides) => void;
  t: (key: DictKey) => string;
}) {
  // Real/agg best/worst live inline next to the toolbar, so the Customize
  // dropdown only covers the three residual lines: EV reference and the
  // p5/p95 percentile envelopes.
  const CUSTOMIZER_KEYS: OverridableLineKey[] = ["ev", "p05", "p95"];
  const labelKey = (k: OverridableLineKey): DictKey =>
    ({
      mean: "lineStyle.line.mean",
      ev: "lineStyle.line.ev",
      best: "lineStyle.line.best",
      worst: "lineStyle.line.worst",
      p05: "lineStyle.line.p05",
      p95: "lineStyle.line.p95",
    })[k] as DictKey;

  const setKey = (
    k: OverridableLineKey,
    patch: { stroke?: string; width?: number; enabled?: boolean },
  ) => {
    const current = overrides[k] ?? {};
    const next: LineStyleOverrides = {
      ...overrides,
      [k]: { ...current, ...patch },
    };
    onChange(next);
  };

  const resetKey = (k: OverridableLineKey) => {
    const next = { ...overrides };
    delete next[k];
    onChange(next);
  };

  const hasAny = CUSTOMIZER_KEYS.some((k) => overrides[k]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useCloseDetailsOnOutsideClick(detailsRef);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="cursor-pointer select-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm hover:border-[color:var(--color-accent)]">
        {t("lineStyle.customize")}
      </summary>
      <div
        className="absolute left-0 top-full z-10 mt-1 hidden rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg group-open:block"
        style={{ width: "min(22rem, calc(100vw - 4rem))" }}
      >
        <div className="flex flex-col gap-2">
          {CUSTOMIZER_KEYS.map((k) => {
            const base = preset[k];
            const ov = overrides[k] ?? {};
            const stroke = ov.stroke ?? base.stroke;
            const width = ov.width ?? base.width;
            const enabled = isLineEnabled(k, overrides);
            // color input needs a hex value — fall back to preset color if it's a named/rgba.
            const hex = /^#([0-9a-f]{3}){1,2}$/i.test(stroke) ? stroke : "#34d399";
            return (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setKey(k, { enabled: e.target.checked })}
                  className="h-3 w-3 cursor-pointer accent-[color:var(--color-accent)]"
                  aria-label={t(labelKey(k))}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[color:var(--color-fg-dim)] sm:min-w-[8rem]"
                  title={t(labelKey(k))}
                >
                  {t(labelKey(k))}
                </span>
                <DebouncedColorInput
                  value={hex}
                  disabled={!enabled}
                  onChange={(v) => setKey(k, { stroke: v })}
                  aria-label={t(labelKey(k))}
                />
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.25}
                  value={width}
                  disabled={!enabled}
                  onChange={(e) => setKey(k, { width: Number(e.target.value) })}
                  className="min-w-0 flex-1 disabled:opacity-40"
                  aria-label={t("lineStyle.width")}
                />
                <span className="w-6 text-right tabular-nums text-[color:var(--color-fg-dim)]">
                  {width.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => resetKey(k)}
                  disabled={!overrides[k]}
                  className="rounded px-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)] disabled:opacity-30"
                  title={t("lineStyle.reset")}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => onChange({})}
            disabled={!hasAny}
            className="mt-1 self-end rounded border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] disabled:opacity-30"
          >
            {t("lineStyle.resetAll")}
          </button>
        </div>
      </div>
    </details>
  );
}

function CollapsibleSection({
  id,
  title,
  children,
  showUnitToggle = true,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  showUnitToggle?: boolean;
  defaultOpen?: boolean;
}) {
  const storageKey = `tvs.collapse.${id}.v1`;
  const ref = useRef<HTMLDetailsElement>(null);
  // Controlled `open` on <details> is historically flaky because the browser
  // toggles the attribute synchronously on click, competing with React's
  // render. Use a ref: hydrate open state post-mount from localStorage, then
  // let the browser own the attribute and just persist changes in onToggle.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof localStorage === "undefined") return;
    try {
      const v = localStorage.getItem(storageKey);
      el.open = v == null ? defaultOpen : v === "1";
    } catch {}
  }, [storageKey, defaultOpen]);
  const onToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    try {
      localStorage.setItem(
        storageKey,
        e.currentTarget.open ? "1" : "0",
      );
    } catch {}
  };
  return (
    <UnitScope id={`collapse.${id}`}>
      <details
        ref={ref}
        onToggle={onToggle}
        className="group rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-1)]"
      >
        <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]">
          <span>{title}</span>
          <span className="ml-auto">
            {showUnitToggle && <InlineUnitToggle />}
          </span>
          <span className="text-[10px] transition-transform group-open:rotate-90">
            ▶
          </span>
        </summary>
        <div className="border-t border-[color:var(--color-border)] p-0">
          {children}
        </div>
      </details>
    </UnitScope>
  );
}

/**
 * Close a <details> popover when the user clicks outside it. Native <details>
 * only toggles on summary click; without this, the customizer stays pinned
 * open until the user explicitly clicks the summary again.
 */
function useCloseDetailsOnOutsideClick(
  ref: React.RefObject<HTMLDetailsElement | null>,
) {
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.key === "Escape") el.open = false;
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

function RefLineCustomizer({
  value,
  onChange,
  t,
}: {
  value: RefLineConfig[];
  onChange: (v: RefLineConfig[]) => void;
  t: (key: DictKey) => string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useCloseDetailsOnOutsideClick(detailsRef);
  const setAt = (i: number, patch: Partial<RefLineConfig>) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };
  const addLine = () => {
    const next: RefLineConfig[] = [
      ...value,
      { roi: 0, label: roiLabel(0), color: "#94a3b8", enabled: true },
    ];
    onChange(next);
  };
  const reset = () => onChange(DEFAULT_REF_LINES);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="cursor-pointer select-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm hover:border-[color:var(--color-accent)]">
        {t("refLines.label")}
      </summary>
      <div
        className="absolute left-0 top-full z-10 mt-1 hidden w-[15rem] rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg group-open:block sm:w-80"
      >
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>{t("refLines.title")}</span>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)]"
          >
            {t("lineStyle.resetAll")}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {value.map((ref, i) => {
            const hex = /^#([0-9a-f]{3}){1,2}$/i.test(ref.color) ? ref.color : "#94a3b8";
            const pctValue = Math.round(ref.roi * 100);
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={ref.enabled}
                  onChange={(e) => setAt(i, { enabled: e.target.checked })}
                  className="h-3 w-3 cursor-pointer accent-[color:var(--color-accent)]"
                  aria-label={t("refLines.enabled")}
                />
                <DebouncedColorInput
                  value={hex}
                  onChange={(v) => setAt(i, { color: v })}
                  aria-label={t("refLines.color")}
                />
                <span className="text-[color:var(--color-fg-dim)]">ROI</span>
                <input
                  type="number"
                  value={pctValue}
                  step={5}
                  min={-99}
                  max={10_000}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    if (raw < -99 || raw > 10_000) return;
                    const nextRoi = raw / 100;
                    setAt(i, { roi: nextRoi, label: roiLabel(nextRoi) });
                  }}
                  className="w-14 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)] px-1 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)]"
                  aria-label={t("refLines.roi")}
                />
                <span className="text-[color:var(--color-fg-dim)]">%</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="ml-auto rounded px-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-danger)]"
                  title={t("refLines.remove")}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 w-full rounded border border-dashed border-[color:var(--color-border)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)]"
        >
          + {t("refLines.add")}
        </button>
      </div>
    </details>
  );
}

/**
 * Context-bound unit toggle. Reads the current money/abi mode from
 * MoneyFmtContext so any widget can drop it in without prop-drilling.
 * Swallows click events so placing it inside a <summary> won't also
 * toggle the enclosing <details>.
 */
function InlineUnitToggle() {
  const { unit, setUnit } = useMoneyFmt();
  const t = useT();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span onClick={stop} onMouseDown={stop}>
      <UnitToggle value={unit} onChange={setUnit} t={t} />
    </span>
  );
}

function UnitToggle({
  value,
  onChange,
  t,
}: {
  value: UnitMode;
  onChange: (v: UnitMode) => void;
  t: (key: DictKey) => string;
}) {
  const btn = (mode: "money" | "abi", label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
        value === mode
          ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
          : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 shadow-sm">
      {btn("money", t("unit.money"))}
      {btn("abi", t("unit.abi"))}
    </div>
  );
}

function ChartHelp({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
      {text}
    </div>
  );
}

function PrimedopeReportCard({ result }: { result: SimulationResult }) {
  // PrimeDope-style numeric dump — mirrors the layout of their site so users
  // can put the two side by side and watch deltas as they tweak settings.
  // When the run has a comparison twin (binary-ITM), shows both columns.
  const cols: { label: string; res: SimulationResult; tone: string }[] = [
    { label: "наша α-калибровка", res: result, tone: "#34d399" },
  ];
  if (result.comparison) {
    cols.push({
      label: "PrimeDope (binary-ITM)",
      res: result.comparison,
      tone: "#60a5fa",
    });
  }

  const fmt$ = (v: number) =>
    `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const buildRows = (r: SimulationResult) => {
    const N = r.tournamentsPerSample;
    const cost = r.totalBuyIn;
    const meanSim = r.stats.mean;
    const sdSim = r.stats.stdDev;
    // Math (analytic) EV from compile-time targets — not affected by MC noise.
    const evMath = r.expectedProfit;
    // Math SD from per-sample MC SE has the same expectation as sdSim, so
    // we report sdSim under both columns; PrimeDope's "math" SD is just the
    // closed-form binomial-ish estimate, which lines up with our sim within
    // a few percent at S ≈ 1000+.
    const ci = (k: number) => ({
      lo: meanSim - k * sdSim,
      hi: meanSim + k * sdSim,
    });
    const ci70 = ci(1.036); // 1.036σ ≈ 70 %
    const ci95 = ci(1.96);
    const ci997 = ci(3);
    const probLoss = 1 - r.stats.probProfit;
    return {
      N,
      cost,
      evMath,
      meanSim,
      sdSim,
      roiMath: cost > 0 ? evMath / cost : 0,
      roiSim: cost > 0 ? meanSim / cost : 0,
      ci70,
      ci95,
      ci997,
      ror50: r.stats.minBankrollRoR50pct,
      ror15: r.stats.minBankrollRoR15pct,
      ror5: r.stats.minBankrollRoR5pct,
      ror1: r.stats.minBankrollRoR1pct,
      ror5Gauss: r.stats.minBankrollRoR5pctGaussian,
      ror1Gauss: r.stats.minBankrollRoR1pctGaussian,
      probLoss,
      neverBelow: r.stats.neverBelowZeroFrac,
    };
  };

  const rows = cols.map((c) => ({ ...c, data: buildRows(c.res) }));

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">{children}</div>
    </div>
  );
  const Line = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--color-fg-dim)]">{k}</span>
      <span className="tabular-nums text-[color:var(--color-fg)]">{v}</span>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          PrimeDope-style report
        </div>
        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          формат с сайта PrimeDope — для прямого сравнения
        </div>
      </div>
      <div className={`grid gap-5 ${rows.length === 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {rows.map((col) => (
          <div key={col.label} className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 p-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: col.tone }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
                {col.label}
              </span>
            </div>
            <Section title="Return on investment, EV & SD">
              <Line k="Total tournaments" v={col.data.N.toLocaleString()} />
              <Line k="Sample size" v={col.res.samples.toLocaleString()} />
              <Line k="Sum buy-ins" v={fmt$(col.data.cost)} />
              <Line k="EV (mathematically)" v={fmt$(col.data.evMath)} />
              <Line k="EV (simulated)" v={fmt$(col.data.meanSim)} />
              <Line k="ROI (mathematically)" v={fmtPct(col.data.roiMath)} />
              <Line k="ROI (simulated)" v={fmtPct(col.data.roiSim)} />
              <Line k="SD (simulated)" v={fmt$(col.data.sdSim)} />
            </Section>
            <Section title="Confidence Intervals (simulated)">
              <Line
                k="70%"
                v={`${fmt$(col.data.ci70.lo)} – ${fmt$(col.data.ci70.hi)}`}
              />
              <Line
                k="95%"
                v={`${fmt$(col.data.ci95.lo)} – ${fmt$(col.data.ci95.hi)}`}
              />
              <Line
                k="99.7%"
                v={`${fmt$(col.data.ci997.lo)} – ${fmt$(col.data.ci997.hi)}`}
              />
            </Section>
            <Section title="Bankroll & risk of ruin">
              <Line k="RoR 50%" v={fmt$(col.data.ror50)} />
              <Line k="RoR 15%" v={fmt$(col.data.ror15)} />
              <Line k="RoR 5%" v={fmt$(col.data.ror5)} />
              <Line k="RoR 1%" v={fmt$(col.data.ror1)} />
              <Line k="RoR 5% · Gaussian" v={fmt$(col.data.ror5Gauss)} />
              <Line k="RoR 1% · Gaussian" v={fmt$(col.data.ror1Gauss)} />
              <Line
                k={`Runs that never dipped below 0`}
                v={`${Math.round(col.data.neverBelow * col.res.samples)} / ${col.res.samples.toLocaleString()}`}
              />
              <Line
                k={`Probability of loss after ${col.data.N.toLocaleString()} tournaments`}
                v={fmtPct(col.data.probLoss)}
              />
            </Section>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OverlayLegendChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
      <span
        className="inline-block h-[1px] w-6 border-t-2 border-dashed"
        style={{ borderColor: "#60a5fa" }}
      />
      <span>{label}</span>
    </div>
  );
}

function ChartPane({
  label,
  sublabel,
  hueDot,
  caption,
  children,
  action,
  itmRate,
  itmCashOnly,
}: {
  label: string;
  sublabel?: string | null;
  hueDot: string;
  caption: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  itmRate?: number;
  itmCashOnly?: boolean;
}) {
  const t = useT();
  const itmLabel = itmCashOnly ? t("chart.itmBadge.cash") : "ITM";
  const itmTitle = itmCashOnly
    ? t("chart.itmBadge.cash.tip")
    : `In-the-money rate: ${itmRate != null ? (itmRate * 100).toFixed(2) : "—"}%`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev-2)]/30 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Pane identity: colored dot tinted with the pane's hue, the model
            label, and (if known) an ITM-rate pill in the same hue. The pill
            replaces the older inline "ITM 15.0% [bar]" combo — the model the
            number belongs to is now read from the pill color, not from a
            separate legend strip. */}
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{
            background: hueDot,
            boxShadow: `0 0 8px ${hueDot}`,
          }}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] font-mono text-[color:var(--color-fg-dim)]">
            {sublabel}
          </span>
        )}
        {itmRate != null && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{
              borderColor: `color-mix(in srgb, ${hueDot} 45%, transparent)`,
              background: `color-mix(in srgb, ${hueDot} 12%, transparent)`,
              color: hueDot,
            }}
            title={itmTitle}
          >
            {itmLabel} {(itmRate * 100).toFixed(1)}%
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
      <div className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
        {caption}
      </div>
    </div>
  );
}

function buildPrimedopeCheatSheet(
  schedule: TournamentRow[],
  scheduleRepeats: number,
  locale: "en" | "ru",
): string {
  const r = schedule[0];
  const totalTourneys = Math.round(
    schedule.reduce((acc, row) => acc + row.count, 0) * scheduleRepeats,
  );
  const paidPct =
    r.payoutStructure === "satellite-ticket"
      ? 10
      : r.payoutStructure === "mtt-flat"
      ? 20
      : r.payoutStructure === "battle-royale"
      ? (3 / 18) * 100
      : r.payoutStructure === "mtt-top-heavy"
      ? 12
      : r.payoutStructure === "mtt-gg"
      ? 18
      : r.payoutStructure === "mtt-gg-bounty"
      ? 11.5
      : r.payoutStructure === "mtt-gg-mystery"
      ? 13
      : r.payoutStructure === "mtt-sunday-million"
      ? 13.8
      : 15;
  const lines =
    locale === "ru"
      ? [
          `# Введи в PrimeDope вручную:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% поля`,
          ``,
          schedule.length > 1
            ? `⚠ В расписании ${schedule.length} строк — PrimeDope умеет только одну. Скопированы параметры первой строки (${r.label ?? r.id}).`
            : ``,
        ]
      : [
          `# Paste into PrimeDope manually:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% of field`,
          ``,
          schedule.length > 1
            ? `⚠ Your schedule has ${schedule.length} rows — PrimeDope only handles one. The first row's values were copied (${r.label ?? r.id}).`
            : ``,
        ];
  return lines.filter(Boolean).join("\n");
}

function PdCompareToggles({
  usePdPayouts,
  onUsePdPayoutsChange,
  usePdFinishModel,
  onUsePdFinishModelChange,
  usePdRakeMath,
  onUsePdRakeMathChange,
  pdOverrideStatus,
  pdOverrideProgress,
}: {
  usePdPayouts: boolean;
  onUsePdPayoutsChange?: (v: boolean) => void;
  usePdFinishModel: boolean;
  onUsePdFinishModelChange?: (v: boolean) => void;
  usePdRakeMath: boolean;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
}) {
  const t = useT();
  const row = (
    checked: boolean,
    onChange: ((v: boolean) => void) | undefined,
    labelKey: DictKey,
    hintKey: DictKey,
  ) =>
    onChange ? (
      <div className="flex items-center gap-1">
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-[color:var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3 w-3 accent-[color:var(--color-accent)]"
          />
          <span>{t(labelKey)}</span>
        </label>
        <InfoTooltip content={t(hintKey)} />
      </div>
    ) : null;
  return (
    <div className="flex items-center gap-2">
      {row(
        usePdPayouts,
        onUsePdPayoutsChange,
        "chart.trajectory.pdPayouts",
        "chart.trajectory.pdPayouts.hint",
      )}
      {row(
        usePdFinishModel,
        onUsePdFinishModelChange,
        "chart.trajectory.pdFinishModel",
        "chart.trajectory.pdFinishModel.hint",
      )}
      {row(
        usePdRakeMath,
        onUsePdRakeMathChange,
        "chart.trajectory.pdRakeMath",
        "chart.trajectory.pdRakeMath.hint",
      )}
      {pdOverrideStatus === "running" && (
        <div className="h-1 w-16 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
          <div
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-100"
            style={{
              width: `${Math.max(2, Math.min(100, (pdOverrideProgress ?? 0) * 100))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function PrimedopeReproduceButton({
  schedule,
  scheduleRepeats,
}: {
  schedule: TournamentRow[];
  scheduleRepeats: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const cheat = buildPrimedopeCheatSheet(schedule, scheduleRepeats, locale);
    try {
      await navigator.clipboard.writeText(cheat);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore — still open the tab
    }
    window.open(
      "https://www.primedope.com/tournament-variance-calculator/",
      "_blank",
      "noopener,noreferrer",
    );
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={t("pd.reproduce.hint")}
      className="inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
        <path
          d="M14 3h7v7M10 14L21 3M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {copied ? t("pd.reproduce.copied") : t("pd.reproduce.label")}
    </button>
  );
}

function CopyPdDiagButton({
  settings,
  schedule,
  scheduleRepeats,
  bankroll,
  result,
  pdChart,
  pdOverrideStatus,
  usePdPayouts,
  usePdFinishModel,
  usePdRakeMath,
}: {
  settings?: ControlsState;
  schedule: TournamentRow[];
  scheduleRepeats: number;
  bankroll: number;
  result: SimulationResult;
  pdChart: SimulationResult | null | undefined;
  pdOverrideStatus: "idle" | "running" | "done" | "error";
  usePdPayouts: boolean;
  usePdFinishModel: boolean;
  usePdRakeMath: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const statSummary = (r: SimulationResult | null | undefined) => {
      if (!r) return null;
      const s = r.stats as Record<string, unknown>;
      const num = (k: string) =>
        typeof s[k] === "number" ? (s[k] as number) : undefined;
      const round = (v: number | undefined) =>
        v == null ? undefined : Math.round(v);
      const fix4 = (v: number | undefined) =>
        v == null ? undefined : Number(v.toFixed(4));
      return {
        mean: round(num("mean")),
        stdDev: round(num("stdDev")),
        median: round(num("median")),
        min: round(num("min")),
        max: round(num("max")),
        p01: round(num("p01")),
        p05: round(num("p05")),
        p95: round(num("p95")),
        p99: round(num("p99")),
        maxDrawdownMean: round(num("maxDrawdownMean")),
        maxDrawdownMedian: round(num("maxDrawdownMedian")),
        maxDrawdownP95: round(num("maxDrawdownP95")),
        maxDrawdownP99: round(num("maxDrawdownP99")),
        maxDrawdownWorst: round(num("maxDrawdownWorst")),
        minBankrollRoR1pct: round(num("minBankrollRoR1pct")),
        minBankrollRoR5pct: round(num("minBankrollRoR5pct")),
        itmRate: fix4(num("itmRate")),
        probProfit: fix4(num("probProfit")),
        riskOfRuin: fix4(num("riskOfRuin")),
        sigmaPerTourneyEmpirical: (() => {
          const v = num("sigmaPerTournamentEmpirical");
          return v == null ? undefined : Number(v.toFixed(2));
        })(),
        sigmaPerTourneyMath: (() => {
          const v = num("sigmaPerTournamentMath");
          return v == null ? undefined : Number(v.toFixed(2));
        })(),
        spreadMaxMinusMean:
          num("max") != null && num("mean") != null
            ? Math.round((num("max") as number) - (num("mean") as number))
            : undefined,
      };
    };
    const dump = {
      timestamp: new Date().toISOString(),
      scheduleRepeats,
      bankroll,
      schedule: schedule.map((r) => ({
        players: r.players,
        buyIn: r.buyIn,
        rake: r.rake,
        roi: r.roi,
        payoutStructure: r.payoutStructure,
        count: r.count,
        bountyFraction: r.bountyFraction,
      })),
      pdFlagsFromProps: {
        usePdPayouts,
        usePdFinishModel,
        usePdRakeMath,
      },
      settingsPdFlags: settings
        ? {
            usePrimedopePayouts: settings.usePrimedopePayouts,
            usePrimedopeFinishModel: settings.usePrimedopeFinishModel,
            usePrimedopeRakeMath: settings.usePrimedopeRakeMath,
            compareMode: settings.compareMode,
            modelPresetId: settings.modelPresetId,
            samples: settings.samples,
            seed: settings.seed,
          }
        : null,
      pdOverrideStatus,
      primary: statSummary(result),
      pdPane: statSummary(pdChart ?? null),
      comparisonPresent: !!result.comparison,
      pdOverrideVsComparison:
        pdChart && result.comparison
          ? pdChart === result.comparison
            ? "same-as-result.comparison"
            : "pdOverrideResult-different-from-result.comparison"
          : null,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* noop */
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy PD diagnostic logs to clipboard"
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      {copied ? "copied ✓" : "copy PD logs"}
    </button>
  );
}

function ChartHeader({
  title,
  subtitle,
  showUnitToggle = true,
  tip,
}: {
  title: string;
  subtitle?: string;
  /** Hide the money/ABI toggle on charts whose axes aren't in money. */
  showUnitToggle?: boolean;
  /** Optional help tooltip surfaced as a "?" button next to the title. */
  tip?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex w-full items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <div className="font-display text-[16px] font-bold leading-[1.15] tracking-[-0.005em] text-[color:var(--color-fg)] sm:text-[18px]">
            {title}
          </div>
          {tip && <InfoTooltip content={tip} />}
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-[color:var(--color-fg-dim)]">{subtitle}</div>}
      </div>
      {showUnitToggle && <InlineUnitToggle />}
    </div>
  );
}

function PrimedopeDiff({
  primary,
  other,
  theirsLabel,
  title,
  subtitle,
  hasBounty,
}: {
  primary: SimulationResult;
  other: SimulationResult;
  theirsLabel?: string;
  title?: string;
  subtitle?: string;
  /** When true, the primary schedule has bounty tournaments (PKO / Mystery /
   * BR). The "Cash-in rate" row gets relabeled to "Cash-ITM (excl. bounties)"
   * with a footnote — raw ITM comparison against a no-bounty schedule is
   * apples-to-oranges because bounties are a separate EV channel. */
  hasBounty?: boolean;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const ours = primary.stats;
  const theirs = other.stats;
  const pctPp = (a: number, b: number) =>
    `${((a - b) * 100).toFixed(2)} процентных пунктов`;
  const ratioPct = (a: number, b: number) =>
    `${((a / Math.max(1e-9, b) - 1) * 100).toFixed(1)} %`;
  const diffMoney = (a: number, b: number) =>
    `${a - b >= 0 ? "+" : "−"}${money(Math.abs(a - b))}`;
  const rows: {
    label: string;
    ours: string;
    theirs: string;
    delta: string;
    highlight?: boolean;
  }[] = [
    {
      label: t("pd.row.ev"),
      ours: money(primary.expectedProfit),
      theirs: money(other.expectedProfit),
      delta: diffMoney(primary.expectedProfit, other.expectedProfit),
      highlight: true,
    },
    {
      label: hasBounty ? t("pd.row.itm.cash") : t("pd.row.itm"),
      ours: pct(ours.itmRate),
      theirs: pct(theirs.itmRate),
      delta: pctPp(ours.itmRate, theirs.itmRate),
    },
    {
      label: t("pd.row.pprofit"),
      ours: pct(ours.probProfit),
      theirs: pct(theirs.probProfit),
      delta: pctPp(ours.probProfit, theirs.probProfit),
    },
    {
      label: t("pd.row.dd"),
      ours: money(ours.maxDrawdownMean),
      theirs: money(theirs.maxDrawdownMean),
      delta: ratioPct(ours.maxDrawdownMean, theirs.maxDrawdownMean),
    },
    {
      label: t("pd.row.ddWorst"),
      ours: money(ours.maxDrawdownWorst),
      theirs: money(theirs.maxDrawdownWorst),
      delta: diffMoney(ours.maxDrawdownWorst, theirs.maxDrawdownWorst),
    },
    {
      label: t("pd.row.longestBE"),
      ours: `${Math.round(ours.longestBreakevenMean)} турниров`,
      theirs: `${Math.round(theirs.longestBreakevenMean)} турниров`,
      delta: `${Math.round(ours.longestBreakevenMean - theirs.longestBreakevenMean)} турниров`,
    },
    {
      label: t("pd.row.var95"),
      ours: money(ours.var95),
      theirs: money(theirs.var95),
      delta: diffMoney(ours.var95, theirs.var95),
    },
    {
      label: t("pd.row.cvar"),
      ours: money(ours.cvar95),
      theirs: money(theirs.cvar95),
      delta: ratioPct(ours.cvar95, theirs.cvar95),
    },
    {
      label: t("pd.row.cvar99"),
      ours: money(ours.cvar99),
      theirs: money(theirs.cvar99),
      delta: ratioPct(ours.cvar99, theirs.cvar99),
    },
    {
      label: t("pd.row.worstRun"),
      ours: money(ours.min),
      theirs: money(theirs.min),
      delta: diffMoney(ours.min, theirs.min),
    },
    {
      label: t("pd.row.bestRun"),
      ours: money(ours.max),
      theirs: money(theirs.max),
      delta: diffMoney(ours.max, theirs.max),
    },
    {
      label: t("pd.row.ror"),
      ours: pct(ours.riskOfRuin),
      theirs: pct(theirs.riskOfRuin),
      delta: pctPp(ours.riskOfRuin, theirs.riskOfRuin),
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {title ?? t("pd.title")}
          </div>
          <div className="text-xs text-[color:var(--color-fg-dim)]">
            {subtitle ?? t("pd.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#34d399]" />{" "}
            {t("pd.ours")}
          </span>
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#60a5fa]" />{" "}
            {theirsLabel ?? t("pd.theirs")}
          </span>
        </div>
      </div>
      <div className="mb-3 rounded border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/6 px-3 py-2 text-[11px] leading-relaxed">
        <div className="font-semibold text-[color:var(--color-accent)]">
          {t("pd.evDelta.title")}
        </div>
        <div className="mt-0.5 text-[color:var(--color-fg-muted)]">
          {t("pd.evDelta.body")}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <th className="py-2 text-left font-medium">{t("pd.metric")}</th>
              <th className="py-2 text-right font-medium">{t("pd.ours")}</th>
              <th className="py-2 text-right font-medium">{theirsLabel ?? "primedope"}</th>
              <th className="py-2 text-right font-medium">{t("pd.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className={
                  r.highlight
                    ? "border-b border-[color:var(--color-border)] bg-[color:var(--color-accent)]/8"
                    : "border-b border-[color:var(--color-border)]/60 last:border-b-0"
                }
              >
                <td
                  className={
                    r.highlight
                      ? "py-2.5 font-semibold text-[color:var(--color-fg)]"
                      : "py-2 text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.label}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-[color:var(--color-fg)]">
                  {r.ours}
                </td>
                <td className="py-2 text-right tabular-nums text-[#60a5fa]">
                  {r.theirs}
                </td>
                <td
                  className={
                    r.highlight
                      ? "py-2 text-right font-semibold tabular-nums text-[color:var(--color-accent)]"
                      : "py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasBounty && (
        <div className="mt-3 rounded border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev)]/40 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {t("pd.row.itm.cashNote")}
        </div>
      )}
    </Card>
  );
}

function DebouncedColorInput({
  value,
  disabled,
  onChange,
  ...rest
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  // Uncontrolled: native <input type="color"> tracks its own in-flight value
  // during drag. We debounce the upstream onChange so each drag tick does not
  // trigger a full ResultsView re-render. `key={value}` forces a reset if the
  // prop changes externally (rare), sidestepping the controlled-vs-uncontrolled
  // mirror pattern that tripped the hooks lint rules.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <input
      key={value}
      type="color"
      defaultValue={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        latestRef.current = v;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onChangeRef.current(latestRef.current);
        }, 120);
      }}
      onBlur={() => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (latestRef.current !== value) onChangeRef.current(latestRef.current);
      }}
      className="h-5 w-5 cursor-pointer rounded-[5px] border border-[color:var(--color-border)] bg-transparent p-0 shadow-sm disabled:opacity-40"
      {...rest}
    />
  );
}
