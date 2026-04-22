"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Section, Card } from "@/components/ui/Section";
import { UplotChart } from "@/components/charts/UplotChart";
import { useT } from "@/lib/i18n/LocaleProvider";
import { normalizeNumericDraft } from "@/lib/ui/numberDraft";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import {
  commitNumFieldDraft,
  formatNumFieldValue,
  parseNumFieldDraft,
} from "@/components/cashNumberField";
import {
  buildCashResult,
  makeCashEnvGrid,
  makeCashHiResGrid,
  type CashShard,
} from "@/lib/sim/cashEngine";
import {
  type CashInputDraft,
  DEFAULT_CASH_INPUT,
  MAX_ABS_WR_BB100,
  MAX_BB_SIZE,
  MAX_HANDS,
  MAX_HANDS_PER_HOUR,
  MAX_RAKE_CONTRIB_BB100,
  MAX_SD_BB100,
  MAX_TOTAL_SIM_HANDS,
  normalizeCashInput,
  normalizeCashInputForUi,
  serializeCashInput,
} from "@/lib/sim/cashInput";
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

function loadInput(): CashInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CASH_INPUT;
    const parsed = JSON.parse(raw) as CashInputDraft;
    return normalizeCashInputForUi(parsed);
  } catch {
    return DEFAULT_CASH_INPUT;
  }
}
function saveInput(next: CashInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeCashInput(next)));
  } catch {
    // localStorage full / unavailable — silently drop; UI still works.
  }
}

