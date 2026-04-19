"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Section, Card } from "@/components/ui/Section";
import { UplotChart } from "@/components/charts/UplotChart";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
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

const STORAGE_KEY = "tvs:cash-input";

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

export function CashApp() {
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
}

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
  // X axis is hands (envelope grid). Y axis in BB; no USD lens applied here
  // for clarity — bbSize shows up in the stats panel.
  void bbSize;

  const data = useMemo(() => {
    const env = result.envelopes;
    const x = Array.from(env.x, (h) => h);
    const p05 = Array.from(env.p05);
    const p95 = Array.from(env.p95);
    const p15 = Array.from(env.p15);
    const p85 = Array.from(env.p85);
    const mean = Array.from(env.mean);
    // Up to N hi-res sample paths layered underneath the envelopes.
    const HI_PATH_SHOW = 30;
    const paths = result.samplePaths.paths.slice(0, HI_PATH_SHOW);
    // Pad hi-res paths to env x-axis length by sampling nearest index. The
    // two grids have different K but both cover [0, hands], so we align by
    // hand value rather than index.
    const hiX = result.samplePaths.x;
    const aligned: number[][] = paths.map((p) => {
      const out = new Array<number>(x.length);
      let j = 0;
      for (let i = 0; i < x.length; i++) {
        const target = env.x[i];
        while (j + 1 < hiX.length && hiX[j + 1] <= target) j++;
        out[i] = p[j];
      }
      return out;
    });
    return [x, p05, p15, mean, p85, p95, ...aligned] as Array<
      (number | null)[]
    >;
  }, [result]);

  const series = useMemo(() => {
    const HI_PATH_SHOW = 30;
    const pathCount = Math.min(HI_PATH_SHOW, result.samplePaths.paths.length);
    // points.show: false kills the per-sample dot markers uPlot draws by
    // default at every x. With 30 hi-res paths layered behind envelopes the
    // chart turns into a noise field without this.
    const noPoints = { show: false as const };
    const s: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"] =
      [
        {},
        {
          stroke: "rgba(255,80,80,0.55)",
          width: 1,
          label: "p05",
          points: noPoints,
        },
        {
          stroke: "rgba(255,170,80,0.5)",
          width: 1,
          label: "p15",
          points: noPoints,
        },
        {
          stroke: "var(--color-accent)",
          width: 2.2,
          label: "mean",
          points: noPoints,
        },
        {
          stroke: "rgba(80,200,130,0.5)",
          width: 1,
          label: "p85",
          points: noPoints,
        },
        {
          stroke: "rgba(80,180,255,0.55)",
          width: 1,
          label: "p95",
          points: noPoints,
        },
      ];
    for (let i = 0; i < pathCount; i++) {
      s.push({
        stroke: "rgba(150,150,170,0.14)",
        width: 0.8,
        label: `r${i}`,
        points: noPoints,
      });
    }
    return s;
  }, [result]);

  return (
    <UplotChart
      data={data as unknown as Parameters<typeof UplotChart>[0]["data"]}
      options={{
        series,
        cursor: { show: true, points: { show: false } },
        legend: { show: false },
        scales: { x: { time: false } },
        axes: [
          { label: "hands" },
          { label: "BB", size: 55 },
        ],
      }}
      height={320}
    />
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
