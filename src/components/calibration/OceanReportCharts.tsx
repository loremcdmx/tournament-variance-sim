"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  commonRiskCurves,
  type ComparisonFormat, type FormatComparisonSummary, type ProbabilityEstimate, type RiskMetric,
} from "@/lib/calibration/formatComparison";
import type { DictKey } from "@/lib/i18n/dict";
import { riskChartMaximum } from "./riskChartDomain";
import styles from "./OceanReportCharts.module.css";

type Translate = (key: DictKey) => string;
type NumberFormat = (value: number, digits?: number) => string;

const names: Record<ComparisonFormat, DictKey> = {
  freezeout: "oceanReport.freezeout", pko: "oceanReport.pko", mystery: "oceanReport.mystery",
  "ocean-ko": "oceanReport.ocean",
};
const colors: Record<ComparisonFormat, string> = {
  freezeout: "var(--c-spade)", pko: "var(--c-club)", mystery: "var(--c-rival)",
  "ocean-ko": "var(--c-accent)",
};
const dashes: Record<ComparisonFormat, string | undefined> = {
  freezeout: "2 5", pko: "9 4", mystery: "3 3 10 3", "ocean-ko": undefined,
};

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** About five evenly spaced labelled ticks at 1 / 2 / 2.5 / 5 times a power of ten. */
function axisTicks(maximum: number): { ticks: number[]; digits: number } {
  if (!(maximum > 0)) return { ticks: [0], digits: 0 };
  const raw = maximum / 6;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(mantissa => mantissa * base).find(candidate => candidate >= raw) ?? 10 * base;
  const ticks: number[] = [];
  for (let index = 0; index * step <= maximum * (1 + 1e-9); index++) ticks.push(Number((index * step).toPrecision(12)));
  return { ticks, digits: Number.isInteger(step) ? 0 : step >= 1 ? 1 : 2 };
}

function Swatch({ format, solid = false }: { format: ComparisonFormat; solid?: boolean }) {
  return <svg width="26" height="10" aria-hidden="true" className={styles.swatch}>
    <line x1="0" y1="5" x2="26" y2="5" stroke={colors[format]} strokeWidth={format === "ocean-ko" ? 3 : 2} strokeDasharray={solid ? undefined : dashes[format]} />
  </svg>;
}

function Legend({ rows, t }: { rows: FormatComparisonSummary[]; t: Translate }) {
  return <ul className={styles.legend}>{rows.map(row => <li key={row.format}>
    <Swatch format={row.format} />{t(names[row.format])}
  </li>)}</ul>;
}

function DataTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={label}>
    <table className={styles.table}>{children}</table>
  </div>;
}

function Probability({ probability, pct, interval = false }: { probability: ProbabilityEstimate; pct: (value: number) => string; interval?: boolean }) {
  return <span className={styles.probability}>
    <span>{pct(probability.value)}</span>
    {interval && <small>{pct(probability.wilson95.lower)}–{pct(probability.wilson95.upper)}</small>}
  </span>;
}

