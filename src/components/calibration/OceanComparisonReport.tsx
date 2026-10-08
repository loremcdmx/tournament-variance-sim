"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
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
const formatColors: Record<ComparisonFormat, string> = {
  freezeout: "var(--c-spade)", pko: "var(--c-club)", mystery: "var(--c-rival)",
  "ocean-ko": "var(--c-accent)", "mystery-royale": "var(--c-heart)",
};
const formatDashes: Record<ComparisonFormat, string | undefined> = {
  freezeout: "2 5", pko: "9 4", mystery: "3 3 10 3", "ocean-ko": undefined, "mystery-royale": "8 4",
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

function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className={`max-w-full overflow-x-auto rounded-lg border border-border ${focus}`} tabIndex={0} role="region" aria-label={label}>
    <table className="w-full min-w-[40rem] border-collapse text-sm">{children}</table>
  </div>;
}

function RowName({ row, t }: { row: FormatComparisonSummary; t: Translate }) {
  return <th scope="row" className={`whitespace-nowrap px-4 py-3 text-left font-medium ${row.format === "ocean-ko" ? "text-accent" : "text-fg"}`}>{t(formatNames[row.format])}</th>;
}

function Probability({ value, format }: { value: ProbabilityEstimate; format: (n: number) => string }) {
  return <span className="inline-flex flex-col items-end gap-0.5"><span>{format(value.value)}</span><span className="text-xs text-fg-muted">{format(value.wilson95.lower)}–{format(value.wilson95.upper)}</span></span>;
}

function MetricTable({ rows, kind, t, n }: { rows: FormatComparisonSummary[]; kind: "depth" | "duration"; t: Translate; n: (value: number, digits?: number) => string }) {
  const first = kind === "depth" ? "maxDrawdownBI" : "longestUnderwater";
  const second = kind === "depth" ? "maxEvShortfallBI" : "longestBelowEv";
  const title = t(kind === "depth" ? "oceanReport.comparison" : "oceanReport.duration");
  return <ScrollTable label={title}>
    <thead className="border-b border-border bg-bg">
      <tr><th rowSpan={2} scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th colSpan={2} scope="colgroup" className={th}>{t(kind === "depth" ? "oceanReport.maxDD" : "oceanReport.underwater")}</th><th colSpan={2} scope="colgroup" className={th}>{t(kind === "depth" ? "oceanReport.maxEV" : "oceanReport.underEV")}</th></tr>
      <tr>{[0, 1].map(group => <FragmentHeaders key={group} t={t} />)}</tr>
    </thead>
    <tbody>{rows.map(row => <tr key={row.format} className={`border-b border-border last:border-0 ${row.format === "ocean-ko" ? "bg-accent/5" : ""}`}><RowName row={row} t={t} />
      <td className={td}>{n(row[first].median, kind === "duration" ? 0 : 1)}</td><td className={`${td} font-semibold`}>{n(row[first].p95, kind === "duration" ? 0 : 1)}</td>
      <td className={td}>{n(row[second].median, kind === "duration" ? 0 : 1)}</td><td className={`${td} font-semibold`}>{n(row[second].p95, kind === "duration" ? 0 : 1)}</td>
    </tr>)}</tbody>
  </ScrollTable>;
}

function FragmentHeaders({ t }: { t: Translate }) {
  return <><th scope="col" className={`${th} pt-0 text-xs`}>{t("oceanReport.median")}</th><th scope="col" className={`${th} pt-0 text-xs`}>{t("oceanReport.tail")}</th></>;
}

function Legend({ rows, t }: { rows: FormatComparisonSummary[]; t: Translate }) {
  return <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">{rows.map(row => <li key={row.format} className="flex items-center gap-2"><svg width="27" height="8" aria-hidden="true"><line x1="0" y1="4" x2="27" y2="4" stroke={formatColors[row.format]} strokeWidth={row.format === "ocean-ko" ? 3 : 2} strokeDasharray={formatDashes[row.format]} /></svg>{t(formatNames[row.format])}</li>)}</ul>;
}

