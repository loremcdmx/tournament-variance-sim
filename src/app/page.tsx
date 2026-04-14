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
import { useT } from "@/lib/i18n/LocaleProvider";
import { SCENARIOS } from "@/lib/scenarios";
import type {
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import {
  addUserPreset,
  loadFromUrlHash,
  loadLocal,
  loadUserPresets,
  removeUserPreset,
  saveLocal,
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
  const [schedule, setSchedule] = useState<TournamentRow[]>(initialSchedule);
  const [controls, setControls] = useState<ControlsState>(initialControls);
  const [compareSlot, setCompareSlot] = useState<CompareSlot | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);

  useEffect(() => {
    setUserPresets(loadUserPresets());
  }, []);

  const { status, progress, result, error, elapsedMs, run, cancel } = useSimulation();

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

  const onRun = useCallback(() => {
    const input = buildInput(schedule, controls);
    input.seed =
      (((Math.random() * 0xffffffff) >>> 0) ^
        ((Date.now() & 0xffffffff) >>> 0)) >>>
      0;
    run(input);
  }, [schedule, controls, run, buildInput]);

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
        <div className="relative py-10 sm:py-16">
          <div className="eyebrow mb-6">/ variance.lab — v1</div>
          <h1 className="text-[56px] font-black uppercase leading-[0.88] tracking-[-0.02em] sm:text-[96px] lg:text-[128px]">
            <span className="text-[color:var(--color-fg)]">
              {t("app.title").split(" ")[0]}
            </span>
            <br />
            <span className="text-[color:var(--color-accent)]">
              {t("app.title").split(" ").slice(1).join(" ") || t("app.title")}
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-[color:var(--color-fg-muted)]">
            {t("app.subtitle")}
          </p>
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
            {SCENARIOS.map((s, i) => {
              const total = s.schedule.reduce((n, r) => n + r.count, 0);
              const buyIns = s.schedule.map((r) => r.buyIn);
              const lo = Math.min(...buyIns);
              const hi = Math.max(...buyIns);
              const range =
                lo === hi ? `$${lo}` : `$${lo}–${hi}`;
              const active = activeScenarioId === s.id;
              const disabled = s.disabled === true;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => loadScenario(s.id)}
                  title={disabled ? `${s.description} (coming soon)` : s.description}
                  className={`group relative flex flex-col items-start gap-2 overflow-hidden border px-4 py-3 text-left transition-all ${
                    disabled
                      ? "cursor-not-allowed border-dashed border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/40 opacity-40"
                      : active
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
            <div className="flex items-center justify-between">
              <span className="eyebrow">{t("userPreset.label")}</span>
              <button
                type="button"
                onClick={onSaveUserPreset}
                className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
              >
                + {t("userPreset.saveCurrent")}
              </button>
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
                      <button
                        type="button"
                        onClick={() => onDeleteUserPreset(p.id)}
                        aria-label={t("userPreset.delete")}
                        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center text-[color:var(--color-fg-dim)] opacity-0 transition-opacity hover:text-[color:var(--color-accent)] group-hover:opacity-100"
                      >
                        ×
                      </button>
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
        subtitle={t("section.schedule.subtitle")}
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
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
              <FinishPMFPreview row={previewRow} model={previewModel} />
            </Card>
          )}
        </div>
      </Section>

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

      <footer className="mt-4 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-fg-dim)]">
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