export const CashApp = memo(function CashApp() {
  const t = useT();
  const [input, setInput] = useLocalStorageState<CashInput>(
    STORAGE_KEY,
    loadInput,
    saveInput,
    DEFAULT_CASH_INPUT,
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
    const snapshot = normalizeCashInput(input);
    setInput(snapshot);
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
  const patchRisk = (p: Partial<NonNullable<CashInput["riskBlock"]>>) =>
    setInput({
      ...input,
      riskBlock: { thresholdBb: input.riskBlock?.thresholdBb ?? 100, ...p },
    });

  const mixEnabled = !!input.stakes && input.stakes.length > 0;
  const stakes = input.stakes ?? [];
  const maxHandsForSimulations = Math.max(
    1_000,
    Math.min(
      MAX_HANDS,
      Math.floor(MAX_TOTAL_SIM_HANDS / Math.max(1, input.nSimulations)),
    ),
  );
  const maxSimulationsForHands = Math.max(
    100,
    Math.min(20_000, Math.floor(MAX_TOTAL_SIM_HANDS / Math.max(1, input.hands))),
  );
  const stakeShareSum = stakes.reduce((acc, row) => acc + row.handShare, 0);
  const stakeShareLabel = stakeShareSum.toFixed(2);
  const mixSharesNeedRenorm =
    mixEnabled && Math.abs(stakeShareSum - 1) > 1e-9;
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
        <Card className="data-surface-card flex flex-col gap-6 p-6">
          <InputGroup title={t("cash.group.session")} accent="spade">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!mixEnabled && (
                <>
                  <NumField
                    label={t("cash.wrBb100.label")}
                    value={input.wrBb100}
                    step={0.5}
                    min={-MAX_ABS_WR_BB100}
                    max={MAX_ABS_WR_BB100}
                    onChange={(v) => patch({ wrBb100: v })}
                  />
                  <NumField
                    label={t("cash.sdBb100.label")}
                    value={input.sdBb100}
                    step={5}
                    min={1}
                    max={MAX_SD_BB100}
                    onChange={(v) => patch({ sdBb100: v })}
                  />
                </>
              )}
              <NumField
                label={t("cash.hands.label")}
                value={input.hands}
                step={10_000}
                min={1000}
                max={maxHandsForSimulations}
                onChange={(v) => patch({ hands: Math.floor(v) })}
              />
              <NumField
                label={t("cash.nSimulations.label")}
                value={input.nSimulations}
                step={500}
                min={100}
                max={maxSimulationsForHands}
                onChange={(v) => patch({ nSimulations: Math.floor(v) })}
              />
              <NumField
                label={t("cash.bbSize.label")}
                value={input.bbSize}
                step={0.25}
                min={0.01}
                max={MAX_BB_SIZE}
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
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/38 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
                      {t("cash.group.hourly")}
                    </span>
                    <p className="max-w-2xl text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
                      {t("cash.hours.hint")}
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={!!input.hoursBlock}
                    tone="club"
                    onChange={(checked) =>
                      setInput({
                        ...input,
                        hoursBlock: checked
                          ? { handsPerHour: input.hoursBlock?.handsPerHour ?? 500 }
                          : undefined,
                      })
                    }
                  />
                </div>
                {input.hoursBlock && (
                  <div className="max-w-xs">
                    <NumField
                      label={t("cash.hours.handsPerHour.label")}
                      value={input.hoursBlock.handsPerHour}
                      step={50}
                      min={50}
                      max={MAX_HANDS_PER_HOUR}
                      onChange={(v) =>
                        setInput({
                          ...input,
                          hoursBlock: { handsPerHour: Math.floor(v) },
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--color-heart)]/32 bg-[color:var(--color-heart)]/6 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
                    {t("cash.group.riskLine")}
                  </span>
                  <p className="max-w-2xl text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
                    {t("cash.risk.hint")}
                  </p>
                </div>
                <div className="max-w-xs">
                  <NumField
                    label={t("cash.risk.threshold.label")}
                    value={input.riskBlock?.thresholdBb ?? 100}
                    step={10}
                    min={10}
                    onChange={(v) =>
                      patchRisk({ thresholdBb: Math.max(1, v) })
                    }
                  />
                </div>
              </div>
            </div>
          </InputGroup>

          <InputGroup
            title={t("cash.group.stakes")}
            accent="diamond"
            toggle={
              <ToggleSwitch
                checked={mixEnabled}
                onChange={enableMix}
                tone="diamond"
              />
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
                <p
                  className={`rounded-sm border px-3 py-2 text-[11px] leading-relaxed ${
                    mixSharesNeedRenorm
                      ? "border-[color:var(--color-heart)]/45 bg-[color:var(--color-heart)]/10 text-[color:var(--color-fg-muted)]"
                      : "border-[color:var(--color-club)]/45 bg-[color:var(--color-club)]/10 text-[color:var(--color-fg-muted)]"
                  }`}
                >
                  {mixSharesNeedRenorm
                    ? t("cash.stakes.share.renorm").replace(
                        "{sum}",
                        stakeShareLabel,
                      )
                    : t("cash.stakes.share.ok").replace(
                        "{sum}",
                        stakeShareLabel,
                      )}
                </p>
                <button
                  type="button"
                  onClick={addStake}
                  className="self-start rounded-sm border border-[color:var(--color-diamond)]/50 bg-[color:var(--color-diamond)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-diamond)] transition-colors hover:bg-[color:var(--color-diamond)]/16 hover:text-[color:var(--color-fg)]"
                >
                  {t("cash.stakes.add")}
                </button>
              </div>
            )}
          </InputGroup>

          {!mixEnabled && (
            <InputGroup
              title={t("cash.group.rake")}
              accent="heart"
              toggle={
                <ToggleSwitch
                  checked={input.rake.enabled}
                  onChange={(checked) => patchRake({ enabled: checked })}
                  tone="heart"
                />
              }
            >
              <div
                className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${
                  input.rake.enabled ? "" : "pointer-events-none opacity-70"
                }`}
              >
                <NumField
                  label={t("cash.rake.contrib.label")}
                  value={input.rake.contributedRakeBb100}
                  step={0.5}
                  min={0}
                  max={MAX_RAKE_CONTRIB_BB100}
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

          <div className="mt-5 flex flex-col items-stretch gap-3 border-t border-[color:var(--color-border)]/70 pt-4 sm:flex-row sm:items-center sm:justify-end">
            {running && (
              <div className="flex flex-1 items-center gap-3 rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/36 px-3 py-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-[color:var(--color-bg-elev-2)]/90">
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
                  className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                >
                  ×
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={runSim}
              disabled={running}
              className="rounded-sm border border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/14 px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-[color:var(--color-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:bg-[color:var(--color-accent)]/22 disabled:opacity-50"
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
          <Card className="data-surface-card border-dashed p-5">
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--color-fg-muted)]">
              {t("cash.empty")}
            </p>
          </Card>
        )}
        {result && <CashResultsView result={result} />}
      </Section>
    </>
  );
});

type CashMoneyUnit = "bb" | "usd";

function CashResultsView({ result }: { result: CashResult }) {
  const t = useT();
  const s = result.stats;
  const bb = result.echoInput.bbSize;
  const riskThresholdBb = result.oddsOverDistance.thresholdBb;
  const mixBreakdown = result.mixBreakdown;
  const [moneyUnit, setMoneyUnit] = useState<CashMoneyUnit>("bb");
  const maxVisibleRuns = Math.max(1, Math.min(36, result.samplePaths.paths.length));
  const [visibleRuns, setVisibleRuns] = useState(() =>
    Math.min(12, maxVisibleRuns),
  );
  const clampedVisibleRuns = Math.max(
    0,
    Math.min(visibleRuns, maxVisibleRuns),
  );

  const fmtPct = (v: number) => formatCashPct(v);
  const fmtMoney = (vBb: number) => formatCashMoney(vBb, moneyUnit, bb);
  const fmtHands = (v: number) =>
    Number.isFinite(v) ? `${Math.round(v).toLocaleString()} ${t("cash.axis.hands")}` : "—";
  const moneyAxisLabel =
    moneyUnit === "usd" ? t("cash.axis.usd") : t("cash.axis.bb");

  const finalHistogram = useMemo(
    () => scaleMoneyHistogram(result.histogram, moneyUnit, bb),
    [result.histogram, moneyUnit, bb],
  );
  const drawdownHistogram = useMemo(
    () => scaleMoneyHistogram(result.drawdownHistogram, moneyUnit, bb),
    [result.drawdownHistogram, moneyUnit, bb],
  );
  const oddsEndIdx = Math.max(0, result.oddsOverDistance.x.length - 1);
  const oddsEndProfit = result.oddsOverDistance.profitShare[oddsEndIdx] ?? 0;
  const oddsEndBelowThresholdNow =
    result.oddsOverDistance.belowThresholdNowShare[oddsEndIdx] ?? 0;
  const riskThresholdLabel = formatRiskThresholdBb(riskThresholdBb);

  const heroStats: HeroStat[] = [
    {
      accent: "diamond",
      label: t("cash.hero.expected"),
      value: fmtMoney(s.expectedEvBb),
      sub:
        s.hourlyEvUsd !== undefined
          ? t("cash.hero.expected.subHourly")
              .replace("{hourly}", formatUsdRate(s.hourlyEvUsd))
              .replace(
                "{hands}",
                result.echoInput.hoursBlock?.handsPerHour.toLocaleString() ?? "—",
              )
          : t("cash.hero.expected.subDistance"),
      tone: "pos",
    },
    {
      accent: "spade",
      label: t("cash.hero.typical"),
      value: fmtMoney(s.finalBbMedian),
      sub: t("cash.hero.typical.subRange")
        .replace("{lo}", fmtMoney(s.finalBbP05))
        .replace("{hi}", fmtMoney(s.finalBbP95)),
    },
    {
      accent: "club",
      label: t("cash.hero.finishUp"),
      value: fmtPct(s.probProfit),
      sub: t("cash.hero.finishUp.subLoss").replace(
        "{pct}",
        fmtPct(s.probLoss),
      ),
      tone: s.probProfit >= 0.5 ? "pos" : "neg",
    },
    {
      accent: "heart",
      label: t("cash.hero.drawdown"),
      value: fmtMoney(s.maxDrawdownP95),
      sub: t("cash.hero.drawdown.subMedian").replace(
        "{value}",
        fmtMoney(s.maxDrawdownMedian),
      ),
      tone: "neg",
    },
    {
      accent: "spade",
      label: t("cash.hero.breakeven"),
      value: fmtHands(s.longestBreakevenMedian),
      sub: t("cash.hero.breakeven.subRecovery")
        .replace("{recovery}", fmtHands(s.recoveryP90))
        .replace("{share}", fmtPct(s.recoveryUnrecoveredShare)),
    },
  ];

  const finalSummary: SummaryStat[] = [
    {
      accent: "diamond",
      label: t("cash.summary.p05"),
      value: fmtMoney(s.finalBbP05),
    },
    {
      accent: "diamond",
      label: t("cash.summary.median"),
      value: fmtMoney(s.finalBbMedian),
    },
    {
      accent: "diamond",
      label: t("cash.summary.p95"),
      value: fmtMoney(s.finalBbP95),
    },
  ];

  const drawdownSummary: SummaryStat[] = [
    {
      accent: "heart",
      label: t("cash.summary.median"),
      value: fmtMoney(s.maxDrawdownMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.p95"),
      value: fmtMoney(s.maxDrawdownP95),
      tone: "neg",
    },
    {
      accent: "club",
      label: t("cash.summary.probBelowThresholdEver").replace(
        "{threshold}",
        riskThresholdLabel,
      ),
      value: fmtPct(s.probBelowThresholdEver),
      tone: s.probBelowThresholdEver > 0.05 ? "neg" : undefined,
    },
  ];

  const streakSummary: SummaryStat[] = [
    {
      accent: "spade",
      label: t("cash.summary.median"),
      value: fmtHands(s.longestBreakevenMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.recoveryMedian"),
      value: fmtHands(s.recoveryMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.unrecovered"),
      value: fmtPct(s.recoveryUnrecoveredShare),
      tone: s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined,
    },
  ];

  const oddsSummary: SummaryStat[] = [
    {
      accent: "club",
      label: t("cash.summary.oddsUp"),
      value: fmtPct(oddsEndProfit),
      tone: oddsEndProfit >= 0.5 ? "pos" : undefined,
    },
    {
      accent: "heart",
      label: t("cash.summary.oddsBelowThresholdNow").replace(
        "{threshold}",
        riskThresholdLabel,
      ),
      value: fmtPct(oddsEndBelowThresholdNow),
      tone: oddsEndBelowThresholdNow > 0.05 ? "neg" : undefined,
    },
  ];

  const economics: StatRow[] = [
    { label: t("cash.stats.meanRakePaidBb"), value: fmtMoney(s.meanRakePaidBb) },
    { label: t("cash.stats.meanRbEarnedBb"), value: fmtMoney(s.meanRbEarnedBb) },
  ];
  if (s.hourlyEvUsd !== undefined) {
    economics.push({
      label: t("cash.stats.hourlyEvUsd"),
      value: formatUsdRate(s.hourlyEvUsd),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <HeroGrid items={heroStats} />

      <Card className="data-surface-card p-4">
        <ChartTitle
          suit="heart"
          title={t("cash.chart.trajectory.title")}
          note={t("cash.chart.trajectory.note").replace(
            "{threshold}",
            formatRiskThreshold(riskThresholdBb, moneyUnit, bb),
          )}
        />
        <TrajectoryToolbar
          visibleRuns={clampedVisibleRuns}
          maxVisibleRuns={maxVisibleRuns}
          onVisibleRunsChange={setVisibleRuns}
          moneyUnit={moneyUnit}
          onMoneyUnitChange={setMoneyUnit}
          riskThresholdBb={riskThresholdBb}
          bbSize={bb}
        />
        <TrajectoryChart
          result={result}
          bbSize={bb}
          visibleRuns={clampedVisibleRuns}
          moneyUnit={moneyUnit}
          riskThresholdBb={riskThresholdBb}
        />
      </Card>

      {mixBreakdown && mixBreakdown.rows.length > 1 && (
        <MixBreakdownCard
          breakdown={mixBreakdown}
          moneyUnit={moneyUnit}
          bbSize={bb}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="data-surface-card p-4">
          <ChartTitle suit="diamond" title={t("cash.chart.final.title")} />
          <SummaryStrip items={finalSummary} />
          <HistogramChart
            hist={finalHistogram}
            xLabel={moneyAxisLabel}
            yLabel={t("cash.axis.count")}
            tone="diamond"
          />
        </Card>
        <Card className="data-surface-card p-4">
          <ChartTitle suit="club" title={t("cash.chart.drawdown.title")} />
          <SummaryStrip items={drawdownSummary} />
          <HistogramChart
            hist={drawdownHistogram}
            xLabel={moneyAxisLabel}
            yLabel={t("cash.axis.count")}
            tone="club"
          />
        </Card>
      </div>

      <Card className="data-surface-card p-4">
        <ChartTitle
          suit="spade"
          title={t("cash.section.streaks.title")}
          note={t("cash.section.streaks.note")}
        />
        <SummaryStrip items={streakSummary} />
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-3">
            <MiniChartTitle
              suit="spade"
              title={t("cash.chart.breakeven.title")}
              note={t("cash.chart.breakeven.note")}
            />
            <HistogramChart
              hist={result.longestBreakevenHistogram}
              xLabel={t("cash.axis.hands")}
              yLabel={t("cash.axis.count")}
              tone="spade"
            />
          </div>
          <div className="flex flex-col gap-3">
            <MiniChartTitle
              suit="heart"
              title={t("cash.chart.recovery.title")}
              note={t("cash.chart.recovery.note")}
            />
            <HistogramChart
              hist={result.recoveryHistogram}
              xLabel={t("cash.axis.hands")}
              yLabel={t("cash.axis.count")}
              tone="heart"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="club"
            title={t("cash.chart.odds.title")}
            note={t("cash.chart.odds.note").replace(
              "{threshold}",
              riskThresholdLabel,
            )}
          />
          <SummaryStrip items={oddsSummary} />
          <CashOddsChart result={result} />
        </Card>
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="diamond"
            title={t("cash.section.economics.title")}
            note={t("cash.section.economics.note")}
          />
          <DetailList rows={economics} accent="diamond" />
        </Card>
      </div>

      <DiagnosticsDisclosure result={result} />
    </div>
  );
}

function MixBreakdownCard({
  breakdown,
  moneyUnit,
  bbSize,
}: {
  breakdown: NonNullable<CashResult["mixBreakdown"]>;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
}) {
  const t = useT();
  return (
    <Card className="data-surface-card p-4">
      <ChartTitle
        suit="diamond"
        title={t("cash.section.mix.title")}
        note={t("cash.section.mix.note")}
      />
      <div className="flex flex-col gap-3">
        {breakdown.rows.map((row, index) => (
          <MixBreakdownRowCard
            key={`${row.label ?? "row"}-${index}`}
            row={row}
            index={index}
            moneyUnit={moneyUnit}
            bbSize={bbSize}
          />
        ))}
      </div>
    </Card>
  );
}

function MixBreakdownRowCard({
  row,
  index,
  moneyUnit,
  bbSize,
}: {
  row: NonNullable<CashResult["mixBreakdown"]>["rows"][number];
  index: number;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
}) {
  const t = useT();
  const rowLabel =
    row.label?.trim() ||
    t("cash.mix.rowFallback").replace("{index}", String(index + 1));
  const evTone =
    row.expectedEvBb < -1e-9
      ? "text-[color:var(--color-heart)]"
      : row.expectedEvBb > 1e-9
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";

  return (
    <div className="rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-[color:var(--color-fg)]">
              {rowLabel}
            </span>
            <MixTag accent="diamond">
              {formatCashPct(row.handShare)}
            </MixTag>
            <MixTag accent="spade">{formatUsdBbSize(row.bbSize)}</MixTag>
          </div>
          <div className="flex flex-wrap gap-2">
            <MixTag accent="diamond">
              {row.hands.toLocaleString()} {t("cash.axis.hands")}
            </MixTag>
            <MixTag accent="club">
              {t("cash.wrBb100.label")}: {formatSignedBb100(row.wrBb100)}
            </MixTag>
            <MixTag accent="heart">
              {t("cash.sdBb100.label")}: {formatUnsignedBb100(row.sdBb100)}
            </MixTag>
          </div>
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1 rounded-sm border border-[color:var(--color-border)]/65 bg-[color:var(--color-bg)]/55 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
            {t("cash.mix.expectedEv")}
          </span>
          <span className={`font-mono text-[18px] font-semibold tabular-nums ${evTone}`}>
            {formatCashMoney(row.expectedEvBb, moneyUnit, bbSize)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MixMetricBar
          accent="diamond"
          label={t("cash.mix.metric.hands")}
          share={row.handShare}
          detail={`${formatCashPct(row.handShare)} · ${row.hands.toLocaleString()} ${t("cash.axis.hands")}`}
        />
        <MixMetricBar
          accent="heart"
          label={t("cash.mix.metric.swing")}
          share={row.varianceShare}
          detail={formatCashPct(row.varianceShare)}
        />
        <MixMetricBar
          accent="spade"
          label={t("cash.mix.metric.rake")}
          share={row.rakeShare}
          detail={`${formatCashPct(row.rakeShare)} · ${formatCashMoney(
            row.rakePaidBb,
            moneyUnit,
            bbSize,
          )}`}
        />
        <MixMetricBar
          accent="club"
          label={t("cash.mix.metric.rb")}
          share={row.rbShare}
          detail={`${formatCashPct(row.rbShare)} · ${formatCashMoney(
            row.rbEarnedBb,
            moneyUnit,
            bbSize,
          )}`}
        />
      </div>
    </div>
  );
}

function TrajectoryToolbar({
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

function TrajectoryChart({
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

function MiniChartTitle({
  suit,
  title,
  note,
}: {
  suit: SuitAccent;
  title: string;
  note?: string;
}) {
  const meta = CASH_ACCENT_META[suit];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]"
          style={{
            color: meta.colorVar,
            borderColor: meta.badgeBorder,
            background: meta.badgeBg,
          }}
        >
          {meta.glyph}
        </span>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-fg)]">
          {title}
        </h4>
      </div>
      {note && (
        <p className="text-[10.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {note}
        </p>
      )}
    </div>
  );
}

function HistogramChart({
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

function CashOddsChart({ result }: { result: CashResult }) {
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

function CashConvergenceChart({ result }: { result: CashResult }) {
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

function DiagnosticsDisclosure({ result }: { result: CashResult }) {
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

function ChartTitle({
  suit,
  title,
  note,
}: {
  suit: SuitAccent;
  title: string;
  note?: string;
}) {
  const accent = CASH_ACCENT_META[suit];
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          style={{
            color: accent.colorVar,
            borderColor: accent.badgeBorder,
            background: accent.badgeBg,
          }}
        >
          {accent.glyph}
        </span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
          <span className="mr-2 hidden text-[color:var(--color-fg-dim)] sm:inline">
            {accent.glyph}
          </span>
          {title}
        </h3>
      </div>
      {note && (
        <p className="max-w-3xl text-[11.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {note}
        </p>
      )}
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
  const [draft, setDraft] = useState(() => formatNumFieldValue(value));
  const [editing, setEditing] = useState(false);

  const commitDraft = (raw: string) => {
    const next = commitNumFieldDraft(raw, value, min, max);
    onChange(next);
    setDraft(formatNumFieldValue(next));
  };

  return (
    <label
      className={`flex flex-col gap-1 ${disabled ? "opacity-75" : ""}`}
    >
      <span className="eyebrow text-[10px] text-[color:var(--color-fg-muted)]">
        {label}
      </span>
      <input
        type="number"
        value={editing ? draft : formatNumFieldValue(value)}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onFocus={(e) => {
          setEditing(true);
          setDraft(e.currentTarget.value);
        }}
        onChange={(e) => {
          const raw = normalizeNumericDraft(e.target.value);
          setDraft(raw);
          const parsed = parseNumFieldDraft(raw, min, max);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={(e) => {
          commitDraft(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(formatNumFieldValue(value));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className="h-10 rounded-sm border border-[color:var(--color-border)]/85 bg-[color:var(--color-bg)]/65 px-3 py-1.5 font-mono text-sm tabular-nums text-[color:var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:border-[color:var(--color-border)]/80 disabled:bg-[color:var(--color-bg)]/55 disabled:text-[color:var(--color-fg-dim)] disabled:opacity-100"
      />
      {hint && (
        <span className="text-[10px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}

function InputGroup({
  title,
  accent,
  toggle,
  children,
}: {
  title: string;
  accent?: SuitAccent;
  toggle?: ReactNode;
  children: ReactNode;
}) {
  const meta = accent ? CASH_ACCENT_META[accent] : null;
  return (
    <section
      className="flex flex-col gap-3 rounded-sm border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
      style={{
        borderColor: meta?.panelBorder ?? "color-mix(in oklab, var(--color-border), transparent 10%)",
        background:
          meta?.panelBg ??
          "linear-gradient(180deg, color-mix(in oklab, var(--color-bg), white 1%) 0%, color-mix(in oklab, var(--color-bg), black 2%) 100%)",
      }}
    >
      <header
        className="flex items-center justify-between gap-3 border-b pb-2.5"
        style={{
          borderColor: meta?.badgeBorder ?? "color-mix(in oklab, var(--color-border), transparent 10%)",
        }}
      >
        <h3
          className="inline-flex items-center rounded-sm border px-2.5 py-1 eyebrow text-[11px] tracking-[0.14em]"
          style={{
            borderColor: meta?.badgeBorder ?? "color-mix(in oklab, var(--color-border), transparent 10%)",
            background: meta?.badgeBg ?? "color-mix(in oklab, var(--color-bg), transparent 94%)",
            color: meta?.colorVar ?? "var(--color-fg-muted)",
          }}
        >
          {title}
        </h3>
        {toggle}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  tone = "diamond",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone?: SuitAccent;
}) {
  const meta = CASH_ACCENT_META[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-10 flex-none items-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors"
      style={{
        borderColor: checked
          ? meta.badgeBorder
          : "color-mix(in oklab, var(--color-border), transparent 10%)",
        background: checked
          ? meta.badgeBg
          : "color-mix(in oklab, var(--color-bg), white 4%)",
      }}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full shadow-sm transition-transform ${
          checked
            ? "translate-x-[18px]"
            : "translate-x-[3px] bg-[color:var(--color-fg-muted)]"
        }`}
        style={checked ? { background: meta.colorVar } : undefined}
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
    <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={row.label ?? ""}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={t("cash.stakes.row.label")}
          className="h-10 flex-1 rounded-sm border border-[color:var(--color-border)]/85 bg-[color:var(--color-bg)]/65 px-3 py-1.5 font-mono text-sm text-[color:var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-heart)] hover:text-[color:var(--color-heart)]"
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
          min={-MAX_ABS_WR_BB100}
          max={MAX_ABS_WR_BB100}
          onChange={(v) => onPatch({ wrBb100: v })}
        />
        <NumField
          label={t("cash.sdBb100.label")}
          value={row.sdBb100}
          step={5}
          min={1}
          max={MAX_SD_BB100}
          onChange={(v) => onPatch({ sdBb100: v })}
        />
        <NumField
          label={t("cash.stakes.row.bbSize")}
          value={row.bbSize}
          step={0.25}
          min={0.01}
          max={MAX_BB_SIZE}
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
          max={MAX_RAKE_CONTRIB_BB100}
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

type ValueTone = "pos" | "neg";

type StatRow = { label: string; value: string };
type HeroStat = {
  accent: SuitAccent;
  label: string;
  value: string;
  sub: string;
  tone?: ValueTone;
};
type SummaryStat = {
  accent: SuitAccent;
  label: string;
  value: string;
  tone?: ValueTone;
};

type SuitAccent = "spade" | "heart" | "diamond" | "club";

const CASH_ACCENT_META: Record<
  SuitAccent,
  {
    glyph: string;
    colorVar: string;
    chartStroke: string;
    chartFill: string;
    panelBorder: string;
    panelBg: string;
    badgeBg: string;
    badgeBorder: string;
  }
> = {
  spade: {
    glyph: "♠",
    colorVar: "var(--color-spade)",
    chartStroke: "#83b7ff",
    chartFill: "rgba(131,183,255,0.24)",
    panelBorder:
      "color-mix(in oklab, var(--color-rival), var(--color-border) 56%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-rival) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-rival), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-rival), var(--color-border) 42%)",
  },
  heart: {
    glyph: "♥",
    colorVar: "var(--color-heart)",
    chartStroke: "#ff9176",
    chartFill: "rgba(255,145,118,0.23)",
    panelBorder:
      "color-mix(in oklab, var(--color-heart), var(--color-border) 56%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-heart) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-heart), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-heart), var(--color-border) 42%)",
  },
  diamond: {
    glyph: "♦",
    colorVar: "var(--color-diamond)",
    chartStroke: "#f2cf45",
    chartFill: "rgba(242,207,69,0.24)",
    panelBorder:
      "color-mix(in oklab, var(--color-diamond), var(--color-border) 52%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-diamond) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-diamond), transparent 87%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-diamond), var(--color-border) 40%)",
  },
  club: {
    glyph: "♣",
    colorVar: "var(--color-club)",
    chartStroke: "#7ccd96",
    chartFill: "rgba(124,205,150,0.23)",
    panelBorder:
      "color-mix(in oklab, var(--color-club), var(--color-border) 54%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-club) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-club), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-club), var(--color-border) 42%)",
  },
};

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

function CashChartFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/42 px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:px-3">
      {children}
    </div>
  );
}

function HeroGrid({
  items,
}: {
  items: HeroStat[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <HeroCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function HeroCard({
  accent,
  label,
  value,
  sub,
  tone,
}: HeroStat) {
  const meta = CASH_ACCENT_META[accent];
  const toneClass =
    tone === "neg"
      ? "text-[color:var(--color-heart)]"
      : tone === "pos"
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div
      className="data-surface-card flex h-full flex-col gap-3 rounded-sm border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
      style={{
        borderColor: meta.panelBorder,
        background: meta.panelBg,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]"
          style={{
            color: meta.colorVar,
            borderColor: meta.badgeBorder,
            background: meta.badgeBg,
          }}
        >
          {meta.glyph}
        </span>
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {label}
        </span>
      </div>
      <div className={`font-mono text-[26px] font-semibold leading-none ${toneClass}`}>
        {value}
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {sub}
      </p>
    </div>
  );
}

function SummaryStrip({
  items,
}: {
  items: SummaryStat[];
}) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <SummaryPill key={item.label} {...item} />
      ))}
    </div>
  );
}

function SummaryPill({
  accent,
  label,
  value,
  tone,
}: SummaryStat) {
  const meta = CASH_ACCENT_META[accent];
  const toneClass =
    tone === "neg"
      ? "text-[color:var(--color-heart)]"
      : tone === "pos"
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5"
      style={{
        borderColor: meta.badgeBorder,
        background: meta.badgeBg,
      }}
    >
      <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
        {label}
      </span>
      <span className={`font-mono text-[13px] font-semibold tabular-nums ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

function DetailList({
  rows,
  accent,
}: {
  rows: StatRow[];
  accent: SuitAccent;
}) {
  const meta = CASH_ACCENT_META[accent];
  return (
    <div
      className="flex h-full flex-col gap-3 rounded-sm border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{
        borderColor: meta.panelBorder,
        background: meta.panelBg,
      }}
    >
      <dl className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)]/35 pb-2 last:border-b-0 last:pb-0"
          >
            <dt className="max-w-[58%] text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
              {r.label}
            </dt>
            <dd className="text-right font-mono text-[15px] font-semibold tabular-nums leading-none text-[color:var(--color-fg)]">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MixTag({
  accent,
  children,
}: {
  accent: SuitAccent;
  children: ReactNode;
}) {
  const meta = CASH_ACCENT_META[accent];
  return (
    <span
      className="rounded-sm border px-2 py-1 font-mono text-[10px] tabular-nums"
      style={{
        borderColor: meta.badgeBorder,
        background: meta.badgeBg,
        color: meta.colorVar,
      }}
    >
      {children}
    </span>
  );
}

function MixMetricBar({
  accent,
  label,
  share,
  detail,
}: {
  accent: SuitAccent;
  label: string;
  share: number;
  detail: string;
}) {
  const meta = CASH_ACCENT_META[accent];
  const clampedShare = Math.max(0, Math.min(share, 1));
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-[color:var(--color-border)]/65 bg-[color:var(--color-bg)]/55 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
          {detail}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--color-bg-elev-2)]/90">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${clampedShare * 100}%`,
            background: meta.chartStroke,
            boxShadow: `0 0 0 1px ${meta.badgeBorder} inset`,
          }}
        />
      </div>
    </div>
  );
}

function UnitToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active
                ? "bg-[color:var(--color-accent)]/18 text-[color:var(--color-accent)]"
                : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function convertCashMoney(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): number {
  return unit === "usd" ? valueBb * bbSize : valueBb;
}

function formatCashMoney(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): string {
  const value = convertCashMoney(valueBb, unit, bbSize);
  const abs = Math.abs(value);
  const digits = unit === "usd" ? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2) : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  if (unit === "usd") return `${value < 0 ? "-" : ""}$${formatted}`;
  return `${value < 0 ? "-" : ""}${formatted} BB`;
}

function formatUsdRate(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : ""}$${formatted}/h`;
}

function formatCashPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedBb100(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : "+"}${formatted}`;
}

function formatUnsignedBb100(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  return abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatUsdBbSize(value: number): string {
  const digits = value >= 10 ? 0 : value >= 1 ? 2 : 3;
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits >= 2 ? 2 : 0,
  });
  return `$${formatted} BB`;
}

function formatRiskThresholdBb(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `−${formatted} BB`;
}

function formatRiskThreshold(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): string {
  if (unit === "bb") return formatRiskThresholdBb(valueBb);
  const abs = Math.abs(valueBb * bbSize);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `−$${formatted}`;
}

function scaleMoneyHistogram(
  hist: { binEdges: number[]; counts: number[] },
  unit: CashMoneyUnit,
  bbSize: number,
): { binEdges: number[]; counts: number[] } {
  if (unit === "bb") return hist;
  return {
    binEdges: hist.binEdges.map((edge) => edge * bbSize),
    counts: hist.counts,
  };
}