function SurvivalChart({ rows, kind, t, n, pct }: { rows: FormatComparisonSummary[]; kind: "drawdownRisks" | "evShortfallRisks"; t: Translate; n: (value: number, digits?: number) => string; pct: (value: number) => string }) {
  const id = useId();
  const thresholds = rows[0]?.[kind].map(point => point.thresholdBI) ?? [];
  const maximum = Math.max(1, ...thresholds);
  const x = (value: number) => 70 + value / maximum * 395;
  const y = (value: number) => 220 - value * 185;
  const title = t(kind === "drawdownRisks" ? "oceanReport.survivalDD" : "oceanReport.survivalEV");
  return <section className={panel}>
    <h3 className="text-lg font-semibold leading-snug">{title}</h3>
    <svg viewBox="0 0 500 285" className="my-4 block w-full [&_text]:text-[20px] sm:[&_text]:text-[12px]" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{t("oceanReport.survivalNote")}</desc>
      {[0, 0.25, 0.5, 0.75, 1].map(value => <g key={value}><line x1="70" x2="465" y1={y(value)} y2={y(value)} stroke="var(--c-border)" /><text x="61" y={y(value) + 5} fill="var(--c-fg-muted)" textAnchor="end">{pct(value)}</text></g>)}
      {thresholds.filter(value => value >= 100).map(value => <text key={value} x={x(value)} y="246" textAnchor={value === maximum ? "end" : "middle"} fill="var(--c-fg-muted)">{n(value, 0)}</text>)}
      <text x="267" y="276" textAnchor="middle" fill="var(--c-fg-muted)">{t("oceanReport.threshold")}</text>
      {rows.map(row => <g key={row.format}><polyline fill="none" stroke={formatColors[row.format]} strokeWidth={row.format === "ocean-ko" ? 3 : 2} strokeDasharray={formatDashes[row.format]} points={row[kind].map(point => `${x(point.thresholdBI)},${y(point.probability.value)}`).join(" ")} />{row[kind].map(point => <circle key={point.thresholdBI} cx={x(point.thresholdBI)} cy={y(point.probability.value)} r="3" fill={formatColors[row.format]} />)}</g>)}
    </svg>
    <Legend rows={rows} t={t} />
    <details className="mt-5"><summary className={`cursor-pointer text-sm font-medium text-accent ${focus}`}>{t("oceanReport.chartData")}</summary><div className="mt-3"><ScrollTable label={title}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.threshold")}</th>{rows.map(row => <th scope="col" className={th} key={row.format}>{t(formatNames[row.format])}</th>)}</tr></thead><tbody>{thresholds.map(threshold => <tr key={threshold} className="border-t border-border"><th scope="row" className="px-4 py-3 text-left font-medium tabular-nums">{n(threshold, 0)}</th>{rows.map(row => { const point = row[kind].find(item => item.thresholdBI === threshold); return <td key={row.format} className={td}>{point ? <Probability value={point.probability} format={pct} /> : "—"}</td>; })}</tr>)}</tbody></ScrollTable><p className="mt-2 text-xs text-fg-muted">{t("oceanReport.interval")}</p></div></details>
  </section>;
}