export function SurvivalChart({ rows, metric, t, n, pct }: {
  rows: FormatComparisonSummary[]; metric: RiskMetric; t: Translate; n: NumberFormat; pct: (value: number) => string;
}) {
  const id = useId();
  const [threshold, setThreshold] = useState<number | null>(null);
  const [fullTail, setFullTail] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const common = useMemo(() => commonRiskCurves(rows, metric), [rows, metric]);
  const grid = common.thresholds;
  const gridMaximum = grid.at(-1) ?? 0;
  const curves = rows.map(row => common.curves[row.format] ?? []);
  const maximum = riskChartMaximum(curves, fullTail);
  const autoClipped = !fullTail && maximum < gridMaximum;
  const shown = grid.filter(value => value <= maximum);
  const wanted = threshold ?? maximum * 0.35;
  const selectedIndex = shown.reduce((best, value, index) => Math.abs(value - wanted) < Math.abs(shown[best] - wanted) ? index : best, 0);
  const selected = shown[selectedIndex] ?? 0;
  const x = (value: number) => 70 + value / maximum * 395;
  const y = (value: number) => 220 - value * 185;
  const title = t(metric === "drawdown" ? "oceanReport.survivalDD" : "oceanReport.survivalEV");
  const axis = axisTicks(maximum);
  const selectAtPointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotX = (event.clientX - bounds.left) / bounds.width * 500;
    setThreshold(Math.max(0, Math.min(maximum, (plotX - 70) / 395 * maximum)));
  };
  const gridDescription = interpolate(t("oceanReport.chartGrid"), {
    points: n(shown.length, 0), step: n((grid[1] ?? 0) - (grid[0] ?? 0), 2),
  });
  return <section className={styles.panel}>
    <header className={styles.header}>
      <h3>{title}</h3><p>{t("oceanReport.riskBrief")}</p>
    </header>
    <svg viewBox="0 0 500 270" className={styles.riskChart} role="img" aria-labelledby={`${id}-title ${id}-desc`}
      onPointerDown={selectAtPointer} onPointerMove={event => { if (event.pointerType === "mouse") selectAtPointer(event); }}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{t("oceanReport.survivalNote")}</desc>
      {[0, 0.25, 0.5, 0.75, 1].map(value => <g key={value}>
        <line x1="70" x2="465" y1={y(value)} y2={y(value)} stroke="var(--c-border)" />
        <text x="59" y={y(value) + 5} fill="var(--c-fg-muted)" textAnchor="end">{n(value * 100, 0)}%</text>
      </g>)}
      {axis.ticks.map(value => <text key={value} x={x(value)} y="250"
        textAnchor={value === 0 ? "start" : value >= maximum ? "end" : "middle"} fill="var(--c-fg-muted)">{n(value, axis.digits)}</text>)}
      <line x1={x(selected)} x2={x(selected)} y1="35" y2="220" stroke="var(--c-fg-dim)" strokeDasharray="3 4" />
      {rows.map((row, rowIndex) => <g key={row.format}>
        <polyline fill="none" stroke={colors[row.format]} strokeWidth={row.format === "ocean-ko" ? 3 : 2}
          strokeDasharray={dashes[row.format]} strokeLinejoin="round"
          points={curves[rowIndex].filter(point => point.thresholdBI <= maximum).map(point => `${x(point.thresholdBI)},${y(point.probability.value)}`).join(" ")} />
        {curves[rowIndex].filter(point => point.thresholdBI === selected).map(point => <circle key={point.thresholdBI}
          cx={x(point.thresholdBI)} cy={y(point.probability.value)} r={row.format === "ocean-ko" ? 4 : 3}
          stroke="var(--c-bg-elev)" strokeWidth="1.5" fill={colors[row.format]} />)}
      </g>)}
    </svg>
    <label className={styles.showBest}><input type="checkbox" checked={fullTail} onChange={event => setFullTail(event.target.checked)} />{interpolate(t("oceanReport.fullRiskTail"), { max: n(gridMaximum, 2) })}</label>
    <div className={`${styles.threshold} ${styles.riskThreshold}`}>
      <label htmlFor={`${id}-threshold`}>{t("oceanReport.threshold")}</label>
      <output htmlFor={`${id}-threshold`}>{n(selected, 2)} <span>BI</span></output>
    </div>
    <input id={`${id}-threshold`} className={styles.slider} type="range" min="0" max={Math.max(0, shown.length - 1)} step="1"
      value={selectedIndex} onChange={event => setThreshold(shown[Number(event.target.value)] ?? 0)}
      aria-valuetext={`${n(selected, 2)} BI`} aria-describedby={`${id}-help`} disabled={shown.length === 0}
      style={{ "--range-progress": `${selectedIndex / Math.max(1, shown.length - 1) * 100}%` } as CSSProperties} />
    <p id={`${id}-help`} className="sr-only">{t("oceanReport.chartInteract")}</p>
    <ul className={styles.readouts}>
      {rows.map((row, rowIndex) => {
        const point = curves[rowIndex][selectedIndex];
        return <li key={row.format} className={row.format === "ocean-ko" ? styles.oceanReadout : undefined}>
          <span className={styles.readoutName}><Swatch format={row.format} />{t(names[row.format])}</span>
          {point && <Probability probability={point.probability} pct={pct} />}
        </li>;
      })}
    </ul>
    <details className={styles.details} onToggle={event => setDataOpen(event.currentTarget.open)}>
      <summary>{t("oceanReport.chartData")}</summary>
      <p className={styles.detailNote}>{gridDescription}</p>
      <p className={styles.detailNote}>{interpolate(t("oceanReport.chartSharedGrid"), { max: n(gridMaximum, 2) })}</p>
      {autoClipped && <p className={styles.detailNote}>{interpolate(t("oceanReport.riskAutoRange"), { max: n(gridMaximum, 2) })}</p>}
      <p className={styles.detailNote}>{t("oceanReport.chartDenseNote")}</p>
      {dataOpen && <DataTable label={title}>
        <thead><tr><th scope="col">{t("oceanReport.threshold")}</th>{rows.map(row => <th scope="col" key={row.format}>{t(names[row.format])}</th>)}</tr></thead>
        <tbody>{grid.map((thresholdBI, index) => <tr key={thresholdBI}>
          <th scope="row">{n(thresholdBI, 2)}</th>{rows.map((row, rowIndex) => {
            const point = curves[rowIndex][index];
            return <td key={row.format}>{point ? <>
              <Probability probability={point.probability} pct={pct} interval />
              <small className={styles.count}>{interpolate(t("oceanReport.chartCount"), { count: n(point.probability.count, 0), samples: n(point.probability.samples, 0) })}</small>
            </> : "—"}</td>;
          })}
        </tr>)}</tbody>
      </DataTable>}<p className={styles.detailNote}>{t("oceanReport.interval")}</p>
    </details>
  </section>;
}

