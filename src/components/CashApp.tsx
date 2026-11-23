"use client";

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Section, Card } from "@/components/ui/Section";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import { normalizeNumericDraft } from "@/lib/ui/numberDraft";
import { blurFocusedField, restoreFocusedField } from "@/lib/ui/blurFocusedField";
import { formatDuration, formatRoughDuration } from "@/lib/ui/durationFormat";
import { nextStorageNotice, type StorageNotice } from "@/lib/ui/storageNotice";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import {
  commitNumFieldDraft,
  formatNumFieldValue,
  parseNumFieldDraft,
  stepNumFieldValue,
} from "@/components/cashNumberField";
import {
  type CashInputDraft,
  DEFAULT_CASH_INPUT,
  MAX_ABS_WR_BB100,
  MAX_BB_SIZE,
  MAX_HANDS_PER_HOUR,
  MAX_RAKE_CONTRIB_BB100,
  MAX_RISK_THRESHOLD_BB,
  MAX_SD_BB100,
  MAX_TOTAL_SIM_HANDS,
  MAX_WR_STD_ERR_BB100,
  cashFieldMaxima,
  normalizeCashInputForUi,
  serializeCashInput,
} from "@/lib/sim/cashInput";
import type { CashInput, CashStakeRow } from "@/lib/sim/cashTypes";
import { checkCashInputSanity } from "@/lib/sim/cashSanity";
import {
  CASH_SCENARIOS,
  QUICK_STAKE_TEMPLATES,
  type QuickStakeTemplate,
} from "@/lib/cashScenarios";
import {
  CASH_USER_PRESETS_KEY,
  addCashUserPreset,
  buildCashShareUrl,
  loadCashFromUrlHash,
  loadCashUserPresets,
  removeCashUserPreset,
  saveCashUserPresets,
  type CashUserPreset,
} from "@/lib/cashPersistence";
import { CashResultsView } from "@/components/cash/CashResultsView";
import {
  CASH_ACCENT_META,
  type SuitAccent,
} from "@/components/cash/CashResultsShared";
import { useCashFormat } from "@/components/cash/cashFormat";
import { seedMixRows } from "@/components/cash/cashMixSeed";
import { cashRunErrorText } from "@/components/cash/cashRunState";
import { useCashSimulation } from "@/components/cash/useCashSimulation";
import { CashVolumePlanningPanel } from "@/components/cash/CashVolumePlanningPanel";
import { countOrDash } from "@/lib/results/formatters";

const STORAGE_KEY = "tvs:cash-input";

const stakeRowIds = new WeakMap<CashStakeRow, number>();
let nextStakeRowId = 1;

function getStakeRowKey(row: CashStakeRow): number {
  let id = stakeRowIds.get(row);
  if (id == null) {
    id = nextStakeRowId++;
    stakeRowIds.set(row, id);
  }
  return id;
}

function carryStakeRowKey(oldRow: CashStakeRow, updated: CashStakeRow): void {
  const prevId = stakeRowIds.get(oldRow);
  if (prevId != null) stakeRowIds.set(updated, prevId);
}

function drawFreshCashSeed(): number {
  return (
    (((Math.random() * 0xffffffff) >>> 0) ^
      ((Date.now() & 0xffffffff) >>> 0)) >>>
    0
  );
}

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

function saveInputToStorage(next: CashInput): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeCashInput(next)));
    return true;
  } catch {
    return false;
  }
}

