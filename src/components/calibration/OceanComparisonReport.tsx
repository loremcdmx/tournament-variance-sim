"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  FORMAT_COMPARISON_DEFAULTS,
  FORMAT_COMPARISON_LIMITS,
  oceanWheelCutoffs,
  type ComparisonFormat,
  type FormatComparisonConfig,
  type FormatComparisonSummary,
  type NumericBounds,
  type ProbabilityEstimate,
} from "@/lib/calibration/formatComparison";
import { useFormatComparison } from "@/lib/calibration/useFormatComparison";
import type { EmpiricalBridgeData } from "@/lib/calibration/oceanTransport";
import type { PublicSpaceProfile } from "@/lib/calibration/types";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { DictKey, Locale } from "@/lib/i18n/dict";
import { EmpiricalOceanExplorer } from "./EmpiricalOceanExplorer";
import { SurvivalChart, LowerPathChart, AggregateRunsChart } from "./OceanReportCharts";
import styles from "./OceanComparisonReport.module.css";

const panel = "min-w-0 rounded-xl border border-border bg-bg-elev p-4 sm:p-6";
const prose = "max-w-3xl text-sm leading-relaxed text-fg-muted";
const input = "w-full min-w-0 rounded-lg border border-border-strong bg-bg px-3 py-2.5 text-fg tabular-nums outline-offset-2 focus:outline-2 focus:outline-accent aria-invalid:border-danger";
const focus = "outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent";
const th = "px-4 py-3 text-right font-medium text-fg-muted";
const td = "px-4 py-3 text-right tabular-nums";
const formatNames: Record<ComparisonFormat, DictKey> = {
  freezeout: "oceanReport.freezeout", pko: "oceanReport.pko", mystery: "oceanReport.mystery",
  "ocean-ko": "oceanReport.ocean", "mystery-royale": "oceanReport.battle",
};
const payoutNames: Record<string, DictKey> = {
  "mtt-gg": "oceanReport.payoutGG", "mtt-gg-bounty": "oceanReport.payoutKO",
  "mtt-gg-mystery": "oceanReport.payoutMystery", "battle-royale": "oceanReport.payoutBR",
};
type Translate = (key: DictKey) => string;
type Draft = Record<keyof FormatComparisonConfig, string>;
const initialDraft: Draft = Object.fromEntries(Object.entries(FORMAT_COMPARISON_DEFAULTS).map(([key, value]) => [key, String(key === "roi" ? value * 100 : value)])) as Draft;
const draftKeys = Object.keys(initialDraft) as (keyof Draft)[];

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

