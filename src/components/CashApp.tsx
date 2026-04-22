"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Section, Card } from "@/components/ui/Section";
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
import { CashResultsView } from "@/components/cash/CashResultsView";
import {
  CASH_ACCENT_META,
  type SuitAccent,
} from "@/components/cash/CashResultsShared";

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
