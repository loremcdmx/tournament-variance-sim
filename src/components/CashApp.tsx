"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import uPlot from "uplot";
import { Section, Card } from "@/components/ui/Section";
import { UplotChart, type CursorInfo } from "@/components/charts/UplotChart";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import {
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  loadLineStylePreset,
  saveLineStylePreset,
  type LineStyle,
} from "@/lib/lineStyles";
import { visualDistanceToSeries } from "@/lib/results/trajectoryHitTest";
import {
  buildCashResult,
  makeCashEnvGrid,
  makeCashHiResGrid,
  type CashShard,
} from "@/lib/sim/cashEngine";
import type {
  CashShardRequest,
  CashShardResultMsg,
  CashShardErrorMsg,
} from "@/lib/sim/cashWorker";
import type {
  CashInput,
  CashResult,
  CashStakeRow,
} from "@/lib/sim/cashTypes";
import { rankedRunIndices, type RunMode } from "@/lib/trajectorySelection";
import type { DictKey } from "@/lib/i18n/dict";

const STORAGE_KEY = "tvs:cash-input";
const CASH_TRAJECTORY_RUN_CAP = 120;
const CASH_PATH_HIT_PX = 20;

const DEFAULT_INPUT: CashInput = {
  type: "cash",
  wrBb100: 5,
  sdBb100: 100,
  hands: 100_000,
  nSimulations: 2000,
  bbSize: 1,
  rake: {
    enabled: false,
    contributedRakeBb100: 8,
    advertisedRbPct: 30,
    pvi: 1,
  },
  hoursBlock: { handsPerHour: 500 },
  baseSeed: 42,
};

function loadInput(): CashInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INPUT;
    const parsed = JSON.parse(raw) as Partial<CashInput>;
    return { ...DEFAULT_INPUT, ...parsed, type: "cash" };
  } catch {
    return DEFAULT_INPUT;
  }
}
function saveInput(next: CashInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / unavailable — silently drop; UI still works.
  }
}

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  return [200, 200, 200];
}

function pathStyleForCount(
  base: LineStyle,
  count: number,
): { stroke: string; width: number } {
  const [r, g, b] = parseRgb(base.stroke);
  const n = Math.max(1, count);
  const alpha = Math.min(0.9, Math.max(0.04, 0.9 / Math.sqrt(n)));
  const width = Math.min(1.6, Math.max(0.55, 1.55 - 0.115 * Math.log2(n)));
  return { stroke: `rgba(${r},${g},${b},${alpha.toFixed(3)})`, width };
}

function buildLinearRef(x: readonly number[], slopePerX: number): number[] {
  return x.map((v) => v * slopePerX);
}

type CashTrajectoryLineKind = "mean" | "band" | "path" | "ref";

interface CashTrajectoryLineMeta {
  label: string;
  color: string;
  seriesIdx: number;
  kind: CashTrajectoryLineKind;
  percentile?: number;
  rank?: number;
}

function alignCashPathToEnvX(
  envX: readonly number[],
  hiX: ArrayLike<number>,
  path: ArrayLike<number>,
): number[] {
  const out = new Array<number>(envX.length);
  let j = 0;
  for (let i = 0; i < envX.length; i++) {
    const target = envX[i];
    while (j + 1 < hiX.length && hiX[j + 1] <= target) j++;
    out[i] = path[j] ?? 0;
  }
  return out;
}