function ScrollTable({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  const t = useT();
  return <div className="min-w-0">
    {!compact && <p className={styles.scrollHint}>{t("oceanReport.scrollTable")}</p>}
    <div className={`${styles.scrollTable} ${compact ? styles.compactTable : ""} ${focus}`} tabIndex={0} role="region" aria-label={label}>
      <table className={styles.table}>{children}</table>
    </div>
  </div>;
}

function RowName({ row, t }: { row: FormatComparisonSummary; t: Translate }) {
  return <th scope="row" className={`whitespace-nowrap px-4 py-3 text-left font-medium ${row.format === "ocean-ko" ? "text-accent" : "text-fg"}`}>{t(formatNames[row.format])}</th>;
}

function Probability({ value, format, interval }: { value: ProbabilityEstimate; format: (n: number) => string; interval: boolean }) {
  return <span className="inline-flex flex-col items-end gap-0.5"><span>{format(value.value)}</span>{interval && <span className="text-xs text-fg-muted">{format(value.wilson95.lower)}–{format(value.wilson95.upper)}</span>}</span>;
}

function MetricTable({ rows, kind, t, n, compact = false }: { rows: FormatComparisonSummary[]; kind: "depth" | "duration"; t: Translate; n: (value: number, digits?: number) => string; compact?: boolean }) {
  const [metric, setMetric] = useState(kind === "depth" ? 0 : 1);
  const first = kind === "depth" ? "maxDrawdownBI" : "longestUnderwater";
  const second = kind === "depth" ? "maxEvShortfallBI" : "longestBelowEv";
  const title = t(kind === "depth" ? (compact ? "oceanReport.depthCompact" : "oceanReport.comparison") : (compact ? "oceanReport.durationCompact" : "oceanReport.duration"));
  const visibility = (group: number) => metric !== group ? styles.metricHidden : "";
  return <div>
    <div className={styles.metricSwitch} role="group" aria-label={title}>
      {["oceanReport.peakShort", "oceanReport.evShort"].map((key, index) => <button key={key} type="button" className={focus} aria-pressed={metric === index} onClick={() => setMetric(index)}>{t(key as DictKey)}</button>)}
    </div>
    <div className={styles.metricTable}>
      <table className={styles.table} aria-label={title}>
        <thead><tr>
          <th rowSpan={2} scope="col" className="text-left">{t("oceanReport.format")}</th>
          <th colSpan={2} scope="colgroup" className={visibility(0)}>{t(compact ? (kind === "depth" ? "oceanReport.fromPeak" : "oceanReport.peakShort") : (kind === "depth" ? "oceanReport.maxDD" : "oceanReport.underwater"))}</th>
          <th colSpan={2} scope="colgroup" className={visibility(1)}>{t(compact ? "oceanReport.evShort" : (kind === "depth" ? "oceanReport.maxEV" : "oceanReport.underEV"))}</th>
        </tr><tr>{[0, 1].map(group => <FragmentHeaders key={group} t={t} className={visibility(group)} />)}</tr></thead>
        <tbody>{rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format}>
          <RowName row={row} t={t} />
          {([first, second] as const).map((key, group) => <MetricCells key={key} median={row[key].median} p95={row[key].p95} className={visibility(group)} n={value => n(value, kind === "duration" ? 0 : 1)} />)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function MetricCells({ median, p95, className, n }: { median: number; p95: number; className: string; n: (value: number) => string }) {
  return <><td className={`${td} ${className}`}>{n(median)}</td><td className={`${td} ${className}`}>{n(p95)}</td></>;
}

function FragmentHeaders({ t, className }: { t: Translate; className: string }) {
  return <><th scope="col" className={`text-right ${className}`}>{t("oceanReport.p50Label")}</th><th scope="col" className={`text-right ${className}`}>{t("oceanReport.p95Label")}</th></>;
}

export function OceanComparisonReport({ profile, bridge, locale, active = true }: { profile: PublicSpaceProfile; bridge: EmpiricalBridgeData; locale: Locale; active?: boolean }) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showIntervals, setShowIntervals] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const report = useFormatComparison();
  const { status: comparisonStatus, cancel: cancelComparison } = report;
  useEffect(() => {
    if (!active && comparisonStatus === "running") cancelComparison();
  }, [active, comparisonStatus, cancelComparison]);
  const numberFormats = useMemo(() => Array.from({ length: 5 }, (_, maximumFractionDigits) => new Intl.NumberFormat(locale, { maximumFractionDigits })), [locale]);
  const n = useCallback((value: number, digits = 1) => numberFormats[digits].format(value), [numberFormats]);
  const pct = useCallback((value: number) => `${n(value * 100, 1)}%`, [n]);
  const bounds = (value: NumericBounds) => Math.abs(value.upper - value.lower) < 0.00001 ? n(value.lower, 2) : `${n(value.lower, 2)}–${n(value.upper, 2)}`;
  const parsed = useMemo(() => {
    const config = Object.fromEntries(draftKeys.map(key => [key, draft[key].trim() ? Number(draft[key]) / (key === "roi" ? 100 : 1) : NaN])) as unknown as FormatComparisonConfig;
    const invalid = draftKeys.filter(key => {
      const value = config[key];
      const limit = key === "seed" ? { min: 0, max: 0xffffffff } : FORMAT_COMPARISON_LIMITS[key];
      return !Number.isFinite(value) || value < limit.min || value > limit.max || (["players", "distance", "samples", "seed"].includes(key) && !Number.isSafeInteger(value));
    });
    return { config, invalid };
  }, [draft]);
  const snapshot = report.configSnapshot;
  const stale = snapshot !== null && draftKeys.some(key => parsed.config[key] !== snapshot[key]);
  const rows = report.rows.filter(row => row.comparable);
  const ocean = rows.find(row => row.format === "ocean-ko");
  const battle = report.rows.find(row => !row.comparable);
  const complete = report.status === "done" && report.completed === report.total;
  const running = report.status === "running";
  const wheel = useMemo(() => oceanWheelCutoffs(), []);
  const controls: { key: keyof Draft; label: DictKey; step: string }[] = [
    { key: "players", label: "oceanReport.field", step: "1" },
    { key: "roi", label: "oceanReport.roi", step: "any" },
    { key: "distance", label: "oceanReport.distance", step: "1" },
    { key: "samples", label: "oceanReport.samples", step: "1" },
    { key: "seed", label: "oceanReport.seed", step: "1" },
  ];
  const mechanics: { format: ComparisonFormat; key: DictKey }[] = [
    { format: "freezeout", key: "oceanReport.mechanicsFreeze" }, { format: "pko", key: "oceanReport.mechanicsPKO" },
    { format: "mystery", key: "oceanReport.mechanicsMystery" }, { format: "ocean-ko", key: "oceanReport.mechanicsOcean" },
    { format: "mystery-royale", key: "oceanReport.mechanicsBattle" },
  ];

  const field = ({ key, label, step }: typeof controls[number]) => {
    const limit = key === "seed" ? { min: 0, max: 0xffffffff } : FORMAT_COMPARISON_LIMITS[key];
    const factor = key === "roi" ? 100 : 1;
    return <label key={key} htmlFor={`${id}-${key}`}>
      <span className="font-medium">{t(label)}</span>
      <input id={`${id}-${key}`} aria-label={t(label)} type="number" inputMode={key === "roi" ? "decimal" : "numeric"} min={limit.min * factor} max={limit.max * factor} step={step} value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} aria-invalid={parsed.invalid.includes(key)} aria-describedby={`${id}-${key}-range`} className={input} />
      <span id={`${id}-${key}-range`} className={parsed.invalid.includes(key) ? "text-xs text-danger" : "sr-only"}>{interpolate(t("oceanReport.range"), { min: n(limit.min * factor, 0), max: n(limit.max * factor, 0) })}</span>
    </label>;
  };
  const pko = rows.find(row => row.format === "pko");
  const formatOrder: ComparisonFormat[] = ["freezeout", "pko", "mystery", "ocean-ko", "mystery-royale"];

  return <article className={`${styles.report} min-w-0 space-y-6`} aria-labelledby={`${id}-title`}>
    <header className="space-y-2 pt-2">
      <h2 id={`${id}-title`} className="display max-w-4xl text-3xl leading-tight sm:text-4xl">{t("oceanReport.title")}</h2>
      <p className="max-w-3xl text-base leading-relaxed">{t("oceanReport.intro")}</p>
    </header>
    {snapshot && <nav className={styles.nav} aria-label={t("oceanReport.title")}>
      {([["settings", "oceanReport.settingsShort"], ["results", "oceanReport.jumpResults"], ["charts", "oceanReport.chartsShort"], ["evidence", "oceanReport.jumpEvidence"], ["method", "oceanReport.jumpMethod"]] as const).filter(([target]) => target !== "charts" || rows.length > 0).map(([target, key]) => <a key={target} className={focus} href={`#${id}-${target}`} onClick={() => { const section = document.getElementById(`${id}-${target}`); if (section instanceof HTMLDetailsElement) section.open = true; }}>{t(key)}</a>)}
    </nav>}

    <form id={`${id}-settings`} className={styles.settings} onSubmit={event => { event.preventDefault(); if (!parsed.invalid.length && !running) report.run(parsed.config); }}>
      <div className={styles.settingsHeading}><h3 className="text-lg font-semibold">{t("oceanReport.settings")}</h3><span>{t("oceanReport.modelEstimate")}</span></div>
      <p className={`${prose} mt-2`}>{t("oceanReport.settingsNote")}</p>
      <fieldset disabled={running} className={`${styles.fields} disabled:opacity-70`}>
        <label><span className="font-medium">{t("oceanReport.ticket")}</span><select className={input} value={draft.ticket} onChange={event => setDraft(previous => ({ ...previous, ticket: event.target.value }))}><option value="10">$10</option><option value="100">$100</option></select></label>
        {controls.slice(0, 3).map(field)}
      </fieldset>
      <div className={styles.presets} role="group" aria-label={t("oceanReport.quickDistance")}>
        <span className="mr-1 text-xs text-fg-muted">{t("oceanReport.distance")}</span>
        {[1000, 5000, 20000, 50000, 100000].map(distance => <button type="button" key={distance} className={focus} disabled={running} aria-pressed={Number(draft.distance) === distance} onClick={() => setDraft(previous => ({ ...previous, distance: String(distance) }))}>{n(distance, 0)}</button>)}
      </div>
      <div className={styles.actions}>
        <button type="submit" disabled={running || parsed.invalid.length > 0} className={`rounded-lg bg-accent px-5 py-3 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}>{t(stale ? "oceanReport.recalculate" : "oceanReport.run")}</button>
        {running && <button type="button" className={`rounded-lg border border-border-strong px-5 py-3 font-medium ${focus}`} onClick={report.cancel}>{t("oceanReport.cancel")}</button>}
      </div>
      <details className={styles.advanced} open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary className={focus}>{t("oceanReport.advanced")}</summary>
        <p className={`${prose} mt-3`}>{t("oceanReport.advancedNote")}</p>
        <fieldset disabled={running} className={styles.fields}>
          {controls.slice(3).map(field)}
          <label htmlFor={`${id}-mystery`}><span className="font-medium">{t("oceanReport.mysterySpread")}</span><select id={`${id}-mystery`} className={input} value={draft.mysteryLogVariance} onChange={event => setDraft(previous => ({ ...previous, mysteryLogVariance: event.target.value }))}>{[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select><span className="text-xs leading-relaxed text-fg-muted">{t("oceanReport.mysterySpreadNote")}</span></label>
        </fieldset>
      </details>
      {parsed.invalid.length > 0 && <div role="alert" className="mt-4 space-y-2 text-sm text-danger">
        <p>{interpolate(t("oceanReport.invalidFields"), { fields: parsed.invalid.map(key => t(controls.find(control => control.key === key)?.label ?? (key === "ticket" ? "oceanReport.ticket" : "oceanReport.mysterySpread"))).join(", ") })}</p>
        {parsed.invalid.some(key => ["samples", "seed", "mysteryLogVariance"].includes(key)) && !advancedOpen && <button type="button" className={`min-h-11 underline underline-offset-4 ${focus}`} onClick={() => setAdvancedOpen(true)}>{t("oceanReport.openAdvanced")}</button>}
      </div>}
      {parsed.invalid.length === 0 && parsed.config.distance * parsed.config.samples > 10_000_000 && <p className="mt-4 text-sm leading-relaxed text-fg-muted">{interpolate(t("oceanReport.largeRun"), { n: n(parsed.config.distance * parsed.config.samples, 0) })}</p>}
      {running && <div className="mt-4 space-y-2" role="status">
        <p className="text-sm">{interpolate(t("oceanReport.currentFormat"), { format: t(formatNames[formatOrder[Math.min(report.completed, 4)]]), progress: n(report.progress * 100, 0) })}</p>
        <progress max={1} value={report.progress} aria-label={t("oceanReport.resultRunning")} className="h-2 w-full accent-accent" />
      </div>}
    </form>

    <section id={`${id}-results`} className="min-w-0 scroll-mt-6 space-y-6" aria-label={t("oceanReport.jumpResults")}>
      {snapshot && <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t(complete ? "oceanReport.resultDone" : running ? "oceanReport.resultRunning" : "oceanReport.resultPartial")}</h3><a className={`text-sm text-accent ${focus}`} href={`#${id}-settings`}>{t("oceanReport.changeSettings")}</a></div>
        <div className={styles.snapshot}><span>${n(snapshot.ticket, 0)}</span><span>{interpolate(t("oceanReport.resultMeta"), { field: n(snapshot.players, 0), roi: pct(snapshot.roi), distance: n(snapshot.distance, 0) })}</span></div>
        <details><summary className={`cursor-pointer text-xs text-fg-muted ${focus}`}>{t("oceanReport.resultDetails")}</summary><p className="mt-2 text-xs leading-relaxed text-fg-muted">{interpolate(t("oceanReport.snapshot"), { ticket: `$${n(snapshot.ticket, 0)}`, field: n(snapshot.players, 0), roi: pct(snapshot.roi), distance: n(snapshot.distance, 0), samples: n(snapshot.samples, 0), seed: n(snapshot.seed, 0) })}</p><p className="mt-2 text-xs text-fg-muted">{interpolate(t("oceanReport.snapshotMystery"), { value: n(snapshot.mysteryLogVariance, 1) })}</p></details>
      </div>}
      {stale && <p role="status" className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm leading-relaxed">{t("oceanReport.stale")}</p>}
      {report.status === "error" && <div role="alert" className="rounded-lg border border-danger/40 p-4"><p className="text-sm">{t("oceanReport.error")}</p>{report.error && <details className="mt-2 text-xs text-fg-muted"><summary className={`cursor-pointer ${focus}`}>{t("oceanReport.errorDetails")}</summary><p className="mt-2 break-words">{report.error}</p></details>}</div>}
      {report.status === "cancelled" && report.rows.length === 0 && <p role="status" className="text-sm text-fg-muted">{t("oceanReport.cancelledEmpty")}</p>}
      {!complete && !running && report.rows.length > 0 && <p role="status" className="text-sm text-fg-muted">{t("oceanReport.stopped")}</p>}
      {complete && ocean && <section className={styles.summary}>
        <h3 className="display text-2xl">{t("oceanReport.verdict")}</h3>
        <dl className={styles.stats}>
          {([
            { label: "oceanReport.summaryDD", values: ocean.maxDrawdownBI, unit: "BI", digits: 1 },
            { label: "oceanReport.summaryEV", values: ocean.maxEvShortfallBI, unit: "BI", digits: 1 },
            { label: "oceanReport.summaryTime", values: ocean.longestBelowEv, unit: t("oceanReport.entryShort"), digits: 0 },
          ] as const).map(item => <div key={item.label}><dt>{t(item.label)}</dt><dd><span className={styles.statValue}>{n(item.values.p95, item.digits)} <small>{item.unit}</small></span><span className={styles.statSecondary}>{interpolate(t("oceanReport.summaryMedian"), { value: n(item.values.median, item.digits) })}</span></dd></div>)}
        </dl>
        <p className="text-sm leading-relaxed">{t("oceanReport.p95Note")}</p>
        {pko && pko.maxDrawdownBI.p95 > 0 && pko.maxEvShortfallBI.p95 > 0 && <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed">{interpolate(t("oceanReport.summaryPKO"), { dd: n(ocean.maxDrawdownBI.p95 / pko.maxDrawdownBI.p95, 2), ev: n(ocean.maxEvShortfallBI.p95 / pko.maxEvShortfallBI.p95, 2) })}</p>}
      </section>}

      {rows.length > 0 && <>
        <div id={`${id}-charts`} className="space-y-6"><AggregateRunsChart rows={rows} expectedRoi={snapshot?.roi ?? 0} t={t} n={n} /><div className="grid min-w-0 gap-5 xl:grid-cols-2"><SurvivalChart rows={rows} kind="drawdownRisks" t={t} n={n} pct={pct} /><SurvivalChart rows={rows} kind="evShortfallRisks" t={t} n={n} pct={pct} /></div></div>
        <LowerPathChart rows={rows} t={t} n={n} />
        <div className={styles.comparisonGrid}>
        <section className={styles.comparisonBlock}><h3>{t("oceanReport.depthCompact")}</h3><MetricTable compact rows={rows} kind="depth" t={t} n={n} /><p className={styles.comparisonNote}>{t("oceanReport.maximumNote")}</p></section>
        <section className={styles.comparisonBlock}><h3>{t("oceanReport.durationCompact")}</h3><MetricTable compact rows={rows} kind="duration" t={t} n={n} /><p className={styles.comparisonNote}>{t("oceanReport.censorCompact")}</p></section>
        <section className={styles.comparisonBlock}>
          <div className={styles.sectionHeading}><h3>{t("oceanReport.probabilities")}</h3><label className={styles.intervalToggle}><input type="checkbox" checked={showIntervals} onChange={event => setShowIntervals(event.target.checked)} />{t("oceanReport.showIntervals")}</label></div>
          <ScrollTable compact={!showIntervals} label={t("oceanReport.probabilities")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th>{["oceanReport.loss", "oceanReport.belowEV", "oceanReport.unrecovered"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{rows.map(row => <tr data-ocean={row.format === "ocean-ko"} className={`border-t border-border ${row.format === "ocean-ko" ? "bg-accent/5" : ""}`} key={row.format}><RowName row={row} t={t} />{[row.finalLossProbability, row.finalBelowEvProbability, row.recovery.unrecoveredProbability].map((probability, index) => <td key={index} className={td}><Probability value={probability} format={pct} interval={showIntervals} /></td>)}</tr>)}</tbody></ScrollTable>
        </section>
        {complete && ocean && <section className={styles.comparisonBlock}><h3>{t("oceanReport.relative")}</h3><ScrollTable compact label={t("oceanReport.relative")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.ratioDD")}</th><th scope="col" className={th}>{t("oceanReport.ratioEV")}</th></tr></thead><tbody>{rows.filter(row => row.format !== "ocean-ko").map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{row.maxDrawdownBI.p95 > 0 ? `${n(ocean.maxDrawdownBI.p95 / row.maxDrawdownBI.p95, 2)}×` : "—"}</td><td className={td}>{row.maxEvShortfallBI.p95 > 0 ? `${n(ocean.maxEvShortfallBI.p95 / row.maxEvShortfallBI.p95, 2)}×` : "—"}</td></tr>)}</tbody></ScrollTable><p className={styles.comparisonNote}>{t("oceanReport.relativeCompact")}</p></section>}
        </div>
        <details className={styles.inlineDetails}><summary className={focus}>{t("oceanReport.tableGuide")}</summary><div className="space-y-3"><p className={prose}>{t("oceanReport.comparisonNote")}</p><p className={prose}>{t("oceanReport.durationNote")}</p><p className={prose}>{t("oceanReport.censor")}</p><p className={prose}>{t("oceanReport.finishNote")}</p><p className={prose}>{t("oceanReport.belowEVNote")}</p><p className={prose}>{t("oceanReport.recoveryNote")}</p><p className={prose}>{t("oceanReport.probabilityNote")}</p></div></details>
        <details className={styles.disclosure}><summary className={focus}>{t("oceanReport.moreMetrics")}</summary><div className="space-y-6">
        <section className="min-w-0 space-y-3"><h3 className="text-xl font-semibold">{t("oceanReport.recoveryTime")}</h3><p className={prose}>{t("oceanReport.recoveryTimeNote")}</p><ScrollTable label={t("oceanReport.recoveryTime")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.recoveredCount")}</th><th scope="col" className={th}>{t("oceanReport.noDrawdown")}</th><th scope="col" className={th}>{t("oceanReport.median")}</th><th scope="col" className={th}>{t("oceanReport.tail")}</th></tr></thead><tbody>{rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.recovery.recoveredSamples, 0)} / {n(row.samples, 0)}</td><td className={td}>{n(row.recovery.noDrawdownSamples, 0)}</td><td className={td}>{row.recovery.recoveredOnly ? n(row.recovery.recoveredOnly.median, 0) : "—"}</td><td className={td}>{row.recovery.recoveredOnly ? n(row.recovery.recoveredOnly.p95, 0) : "—"}</td></tr>)}</tbody></ScrollTable><p className="text-xs text-fg-muted">{t("oceanReport.entry")}</p></section>
        <section className="min-w-0 space-y-3"><ScrollTable label={t("oceanReport.losingEntries")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.losingEntries")}</th><th scope="col" className={th}>{t("oceanReport.timeBelow")}</th></tr></thead><tbody>{rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.longestLosingEntries.p95, 0)}</td><td className={td}>{pct(row.fractionEntriesBelowEv.median)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.timeBelowNote")}</p></section>
        </div></details>
      </>}
      {battle && <details className={styles.disclosure}><summary className={focus}>{t("oceanReport.battleTitle")}</summary><div className="space-y-3"><p className={prose}>{t("oceanReport.battleNote")}</p><p className={prose}>{t("oceanReport.battleFixed")}</p><MetricTable rows={[battle]} kind="depth" t={t} n={n} /><MetricTable rows={[battle]} kind="duration" t={t} n={n} /></div></details>}
    </section>

    <details className={styles.disclosure}><summary className={focus}>{t("oceanReport.jackpotTitle")}</summary><div className="space-y-3"><p className={prose}>{t("oceanReport.jackpotText")}</p><p className={prose}>{t("oceanReport.jackpotBoundary")}</p>
      <details className={`${panel} mt-4`}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.wheelTitle")}</summary><div className="mt-4 space-y-3"><p className={prose}>{t("oceanReport.wheelIntro")}</p><ScrollTable label={t("oceanReport.wheelTitle")}><thead className="bg-bg"><tr>{["oceanReport.wheelCap", "oceanReport.wheelAbove", "oceanReport.wheelMean", "oceanReport.wheelEV", "oceanReport.wheelVar"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{wheel.map(row => <tr key={row.cap} className="border-t border-border"><th scope="row" className={th}>{row.cap >= 400 ? t("oceanReport.noCap") : `${n(row.cap, 1)}×`}</th><td className={td}>{n(row.probabilityAbove * 100, 4)}%</td><td className={td}>{n(row.meanAfter, 4)}×</td><td className={td}>{pct(row.evRemovedFraction)}</td><td className={td}>{n(row.varianceAfter, 4)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.wheelBoundary")}</p><a href="https://br-1.ggpoker.com/tournaments/ocean-ko/" target="_blank" rel="noreferrer" className={`inline-block text-sm text-accent underline underline-offset-4 ${focus}`}>{t("oceanReport.rules")}</a></div></details>
    </div></details>

    <details id={`${id}-evidence`} className={styles.disclosure}><summary className={focus}>{t("oceanReport.evidenceTitle")}</summary><div className="space-y-3"><p className={prose}>{interpolate(t("oceanReport.evidenceIntro"), { entries: n(profile.trainingEntries, 0), events: n(profile.trainingEvents, 0) })}</p><p className={prose}>{t("oceanReport.evidenceBoundary")}</p><p className={prose}>{t("oceanReport.evidenceCaps")}</p><details className={panel} onToggle={event => setEvidenceOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.evidenceOpen")}</summary>{evidenceOpen && <div className="mt-6"><EmpiricalOceanExplorer profile={profile} bridge={bridge} locale={locale} /></div>}</details></div></details>

    <details id={`${id}-method`} className={styles.disclosure}><summary className={focus}>{t("oceanReport.method")}</summary><div className="space-y-4"><p className={prose}>{t("oceanReport.modelScope")}</p><p className={prose}>{t("oceanReport.methodLimit")}</p><div className="max-w-3xl space-y-3">{["oceanReport.methodEngine", "oceanReport.methodParameters", "oceanReport.methodEV", "oceanReport.methodROI", "oceanReport.methodSeed", "oceanReport.methodTail"].map(key => <p key={key} className={prose}>{t(key as DictKey)}</p>)}</div>
      <h4 className="pt-3 text-xl font-semibold">{t("oceanReport.mechanics")}</h4><dl className="max-w-4xl divide-y divide-border">{mechanics.map(item => <div key={item.format} className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="font-semibold">{t(formatNames[item.format])}</dt><dd className={prose}>{t(item.key)}</dd></div>)}</dl></div></details>

    {report.rows.length > 0 && <details className={styles.disclosure}><summary className={focus}>{t("oceanReport.rowParameters")}</summary><div className="min-w-0 space-y-3"><p className={prose}>{t("oceanReport.rowParametersNote")}</p><ScrollTable label={t("oceanReport.rowParameters")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.ticket", "oceanReport.field", "oceanReport.payout", "oceanReport.rake", "oceanReport.cashPool", "oceanReport.bountyShare"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>${n(row.ticket, 0)}</td><td className={td}>{n(row.players, 0)}</td><td className={`${td} text-xs`}>{t(payoutNames[row.moments.payoutStructure] ?? "oceanReport.noEstimate")}</td><td className={td}>{pct(row.moments.feeFractionOfTicket)}</td><td className={td}>{pct(row.moments.cashPoolFractionOfTicket)}</td><td className={td}>{pct(row.moments.bountyPoolFractionOfTicket)}</td></tr>)}</tbody></ScrollTable>
      <ScrollTable label={t("oceanReport.sigma")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.compiledROI", "oceanReport.sampleROI", "oceanReport.itm", "oceanReport.sigma", "oceanReport.expected"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{pct(row.moments.roi)}</td><td className={td}>{pct(row.realisedMeanRoi)}</td><td className={td}>{pct(row.moments.itm)}</td><td className={td}>{bounds(row.moments.sigmaBI)}</td><td className={td}>{n(row.expectedProfitBI, 1)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.sigmaBound")}</p>
      <details className={panel}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.diagnosticOpen")}</summary><div className="mt-4 space-y-3"><ScrollTable label={t("oceanReport.diagnosticOpen")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.cashMean", "oceanReport.bountyMean", "oceanReport.varianceCash", "oceanReport.varianceBounty", "oceanReport.covariance"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr data-ocean={row.format === "ocean-ko"} key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.moments.cashMeanBI, 3)}</td><td className={td}>{n(row.moments.bountyMeanBI, 3)}</td><td className={td}>{n(row.moments.cashVarianceBI2, 2)}</td><td className={td}>{bounds(row.moments.bountyVarianceBI2)}</td><td className={td}>{n(row.moments.twiceCashBountyCovarianceBI2, 2)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.varianceNote")}</p></div></details>
    </div></details>}

    <details className={styles.disclosure}><summary className={focus}>{t("oceanReport.glossary")}</summary><div className="space-y-4">{[
      ["oceanReport.faqDD", "oceanReport.faqDDAnswer"], ["oceanReport.faq95", "oceanReport.faq95Answer"],
      ["oceanReport.faqLoss", "oceanReport.faqLossAnswer"], ["oceanReport.faqSpace", "oceanReport.faqSpaceAnswer"],
      ["oceanReport.faqScale", "oceanReport.faqScaleAnswer"],
    ].map(([question, answer]) => <details key={question} className="border-b border-border pb-4"><summary className={`cursor-pointer font-medium ${focus}`}>{t(question as DictKey)}</summary><p className={`${prose} mt-3`}>{t(answer as DictKey)}</p></details>)}</div></details>
  </article>;
}
