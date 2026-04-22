import { useMemo } from "react";
import { UplotChart } from "@/components/charts/UplotChart";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CashResult } from "@/lib/sim/cashTypes";
import {
  type CashMoneyUnit,
  type SuitAccent,
  CASH_ACCENT_META,
  CashChartFrame,
  ChartTitle,
  MiniChartTitle,
  UnitToggle,
  convertCashMoney,
  formatRiskThreshold,
} from "./CashResultsShared";

function cashAxes(
  xLabel: string,
  yLabel: string,
  ySize: number = 55,
): NonNullable<Parameters<typeof UplotChart>[0]["options"]>["axes"] {
  return [
    {
      label: xLabel,
      stroke: "#a4afc2",
      grid: { stroke: "rgba(148,163,184,0.1)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.22)" },
    },
    {
      label: yLabel,
      size: ySize,
      stroke: "#aeb8cb",
      grid: { stroke: "rgba(148,163,184,0.14)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.26)" },
    },
  ];
}

function cashPctAxes(
  xLabel: string,
  yLabel: string,
): NonNullable<Parameters<typeof UplotChart>[0]["options"]>["axes"] {
  return [
    {
      label: xLabel,
      stroke: "#a4afc2",
      grid: { stroke: "rgba(148,163,184,0.1)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.22)" },
    },
    {
      label: yLabel,
      size: 64,
      stroke: "#aeb8cb",
      grid: { stroke: "rgba(148,163,184,0.14)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.26)" },
      values: (_u, splits) => splits.map((value) => `${Math.round(value * 100)}%`),
    },
  ];
}

export function TrajectoryToolbar({
  visibleRuns,
  maxVisibleRuns,
  onVisibleRunsChange,
  moneyUnit,
  onMoneyUnitChange,
  riskThresholdBb,
  bbSize,
}: {
  visibleRuns: number;
  maxVisibleRuns: number;
  onVisibleRunsChange: (next: number) => void;
  moneyUnit: CashMoneyUnit;
  onMoneyUnitChange: (next: CashMoneyUnit) => void;
  riskThresholdBb: number;
  bbSize: number;
}) {
  const t = useT();
  return (
    <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 px-3 py-2">
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {t("cash.toolbar.runs")}
        </span>
        <input
          type="range"
          min={0}
          max={maxVisibleRuns}
          step={1}
          value={visibleRuns}
          onChange={(e) => onVisibleRunsChange(Number(e.target.value))}
          className="h-1.5 w-32 cursor-pointer accent-[color:var(--color-accent)]"
          aria-label={t("cash.toolbar.runs")}
        />
        <span className="min-w-[4.5rem] rounded-sm border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-2 py-1 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
          {visibleRuns}/{maxVisibleRuns}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 px-3 py-2">
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {t("cash.toolbar.units")}
        </span>
        <UnitToggle
          value={moneyUnit}
          onChange={onMoneyUnitChange}
          options={[
            { value: "bb", label: t("cash.unit.bb") },
            { value: "usd", label: t("cash.unit.usd") },
          ]}
        />
        <span className="rounded-sm border border-[color:var(--color-heart)]/35 bg-[color:var(--color-heart)]/10 px-2 py-1 font-mono text-[11px] tabular-nums text-[color:var(--color-heart)]">
          {formatRiskThreshold(riskThresholdBb, moneyUnit, bbSize)}
        </span>
      </div>
    </div>
  );
}