function LowerPathChart({ rows, t, n }: { rows: FormatComparisonSummary[]; t: Translate; n: (value: number, digits?: number) => string }) {
  const id = useId();
  const maximumX = Math.max(1, ...rows.map(row => row.distance));
  const gaps = rows.flatMap(row => row.downsideCurve.map(point => point.p05BI - point.evBI));
  const minimumY = Math.min(-1, ...gaps) * 1.06;
  const maximumY = Math.max(0, ...gaps);
  const x = (value: number) => 120 + value / maximumX * 605;
  const y = (value: number) => 265 - (value - minimumY) / (maximumY - minimumY) * 220;
  const title = t("oceanReport.trajectory");
  return <section className={panel}>
    <h3 className="text-xl font-semibold">{title}</h3><p className={`${prose} mt-2`}>{t("oceanReport.trajectoryNote")}</p>
    <svg viewBox="0 0 760 345" role="img" aria-labelledby={`${id}-title ${id}-desc`} className="my-4 block w-full [&_text]:text-[28px] sm:[&_text]:text-[13px]">
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{t("oceanReport.trajectoryNote")}</desc>
      {[0, 0.25, 0.5, 0.75, 1].map(value => { const tick = minimumY + value * (maximumY - minimumY); return <g key={value}><line x1="120" x2="725" y1={y(tick)} y2={y(tick)} stroke="var(--c-border)" /><text x="109" y={y(tick) + 6} textAnchor="end" fill="var(--c-fg-muted)">{n(tick, 0)}</text></g>; })}
      {[0, 0.25, 0.5, 0.75, 1].map(value => <text key={value} x={x(value * maximumX)} y="300" textAnchor={value === 0 ? "start" : value === 1 ? "end" : "middle"} fill="var(--c-fg-muted)">{n(value * maximumX, 0)}</text>)}
      <text x="120" y="29" fill="var(--c-fg-muted)">{t("oceanReport.evGap")}</text><text x="422" y="337" textAnchor="middle" fill="var(--c-fg-muted)">{t("oceanReport.entry")}</text>
      {rows.map(row => <polyline key={row.format} fill="none" stroke={formatColors[row.format]} strokeWidth={row.format === "ocean-ko" ? 3 : 2} strokeDasharray={formatDashes[row.format]} points={row.downsideCurve.map(point => `${x(point.entries)},${y(point.p05BI - point.evBI)}`).join(" ")} />)}
    </svg><Legend rows={rows} t={t} />
    <details className="mt-5"><summary className={`cursor-pointer text-sm font-medium text-accent ${focus}`}>{t("oceanReport.chartData")}</summary><div className="mt-3 space-y-2"><p className="text-xs text-fg-muted">{t("oceanReport.selectedCheckpoints")}</p><ScrollTable label={t("oceanReport.selectedCheckpoints")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.entry")}</th>{rows.map(row => <th key={row.format} scope="col" className={th}>{t(formatNames[row.format])}</th>)}</tr></thead><tbody>{[0, 0.25, 0.5, 0.75, 1].map(fraction => {
      const target = maximumX * fraction;
      const nearest = (row: FormatComparisonSummary) => row.downsideCurve.reduce((best, point) => Math.abs(point.entries - target) < Math.abs(best.entries - target) ? point : best);
      return <tr key={fraction} className="border-t border-border"><th scope="row" className="px-4 py-3 text-left font-medium tabular-nums">{n(nearest(rows[0]).entries, 0)}</th>{rows.map(row => { const point = nearest(row); return <td key={row.format} className={td}>{n(point.p05BI - point.evBI, 1)}</td>; })}</tr>;
    })}</tbody></ScrollTable></div></details>
  </section>;
}