export const CashApp = memo(function CashApp({
  active = true,
}: {
  active?: boolean;
}) {
  const { locale, t } = useLocale();
  const fmt = useCashFormat();
  const [storageNotice, setStorageNotice] = useState<StorageNotice>("ok");
  const saveInput = useCallback((next: CashInput) => {
    const ok = saveInputToStorage(next);
    setStorageNotice((prev) => nextStorageNotice(prev, ok));
  }, []);

  const [input, setInput] = useLocalStorageState<CashInput>(
    STORAGE_KEY,
    loadInput,
    saveInput,
    DEFAULT_CASH_INPUT,
  );
  const [userPresets, setUserPresets] = useLocalStorageState<CashUserPreset[]>(
    CASH_USER_PRESETS_KEY,
    loadCashUserPresets,
    (next) => {
      const ok = saveCashUserPresets(next);
      setStorageNotice((prev) => nextStorageNotice(prev, ok));
    },
    [],
  );

  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [shareLinkInvalid, setShareLinkInvalid] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const hashConsumedRef = useRef(false);
  const savedStakesRef = useRef<CashStakeRow[] | null>(null);

  const {
    status,
    running,
    progress,
    stage,
    result,
    resultInput,
    elapsedMs,
    error,
    estimateMs,
    run,
    cancel,
  } = useCashSimulation();

  // Consume `#c=` cash share link once on mount.
  useEffect(() => {
    if (hashConsumedRef.current) return;
    hashConsumedRef.current = true;
    const share = loadCashFromUrlHash();
    if (share.kind !== "none") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    if (share.kind === "invalid") {
      startTransition(() => setShareLinkInvalid(true));
    } else if (share.kind === "state") {
      setInput(share.state);
      startTransition(() => setActiveScenarioId(null));
    }
  }, [setInput]);

  // Settled-state Run: blur the focused field first, then fire the run after
  // React has rendered any pending draft commit (mirrors MTT `page.tsx`).
  const fieldBeforeRunRef = useRef<HTMLElement | null>(null);
  const [runRequest, setRunRequest] = useState(0);
  const handledRunRequestRef = useRef(0);

  const returnFocusToField = useCallback(() => {
    const field = fieldBeforeRunRef.current;
    fieldBeforeRunRef.current = null;
    restoreFocusedField(document, field);
  }, []);

  const requestRun = useCallback(() => {
    if (running) return;
    fieldBeforeRunRef.current = blurFocusedField(document);
    startTransition(() => setRunRequest((n) => n + 1));
  }, [running]);

  useEffect(() => {
    if (!running) returnFocusToField();
  }, [running, returnFocusToField]);

  useEffect(() => {
    if (runRequest === 0 || handledRunRequestRef.current === runRequest) return;
    handledRunRequestRef.current = runRequest;
    if (running) {
      returnFocusToField();
      return;
    }
    const normalized = run(input);
    setInput(normalized);
  }, [runRequest, running, input, run, setInput, returnFocusToField]);

  // Cmd/Ctrl+Enter keyboard shortcut when Cash mode is active.
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        requestRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, requestRun]);

  const patch = (p: Partial<CashInput>) => {
    setActiveScenarioId(null);
    setInput((prev) => ({ ...prev, ...p }));
  };
  const patchRake = (p: Partial<CashInput["rake"]>) => {
    setActiveScenarioId(null);
    setInput((prev) => ({ ...prev, rake: { ...prev.rake, ...p } }));
  };
  const patchRisk = (p: Partial<NonNullable<CashInput["riskBlock"]>>) => {
    setActiveScenarioId(null);
    setInput((prev) => ({
      ...prev,
      riskBlock: { thresholdBb: prev.riskBlock?.thresholdBb ?? 100, ...p },
    }));
  };

  const mixEnabled = !!input.stakes && input.stakes.length > 0;
  const stakes = input.stakes ?? [];
  const { maxHands: maxHandsForSimulations, maxSimulations: maxSimulationsForHands } =
    cashFieldMaxima(input.hands, input.nSimulations);
  const countFormat = numberLocaleTag(locale);
  const budgetText = (n: number) => n.toLocaleString(countFormat);
  const stakeShareSum = stakes.reduce((acc, row) => acc + row.handShare, 0);
  const stakeShareLabel = stakeShareSum.toFixed(2);
  const mixSharesNeedRenorm =
    mixEnabled && Math.abs(stakeShareSum - 1) > 1e-9;

  const patchStake = (idx: number, p: Partial<CashStakeRow>) => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const oldRow = cur[idx];
      if (!oldRow) return prev;
      const updated = { ...oldRow, ...p };
      carryStakeRowKey(oldRow, updated);
      const next = cur.map((r, i) => (i === idx ? updated : r));
      return { ...prev, stakes: next };
    });
  };
  const patchStakeRake = (
    idx: number,
    p: Partial<CashStakeRow["rake"]>,
  ) => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const oldRow = cur[idx];
      if (!oldRow) return prev;
      const updated = { ...oldRow, rake: { ...oldRow.rake, ...p } };
      carryStakeRowKey(oldRow, updated);
      const next = cur.map((r, i) => (i === idx ? updated : r));
      return { ...prev, stakes: next };
    });
  };
  const addStake = () => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const seed: CashStakeRow =
        cur[cur.length - 1] ?? {
          wrBb100: prev.wrBb100,
          sdBb100: prev.sdBb100,
          bbSize: prev.bbSize,
          handShare: 0.5,
          rake: { ...prev.rake },
        };
      return {
        ...prev,
        stakes: [...cur, { ...seed, rake: { ...seed.rake } }],
      };
    });
  };
  const addQuickStake = (tpl: QuickStakeTemplate) => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const nextRow: CashStakeRow = {
        label: tpl.label,
        wrBb100: tpl.wrBb100,
        sdBb100: tpl.sdBb100,
        bbSize: tpl.bbSize,
        handShare: cur.length === 0 ? 1 : Number((1 / (cur.length + 1)).toFixed(2)),
        rake: {
          enabled: true,
          contributedRakeBb100: tpl.contributedRakeBb100,
          advertisedRbPct: tpl.advertisedRbPct,
          pvi: tpl.pvi,
        },
      };
      return { ...prev, stakes: [...cur, nextRow] };
    });
  };
  const duplicateStake = (idx: number) => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const src = cur[idx];
      if (!src) return prev;
      const copy: CashStakeRow = { ...src, rake: { ...src.rake } };
      const next = [...cur.slice(0, idx + 1), copy, ...cur.slice(idx + 1)];
      return { ...prev, stakes: next };
    });
  };
  const removeStake = (idx: number) => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      const next = cur.filter((_, i) => i !== idx);
      return { ...prev, stakes: next.length > 0 ? next : undefined };
    });
  };
  const normalizeStakeShares = () => {
    setActiveScenarioId(null);
    setInput((prev) => {
      const cur = prev.stakes ?? [];
      if (cur.length === 0) return prev;
      const sum = cur.reduce((a, r) => a + Math.max(0, r.handShare), 0);
      const next = cur.map((r, i) => {
        const rawShare = sum > 0 ? Math.max(0, r.handShare) / sum : 1 / cur.length;
        const share =
          i === cur.length - 1
            ? Math.max(
                0,
                Number(
                  (
                    1 -
                    cur
                      .slice(0, -1)
                      .reduce(
                        (a, row) =>
                          a +
                          Number(
                            (sum > 0
                              ? Math.max(0, row.handShare) / sum
                              : 1 / cur.length
                            ).toFixed(2),
                          ),
                        0,
                      )
                  ).toFixed(2),
                ),
              )
            : Number(rawShare.toFixed(2));
        const updated = { ...r, handShare: share };
        carryStakeRowKey(r, updated);
        return updated;
      });
      return { ...prev, stakes: next };
    });
  };
  const enableMix = (on: boolean) => {
    setActiveScenarioId(null);
    if (on && !mixEnabled) {
      const restored = savedStakesRef.current;
      setInput((prev) => ({
        ...prev,
        stakes: restored && restored.length > 0 ? restored : seedMixRows(prev, t),
      }));
    } else if (!on && mixEnabled) {
      savedStakesRef.current = stakes;
      setInput((prev) => ({ ...prev, stakes: undefined }));
    }
  };

  const applyScenario = (scenarioId: string) => {
    const found = CASH_SCENARIOS.find((s) => s.id === scenarioId);
    if (!found) return;
    setActiveScenarioId(found.id);
    setInput({
      ...found.input,
      baseSeed: drawFreshCashSeed(),
    });
  };

  const resetInputs = () => {
    setActiveScenarioId(null);
    savedStakesRef.current = null;
    setInput({ ...DEFAULT_CASH_INPUT, baseSeed: drawFreshCashSeed() });
  };

  const handleSavePreset = () => {
    blurFocusedField(document);
    const name = window.prompt(t("cash.presets.prompt"));
    if (!name || !name.trim()) return;
    setUserPresets((prev) => addCashUserPreset(prev, name, input));
  };

  const handleCopyShareLink = async (targetInput: CashInput, key: string) => {
    try {
      const url = buildCashShareUrl(targetInput);
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1800);
    } catch {
      // Clipboard unavailable — ignore silently.
    }
  };

  const sanityFindings = useMemo(() => checkCashInputSanity(input), [input]);
  const etaMs = estimateMs(input.hands, input.nSimulations);

  const inputsChangedSinceResult = useMemo(() => {
    if (!resultInput) return false;
    return (
      JSON.stringify(serializeCashInput(input)) !==
      JSON.stringify(serializeCashInput(resultInput))
    );
  }, [input, resultInput]);

  const stageLabel =
    stage === "building"
      ? t("cash.stage.building")
      : t("cash.stage.simulating");

  return (
    <div className="flex flex-col gap-6">
      {shareLinkInvalid && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-[color:var(--c-warn-fg)]">
          <span>{t("cash.share.invalid")}</span>
          <button
            type="button"
            onClick={() => setShareLinkInvalid(false)}
            className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80"
          >
            {t("notice.dismiss")}
          </button>
        </div>
      )}

      {storageNotice === "failed" && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-[color:var(--c-warn-fg)]">
          <span>{t("notice.storageFailed")}</span>
          <button
            type="button"
            onClick={() => setStorageNotice("dismissed")}
            className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80"
          >
            {t("notice.dismiss")}
          </button>
        </div>
      )}

      <Section number="01" suit="spade" title={t("cash.section.inputs.title")}>
        <Card className="data-surface-card flex flex-col gap-5 p-5 sm:p-6">
          {/* Scenario strip & user presets */}
          <div className="flex flex-col gap-2.5 border-b border-[color:var(--color-border)]/70 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
                {t("cash.scenarios.label")}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {CASH_SCENARIOS.map((sc) => {
                  const isActive = activeScenarioId === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      disabled={running}
                      title={t(sc.descKey)}
                      onClick={() => applyScenario(sc.id)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 " +
                        (isActive
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/16 text-[color:var(--color-accent)]"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)]/60 hover:text-[color:var(--color-fg)]")
                      }
                    >
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider opacity-80">
                        {sc.badge}
                      </span>
                      <span>{t(sc.nameKey)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => handleCopyShareLink(input, "header-share")}
                  className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:opacity-50"
                >
                  {copiedKey === "header-share"
                    ? t("cash.share.copied")
                    : t("cash.share.copy")}
                </button>
                <button
                  type="button"
                  disabled={running}
                  onClick={resetInputs}
                  className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-heart)] hover:text-[color:var(--color-heart)] disabled:opacity-50"
                >
                  {t("cash.scenarios.reset")}
                </button>
              </div>
            </div>

            <details className="group pt-1">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-accent)]">
                <span className="inline-block transition-transform group-open:rotate-90">
                  ▸
                </span>
                <span className="eyebrow text-[10px] tracking-[0.14em]">
                  {t("cash.presets.label")}
                </span>
                {userPresets.length > 0 && (
                  <span className="font-mono text-[10px] tabular-nums">
                    ({userPresets.length})
                  </span>
                )}
              </summary>
              <div className="mt-2.5 flex flex-col gap-2 rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={running}
                    onClick={handleSavePreset}
                    className="rounded-sm border border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/20 disabled:opacity-50"
                  >
                    {t("cash.presets.save")}
                  </button>
                </div>
                {userPresets.length === 0 ? (
                  <p className="text-[11px] text-[color:var(--color-fg-muted)]">
                    {t("cash.presets.empty")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {userPresets.map((preset) => (
                      <div
                        key={preset.id}
                        className="inline-flex items-center gap-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 px-2 py-1 text-[11px]"
                      >
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => {
                            setActiveScenarioId(null);
                            setInput(preset.input);
                          }}
                          className="font-medium text-[color:var(--color-fg)] hover:text-[color:var(--color-accent)] disabled:opacity-50"
                        >
                          {preset.name}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyShareLink(preset.input, `preset-${preset.id}`)
                          }
                          title={t("cash.share.copy")}
                          className="px-1 text-[10px] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-accent)]"
                        >
                          {copiedKey === `preset-${preset.id}` ? "✓" : "↗"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setUserPresets((prev) =>
                              removeCashUserPreset(prev, preset.id),
                            )
                          }
                          aria-label={`${t("cash.presets.delete")}: ${preset.name}`}
                          className="px-1 text-[10px] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-heart)]"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>

          <fieldset disabled={running} className="flex min-w-0 flex-col gap-5 border-0 p-0">
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
                  hint={t("cash.hands.budgetHint")
                    .replace("{max}", budgetText(maxHandsForSimulations))
                    .replace("{sims}", budgetText(input.nSimulations))
                    .replace("{total}", budgetText(MAX_TOTAL_SIM_HANDS))}
                  onChange={(v) => patch({ hands: Math.floor(v) })}
                />
                <NumField
                  label={t("cash.nSimulations.label")}
                  value={input.nSimulations}
                  step={500}
                  min={100}
                  max={maxSimulationsForHands}
                  hint={t("cash.nSimulations.budgetHint")
                    .replace("{max}", budgetText(maxSimulationsForHands))
                    .replace("{hands}", budgetText(input.hands))
                    .replace("{total}", budgetText(MAX_TOTAL_SIM_HANDS))}
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
                  label={t("cash.wrStdErr.label")}
                  value={input.wrStdErr ?? 0}
                  step={0.5}
                  min={0}
                  max={MAX_WR_STD_ERR_BB100}
                  hint={t("cash.wrStdErr.hint")}
                  onChange={(v) =>
                    patch({ wrStdErr: v > 0 ? v : undefined })
                  }
                />
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <NumField
                      label={t("cash.baseSeed.label")}
                      value={input.baseSeed}
                      step={1}
                      onChange={(v) => patch({ baseSeed: Math.floor(v) })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => patch({ baseSeed: drawFreshCashSeed() })}
                    title={t("cash.seed.new")}
                    className="h-10 shrink-0 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/65 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                  >
                    ↻
                  </button>
                </div>
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
                      label={t("cash.group.hourly")}
                      tone="club"
                      onChange={(checked) =>
                        setInput((prev) => ({
                          ...prev,
                          hoursBlock: checked
                            ? { handsPerHour: prev.hoursBlock?.handsPerHour ?? 500 }
                            : undefined,
                        }))
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
                          setInput((prev) => ({
                            ...prev,
                            hoursBlock: { handsPerHour: Math.floor(v) },
                          }))
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
                      step={50}
                      min={10}
                      max={MAX_RISK_THRESHOLD_BB}
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
                  label={t("cash.group.stakes")}
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
                      key={getStakeRowKey(row)}
                      row={row}
                      canRemove={stakes.length > 1}
                      onPatch={(p) => patchStake(idx, p)}
                      onPatchRake={(p) => patchStakeRake(idx, p)}
                      onDuplicate={() => duplicateStake(idx)}
                      onRemove={() => removeStake(idx)}
                      t={t}
                    />
                  ))}
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 text-[11px] leading-relaxed ${
                      mixSharesNeedRenorm
                        ? "border-[color:var(--color-heart)]/45 bg-[color:var(--color-heart)]/10 text-[color:var(--color-fg-muted)]"
                        : "border-[color:var(--color-club)]/45 bg-[color:var(--color-club)]/10 text-[color:var(--color-fg-muted)]"
                    }`}
                  >
                    <span>
                      {mixSharesNeedRenorm
                        ? t("cash.stakes.share.renorm").replace(
                            "{sum}",
                            stakeShareLabel,
                          )
                        : t("cash.stakes.share.ok").replace(
                            "{sum}",
                            stakeShareLabel,
                          )}
                    </span>
                    {mixSharesNeedRenorm && (
                      <button
                        type="button"
                        onClick={normalizeStakeShares}
                        className="rounded-sm border border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/20"
                      >
                        {t("cash.stakes.normalize")}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={addStake}
                      className="rounded-sm border border-[color:var(--color-diamond)]/50 bg-[color:var(--color-diamond)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-diamond)] transition-colors hover:bg-[color:var(--color-diamond)]/16 hover:text-[color:var(--color-fg)]"
                    >
                      {t("cash.stakes.add")}
                    </button>
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                      {t("cash.stakes.quickAdd")}
                    </span>
                    {QUICK_STAKE_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => addQuickStake(tpl)}
                        className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2 py-1 font-mono text-[10px] font-semibold text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
                      >
                        +{tpl.label}
                      </button>
                    ))}
                  </div>
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
                    label={t("cash.group.rake")}
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
          </fieldset>

          {/* Soft sanity notices (never block Run) */}
          {sanityFindings.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {sanityFindings.map((finding) => {
                const isWarn = finding.severity === "warn";
                return (
                  <p
                    key={finding.code}
                    className={
                      "rounded-sm border px-3 py-2 text-[11px] leading-relaxed " +
                      (isWarn
                        ? "border-amber-500/35 bg-amber-500/10 text-[color:var(--c-warn-fg)]"
                        : "border-sky-500/35 bg-sky-500/10 text-[color:var(--c-info-fg)]")
                    }
                  >
                    {t(`cash.sanity.${finding.code}`)}
                  </p>
                );
              })}
            </div>
          )}

          {/* Run bar — matches MTT primary-run-button + live progress/stage + done strip */}
          <div className="flex flex-col gap-3 border-t border-[color:var(--color-border)]/70 pt-4">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
              {running && (
                <div className="flex flex-1 items-center gap-3 rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/36 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-[color:var(--color-fg-muted)]">
                      <span role="status">{stageLabel}</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(progress * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-[color:var(--color-bg-elev-2)]/90">
                      <div
                        className="h-full bg-[color:var(--color-accent)] transition-[width] duration-100"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-heart)] hover:text-[color:var(--color-heart)]"
                  >
                    {t("cash.stop")}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={requestRun}
                disabled={running}
                className="primary-run-button inline-flex items-center justify-center gap-2.5 rounded-md px-5 py-2.5 text-sm font-bold uppercase tracking-[0.1em] transition-all disabled:opacity-50"
              >
                <span>{running ? t("cash.running") : t("cash.run")}</span>
                {!running && etaMs != null && (
                  <span className="rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold normal-case tracking-normal">
                    {formatRoughDuration(etaMs, locale)}
                  </span>
                )}
                {!running && etaMs == null && (
                  <span className="hidden rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal sm:inline">
                    {t("cash.shortcutHint")}
                  </span>
                )}
              </button>
            </div>

            {status === "done" && result && elapsedMs != null && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11px] text-[color:var(--c-ok-fg)]">
                <span>
                  {t("cash.done.summary")
                    .replace("{ms}", formatDuration(elapsedMs, locale))
                    .replace("{sims}", result.samples.toLocaleString(countFormat))
                    .replace(
                      "{hands}",
                      countOrDash(
                        result.echoInput.hands,
                        t("cash.handCount"),
                        locale,
                        "hand",
                        countFormat,
                      ),
                    )
                    .replace("{ev}", fmt.bb(result.stats.expectedEvBb))
                    .replace("{up}", fmt.pct(result.stats.probProfit))}
                </span>
                {inputsChangedSinceResult && (
                  <span className="font-semibold text-[color:var(--c-warn-fg)]">
                    {t("cash.staleNotice")}
                  </span>
                )}
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* Pre-run closed-form Sample-size & Prove-Edge planner (mirrors MTT VolumePlanningPanel) */}
      <CashVolumePlanningPanel input={input} />

      <Section
        number="02"
        suit="heart"
        title={t("cash.section.results.title")}
      >
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--c-err-fg)]"
          >
            {cashRunErrorText(error, t)}
          </div>
        )}
        {!result && (
          <Card className="data-surface-card border-dashed p-5">
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--color-fg-muted)]">
              {t("cash.empty")}
            </p>
          </Card>
        )}
        {result && (
          <CashResultsView
            result={result}
            stale={inputsChangedSinceResult}
          />
        )}
      </Section>
    </div>
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

export function NumField({
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
  const focusValueRef = useRef(value);
  const cancelledRef = useRef(false);

  const commitDraft = (raw: string) => {
    const next = commitNumFieldDraft(raw, value, min, max);
    onChange(next);
    setDraft(formatNumFieldValue(next));
  };

  const draftInvalid =
    editing && draft.trim() !== "" && parseNumFieldDraft(draft, min, max) === null;

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
        aria-invalid={draftInvalid || undefined}
        onFocus={(e) => {
          focusValueRef.current = value;
          cancelledRef.current = false;
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
          if (!cancelledRef.current) commitDraft(e.target.value);
          cancelledRef.current = false;
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (
            (e.key === "ArrowUp" || e.key === "ArrowDown") &&
            !disabled
          ) {
            // The native step grid starts at `min`, so 1 + 0.25 would land on 1.01.
            e.preventDefault();
            const typed = parseFloat(e.currentTarget.value);
            const next = stepNumFieldValue(
              Number.isFinite(typed) ? typed : value,
              e.key === "ArrowUp" ? 1 : -1,
              step,
              min,
              max,
            );
            setDraft(formatNumFieldValue(next));
            onChange(next);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            onChange(focusValueRef.current);
            setDraft(formatNumFieldValue(focusValueRef.current));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className={`h-10 rounded-sm border bg-[color:var(--color-bg)]/65 px-3 py-1.5 font-mono text-sm tabular-nums text-[color:var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors focus:outline-none disabled:cursor-not-allowed disabled:border-[color:var(--color-border)]/80 disabled:bg-[color:var(--color-bg)]/55 disabled:text-[color:var(--color-fg-dim)] disabled:opacity-100 ${
          draftInvalid
            ? "border-[color:var(--color-danger)] focus:border-[color:var(--color-danger)]"
            : "border-[color:var(--color-border)]/85 hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
        }`}
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
  label,
  onChange,
  tone = "diamond",
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  tone?: SuitAccent;
}) {
  const meta = CASH_ACCENT_META[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-10 flex-none items-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors"
      style={{
        borderColor: checked
          ? meta.badgeBorder
          : "color-mix(in oklab, var(--color-border-strong), transparent 15%)",
        background: checked
          ? meta.badgeBg
          : "var(--color-bg-elev-2)",
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
  onDuplicate,
  onRemove,
  t,
}: {
  row: CashStakeRow;
  canRemove: boolean;
  onPatch: (p: Partial<CashStakeRow>) => void;
  onPatchRake: (p: Partial<CashStakeRow["rake"]>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={row.label ?? ""}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={t("cash.stakes.row.label")}
          aria-label={t("cash.stakes.row.label")}
          className="h-10 min-w-[140px] flex-1 rounded-sm border border-[color:var(--color-border)]/85 bg-[color:var(--color-bg)]/65 px-3 py-1.5 font-mono text-sm text-[color:var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          {t("cash.stakes.duplicate")}
        </button>
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
          label={
            row.label
              ? `${row.label}: ${t("cash.rake.enabled.label")}`
              : t("cash.rake.enabled.label")
          }
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
