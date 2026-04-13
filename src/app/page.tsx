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
  buildShareUrl,
  loadFromUrlHash,
  loadLocal,
  saveLocal,
  type PersistedState,
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
  compareWithPrimedope: false,
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
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const { status, progress, result, error, run } = useSimulation();

  useEffect(() => {
    const fromUrl = loadFromUrlHash();
    const fromLocal = fromUrl ?? loadLocal();
    startTransition(() => {
      if (fromLocal) {
        setSchedule(fromLocal.schedule);
        setControls({ ...initialControls, ...fromLocal.controls });
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
    }),
    [],
  );

  const onRun = useCallback(() => {
    run(buildInput(schedule, controls));
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

  const totalTournaments = useMemo(() => {
    const per = schedule.reduce((a, r) => a + r.count, 0);
    return per * controls.scheduleRepeats;
  }, [schedule, controls.scheduleRepeats]);

  const previewRow = schedule[0];
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

  const onShare = async () => {
    const url = buildShareUrl({ v: 1, schedule, controls });
    try {
      await navigator.clipboard.writeText(url);
      setCopyHint(t("app.copied"));
    } catch {
      window.prompt("Share link:", url);
      setCopyHint(t("app.linkReady"));
    }
    setTimeout(() => setCopyHint(null), 2000);
  };

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
  };

  const onExportCSV = () => {
    if (!result) return;
    const rows = ["sample_index,final_profit"];
    for (let i = 0; i < result.finalProfits.length; i++) {
      rows.push(`${i},${result.finalProfits[i].toFixed(2)}`);
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulation_finals.csv";
    a.click();
    URL.revokeObjectURL(url);
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

        {/* Editorial hero */}
        <div className="bracketed relative grid grid-cols-1 gap-6 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/60 p-6 sm:p-8 lg:grid-cols-[2fr_1fr]">
          <div>
            <div className="eyebrow mb-3">/ variance.lab — v1</div>
            <h1 className="text-[44px] font-black uppercase leading-[0.95] tracking-tight sm:text-[64px]">
              <span className="text-[color:var(--color-fg)]">
                {t("app.title").split(" ")[0]}
              </span>
              <br />
              <span className="text-[color:var(--color-accent)]">
                {t("app.title").split(" ").slice(1).join(" ") || t("app.title")}
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
              {t("app.subtitle")}
            </p>
          </div>
          <div className="flex flex-col justify-between gap-4 border-t border-[color:var(--color-border)] pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
            <div className="flex flex-col gap-2">
              <HeroStat
                label={t("app.tournaments")}
                value={totalTournaments.toLocaleString()}
              />
              <HeroStat
                label={t("app.samples")}
                value={controls.samples.toLocaleString()}
              />
              <HeroStat
                label="model"
                value={t(`model.${controls.finishModelId}` as const)
                  .replace(/ finish model| model/i, "")
                  .trim()}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <TextBtn onClick={onShare}>
                  {copyHint ?? t("app.shareLink")}
                </TextBtn>
                <TextBtn onClick={onExportCSV} disabled={!result}>
                  {t("app.exportCSV")}
                </TextBtn>
              </div>
              <div className="eyebrow">{t("app.runHint")}</div>
            </div>
          </div>
        </div>

        {/* Scenario ticker */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">{t("demo.label")} →</span>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => loadScenario(s.id)}
              title={s.description}
              className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
            >
              {t(s.labelKey)}
            </button>
          ))}
          {compareSlot && (
            <span className="ml-auto inline-flex items-center gap-1.5 border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-accent)]" />
              {t("slot.comparing")}
            </span>
          )}
        </div>
      </header>

      <Section
        number="01"
        suit="spade"
        title={t("section.schedule.title")}
        subtitle={t("section.schedule.subtitle")}
      >
        <ScheduleEditor schedule={schedule} onChange={setSchedule} />
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
            onChange={setControls}
            onRun={onRun}
            running={running}
            progress={progress}
          />
          {previewRow && (
            <Card className="p-5">
              <div className="mb-2 text-sm font-semibold text-[color:var(--color-fg)]">
                {t("preview.title")}
              </div>
              <div className="mb-3 text-xs text-[color:var(--color-fg-dim)]">
                {t("preview.sub")}
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
            />
          </Section>
        </>
      )}

      <footer className="mt-4 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-fg-dim)]">
        {t("footer.line")}{" "}
        <span className="text-[color:var(--color-fg-muted)]">
          {t("footer.state")}
        </span>
      </footer>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[color:var(--color-border)] pb-2">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums text-[color:var(--color-fg)]">
        {value}
      </span>
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