export function LowerPathChart({ rows, t, n }: { rows: FormatComparisonSummary[]; t: Translate; n: NumberFormat }) {
  const id = useId();
  const maximumX = Math.max(1, ...rows.map(row => row.distance));
  const gaps = rows.flatMap(row => row.downsideCurve.map(point => point.p05BI - point.evBI));
  const minimumY = Math.min(-1, ...gaps) * 1.06;
  const maximumY = Math.max(0, ...gaps);
  const x = (value: number) => 120 + value / maximumX * 605;
  const y = (value: number) => 265 - (value - minimumY) / (maximumY - minimumY) * 220;
  const title = t("oceanReport.trajectory");
  return <section className={styles.panel}>
    <header className={styles.header}><h3>{title}</h3></header>
    <p className={styles.description}>{t("oceanReport.trajectoryNote")}</p>
    <svg viewBox="0 0 760 345" role="img" aria-labelledby={`${id}-title ${id}-desc`} className={styles.pathChart}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{t("oceanReport.trajectoryNote")}</desc>
      {[0, 0.25, 0.5, 0.75, 1].map(value => { const tick = minimumY + value * (maximumY - minimumY); return <g key={value}>
        <line x1="120" x2="725" y1={y(tick)} y2={y(tick)} stroke="var(--c-border)" />
        <text x="109" y={y(tick) + 6} textAnchor="end" fill="var(--c-fg-muted)">{n(tick, 0)}</text>
      </g>; })}
      {[0, 0.25, 0.5, 0.75, 1].map(value => <text key={value} x={x(value * maximumX)} y="300"
        textAnchor={value === 0 ? "start" : value === 1 ? "end" : "middle"} fill="var(--c-fg-muted)">{n(value * maximumX, 0)}</text>)}
      <text x="120" y="29" fill="var(--c-fg-muted)">{t("oceanReport.evGap")}</text>
      <text x="422" y="337" textAnchor="middle" fill="var(--c-fg-muted)">{t("oceanReport.entry")}</text>
      {rows.map(row => <polyline key={row.format} fill="none" stroke={colors[row.format]} strokeWidth={row.format === "ocean-ko" ? 3 : 2}
        strokeDasharray={dashes[row.format]} points={row.downsideCurve.map(point => `${x(point.entries)},${y(point.p05BI - point.evBI)}`).join(" ")} />)}
    </svg><Legend rows={rows} t={t} />
    <details className={styles.details}><summary>{t("oceanReport.chartData")}</summary>
      <p className={styles.detailNote}>{t("oceanReport.selectedCheckpoints")}</p>
      <DataTable label={t("oceanReport.selectedCheckpoints")}>
        <thead><tr><th scope="col">{t("oceanReport.entry")}</th>{rows.map(row => <th key={row.format} scope="col">{t(names[row.format])}</th>)}</tr></thead>
        <tbody>{rows.length > 0 && [0, 0.25, 0.5, 0.75, 1].map(fraction => {
          const target = maximumX * fraction;
          const nearest = (row: FormatComparisonSummary) => row.downsideCurve.reduce((best, point) => Math.abs(point.entries - target) < Math.abs(best.entries - target) ? point : best);
          return <tr key={fraction}><th scope="row">{n(nearest(rows[0]).entries, 0)}</th>{rows.map(row => {
            const point = nearest(row); return <td key={row.format}>{n(point.p05BI - point.evBI, 1)}</td>;
          })}</tr>;
        })}</tbody>
      </DataTable>
    </details>
  </section>;
}

