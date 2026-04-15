"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { ControlsPanel, type ControlsState } from "@/components/ControlsPanel";
import { ResultsView } from "@/components/ResultsView";
import { Section, Card } from "@/components/ui/Section";
import { CornerToggles } from "@/components/ui/CornerToggles";
import { FinishPMFPreview } from "@/components/charts/FinishPMFPreview";
import { useSimulation } from "@/lib/sim/useSimulation";
import { validateSchedule } from "@/lib/sim/validation";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import { SCENARIOS } from "@/lib/scenarios";
import type {
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import {
  addUserPreset,
  buildShareUrl,
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
    label: "Bread & butter",
    players: 500,
    buyIn: 10,
    rake: 0.1,
    roi: 0.2,
    payoutStructure: "mtt-standard",
    count: 1,
  },
];

const initialControls: ControlsState = {
  scheduleRepeats: 200,
  samples: 10_000,
  bankroll: 0,
  seed: 42,
  finishModelId: "power-law",
  alphaOverride: null,
  compareWithPrimedope: true,
  compareMode: "primedope",
  primedopeStyleEV: true,
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
};

interface CompareSlot {
  label: string;
  state: PersistedState;
  result: SimulationResult | null;
}

export default function Home() {
  const t = useT();
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
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);

  const { status, progress, result, error, elapsedMs, run, cancel, estimateMs } = useSimulation();

  useEffect(() => {
    const fromUrl = loadFromUrlHash();
    const fromLocal = fromUrl ?? loadLocal();
    startTransition(() => {
      if (fromLocal) {
        setSchedule(fromLocal.schedule);
        setControls({
          ...initialControls,
          ...fromLocal.controls,
          compareWithPrimedope: true,
        });
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveLocal({ v: 1, schedule, controls });
  }, [schedule, controls, hydrated]);

  const buildInput = useCallback(
    (s: TournamentRow[], c: ControlsState): SimulationInput => ({
      schedule: s,
      scheduleRepeats: c.scheduleRepeats,
      samples: c.samples,
      bankroll: c.bankroll,
      seed: c.seed,
      finishModel: {
        id: c.finishModelId,
        alpha: c.alphaOverride ?? undefined,
        empiricalBuckets:
          c.finishModelId === "empirical" ? c.empiricalBuckets : undefined,
      },
      compareWithPrimedope: c.compareWithPrimedope,
      compareMode: c.compareMode,
      modelPresetId: c.modelPresetId,
      primedopeStyleEV: c.primedopeStyleEV,
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
    }),
    [],
  );

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

  const feasibility = useMemo(
    () => validateSchedule(schedule, previewModel),
    [schedule, previewModel],
  );

  const onRun = useCallback(() => {
    if (!feasibility.ok) return;
    const input = buildInput(schedule, controls);
    input.seed =
      (((Math.random() * 0xffffffff) >>> 0) ^
        ((Date.now() & 0xffffffff) >>> 0)) >>>
      0;
    run(input);
  }, [schedule, controls, run, buildInput, feasibility.ok]);

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

  const previewRow = useMemo(() => {
    if (!schedule.length) return undefined;
    const found = previewRowId
      ? schedule.find((r) => r.id === previewRowId)
      : undefined;
    return found ?? schedule[0];
  }, [schedule, previewRowId]);

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

  const loadScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setSchedule(s.schedule);
    setControls({ ...initialControls, ...s.controls });
    setActiveScenarioId(id);
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
        if (!p || typeof p !== "object" || !p.id || !p.state) continue;
        byId.set(p.id, p);
      }
      const merged = Array.from(byId.values());
      saveUserPresets(merged);
      setUserPresets(merged);
      window.alert(
        t("presets.importDone").replace("{n}", String(incoming.length)),
      );
    } catch {
      window.alert(t("presets.importError"));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-10 sm:py-14">
      <header className="flex flex-col gap-6">
        {/* Top strip: kicker + toggles */}
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[color:var(--color-accent)] text-[10px] font-bold text-[color:var(--color-accent)]">
              ♠
            </span>
            <div className="eyebrow">{t("app.kicker")}</div>
          </div>
          <CornerToggles />
        </div>

        {/* Editorial hero — FF-style, full width, no side stats */}
        <div className="relative pt-4 pb-3 sm:pt-6 sm:pb-4">
          <h1 className="text-[56px] font-black uppercase leading-[0.88] tracking-[-0.02em] sm:text-[96px] lg:text-[128px]">
            <span className="text-[color:var(--color-fg)]">
              {t("app.title").split(" ")[0]}
            </span>
            <br />
            <span className="text-[color:var(--color-accent)]">
              {t("app.title").split(" ").slice(1).join(" ") || t("app.title")}
            </span>
          </h1>
          <div className="eyebrow mt-2 text-right text-[color:var(--color-fg-dim)]">v0.3</div>
        </div>

        {/* Scenario grid */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow">{t("demo.label")}</span>
            {compareSlot && (
              <span className="inline-flex items-center gap-1.5 border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)]">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-accent)]" />
                {t("slot.comparing")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
            {SCENARIOS.filter((s) => advanced || s.id !== "romeo-pro").map((s, i) => {
              const total = s.schedule.reduce((n, r) => n + r.count, 0);
              const buyIns = s.schedule.map((r) => r.buyIn);
              const lo = Math.min(...buyIns);
              const hi = Math.max(...buyIns);
              const range =
                lo === hi ? `$${lo}` : `$${lo}–${hi}`;
              const active = activeScenarioId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => loadScenario(s.id)}
                  title={s.description}
                  className={`group relative flex flex-col items-start gap-2 overflow-hidden border px-4 py-3 text-left transition-all ${
                    active
                      ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] hover:border-[color:var(--color-accent)]/60 hover:bg-[color:var(--color-bg-elev-2)]"
                  }`}
                >
                  <div className="relative flex w-full items-center justify-between">
                    {s.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.icon}
                        alt=""
                        aria-hidden
                        className={`h-6 w-6 select-none rounded-full object-cover ring-1 ${
                          active
                            ? "ring-[color:var(--color-accent)]"
                            : "ring-[color:var(--color-border-strong)]"
                        }`}
                      />
                    ) : (
                      <span
                        className={`font-mono text-[10px] tabular-nums ${
                          active
                            ? "text-[color:var(--color-accent)]"
                            : "text-[color:var(--color-fg-dim)]"
                        }`}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    )}
                    <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                      {total} × {range}
                    </span>
                  </div>
                  <div
                    className={`relative text-[13px] font-semibold leading-tight ${
                      active
                        ? "text-[color:var(--color-accent)]"
                        : "text-[color:var(--color-fg)] group-hover:text-[color:var(--color-accent)]"
                    }`}
                  >
                    {t(s.labelKey)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* User-saved presets */}
          <div className="mt-2 flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="eyebrow">{t("userPreset.label")}</span>
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
            {userPresets.length === 0 ? (
              <div className="text-[11px] text-[color:var(--color-fg-dim)]">
                {t("userPreset.empty")}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
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
            )}
          </div>
        </div>
      </header>

      <Section
        number="01"
        suit="spade"
        title={t("section.schedule.title")}
      >
        <ScheduleEditor
          schedule={schedule}
          onChange={(s) => {
            setSchedule(s);
            setActiveScenarioId(null);
          }}
          disabled={running}
        />
      </Section>

      <Section
        number="02"
        suit="diamond"
        title={t("section.controls.title")}
        subtitle={t("section.controls.subtitle")}
      >
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
          <ControlsPanel
            value={controls}
            onChange={(c) => {
              setControls(c);
              setActiveScenarioId(null);
            }}
            onRun={onRun}
            onCancel={cancel}
            running={running}
            progress={progress}
            estimatedMs={estimateMs(
              controls.samples,
              controls.scheduleRepeats,
              schedule.reduce((a, r) => a + Math.max(1, Math.floor(r.count)), 0),
            )}
            tournamentsPerSession={
              schedule.reduce((a, r) => a + Math.max(1, Math.floor(r.count)), 0) *
              Math.max(1, controls.scheduleRepeats)
            }
            doneSummary={
              status === "done" && result
                ? {
                    mean: result.stats.mean,
                    median: result.stats.median,
                    roi: result.stats.mean / result.totalBuyIn,
                    probProfit: result.stats.probProfit,
                    riskOfRuin: result.stats.riskOfRuin,
                    elapsedMs,
                    resultsAnchorId: "results-top",
                  }
                : null
            }
          />
          {previewRow && (
            <Card className="p-5">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <div className="text-sm font-semibold text-[color:var(--color-fg)]">
                    {t("preview.title")}
                  </div>
                  <div className="text-xs text-[color:var(--color-fg-dim)]">
                    {t("preview.sub")}
                  </div>
                </div>
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
                onRowChange={(updates) =>
                  setSchedule((prev) =>
                    prev.map((r) =>
                      r.id === previewRow.id ? { ...r, ...updates } : r,
                    ),
                  )
                }
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
              bankroll={controls.bankroll}
              schedule={schedule}
              scheduleRepeats={controls.scheduleRepeats}
              compareMode={controls.compareMode}
              modelPresetId={controls.modelPresetId}
              finishModelId={controls.finishModelId}
              settings={controls}
              elapsedMs={elapsedMs}
            />
          </Section>
        </>
      )}

      <footer className="mt-4 flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-fg-dim)]">
        <div>
          {t("footer.line")}{" "}
          <span className="text-[color:var(--color-fg-muted)]">
            {t("footer.state")}
          </span>
          {" · "}
          <a
            href="https://github.com/loremcdmx/tournament-variance-sim"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--color-fg-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--color-fg)]"
          >
            {t("footer.github")}
          </a>
          {" · "}
          {t("footer.madeBy")}{" "}
          <a
            href="https://t.me/loremnopoker"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--color-fg-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--color-fg)]"
          >
            LoremCDMX
          </a>
        </div>
        <details className="group">
          <summary className="cursor-pointer select-none text-[color:var(--color-fg-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--color-fg)]">
            {t("changelog.title")}
          </summary>
          <div className="mt-3 space-y-3 pl-2">
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v04.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v04.summary")}</li>
            </ul>
            <div className="text-[color:var(--color-fg-muted)]">{t("changelog.v03.title")}</div>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("changelog.v03.preview")}</li>
              <li>{t("changelog.v03.unit")}</li>
              <li>{t("changelog.v03.presets")}</li>
              <li>{t("changelog.v03.exportImport")}</li>
              <li>{t("changelog.v03.ru")}</li>
              <li>{t("changelog.v03.layout")}</li>
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