export function TrajectoryChart({
  result,
  bbSize,
  visibleRuns,
  moneyUnit,
  riskThresholdBb,
}: {
  result: CashResult;
  bbSize: number;
  visibleRuns: number;
  moneyUnit: CashMoneyUnit;
  riskThresholdBb: number;
}) {
  const t = useT();

  const data = useMemo(() => {
    const env = result.envelopes;
    const x = Array.from(env.x, (h) => h);
    const convert = (v: number) => convertCashMoney(v, moneyUnit, bbSize);
    const p05 = Array.from(env.p05, convert);
    const p95 = Array.from(env.p95, convert);
    const p15 = Array.from(env.p15, convert);
    const p85 = Array.from(env.p85, convert);
    const mean = Array.from(env.mean, convert);
    const riskLine = new Array<number>(x.length).fill(
      convert(-riskThresholdBb),
    );
    const paths = result.samplePaths.paths.slice(0, visibleRuns);
    const hiX = result.samplePaths.x;
    const aligned: number[][] = paths.map((p) => {
      const out = new Array<number>(x.length);
      let j = 0;
      for (let i = 0; i < x.length; i++) {
        const target = env.x[i];
        while (j + 1 < hiX.length && hiX[j + 1] <= target) j++;
        out[i] = convert(p[j]);
      }
      return out;
    });
    return [x, p05, p15, mean, p85, p95, riskLine, ...aligned] as Array<
      (number | null)[]
    >;
  }, [result, visibleRuns, moneyUnit, bbSize, riskThresholdBb]);

  const series = useMemo(() => {
    const pathCount = Math.min(visibleRuns, result.samplePaths.paths.length);
    const noPoints = { show: false as const };
    const s: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"] =
      [
        {},
        {
          stroke: "#ff7f73",
          width: 1.25,
          label: "p05",
          points: noPoints,
        },
        {
          stroke: "#ffb35d",
          width: 1.25,
          label: "p15",
          points: noPoints,
        },
        {
          stroke: "#f2cf45",
          width: 2.35,
          label: "mean",
          points: noPoints,
        },
        {
          stroke: "#79cf96",
          width: 1.25,
          label: "p85",
          points: noPoints,
        },
        {
          stroke: "#6db7ff",
          width: 1.25,
          label: "p95",
          points: noPoints,
        },
        {
          stroke: "rgba(255,145,118,0.9)",
          width: 1.4,
          dash: [6, 5],
          label: "risk",
          points: noPoints,
        },
      ];
    for (let i = 0; i < pathCount; i++) {
      s.push({
        stroke: "rgba(178,186,202,0.18)",
        width: 0.8,
        label: `r${i}`,
        points: noPoints,
      });
    }
    return s;
  }, [result, visibleRuns]);

  return (
    <CashChartFrame>
      <UplotChart
        data={data as unknown as Parameters<typeof UplotChart>[0]["data"]}
        options={{
          series,
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: { x: { time: false } },
          axes: cashAxes(
            t("cash.axis.hands"),
            moneyUnit === "usd" ? t("cash.axis.usd") : t("cash.axis.bb"),
          ),
        }}
        height={340}
      />
    </CashChartFrame>
  );
}

export function HistogramChart({
  hist,
  xLabel,
  yLabel,
  tone,
}: {
  hist: { binEdges: number[]; counts: number[] };
  xLabel: string;
  yLabel: string;
  tone: SuitAccent;
}) {
  const palette = CASH_ACCENT_META[tone];
  const data = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < hist.counts.length; i++) {
      xs.push((hist.binEdges[i] + hist.binEdges[i + 1]) / 2);
      ys.push(hist.counts[i]);
    }
    return [xs, ys] as Parameters<typeof UplotChart>[0]["data"];
  }, [hist]);

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: palette.chartStroke,
              fill: palette.chartFill,
              width: 2,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: {
            x: { time: false },
            y: { range: (_u, _min, max) => [0, max * 1.05] },
          },
          axes: cashAxes(xLabel, yLabel),
        }}
        height={220}
      />
    </CashChartFrame>
  );
}

export function CashOddsChart({ result }: { result: CashResult }) {
  const t = useT();
  const data = useMemo(
    () =>
      [
        Array.from(result.oddsOverDistance.x),
        Array.from(result.oddsOverDistance.profitShare),
        Array.from(result.oddsOverDistance.belowThresholdNowShare),
      ] as Parameters<typeof UplotChart>[0]["data"],
    [result],
  );

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: CASH_ACCENT_META.club.chartStroke,
              width: 2.35,
              points: { show: false },
            },
            {
              stroke: CASH_ACCENT_META.heart.chartStroke,
              width: 2.35,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: {
            x: { time: false },
            y: { range: () => [0, 1] },
          },
          axes: cashPctAxes(t("cash.axis.hands"), t("cash.axis.share")),
        }}
        height={240}
      />
    </CashChartFrame>
  );
}

export function CashConvergenceChart({ result }: { result: CashResult }) {
  const t = useT();
  const data = useMemo(
    () =>
      [
        Array.from(result.convergence.x),
        Array.from(result.convergence.seLo),
        Array.from(result.convergence.mean),
        Array.from(result.convergence.seHi),
      ] as Parameters<typeof UplotChart>[0]["data"],
    [result],
  );

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: "rgba(118,176,255,0.7)",
              width: 1.25,
              points: { show: false },
            },
            {
              stroke: "#9cc3ff",
              width: 2.35,
              points: { show: false },
            },
            {
              stroke: "rgba(118,176,255,0.7)",
              width: 1.25,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: { x: { time: false } },
          axes: cashAxes(t("cash.axis.samples"), t("cash.axis.winrate")),
        }}
        height={220}
      />
    </CashChartFrame>
  );
}

export function DiagnosticsDisclosure({ result }: { result: CashResult }) {
  const t = useT();
  return (
    <details className="data-surface-card rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg-elev)]/68">
      <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <ChartTitle
            suit="spade"
            title={t("cash.section.diagnostics.title")}
            note={t("cash.section.diagnostics.note")}
          />
          <span className="mt-0.5 text-[11px] text-[color:var(--color-fg-dim)]">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4">
        <MiniChartTitle
          suit="spade"
          title={t("cash.chart.convergence.title")}
          note={t("cash.chart.convergence.note")}
        />
        <div className="mt-3">
          <CashConvergenceChart result={result} />
        </div>
      </div>
    </details>
  );
}