type CurvePoint = FormatComparisonSummary["downsideCurve"][number];
type AggregateMeasure = "profit" | "ev";
type AggregateSide = "worst" | "best";

function aggregateValue(point: CurvePoint, side: AggregateSide, measure: AggregateMeasure): number {
  return (side === "worst" ? point.minBI : point.maxBI) - (measure === "ev" ? point.evBI : 0);
}

function nearestPoint(points: CurvePoint[], target: number): CurvePoint | undefined {
  return points.reduce<CurvePoint | undefined>((best, point) => !best || Math.abs(point.entries - target) < Math.abs(best.entries - target) ? point : best, undefined);
}

function AggregatePlot({ rows, sides, showEV, expectedRoi, measure, selectedEntry, onSelect, t, n }: {
  rows: FormatComparisonSummary[]; sides: AggregateSide[]; showEV: boolean; expectedRoi: number;
  measure: AggregateMeasure; selectedEntry: number;
  onSelect: (entry: number) => void; t: Translate; n: NumberFormat;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth && nextWidth > 0) setWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = width < 600 ? 320 : 400;
  const left = 67, right = Math.max(left + 1, width - 16), top = 18, bottom = height - 48;
  const maximumX = Math.max(1, ...rows.map(row => row.distance));
  const evAt = (entry: number) => measure === "ev" ? 0 : expectedRoi * entry;
  const values = rows.flatMap(row => sides.flatMap(side => row.downsideCurve.map(point => aggregateValue(point, side, measure))));
  if (showEV) values.push(0, evAt(maximumX));
  const floor = Math.min(0, ...values), ceiling = Math.max(1 + floor, 0, ...values);
  const span = ceiling - floor;
  const minimumY = floor - span * 0.04, maximumY = ceiling + span * 0.04;
  const x = (entry: number) => left + entry / maximumX * (right - left);
  const y = (value: number) => bottom - (value - minimumY) / (maximumY - minimumY) * (bottom - top);
  const axisNumber = (value: number) => Math.abs(value) >= 1e6 ? `${n(value / 1e6, 1)}M`
    : Math.abs(value) >= 1000 ? `${n(value / 1000, 1)}k` : n(value, 0);
  const title = t("oceanReport.aggregateTitle");
  const selectAtPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * width;
    onSelect(Math.max(0, Math.min(maximumX, (position - left) / (right - left) * maximumX)));
  };
  return <div ref={container} className={styles.aggregatePane}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ height }} className={styles.aggregateChart} role="img"
      aria-labelledby={`${id}-title ${id}-description`} onPointerDown={selectAtPointer}
      onPointerMove={event => { if (event.pointerType === "mouse") selectAtPointer(event); }}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-description`}>{t(measure === "ev" ? "oceanReport.aggregateEv" : "oceanReport.aggregateProfit")}. {t("oceanReport.aggregateScale")}</desc>
      {[0, .25, .5, .75, 1].map(fraction => {
        const tick = floor + fraction * span;
        return <g key={fraction}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--c-border)" />
          <text x={left - 9} y={y(tick) + 4} textAnchor="end" fill="var(--c-fg-muted)">{axisNumber(tick)}</text>
        </g>;
      })}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--c-fg-dim)" />
      {[0, .25, .5, .75, 1].map(fraction => <text key={fraction} x={x(fraction * maximumX)} y={height - 24}
        textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"} fill="var(--c-fg-muted)">{axisNumber(fraction * maximumX)}</text>)}
      <line x1={x(selectedEntry)} x2={x(selectedEntry)} y1={top} y2={bottom} stroke="var(--c-fg-dim)" strokeDasharray="3 4" />
      {rows.flatMap(row => sides.map(side => {
        const selected = nearestPoint(row.downsideCurve, selectedEntry);
        return <g key={`${row.format}-${side}`} data-format={row.format} data-side={side}>
          <title>{t(names[row.format])}: {t(side === "worst" ? "oceanReport.aggregateWorst" : "oceanReport.aggregateBest")}</title>
          <polyline fill="none" stroke={colors[row.format]} strokeWidth={side === "worst" ? 2.5 : 1.8}
            strokeDasharray={side === "best" ? "7 4" : undefined} strokeLinejoin="round"
            points={row.downsideCurve.map(point => `${x(point.entries)},${y(aggregateValue(point, side, measure))}`).join(" ")} />
          {selected && <circle cx={x(selected.entries)} cy={y(aggregateValue(selected, side, measure))} r={row.format === "ocean-ko" ? 4 : 3}
            fill={colors[row.format]} stroke="var(--c-bg-elev)" strokeWidth="1.5" />}
        </g>;
      }))}
      {showEV && <g data-reference="ev">
        <title>{t("oceanReport.aggregateShowEV")}</title>
        <line x1={left} x2={right} y1={y(0)} y2={y(evAt(maximumX))} stroke="var(--c-fg)" strokeWidth="1.5" strokeDasharray="2 5" />
        <text x={right - 4} y={y(evAt(maximumX)) - 8} textAnchor="end" fill="var(--c-fg)">EV</text>
      </g>}
    </svg>
  </div>;
}

export function AggregateRunsChart({ rows, expectedRoi, t, n }: { rows: FormatComparisonSummary[]; expectedRoi: number; t: Translate; n: NumberFormat }) {
  const id = useId();
  const [measure, setMeasure] = useState<AggregateMeasure>("profit");
  const [showWorst, setShowWorst] = useState(true);
  const [showBest, setShowBest] = useState(true);
  const [showEV, setShowEV] = useState(true);
  const [hidden, setHidden] = useState<ComparisonFormat[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<number | null>(null);
  const visibleRows = rows.filter(row => !hidden.includes(row.format));
  const points = rows[0]?.downsideCurve ?? [];
  const selected = selectedEntry === null ? points.at(-1) : nearestPoint(points, selectedEntry);
  const selectedIndex = selected ? points.indexOf(selected) : 0;
  const entry = selected?.entries ?? 0;
  const sides: AggregateSide[] = [...(showBest ? ["best" as const] : []), ...(showWorst ? ["worst" as const] : [])];
  const shownKinds = Number(showWorst) + Number(showBest) + Number(showEV);
  const toggleFormat = (format: ComparisonFormat) => setHidden(current => current.includes(format)
    ? current.filter(item => item !== format) : [...current, format]);
  return <section className={styles.panel}>
    <header className={styles.header}><h3>{t("oceanReport.aggregateTitle")}</h3></header>
    <p className={styles.description}>{interpolate(t("oceanReport.aggregateNote"), { samples: n(rows[0]?.samples ?? 0, 0) })}</p>
    <div className={styles.aggregateToolbar}>
      <div className={styles.measureToggle} role="group" aria-label={t("oceanReport.aggregateView")}>
        {(["profit", "ev"] as const).map(value => <button key={value} type="button" aria-pressed={measure === value}
          onClick={() => setMeasure(value)}>{t(value === "profit" ? "oceanReport.aggregateProfit" : "oceanReport.aggregateEv")}</button>)}
      </div>
      <div className={styles.runToggles}>
        {([
          { key: "worst", label: "oceanReport.aggregateShowWorst", checked: showWorst, set: setShowWorst, dash: undefined },
          { key: "best", label: "oceanReport.aggregateShowBest", checked: showBest, set: setShowBest, dash: "7 4" },
          { key: "ev", label: "oceanReport.aggregateShowEV", checked: showEV, set: setShowEV, dash: "2 5" },
        ] as const).map(control => <label key={control.key} className={styles.showBest}>
          <input type="checkbox" checked={control.checked} disabled={control.checked && shownKinds === 1} onChange={event => control.set(event.target.checked)} />
          <svg width="26" height="10" aria-hidden="true" className={styles.swatch}><line x1="0" x2="26" y1="5" y2="5" stroke="currentColor" strokeWidth={control.key === "worst" ? 2.5 : 1.8} strokeDasharray={control.dash} /></svg>
          {t(control.label)}
        </label>)}
      </div>
    </div>
    <div className={styles.formatToggles} role="group" aria-label={t("oceanReport.format")}>
      {rows.map(row => <button type="button" key={row.format} aria-pressed={!hidden.includes(row.format)}
        disabled={visibleRows.length === 1 && visibleRows[0].format === row.format} onClick={() => toggleFormat(row.format)}>
        <Swatch format={row.format} solid />{t(names[row.format])}
      </button>)}
    </div>
    <AggregatePlot rows={visibleRows} sides={sides} showEV={showEV} expectedRoi={expectedRoi} measure={measure} selectedEntry={entry} onSelect={setSelectedEntry} t={t} n={n} />
    <div className={styles.threshold}><label htmlFor={`${id}-checkpoint`}>{t("oceanReport.entry")}</label><output htmlFor={`${id}-checkpoint`}>{n(entry, 0)}</output></div>
    <input id={`${id}-checkpoint`} className={styles.slider} type="range" min="0" max={Math.max(0, points.length - 1)} step="1" value={selectedIndex}
      disabled={points.length === 0} onChange={event => setSelectedEntry(points[Number(event.target.value)]?.entries ?? 0)}
      aria-valuetext={`${t("oceanReport.entry")}: ${n(entry, 0)}`} aria-describedby={`${id}-help`}
      style={{ "--range-progress": `${selectedIndex / Math.max(1, points.length - 1) * 100}%` } as CSSProperties} />
    <p id={`${id}-help`} className="sr-only">{t("oceanReport.aggregateSelect")}</p>
    {sides.length > 0 && <div className={styles.aggregateReadouts}>
      {visibleRows.map(row => {
        const point = nearestPoint(row.downsideCurve, entry);
        return <div key={row.format} className={row.format === "ocean-ko" ? styles.oceanReadout : undefined}>
          <span className={styles.readoutName}><Swatch format={row.format} solid />{t(names[row.format])}</span>
          {point && <dl>
            {showWorst && <div><dt>{t("oceanReport.aggregateWorstValue")}</dt><dd>{n(aggregateValue(point, "worst", measure), 1)} <small>BI</small></dd></div>}
            {showBest && <div><dt>{t("oceanReport.aggregateBestValue")}</dt><dd>{n(aggregateValue(point, "best", measure), 1)} <small>BI</small></dd></div>}
          </dl>}
        </div>;
      })}
    </div>}
    <details className={styles.details}><summary>{t("oceanReport.chartHelp")}</summary><p className={styles.detailNote}>{t("oceanReport.aggregateScale")}</p><p className={styles.detailNote}>{t("oceanReport.aggregateSampleNote")}</p></details>
  </section>;
}