export function OceanComparisonReport({ profile, bridge, locale }: { profile: PublicSpaceProfile; bridge: EmpiricalBridgeData; locale: Locale }) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const report = useFormatComparison();
  const n = (value: number, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const pct = (value: number) => `${n(value * 100, 1)}%`;
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

  return <article className="min-w-0 space-y-8" aria-labelledby={`${id}-title`}>
    <header className="space-y-4 border-b border-border pb-6">
      <h2 id={`${id}-title`} className="display max-w-4xl text-3xl leading-tight sm:text-4xl">{t("oceanReport.title")}</h2>
      <p className="max-w-3xl text-base leading-relaxed sm:text-lg">{t("oceanReport.intro")}</p>
      <p className={prose}>{t("oceanReport.modelScope")}</p>
      <nav className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-accent" aria-label={t("oceanReport.title")}>
        <a className={focus} href={`#${id}-results`}>{t("oceanReport.jumpResults")}</a><a className={focus} href={`#${id}-evidence`}>{t("oceanReport.jumpEvidence")}</a><a className={focus} href={`#${id}-method`}>{t("oceanReport.jumpMethod")}</a>
      </nav>
    </header>

    <form className={panel} onSubmit={event => { event.preventDefault(); if (!parsed.invalid.length && !running) report.run(parsed.config); }}>
      <h3 className="text-xl font-semibold">{t("oceanReport.settings")}</h3><p className={`${prose} mt-2`}>{t("oceanReport.settingsNote")}</p>
      <fieldset disabled={running} className="mt-5 grid min-w-0 gap-4 disabled:opacity-70 sm:grid-cols-2 lg:grid-cols-3">
        <label className="min-w-0 space-y-2 text-sm"><span className="block font-medium">{t("oceanReport.ticket")}</span><select className={input} value={draft.ticket} onChange={event => setDraft(previous => ({ ...previous, ticket: event.target.value }))}><option value="10">$10</option><option value="100">$100</option></select></label>
        {controls.map(({ key, label, step }) => { const limit = key === "seed" ? { min: 0, max: 0xffffffff } : FORMAT_COMPARISON_LIMITS[key]; const factor = key === "roi" ? 100 : 1; return <label key={key} className="min-w-0 space-y-2 text-sm" htmlFor={`${id}-${key}`}><span className="block font-medium">{t(label)}</span><input id={`${id}-${key}`} type="number" inputMode={key === "roi" ? "decimal" : "numeric"} min={limit.min * factor} max={limit.max * factor} step={step} value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} aria-invalid={parsed.invalid.includes(key)} aria-describedby={`${id}-${key}-range`} className={input} /><span id={`${id}-${key}-range`} className="block text-xs text-fg-muted">{interpolate(t("oceanReport.range"), { min: n(limit.min * factor, 0), max: n(limit.max * factor, 0) })}</span></label>; })}
      </fieldset>
      <details className="mt-4"><summary className={`cursor-pointer text-sm text-fg-muted ${focus}`}>{t("oceanReport.mysterySpread")}</summary><div className="mt-3 max-w-sm"><label htmlFor={`${id}-mystery`} className="sr-only">{t("oceanReport.mysterySpread")}</label><select id={`${id}-mystery`} className={input} disabled={running} value={draft.mysteryLogVariance} onChange={event => setDraft(previous => ({ ...previous, mysteryLogVariance: event.target.value }))}>{[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select><p className={`${prose} mt-2`}>{t("oceanReport.mysterySpreadNote")}</p></div></details>
      {parsed.invalid.length > 0 && <p role="alert" className="mt-4 text-sm text-danger">{t("oceanReport.invalid")} {t("oceanReport.invalidDetail")}</p>}
      {parsed.invalid.length === 0 && parsed.config.distance * parsed.config.samples > 10_000_000 && <p className="mt-4 text-sm leading-relaxed text-fg-muted">{interpolate(t("oceanReport.largeRun"), { n: n(parsed.config.distance * parsed.config.samples, 0) })}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3"><button type="submit" disabled={running || parsed.invalid.length > 0} className={`rounded-lg bg-accent px-5 py-3 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}>{t("oceanReport.run")}</button>{running && <button type="button" className={`rounded-lg border border-border-strong px-5 py-3 font-medium ${focus}`} onClick={report.cancel}>{t("oceanReport.cancel")}</button>}</div>
      {running && <div className="mt-4 space-y-2" role="status"><p className="text-sm text-fg-muted">{interpolate(t("oceanReport.running"), { done: String(report.completed), total: String(report.total) })}</p><progress max={1} value={report.progress} aria-label={t("oceanReport.running").replace("{done}", String(report.completed)).replace("{total}", String(report.total))} className="h-2 w-full accent-accent" /></div>}
    </form>

    <section id={`${id}-results`} className="min-w-0 scroll-mt-6 space-y-6" aria-label={t("oceanReport.jumpResults")}>
      {snapshot && <p className="text-sm leading-relaxed text-fg-muted">{interpolate(t("oceanReport.snapshot"), { ticket: `$${n(snapshot.ticket, 0)}`, field: n(snapshot.players, 0), roi: pct(snapshot.roi), distance: n(snapshot.distance, 0), samples: n(snapshot.samples, 0), seed: n(snapshot.seed, 0) })}</p>}
      {snapshot && <p className="text-xs text-fg-muted">{interpolate(t("oceanReport.snapshotMystery"), { value: n(snapshot.mysteryLogVariance, 1) })}</p>}
      {stale && <p role="status" className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm leading-relaxed">{t("oceanReport.stale")}</p>}
      {report.status === "error" && <div role="alert" className="rounded-lg border border-danger/40 p-4"><p className="text-sm">{t("oceanReport.error")}</p>{report.error && <details className="mt-2 text-xs text-fg-muted"><summary className={`cursor-pointer ${focus}`}>{t("oceanReport.errorDetails")}</summary><p className="mt-2 break-words">{report.error}</p></details>}</div>}
      {report.status === "idle" && <p className={`${panel} text-sm leading-relaxed text-fg-muted`}>{t("oceanReport.idle")}</p>}
      {report.status === "cancelled" && report.rows.length === 0 && <p role="status" className="text-sm text-fg-muted">{t("oceanReport.cancelledEmpty")}</p>}
      {!complete && !running && report.rows.length > 0 && <p role="status" className="text-sm text-fg-muted">{t("oceanReport.stopped")}</p>}
      {complete && ocean && <section className="rounded-xl border border-accent/40 bg-accent/5 p-5 sm:p-7"><h3 className="display text-2xl">{t("oceanReport.verdict")}</h3><div className="mt-4 max-w-4xl space-y-4 text-base leading-relaxed"><p>{interpolate(t("oceanReport.verdictDepth"), { median: n(ocean.maxDrawdownBI.median), p95: n(ocean.maxDrawdownBI.p95) })}</p><p>{interpolate(t("oceanReport.verdictEV"), { median: n(ocean.maxEvShortfallBI.median), p95: n(ocean.maxEvShortfallBI.p95) })}</p><p className="text-sm text-fg-muted">{interpolate(t("oceanReport.verdictTime"), { peak: n(ocean.longestUnderwater.p95, 0), ev: n(ocean.longestBelowEv.p95, 0) })}</p></div></section>}

      {rows.length > 0 && <>
        <section className="min-w-0 space-y-3"><h3 className="display text-2xl">{t("oceanReport.comparison")}</h3><p className={prose}>{t("oceanReport.comparisonNote")}</p><MetricTable rows={rows} kind="depth" t={t} n={n} /></section>
        <section className="min-w-0 space-y-3"><h3 className="display text-2xl">{t("oceanReport.duration")}</h3><p className={prose}>{t("oceanReport.durationNote")}</p><MetricTable rows={rows} kind="duration" t={t} n={n} /><p className={prose}>{t("oceanReport.censor")}</p></section>
        <section className="min-w-0 space-y-3"><h3 className="display text-2xl">{t("oceanReport.probabilities")}</h3><ScrollTable label={t("oceanReport.probabilities")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th>{["oceanReport.loss", "oceanReport.belowEV", "oceanReport.unrecovered"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{rows.map(row => <tr className={`border-t border-border ${row.format === "ocean-ko" ? "bg-accent/5" : ""}`} key={row.format}><RowName row={row} t={t} />{[row.finalLossProbability, row.finalBelowEvProbability, row.recovery.unrecoveredProbability].map((probability, index) => <td key={index} className={td}><Probability value={probability} format={pct} /></td>)}</tr>)}</tbody></ScrollTable><p className="text-xs text-fg-muted">{t("oceanReport.interval")}</p><p className={prose}>{t("oceanReport.probabilityNote")}</p><p className={prose}>{t("oceanReport.belowEVNote")}</p><p className={prose}>{t("oceanReport.recoveryNote")}</p></section>
        {complete && ocean && <section className={`${panel} space-y-3`}><h3 className="text-xl font-semibold">{t("oceanReport.relative")}</h3><p className={prose}>{t("oceanReport.relativeNote")}</p><ScrollTable label={t("oceanReport.relative")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.ratioDD")}</th><th scope="col" className={th}>{t("oceanReport.ratioEV")}</th></tr></thead><tbody>{rows.filter(row => row.format !== "ocean-ko").map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{row.maxDrawdownBI.p95 > 0 ? `${n(ocean.maxDrawdownBI.p95 / row.maxDrawdownBI.p95, 2)}×` : "—"}</td><td className={td}>{row.maxEvShortfallBI.p95 > 0 ? `${n(ocean.maxEvShortfallBI.p95 / row.maxEvShortfallBI.p95, 2)}×` : "—"}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.ratioExplain")}</p></section>}
        <div className="space-y-3"><p className={prose}>{t("oceanReport.survivalNote")}</p><div className="grid min-w-0 gap-5 xl:grid-cols-2"><SurvivalChart rows={rows} kind="drawdownRisks" t={t} n={n} pct={pct} /><SurvivalChart rows={rows} kind="evShortfallRisks" t={t} n={n} pct={pct} /></div></div>
        <LowerPathChart rows={rows} t={t} n={n} />
        <section className="min-w-0 space-y-3"><h3 className="text-xl font-semibold">{t("oceanReport.recoveryTime")}</h3><p className={prose}>{t("oceanReport.recoveryTimeNote")}</p><ScrollTable label={t("oceanReport.recoveryTime")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.recoveredCount")}</th><th scope="col" className={th}>{t("oceanReport.noDrawdown")}</th><th scope="col" className={th}>{t("oceanReport.median")}</th><th scope="col" className={th}>{t("oceanReport.tail")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.recovery.recoveredSamples, 0)} / {n(row.samples, 0)}</td><td className={td}>{n(row.recovery.noDrawdownSamples, 0)}</td><td className={td}>{row.recovery.recoveredOnly ? n(row.recovery.recoveredOnly.median, 0) : "—"}</td><td className={td}>{row.recovery.recoveredOnly ? n(row.recovery.recoveredOnly.p95, 0) : "—"}</td></tr>)}</tbody></ScrollTable><p className="text-xs text-fg-muted">{t("oceanReport.entry")}</p></section>
        <section className="min-w-0 space-y-3"><ScrollTable label={t("oceanReport.losingEntries")}><thead className="bg-bg"><tr><th scope="col" className={`${th} text-left`}>{t("oceanReport.format")}</th><th scope="col" className={th}>{t("oceanReport.losingEntries")}</th><th scope="col" className={th}>{t("oceanReport.timeBelow")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.longestLosingEntries.p95, 0)}</td><td className={td}>{pct(row.fractionEntriesBelowEv.median)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.timeBelowNote")}</p></section>
      </>}
      {battle && <section className={`${panel} space-y-3`}><h3 className="text-xl font-semibold">{t("oceanReport.battleTitle")}</h3><p className={prose}>{t("oceanReport.battleNote")}</p><p className={prose}>{t("oceanReport.battleFixed")}</p><MetricTable rows={[battle]} kind="depth" t={t} n={n} /><MetricTable rows={[battle]} kind="duration" t={t} n={n} /></section>}
    </section>

    <section className="space-y-3 border-t border-border pt-7"><h3 className="display text-2xl">{t("oceanReport.jackpotTitle")}</h3><p className={prose}>{t("oceanReport.jackpotText")}</p><p className={prose}>{t("oceanReport.jackpotBoundary")}</p>
      <details className={`${panel} mt-4`}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.wheelTitle")}</summary><div className="mt-4 space-y-3"><p className={prose}>{t("oceanReport.wheelIntro")}</p><ScrollTable label={t("oceanReport.wheelTitle")}><thead className="bg-bg"><tr>{["oceanReport.wheelCap", "oceanReport.wheelAbove", "oceanReport.wheelMean", "oceanReport.wheelEV", "oceanReport.wheelVar"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{wheel.map(row => <tr key={row.cap} className="border-t border-border"><th scope="row" className={th}>{row.cap >= 400 ? t("oceanReport.noCap") : `${n(row.cap, 1)}×`}</th><td className={td}>{n(row.probabilityAbove * 100, 4)}%</td><td className={td}>{n(row.meanAfter, 4)}×</td><td className={td}>{pct(row.evRemovedFraction)}</td><td className={td}>{n(row.varianceAfter, 4)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.wheelBoundary")}</p><a href="https://br-1.ggpoker.com/tournaments/ocean-ko/" target="_blank" rel="noreferrer" className={`inline-block text-sm text-accent underline underline-offset-4 ${focus}`}>{t("oceanReport.rules")}</a></div></details>
    </section>

    <section id={`${id}-evidence`} className="scroll-mt-6 space-y-3 border-t border-border pt-7"><h3 className="display text-2xl">{t("oceanReport.evidenceTitle")}</h3><p className={prose}>{interpolate(t("oceanReport.evidenceIntro"), { entries: n(profile.trainingEntries, 0), events: n(profile.trainingEvents, 0) })}</p><p className={prose}>{t("oceanReport.evidenceBoundary")}</p><p className={prose}>{t("oceanReport.evidenceCaps")}</p><details className={panel}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.evidenceOpen")}</summary><div className="mt-6"><EmpiricalOceanExplorer profile={profile} bridge={bridge} locale={locale} /></div></details></section>

    <section id={`${id}-method`} className="scroll-mt-6 space-y-4 border-t border-border pt-7"><h3 className="display text-2xl">{t("oceanReport.method")}</h3><div className="max-w-3xl space-y-3">{["oceanReport.methodEngine", "oceanReport.methodParameters", "oceanReport.methodEV", "oceanReport.methodROI", "oceanReport.methodSeed", "oceanReport.methodLimit", "oceanReport.methodTail"].map(key => <p key={key} className={prose}>{t(key as DictKey)}</p>)}</div>
      <h4 className="pt-3 text-xl font-semibold">{t("oceanReport.mechanics")}</h4><dl className="max-w-4xl divide-y divide-border">{mechanics.map(item => <div key={item.format} className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="font-semibold">{t(formatNames[item.format])}</dt><dd className={prose}>{t(item.key)}</dd></div>)}</dl>
    </section>

    {report.rows.length > 0 && <section className="min-w-0 space-y-3"><h3 className="display text-2xl">{t("oceanReport.rowParameters")}</h3><p className={prose}>{t("oceanReport.rowParametersNote")}</p><ScrollTable label={t("oceanReport.rowParameters")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.ticket", "oceanReport.field", "oceanReport.payout", "oceanReport.rake", "oceanReport.cashPool", "oceanReport.bountyShare"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>${n(row.ticket, 0)}</td><td className={td}>{n(row.players, 0)}</td><td className={`${td} text-xs`}>{t(payoutNames[row.moments.payoutStructure] ?? "oceanReport.noEstimate")}</td><td className={td}>{pct(row.moments.feeFractionOfTicket)}</td><td className={td}>{pct(row.moments.cashPoolFractionOfTicket)}</td><td className={td}>{pct(row.moments.bountyPoolFractionOfTicket)}</td></tr>)}</tbody></ScrollTable>
      <ScrollTable label={t("oceanReport.sigma")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.compiledROI", "oceanReport.sampleROI", "oceanReport.itm", "oceanReport.sigma", "oceanReport.expected"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{pct(row.moments.roi)}</td><td className={td}>{pct(row.realisedMeanRoi)}</td><td className={td}>{pct(row.moments.itm)}</td><td className={td}>{bounds(row.moments.sigmaBI)}</td><td className={td}>{n(row.expectedProfitBI, 1)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.sigmaBound")}</p>
      <details className={panel}><summary className={`cursor-pointer font-semibold text-accent ${focus}`}>{t("oceanReport.diagnosticOpen")}</summary><div className="mt-4 space-y-3"><ScrollTable label={t("oceanReport.diagnosticOpen")}><thead className="bg-bg"><tr>{["oceanReport.format", "oceanReport.cashMean", "oceanReport.bountyMean", "oceanReport.varianceCash", "oceanReport.varianceBounty", "oceanReport.covariance"].map(key => <th key={key} scope="col" className={th}>{t(key as DictKey)}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.format} className="border-t border-border"><RowName row={row} t={t} /><td className={td}>{n(row.moments.cashMeanBI, 3)}</td><td className={td}>{n(row.moments.bountyMeanBI, 3)}</td><td className={td}>{n(row.moments.cashVarianceBI2, 2)}</td><td className={td}>{bounds(row.moments.bountyVarianceBI2)}</td><td className={td}>{n(row.moments.twiceCashBountyCovarianceBI2, 2)}</td></tr>)}</tbody></ScrollTable><p className={prose}>{t("oceanReport.varianceNote")}</p></div></details>
    </section>}

    <section className="space-y-4 border-t border-border pt-7"><h3 className="display text-2xl">{t("oceanReport.glossary")}</h3>{[
      ["oceanReport.faqDD", "oceanReport.faqDDAnswer"], ["oceanReport.faq95", "oceanReport.faq95Answer"],
      ["oceanReport.faqLoss", "oceanReport.faqLossAnswer"], ["oceanReport.faqSpace", "oceanReport.faqSpaceAnswer"],
      ["oceanReport.faqScale", "oceanReport.faqScaleAnswer"],
    ].map(([question, answer]) => <details key={question} className="border-b border-border pb-4"><summary className={`cursor-pointer font-medium ${focus}`}>{t(question as DictKey)}</summary><p className={`${prose} mt-3`}>{t(answer as DictKey)}</p></details>)}<p className={`${prose} pt-2`}>{t("oceanReport.methodologyFoot")}</p></section>
  </article>;
}