function formatBb(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatUsd(v: number): string {
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export const CashApp = memo(function CashApp() {
  const t = useT();
  const [input, setInput] = useLocalStorageState<CashInput>(
    STORAGE_KEY,
    loadInput,
    saveInput,
    DEFAULT_INPUT,
  );
  const [result, setResult] = useState<CashResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const jobIdRef = useRef(0);
  const poolRef = useRef<Worker[] | null>(null);
  const destroyPool = () => {
    if (!poolRef.current) return;
    for (const w of poolRef.current) {
      w.onmessage = null;
      w.terminate();
    }
    poolRef.current = null;
  };

  useEffect(() => {
    return () => {
      destroyPool();
    };
  }, []);

  const runSim = () => {
    if (running) return;
    const snapshot = input;
    const jobId = ++jobIdRef.current;
    setRunning(true);
    setProgress(0);

    if (!poolRef.current) {
      const hc =
        typeof navigator !== "undefined"
          ? navigator.hardwareConcurrency ?? 4
          : 4;
      // Match MTT convention: ~half of logical threads, capped at 12.
      const W = Math.max(1, Math.min(12, Math.floor(hc / 2)));
      const workers: Worker[] = [];
      for (let i = 0; i < W; i++) {
        workers.push(
          new Worker(new URL("@/lib/sim/cashWorker.ts", import.meta.url), {
            type: "module",
          }),
        );
      }
      poolRef.current = workers;
    }
    const pool = poolRef.current;

    const envGrid = makeCashEnvGrid(snapshot.hands);
    const hiGrid = makeCashHiResGrid(snapshot.hands);

    // Shard layout: first shard owns sStart=0 (hi-res paths live there),
    // remaining work split across workers in ~even chunks so each worker
    // is busy. Workers are stateless so we round-robin by shardId.
    const S = snapshot.nSimulations;
    const W = pool.length;
    // Aim for roughly 2× workers shards so slower ones don't stall the tail.
    const TARGET_SHARDS = Math.min(S, W * 2);
    const shardSize = Math.max(1, Math.ceil(S / TARGET_SHARDS));
    const shardRanges: { sStart: number; sEnd: number }[] = [];
    for (let s = 0; s < S; s += shardSize) {
      shardRanges.push({ sStart: s, sEnd: Math.min(S, s + shardSize) });
    }
    const totalShards = shardRanges.length;
    const shards: CashShard[] = new Array(totalShards);
    let completed = 0;
    let errored = false;

    const cleanup = () => {
      for (const w of pool) w.onmessage = null;
    };

    const onWorkerMessage = (
      e: MessageEvent<CashShardResultMsg | CashShardErrorMsg>,
    ) => {
      const msg = e.data;
      if (msg.jobId !== jobIdRef.current) return;
      if (msg.type === "cash-shard-error") {
        if (errored) return;
        errored = true;
        cleanup();
        destroyPool();
        setRunning(false);
        console.error("[cash] shard error:", msg.message);
        return;
      }
      shards[msg.shardId] = msg.shard;
      completed++;
      setProgress(completed / totalShards);
      if (completed === totalShards && !errored) {
        cleanup();
        try {
          setResult(buildCashResult(snapshot, shards, envGrid));
          setProgress(1);
        } finally {
          setRunning(false);
        }
      }
    };

    for (const w of pool) w.onmessage = onWorkerMessage;

    for (let i = 0; i < totalShards; i++) {
      const worker = pool[i % W];
      const r = shardRanges[i];
      const req: CashShardRequest = {
        type: "cash-shard",
        jobId,
        shardId: i,
        input: snapshot,
        sStart: r.sStart,
        sEnd: r.sEnd,
        envGrid: {
          K: envGrid.K,
          // structuredClone/Transfer: new Int32Array so we don't detach our own.
          checkpointIdx: new Int32Array(envGrid.checkpointIdx),
        },
        hiResGrid: {
          K: hiGrid.K,
          checkpointIdx: new Int32Array(hiGrid.checkpointIdx),
        },
      };
      worker.postMessage(req);
    }
  };

  const cancelSim = () => {
    // Bump the job id so any late worker messages are ignored, then tear down
    // the pool to stop burning CPU on a job the user already canceled.
    jobIdRef.current++;
    destroyPool();
    setRunning(false);
    setProgress(0);
  };

  const patch = (p: Partial<CashInput>) => setInput({ ...input, ...p });
  const patchRake = (p: Partial<CashInput["rake"]>) =>
    setInput({ ...input, rake: { ...input.rake, ...p } });

  const mixEnabled = !!input.stakes && input.stakes.length > 0;
  const stakes = input.stakes ?? [];
  const patchStake = (idx: number, p: Partial<CashStakeRow>) => {
    const next = stakes.map((r, i) => (i === idx ? { ...r, ...p } : r));
    setInput({ ...input, stakes: next });
  };
  const patchStakeRake = (
    idx: number,
    p: Partial<CashStakeRow["rake"]>,
  ) => {
    const next = stakes.map((r, i) =>
      i === idx ? { ...r, rake: { ...r.rake, ...p } } : r,
    );
    setInput({ ...input, stakes: next });
  };
  const addStake = () => {
    const seed: CashStakeRow =
      stakes[stakes.length - 1] ??
      {
        wrBb100: input.wrBb100,
        sdBb100: input.sdBb100,
        bbSize: input.bbSize,
        handShare: 0.5,
        rake: { ...input.rake },
      };
    setInput({ ...input, stakes: [...stakes, { ...seed }] });
  };
  const removeStake = (idx: number) => {
    const next = stakes.filter((_, i) => i !== idx);
    setInput({
      ...input,
      stakes: next.length > 0 ? next : undefined,
    });
  };
  const enableMix = (on: boolean) => {
    if (on && !mixEnabled) {
      // Seed with the current single-stake as row 1 and a sensible second row.
      const row1: CashStakeRow = {
        label: "NL100",
        wrBb100: input.wrBb100,
        sdBb100: input.sdBb100,
        bbSize: input.bbSize,
        handShare: 0.7,
        rake: { ...input.rake },
      };
      const row2: CashStakeRow = {
        label: "NL200",
        wrBb100: input.wrBb100,
        sdBb100: input.sdBb100,
        bbSize: input.bbSize * 2,
        handShare: 0.3,
        rake: { ...input.rake },
      };
      setInput({ ...input, stakes: [row1, row2] });
    } else if (!on && mixEnabled) {
      setInput({ ...input, stakes: undefined });
    }
  };

  return (
    <>
      <Section number="01" suit="spade" title={t("cash.section.inputs.title")}>
        <Card className="flex flex-col gap-6 p-6">
          <InputGroup title={t("cash.group.session")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!mixEnabled && (
                <>
                  <NumField
                    label={t("cash.wrBb100.label")}
                    value={input.wrBb100}
                    step={0.5}
                    onChange={(v) => patch({ wrBb100: v })}
                  />
                  <NumField
                    label={t("cash.sdBb100.label")}
                    value={input.sdBb100}
                    step={5}
                    min={1}
                    onChange={(v) => patch({ sdBb100: v })}
                  />
                </>
              )}
              <NumField
                label={t("cash.hands.label")}
                value={input.hands}
                step={10_000}
                min={1000}
                onChange={(v) => patch({ hands: Math.floor(v) })}
              />
              <NumField
                label={t("cash.nSimulations.label")}
                value={input.nSimulations}
                step={500}
                min={100}
                max={20_000}
                onChange={(v) => patch({ nSimulations: Math.floor(v) })}
              />
              <NumField
                label={t("cash.bbSize.label")}
                value={input.bbSize}
                step={0.25}
                min={0.01}
                hint={mixEnabled ? t("cash.stakes.refBbHint") : undefined}
                onChange={(v) => patch({ bbSize: v })}
              />
              <NumField
                label={t("cash.baseSeed.label")}
                value={input.baseSeed}
                step={1}
                onChange={(v) => patch({ baseSeed: Math.floor(v) })}
              />
            </div>
          </InputGroup>

          <InputGroup
            title={t("cash.group.stakes")}
            toggle={
              <ToggleSwitch checked={mixEnabled} onChange={enableMix} />
            }
          >
            {!mixEnabled && (
              <p className="text-[11px] text-[color:var(--color-fg-dim)]">
                {t("cash.stakes.toggle.hint")}
              </p>
            )}
            {mixEnabled && (
              <div className="flex flex-col gap-3">
                {stakes.map((row, idx) => (
                  <StakeRowEditor
                    key={idx}
                    row={row}
                    canRemove={stakes.length > 1}
                    onPatch={(p) => patchStake(idx, p)}
                    onPatchRake={(p) => patchStakeRake(idx, p)}
                    onRemove={() => removeStake(idx)}
                    t={t}
                  />
                ))}
                <button
                  type="button"
                  onClick={addStake}
                  className="self-start border border-[color:var(--color-border)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                >
                  {t("cash.stakes.add")}
                </button>
              </div>
            )}
          </InputGroup>

          {!mixEnabled && (
            <InputGroup
              title={t("cash.group.rake")}
              toggle={
                <ToggleSwitch
                  checked={input.rake.enabled}
                  onChange={(checked) => patchRake({ enabled: checked })}
                />
              }
            >
              <div
                className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${
                  input.rake.enabled ? "" : "pointer-events-none opacity-40"
                }`}
              >
                <NumField
                  label={t("cash.rake.contrib.label")}
                  value={input.rake.contributedRakeBb100}
                  step={0.5}
                  min={0}
                  disabled={!input.rake.enabled}
                  onChange={(v) => patchRake({ contributedRakeBb100: v })}
                />
                <NumField
                  label={t("cash.rake.rbPct.label")}
                  value={input.rake.advertisedRbPct}
                  step={1}
                  min={0}
                  max={100}
                  disabled={!input.rake.enabled}
                  onChange={(v) => patchRake({ advertisedRbPct: v })}
                />
                <NumField
                  label={t("cash.rake.pvi.label")}
                  value={input.rake.pvi}
                  step={0.05}
                  min={0.05}
                  max={1}
                  disabled={!input.rake.enabled}
                  onChange={(v) => patchRake({ pvi: v })}
                  hint={t("cash.rake.pvi.hint")}
                />
              </div>
            </InputGroup>
          )}

          <InputGroup
            title={t("cash.group.hourly")}
            toggle={
              <ToggleSwitch
                checked={!!input.hoursBlock}
                onChange={(checked) =>
                  setInput({
                    ...input,
                    hoursBlock: checked
                      ? { handsPerHour: input.hoursBlock?.handsPerHour ?? 500 }
                      : undefined,
                  })
                }
              />
            }
          >
            {input.hoursBlock && (
              <div className="max-w-xs">
                <NumField
                  label={t("cash.hours.handsPerHour.label")}
                  value={input.hoursBlock.handsPerHour}
                  step={50}
                  min={50}
                  onChange={(v) =>
                    setInput({
                      ...input,
                      hoursBlock: { handsPerHour: Math.floor(v) },
                    })
                  }
                />
              </div>
            )}
          </InputGroup>

          <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            {running && (
              <div className="flex flex-1 items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-[color:var(--color-bg-elev-2)]">
                  <div
                    className="h-full bg-[color:var(--color-accent)] transition-[width] duration-100"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
                  {Math.round(progress * 100)}%
                </span>
                <button
                  type="button"
                  onClick={cancelSim}
                  className="border border-[color:var(--color-border)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                >
                  ×
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={runSim}
              disabled={running}
              className="border border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 px-5 py-2 text-sm font-bold uppercase tracking-wider text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)]/20 disabled:opacity-50"
            >
              {running ? t("cash.running") : t("cash.run")}
            </button>
          </div>
        </Card>
      </Section>

      <Section
        number="02"
        suit="heart"
        title={t("cash.section.results.title")}
      >
        {!result && (
          <p className="text-sm text-[color:var(--color-fg-muted)]">
            {t("cash.empty")}
          </p>
        )}
        {result && <CashResultsView result={result} />}
      </Section>
    </>
  );
});

function CashResultsView({ result }: { result: CashResult }) {
  const t = useT();
  const s = result.stats;
  const fmtBb = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const fmtUsd = (v: number) =>
    "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtPct = (v: number) => (v * 100).toFixed(1) + "%";
  const bb = result.echoInput.bbSize;

  const expected: StatRow[] = [
    {
      label: t("cash.stats.expectedEvBb"),
      value: `${fmtBb(s.expectedEvBb)} (${fmtUsd(s.expectedEvUsd)})`,
    },
  ];
  if (s.hourlyEvUsd !== undefined) {
    expected.push({
      label: t("cash.stats.hourlyEvUsd"),
      value: fmtUsd(s.hourlyEvUsd) + "/h",
    });
  }
  const realized: StatRow[] = [
    {
      label: t("cash.stats.meanFinalBb"),
      value: `${fmtBb(s.meanFinalBb)} (${fmtUsd(s.meanFinalUsd)})`,
    },
    { label: t("cash.stats.sdFinalBb"), value: fmtBb(s.sdFinalBb) },
  ];
  const risk: StatRow[] = [
    { label: t("cash.stats.probLoss"), value: fmtPct(s.probLoss) },
    { label: t("cash.stats.probSub100Bb"), value: fmtPct(s.probSub100Bb) },
    {
      label: t("cash.stats.recoveryUnrecoveredShare"),
      value: fmtPct(s.recoveryUnrecoveredShare),
    },
  ];
  const economics: StatRow[] = [
    { label: t("cash.stats.meanRakePaidBb"), value: fmtBb(s.meanRakePaidBb) },
    { label: t("cash.stats.meanRbEarnedBb"), value: fmtBb(s.meanRbEarnedBb) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatGroup title={t("cash.group.stats.expected")} rows={expected} accent="heart" />
          <StatGroup title={t("cash.group.stats.realized")} rows={realized} accent="spade" />
          <StatGroup title={t("cash.group.stats.risk")} rows={risk} accent="club" />
          <StatGroup title={t("cash.group.stats.economics")} rows={economics} accent="diamond" />
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
          <span className="mr-2 text-[color:var(--color-heart)]">♥</span>
          {t("cash.chart.trajectory.title")}
        </h3>
        <TrajectoryChart result={result} bbSize={bb} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
            <span className="mr-2 text-[color:var(--color-diamond)]">♦</span>
            {t("cash.chart.final.title")}
          </h3>
          <HistogramChart hist={result.histogram} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
            <span className="mr-2 text-[color:var(--color-club)]">♣</span>
            {t("cash.chart.drawdown.title")}
          </h3>
          <HistogramChart hist={result.drawdownHistogram} />
        </Card>
      </div>
    </div>
  );
}

function TrajectoryChart({
  result,
  bbSize,
}: {
  result: CashResult;
  bbSize: number;
}) {
  const t = useT();
  const [linePresetId] = useLocalStorageState(
    "tvs.lineStylePreset.v1",
    loadLineStylePreset,
    saveLineStylePreset,
    DEFAULT_LINE_STYLE_PRESET,
  );
  const linePreset = LINE_STYLE_PRESETS[linePresetId];
  const maxRuns = Math.min(CASH_TRAJECTORY_RUN_CAP, result.samplePaths.paths.length);
  const [desiredVisibleRuns, setDesiredVisibleRuns] = useState(80);
  const [runMode, setRunMode] = useState<RunMode>("random");
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const hlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [xZoomed, setXZoomed] = useState(false);

  const visibleRuns =
    maxRuns <= 0 ? 0 : Math.max(1, Math.min(desiredVisibleRuns, maxRuns));
  const deferredVisibleRuns = useDeferredValue(visibleRuns);

  const assets = useMemo(() => {
    const env = result.envelopes;
    const x = Array.from(env.x, (h) => h);
    const data: Array<(number | null)[]> = [x];
    const noPoints = { show: false as const };
    const series: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"] = [
      {},
    ];
    const lines: CashTrajectoryLineMeta[] = [];
    const pushSeries = (
      arr: number[],
      opt: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"][number],
      meta: Omit<CashTrajectoryLineMeta, "seriesIdx">,
    ) => {
      const idx = data.length;
      data.push(arr);
      series.push(opt);
      lines.push({ ...meta, seriesIdx: idx });
    };

    pushSeries(
      buildLinearRef(x, result.stats.expectedEvBb / Math.max(1, x[x.length - 1] ?? 1)),
      {
        stroke: linePreset.ev.stroke,
        width: linePreset.ev.width,
        dash: linePreset.ev.dash,
        points: noPoints,
        label: "EV",
      },
      { label: "EV", color: linePreset.ev.stroke, kind: "ref" },
    );
    pushSeries(
      Array.from(env.p025),
      {
        stroke: linePreset.bandWide.stroke,
        width: linePreset.bandWide.width,
        dash: linePreset.bandWide.dash,
        points: noPoints,
        label: "p2.5",
      },
      { label: "p2.5", color: linePreset.bandWide.stroke, kind: "band", percentile: 0.025 },
    );
    pushSeries(
      Array.from(env.p975),
      {
        stroke: linePreset.bandWide.stroke,
        width: linePreset.bandWide.width,
        dash: linePreset.bandWide.dash,
        points: noPoints,
        label: "p97.5",
      },
      { label: "p97.5", color: linePreset.bandWide.stroke, kind: "band", percentile: 0.975 },
    );
    pushSeries(
      Array.from(env.p15),
      {
        stroke: linePreset.bandNarrow.stroke,
        width: linePreset.bandNarrow.width,
        points: noPoints,
        label: "p15",
      },
      { label: "p15", color: linePreset.bandNarrow.stroke, kind: "band", percentile: 0.15 },
    );
    pushSeries(
      Array.from(env.p85),
      {
        stroke: linePreset.bandNarrow.stroke,
        width: linePreset.bandNarrow.width,
        points: noPoints,
        label: "p85",
      },
      { label: "p85", color: linePreset.bandNarrow.stroke, kind: "band", percentile: 0.85 },
    );
    pushSeries(
      Array.from(env.mean),
      {
        stroke: linePreset.mean.stroke,
        width: linePreset.mean.width,
        points: noPoints,
        label: "mean",
      },
      { label: "mean", color: linePreset.mean.stroke, kind: "mean" },
    );
    pushSeries(
      Array.from(env.p05),
      {
        stroke: linePreset.p05.stroke,
        width: linePreset.p05.width,
        dash: linePreset.p05.dash,
        points: noPoints,
        label: "p5",
      },
      { label: "p5", color: linePreset.p05.stroke, kind: "band", percentile: 0.05 },
    );
    pushSeries(
      Array.from(env.p95),
      {
        stroke: linePreset.p95.stroke,
        width: linePreset.p95.width,
        dash: linePreset.p95.dash,
        points: noPoints,
        label: "p95",
      },
      { label: "p95", color: linePreset.p95.stroke, kind: "band", percentile: 0.95 },
    );
    pushSeries(
      buildLinearRef(x, 0),
      {
        stroke: "#6b7280",
        width: 1,
        points: noPoints,
        label: "zero",
      },
      { label: "zero", color: "#6b7280", kind: "ref" },
    );

    const ranked = rankedRunIndices(result.samplePaths.paths, runMode);
    const pathCount = Math.min(deferredVisibleRuns, ranked.length);
    const pathStyle = pathStyleForCount(linePreset.path, Math.max(1, pathCount));
    const [pathR, pathG, pathB] = parseRgb(pathStyle.stroke);
    const baseAlpha =
      Number(pathStyle.stroke.match(/rgba?\([^)]*?,([^,)]+)\)/i)?.[1] ?? 0.4);
    const hiX = result.samplePaths.x;
    const pathFinals = result.samplePaths.paths.map((path, idx) => ({
      idx,
      final: path[path.length - 1] ?? 0,
    }));
    pathFinals.sort((a, b) => a.final - b.final || a.idx - b.idx);
    const polarity = new Float64Array(result.samplePaths.paths.length);
    const denom = Math.max(1, pathFinals.length - 1);
    for (let k = 0; k < pathFinals.length; k++) {
      const q = k / denom;
      polarity[pathFinals[k].idx] = Math.abs(2 * q - 1);
    }

    for (let rank = 0; rank < pathCount; rank++) {
      const runIdx = ranked[rank];
      const boost = polarity[runIdx] >= 0.98 ? 1.2 : 1;
      const alpha = Math.min(0.95, baseAlpha * boost);
      const width = pathStyle.width * boost;
      const stroke = `rgba(${pathR},${pathG},${pathB},${alpha.toFixed(3)})`;
      pushSeries(
        alignCashPathToEnvX(x, hiX, result.samplePaths.paths[runIdx]),
        {
          stroke,
          width,
          points: noPoints,
          label: `Run ${result.samplePaths.sampleIndices[runIdx] + 1}`,
        },
        {
          label: `Run ${result.samplePaths.sampleIndices[runIdx] + 1}`,
          color: stroke,
          kind: "path",
          rank,
        },
      );
    }

    return {
      data: data as unknown as Parameters<typeof UplotChart>[0]["data"],
      options: {
        series,
        cursor: { show: true, points: { show: false } },
        legend: { show: false },
        scales: {
          x: { time: false },
          y: {
            auto: true,
          },
        },
        axes: [
          { label: "hands" },
          {
            label: "BB",
            size: 55,
            values: (_u: uPlot, splits: number[]) =>
              splits.map((v) => formatBb(v)),
          },
        ],
      } satisfies Omit<Parameters<typeof UplotChart>[0]["options"], "width" | "height">,
      lines,
      xMin: Number(x[0] ?? 0),
      xMax: Number(x[x.length - 1] ?? 0),
    };
  }, [deferredVisibleRuns, linePreset, result, runMode]);

  const legendItems = useMemo(
    () => [
      {
        key: "ev",
        label: t("chart.traj.legend.ev"),
        color: linePreset.ev.stroke,
        dash: true,
      },
      deferredVisibleRuns > 0 && {
        key: "runs",
        label: t("chart.traj.legend.runs").replace(
          "{n}",
          deferredVisibleRuns.toLocaleString(),
        ),
        color: linePreset.path.stroke,
      },
      {
        key: "bands",
        label: t("chart.traj.legend.bands"),
        color: linePreset.bandNarrow.stroke,
      },
    ].filter(Boolean) as Array<{
      key: string;
      label: string;
      color: string;
      dash?: boolean;
    }>,
    [deferredVisibleRuns, linePreset, t],
  );

  const handlePlotReady = useCallback((plot: uPlot | null) => {
    plotRef.current = plot;
  }, []);
  const handleScaleChange = useCallback(
    (scaleKey: string, min: number | null, max: number | null) => {
      if (scaleKey !== "x") return;
      if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) {
        setXZoomed(false);
        return;
      }
      const span = Math.max(1, assets.xMax - assets.xMin);
      const eps = span * 1e-6;
      setXZoomed(
        Math.abs(min - assets.xMin) > eps || Math.abs(max - assets.xMax) > eps,
      );
    },
    [assets.xMax, assets.xMin],
  );
  const resetZoom = useCallback(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setScale("x", { min: assets.xMin, max: assets.xMax });
  }, [assets.xMax, assets.xMin]);

  const idx = cursor?.idx;
  const hands = idx != null ? Math.round((assets.data[0] as number[])[idx] ?? 0) : 0;
  let nearest: CashTrajectoryLineMeta | null = null;
  let nearestVal = 0;
  let nearestPath: CashTrajectoryLineMeta | null = null;
  let nearestPathVal = 0;
  if (cursor && idx != null) {
    let bestDist = Infinity;
    let bestPathPxDist = Infinity;
    for (const line of assets.lines) {
      const arr = assets.data[line.seriesIdx] as ArrayLike<number | null> | undefined;
      if (!arr) continue;
      const v = arr[idx];
      const hasVisibleValue = v != null && Number.isFinite(v);
      const tooltipValue = hasVisibleValue ? Number(v) : cursor.valY;
      if (hasVisibleValue) {
        const d = Math.abs(Number(v) - cursor.valY);
        if (d < bestDist) {
          bestDist = d;
          nearest = line;
          nearestVal = tooltipValue;
        }
      }
      if (line.kind === "path") {
        const pxDist = visualDistanceToSeries(
          cursor,
          assets.data[0] as ArrayLike<number>,
          arr,
        );
        if (pxDist < bestPathPxDist) {
          bestPathPxDist = pxDist;
          nearestPath = line;
          nearestPathVal = tooltipValue;
        }
      }
    }
    if (nearestPath && bestPathPxDist <= CASH_PATH_HIT_PX) {
      nearest = nearestPath;
      nearestVal = nearestPathVal;
    }
  }

  const focusedSeriesIdx = nearest?.kind === "path" ? nearest.seriesIdx : null;
  const focusedPathStats = useMemo(() => {
    if (focusedSeriesIdx == null) return null;
    const yArr = assets.data[focusedSeriesIdx] as ArrayLike<number> | undefined;
    const xArr = assets.data[0] as ArrayLike<number> | undefined;
    if (!yArr || !xArr || yArr.length === 0) return null;

    let peak = -Infinity;
    let maxDd = 0;
    let ddStart = 0;
    let ddEnd = 0;
    let curPeakIdx = 0;
    for (let i = 0; i < yArr.length; i++) {
      const v = yArr[i];
      if (!Number.isFinite(v)) continue;
      if (v > peak) {
        peak = v;
        curPeakIdx = i;
      }
      const dd = peak - v;
      if (dd > maxDd) {
        maxDd = dd;
        ddStart = curPeakIdx;
        ddEnd = i;
      }
    }

    let longestBelowPeak = 0;
    let belowPeakStart = 0;
    let belowPeakEnd = 0;
    peak = -Infinity;
    let streakStart = 0;
    let streakLen = 0;
    for (let i = 0; i < yArr.length; i++) {
      const v = yArr[i];
      if (!Number.isFinite(v)) continue;
      if (v > peak) {
        peak = v;
        streakStart = i;
        streakLen = 0;
      } else {
        streakLen++;
        if (streakLen > longestBelowPeak) {
          longestBelowPeak = streakLen;
          belowPeakStart = streakStart;
          belowPeakEnd = i;
        }
      }
    }

    const handAt = (i: number) => Math.round(xArr[i] ?? 0);
    return {
      finalBb: yArr[yArr.length - 1] ?? 0,
      maxDd,
      ddStart,
      ddEnd,
      ddHands: Math.max(0, handAt(ddEnd) - handAt(ddStart)),
      belowPeakHands:
        longestBelowPeak > 0
          ? Math.max(0, handAt(belowPeakEnd) - handAt(belowPeakStart))
          : 0,
    };
  }, [assets.data, focusedSeriesIdx]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let canvas = hlCanvasRef.current;
    if (!canvas || !plot.over.contains(canvas)) {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.left = "0";
      canvas.style.top = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "5";
      plot.over.appendChild(canvas);
      hlCanvasRef.current = canvas;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = plot.over.clientWidth;
    const h = plot.over.clientHeight;
    const dpr = devicePixelRatio;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (focusedSeriesIdx == null) return;
    const xArr = assets.data[0] as ArrayLike<number>;
    const yArr = assets.data[focusedSeriesIdx] as ArrayLike<number>;
    if (!xArr || !yArr) return;

    const strokeSegment = (
      startIdx: number,
      endIdx: number,
      stroke: string,
      width: number,
    ) => {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (let i = startIdx; i <= endIdx; i++) {
        const xVal = xArr[i];
        const yVal = yArr[i];
        if (xVal == null || yVal == null || !Number.isFinite(yVal)) continue;
        const px = plot.valToPos(xVal, "x", false);
        const py = plot.valToPos(yVal, "y", false);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    strokeSegment(0, xArr.length - 1, "rgba(253,230,138,0.9)", 2.5);
    if (focusedPathStats && focusedPathStats.ddEnd > focusedPathStats.ddStart) {
      strokeSegment(
        focusedPathStats.ddStart,
        focusedPathStats.ddEnd,
        "rgba(248,113,113,0.95)",
        3,
      );
    }
  }, [assets.data, focusedPathStats, focusedSeriesIdx]);

  const kindLabel = (line: CashTrajectoryLineMeta): string => {
    switch (line.kind) {
      case "mean":
        return t("chart.traj.kind.mean");
      case "band":
        return t("chart.traj.kind.band");
      case "path":
        return t("chart.traj.kind.path");
      case "ref":
        return t("chart.traj.kind.ref");
    }
  };

  const winrateSoFar = hands > 0 ? (nearestVal / hands) * 100 : null;

  return (
    <div className="flex flex-col gap-3">
      {maxRuns > 0 && (
        <div className="flex flex-col gap-3 border-b border-[color:var(--color-border)] pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {legendItems.map((item) => (
              <span
                key={item.key}
                className="inline-flex max-w-full items-center gap-1.5 rounded border border-[color:var(--color-border)]/55 bg-[color:var(--color-bg)]/55 px-2 py-1 text-[10px] font-medium text-[color:var(--color-fg-muted)]"
              >
                <span
                  className={`inline-block h-0 w-5 border-t-2 ${item.dash ? "border-dashed" : ""}`}
                  style={{ borderColor: item.color }}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="eyebrow text-[10px] text-[color:var(--color-fg-dim)]">
                {t("runs.label")}
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={maxRuns}
                  step={1}
                  value={visibleRuns}
                  onChange={(e) => setDesiredVisibleRuns(Number(e.target.value))}
                  className="w-full accent-[color:var(--color-accent)]"
                  aria-label={t("runs.label")}
                />
                <span className="min-w-[58px] text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg)]">
                  {visibleRuns}/{maxRuns}
                </span>
              </div>
            </label>
            <RunModeSlider value={runMode} onChange={setRunMode} t={t} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--color-fg-dim)]">
            <span>{t("chart.traj.zoomHint")}</span>
            <span className="text-[color:var(--color-border-strong)]">/</span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-[3px] w-3 rounded-sm"
                style={{ background: "rgba(248,113,113,0.95)" }}
                aria-hidden
              />
              {t("chart.traj.hoverHint.maxDd")}
            </span>
          </div>
        </div>
      )}

      {xZoomed && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetZoom}
            className="rounded border border-[color:var(--color-accent)]/50 bg-[color:var(--color-bg)]/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)] shadow-sm transition hover:bg-[color:var(--color-accent)] hover:text-black"
            title={t("chart.traj.resetZoom")}
          >
            {t("chart.traj.resetZoom")}
          </button>
        </div>
      )}

      <UplotChart
        data={assets.data}
        options={assets.options}
        height={360}
        onCursor={setCursor}
        onPlotReady={handlePlotReady}
        onScaleChange={handleScaleChange}
        onDoubleClick={resetZoom}
      />

      {cursor && idx != null && nearest && (
        <div className="overflow-hidden rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]/95 text-[11px] shadow-xl backdrop-blur">
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{
              background: `linear-gradient(90deg, ${nearest.color}22 0%, transparent 70%)`,
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span
              className="inline-block h-2.5 w-3 rounded-sm"
              style={{ background: nearest.color }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
              {nearest.label}
            </span>
            <span className="ml-auto text-[9px] text-[color:var(--color-fg-dim)]">
              {kindLabel(nearest)}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 tabular-nums">
            <span className="text-[color:var(--color-fg-dim)]">{t("cash.hands.label")}</span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {hands.toLocaleString()}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              {t("cash.chart.trajectory.bankrollBb")}
            </span>
            <span
              className="text-right font-semibold"
              style={{
                color:
                  nearestVal >= 0 ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {formatBb(nearestVal)}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              {t("cash.chart.trajectory.bankrollUsd")}
            </span>
            <span
              className="text-right font-semibold"
              style={{
                color:
                  nearestVal >= 0 ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {formatUsd(nearestVal * bbSize)}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              {t("cash.wrBb100.label")}
            </span>
            <span
              className="text-right font-semibold"
              style={{
                color:
                  winrateSoFar != null && winrateSoFar >= 0
                    ? "var(--color-success)"
                    : "var(--color-danger)",
              }}
            >
              {winrateSoFar != null ? `${winrateSoFar.toFixed(2)}` : "—"}
            </span>
          </div>
          {focusedPathStats && (
            <div className="border-t border-[color:var(--color-border)]/50 px-3 py-2">
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                {t("chart.traj.runStats")}
              </div>
              <div className="mb-1.5 rounded-sm bg-[color:var(--color-danger)]/8 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-danger)]">
                  <span
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ background: "rgba(248,113,113,0.95)" }}
                    aria-hidden
                  />
                  {t("chart.traj.maxDD")}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-[13px] font-bold text-[color:var(--color-danger)]">
                    {formatBb(focusedPathStats.maxDd)} BB
                  </span>
                  <span className="rounded-sm bg-[color:var(--color-danger)]/12 px-1 py-0.5 text-[9px] font-semibold text-[color:var(--color-danger)]">
                    {formatUsd(focusedPathStats.maxDd * bbSize)}
                  </span>
                </div>
                {focusedPathStats.ddHands > 0 && (
                  <div className="mt-0.5 text-[9px] text-[color:var(--color-fg-dim)]">
                    {focusedPathStats.ddHands.toLocaleString()} {t("cash.hands.label").toLowerCase()}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-[color:var(--color-fg-dim)]">
                  {t("cash.chart.trajectory.finalBankroll")}
                </span>
                <span
                  className="text-right font-semibold"
                  style={{
                    color:
                      focusedPathStats.finalBb >= 0
                        ? "var(--color-success)"
                        : "var(--color-danger)",
                  }}
                >
                  {formatBb(focusedPathStats.finalBb)} BB
                </span>
                <span className="text-[color:var(--color-fg-dim)]">
                  {t("chart.traj.longestBE")}
                </span>
                <span className="text-right text-[color:var(--color-fg)]">
                  {focusedPathStats.belowPeakHands.toLocaleString()} {t("cash.hands.label").toLowerCase()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistogramChart({
  hist,
}: {
  hist: { binEdges: number[]; counts: number[] };
}) {
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
    <UplotChart
      data={data}
      options={{
        series: [
          {},
          {
            stroke: "var(--color-accent)",
            fill: "color-mix(in srgb, var(--color-accent) 25%, transparent)",
            width: 1.5,
            points: { show: false },
          },
        ],
        cursor: { show: true, points: { show: false } },
        legend: { show: false },
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, max * 1.05] },
        },
        axes: [{ label: "BB" }, { label: "count", size: 55 }],
      }}
      height={220}
    />
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
      className="inline-flex max-w-full overflow-hidden rounded-md border border-[color:var(--color-border)]"
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
              "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors " +
              (active
                ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
                : "bg-[color:var(--color-bg-elev)] text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]") +
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

interface NumFieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
  onChange: (v: number) => void;
}

function NumField({
  label,
  value,
  step = 1,
  min,
  max,
  disabled,
  hint,
  onChange,
}: NumFieldProps) {
  return (
    <label
      className={`flex flex-col gap-1 ${disabled ? "opacity-50" : ""}`}
    >
      <span className="eyebrow text-[10px] text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1.5 font-mono text-sm tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none disabled:cursor-not-allowed"
      />
      {hint && (
        <span className="text-[10px] text-[color:var(--color-fg-dim)]">
          {hint}
        </span>
      )}
    </label>
  );
}

function InputGroup({
  title,
  toggle,
  children,
}: {
  title: string;
  toggle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-2">
        <h3 className="eyebrow text-[11px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {title}
        </h3>
        {toggle}
      </header>
      {children}
    </section>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full border transition-colors ${
        checked
          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/25"
          : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
          checked
            ? "translate-x-[18px] bg-[color:var(--color-accent)]"
            : "translate-x-[2px] bg-[color:var(--color-fg-muted)]"
        }`}
      />
    </button>
  );
}

function StakeRowEditor({
  row,
  canRemove,
  onPatch,
  onPatchRake,
  onRemove,
  t,
}: {
  row: CashStakeRow;
  canRemove: boolean;
  onPatch: (p: Partial<CashStakeRow>) => void;
  onPatchRake: (p: Partial<CashStakeRow["rake"]>) => void;
  onRemove: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="flex flex-col gap-3 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/40 p-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={row.label ?? ""}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={t("cash.stakes.row.label")}
          className="flex-1 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1.5 font-mono text-sm text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="border border-[color:var(--color-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-heart)] hover:text-[color:var(--color-heart)]"
          >
            {t("cash.stakes.remove")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumField
          label={t("cash.wrBb100.label")}
          value={row.wrBb100}
          step={0.5}
          onChange={(v) => onPatch({ wrBb100: v })}
        />
        <NumField
          label={t("cash.sdBb100.label")}
          value={row.sdBb100}
          step={5}
          min={1}
          onChange={(v) => onPatch({ sdBb100: v })}
        />
        <NumField
          label={t("cash.stakes.row.bbSize")}
          value={row.bbSize}
          step={0.25}
          min={0.01}
          onChange={(v) => onPatch({ bbSize: v })}
        />
        <NumField
          label={t("cash.stakes.row.handShare")}
          value={row.handShare}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => onPatch({ handShare: v })}
        />
        <NumField
          label={t("cash.stakes.row.rake")}
          value={row.rake.contributedRakeBb100}
          step={0.5}
          min={0}
          disabled={!row.rake.enabled}
          onChange={(v) => onPatchRake({ contributedRakeBb100: v })}
        />
        <NumField
          label={t("cash.stakes.row.rbPct")}
          value={row.rake.advertisedRbPct}
          step={1}
          min={0}
          max={100}
          disabled={!row.rake.enabled}
          onChange={(v) => onPatchRake({ advertisedRbPct: v })}
        />
      </div>
      <div className="flex items-center gap-3">
        <ToggleSwitch
          checked={row.rake.enabled}
          onChange={(checked) => onPatchRake({ enabled: checked })}
        />
        <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          {t("cash.rake.enabled.label")}
        </span>
        {row.rake.enabled && (
          <div className="ml-auto max-w-[140px]">
            <NumField
              label={t("cash.stakes.row.pvi")}
              value={row.rake.pvi}
              step={0.05}
              min={0.05}
              max={1}
              onChange={(v) => onPatchRake({ pvi: v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

type StatRow = { label: string; value: string };

type SuitAccent = "spade" | "heart" | "diamond" | "club";

function StatGroup({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: StatRow[];
  accent: SuitAccent;
}) {
  const glyph = accent === "spade" ? "♠" : accent === "heart" ? "♥" : accent === "diamond" ? "♦" : "♣";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] pb-1.5">
        <span className={`text-[color:var(--color-${accent})]`}>{glyph}</span>
        <h4 className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {title}
        </h4>
      </div>
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11px] text-[color:var(--color-fg-dim)]">{r.label}</dt>
            <dd className="font-mono text-sm tabular-nums text-[color:var(--color-fg)]">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
