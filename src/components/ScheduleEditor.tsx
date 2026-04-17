"use client";

import { useRef, useState } from "react";
import type {
  FieldVariability,
  PayoutStructureId,
  TournamentRow,
} from "@/lib/sim/types";
import { parsePayoutString } from "@/lib/sim/payouts";
import {
  inferGameType,
} from "@/lib/sim/gameType";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";

// Parse "50+5", "50 + 5", "55", "$50+$5" → { buyIn: 50, rake: 0.1 }.
// Plain single number is treated as net buy-in (prize-pool portion); the
// caller keeps the existing rake in that case by passing `currentRake`.
function parseBuyIn(
  raw: string,
  currentRake: number,
): { buyIn: number; rake: number } | null {
  const cleaned = raw.replace(/[$\s,]/g, "");
  if (cleaned === "") return null;
  const plus = cleaned.match(/^([\d.]+)\+([\d.]+)$/);
  if (plus) {
    const net = parseFloat(plus[1]);
    const fee = parseFloat(plus[2]);
    if (!isFinite(net) || !isFinite(fee) || net <= 0) return null;
    return { buyIn: net, rake: fee / net };
  }
  const single = parseFloat(cleaned);
  if (!isFinite(single) || single <= 0) return null;
  return { buyIn: single, rake: currentRake };
}

function formatBuyIn(buyIn: number, rake: number): string {
  const fee = buyIn * rake;
  if (fee < 0.005) return buyIn.toString();
  return `${round2(buyIn)}+${round2(fee)}`;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Short labels for the dropdown row (≤ ~22 chars), full descriptions in title.
// `real` entries are calibrated to specific real-world 2026 payout samples
// captured in `data/payout-samples/`. They live in a pinned optgroup above
// the generic presets so users who want authentic structures find them first.
const STRUCTURES: {
  id: PayoutStructureId;
  short: string;
  full: string;
  real?: boolean;
}[] = [
  {
    id: "mtt-pokerstars",
    short: "PokerStars SCOOP (2026)",
    full: "PokerStars SCOOP 119-L Main · calibrated to 2026-03-25 sample",
    real: true,
  },
  {
    id: "mtt-sunday-million",
    short: "Sunday Million (2026)",
    full: "PokerStars Sunday Million · real 2026 curve",
    real: true,
  },
  {
    id: "mtt-gg",
    short: "CoinPoker Mini CoinMasters (2026)",
    full: "CoinPoker Mini CoinMasters · calibrated to 2026-04-14 sample",
    real: true,
  },
  {
    id: "mtt-gg-bounty",
    short: "CoinPoker Mini CoinHunter PKO (2026)",
    full: "CoinPoker Mini CoinHunter PKO · calibrated to 2026-04-14 sample",
    real: true,
  },
  { id: "mtt-primedope", short: "PrimeDope payouts", full: "PrimeDope native payout curves (15% paid)" },
  { id: "mtt-standard", short: "MTT Standard 15%", full: "MTT · Standard (15% paid)" },
  { id: "mtt-flat", short: "MTT Flat 20%", full: "MTT · Flat (20% paid)" },
  { id: "mtt-top-heavy", short: "MTT Top-heavy 12%", full: "MTT · Top-heavy (12% paid)" },
  { id: "satellite-ticket", short: "Satellite (tickets)", full: "Satellite · ticket cliff (10% seats)" },
  { id: "sng-50-30-20", short: "SNG 50/30/20", full: "SNG · 50/30/20" },
  { id: "sng-65-35", short: "SNG 65/35", full: "SNG · 65/35" },
  { id: "winner-takes-all", short: "Winner takes all", full: "Winner takes all" },
  { id: "custom", short: "Custom %", full: "Custom (paste %)" },
];

interface Props {
  schedule: TournamentRow[];
  onChange: (next: TournamentRow[]) => void;
  disabled?: boolean;
  /** When set, rows with no explicit itmRate inherit this default (shown
   *  as the placeholder on the per-row input). Pass null to disable. */
  globalItmPct?: number | null;
  /** Optional extras rendered in the toolbar row (right of Add / Import). */
  toolbarExtras?: React.ReactNode;
}

const IMPORT_PLACEHOLDER = `# label, players, buyIn (50+5 or plain), roi%, count, payout
Bread & butter, 500, 50+5, 20, 1, mtt-standard
Sunday major, 1500, 200+15, 10, 1, mtt-pokerstars
Hyper turbo, 200, 20+2, 15, 3, sng-50-30-20`;

// Per-structure viable field-size ranges. A PayoutStructureId is "allowed" at
// a given AFS only inside this window. The values reflect what those structures
// actually describe on real sites, not what won't crash the math:
//   - SNG 50/30/20 is a 3-payout single-table affair; meaningless past ~18 seats
//   - SNG 65/35 is heads-up only
//   - Winner-takes-all is HU / small-turbo territory
//   - Sunday Million / GG Bounty Builder describe fields thousands deep
//   - Standard MTT curves need ≥30 runners for the 15 / 20 % paid slice to
//     have more than a handful of places.
type CompatRange = { min: number; max: number };
const PAYOUT_COMPAT: Record<PayoutStructureId, CompatRange> = {
  "mtt-standard": { min: 30, max: Infinity },
  "mtt-primedope": { min: 30, max: Infinity },
  "mtt-flat": { min: 30, max: Infinity },
  "mtt-top-heavy": { min: 30, max: Infinity },
  "mtt-pokerstars": { min: 50, max: Infinity },
  "mtt-gg": { min: 50, max: Infinity },
  "mtt-sunday-million": { min: 2000, max: Infinity },
  "mtt-gg-bounty": { min: 500, max: Infinity },
  "satellite-ticket": { min: 10, max: Infinity },
  "sng-50-30-20": { min: 3, max: 18 },
  "sng-65-35": { min: 2, max: 2 },
  "winner-takes-all": { min: 2, max: 20 },
  custom: { min: 2, max: Infinity },
};

function payoutCompat(
  id: PayoutStructureId,
  players: number,
): { ok: true } | { ok: false; reason: "tooFew" | "tooMany"; range: CompatRange } {
  const range = PAYOUT_COMPAT[id];
  if (!range) return { ok: true };
  if (players < range.min) return { ok: false, reason: "tooFew", range };
  if (players > range.max) return { ok: false, reason: "tooMany", range };
  return { ok: true };
}

const PAYOUT_IDS: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-flat",
  "mtt-top-heavy",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "mtt-gg-bounty",
  "satellite-ticket",
  "sng-50-30-20",
  "sng-65-35",
  "winner-takes-all",
  "custom",
];

function parseImportCSV(raw: string): {
  rows: TournamentRow[];
  errors: string[];
} {
  const rows: TournamentRow[] = [];
  const errors: string[] = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, i) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) return;
    const cells = stripped.split(/\s*,\s*/);
    if (cells.length < 3) {
      errors.push(`line ${i + 1}: need at least label, players, buyIn`);
      return;
    }
    const [label, playersStr, buyInStr, roiStr, countStr, payoutStr] = cells;
    const players = parseInt(playersStr, 10);
    if (!isFinite(players) || players < 2) {
      errors.push(`line ${i + 1}: players must be ≥ 2`);
      return;
    }
    const parsed = parseBuyIn(buyInStr ?? "", 0.1);
    if (!parsed) {
      errors.push(`line ${i + 1}: bad buy-in "${buyInStr}"`);
      return;
    }
    const roiPct = roiStr ? parseFloat(roiStr) : 0;
    const count = countStr ? Math.max(1, Math.floor(parseFloat(countStr))) : 1;
    const payout = (
      payoutStr && PAYOUT_IDS.includes(payoutStr as PayoutStructureId)
        ? payoutStr
        : "mtt-standard"
    ) as PayoutStructureId;
    rows.push({
      id: crypto.randomUUID(),
      label: label || `Imported ${rows.length + 1}`,
      players,
      buyIn: parsed.buyIn,
      rake: parsed.rake,
      roi: isFinite(roiPct) ? roiPct / 100 : 0,
      payoutStructure: payout,
      count,
    });
  });
  return { rows, errors };
}

export function ScheduleEditor({
  schedule,
  onChange,
  disabled,
  globalItmPct = null,
  toolbarExtras,
}: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const applyImport = (text: string, mode: "append" | "replace") => {
    const { rows, errors } = parseImportCSV(text);
    setImportErrors(errors);
    if (rows.length === 0) return;
    onChange(mode === "replace" ? rows : [...schedule, ...rows]);
    setImportText("");
    setImportOpen(false);
  };

  const update = (id: string, patch: Partial<TournamentRow>) => {
    onChange(schedule.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => {
    onChange(schedule.filter((r) => r.id !== id));
  };
  const duplicate = (id: string) => {
    const row = schedule.find((r) => r.id === id);
    if (!row) return;
    const copy = { ...row, id: crypto.randomUUID() };
    const idx = schedule.findIndex((r) => r.id === id);
    const next = [...schedule];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };
  const cloneAsReentry = (id: string) => {
    // A late re-entry is just another entry with lower skill edge (player
    // arrives short / plays a bigger field). Clone the row, drop ROI by
    // 5pp, and tag the label. User can tune further if needed.
    const row = schedule.find((r) => r.id === id);
    if (!row) return;
    const baseLabel = row.label || "";
    const copy = {
      ...row,
      id: crypto.randomUUID(),
      roi: row.roi - 0.05,
      label: baseLabel ? `${baseLabel} (re-entry)` : "(re-entry)",
    };
    const idx = schedule.findIndex((r) => r.id === id);
    const next = [...schedule];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };
  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const add = () => {
    onChange([
      ...schedule,
      {
        id: crypto.randomUUID(),
        label: "",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        payoutStructure: "mtt-standard",
        count: 1,
      },
    ]);
  };

  return (
    <Card>
      <fieldset
        disabled={disabled}
        className="contents disabled:opacity-60 [&:disabled_*]:cursor-not-allowed"
      >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/60 text-left text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <Th> </Th>
              <Th hint={t("help.row.label")}>{t("row.label")}</Th>
              <Th align="right" hint={t("help.row.players")}>{t("row.players")}</Th>
              <Th align="right" hint={t("help.row.buyIn")}>{t("row.buyIn")}</Th>
              <Th align="right" hint={t("help.row.roi")}>{t("row.roi")}</Th>
              <Th align="right" hint={t("row.fixedItmHint")}>{t("row.fixedItm")}</Th>
              <Th hint={t("help.row.payouts")}>{t("row.payouts")}</Th>
              <Th align="right" hint={t("help.row.count")}>{t("row.count")}</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((r, i) => {
              const isOpen = advanced && expanded.has(r.id);
              const hasAdv =
                (r.fieldVariability && r.fieldVariability.kind !== "fixed") ||
                r.payoutStructure === "custom" ||
                (r.maxEntries ?? 1) > 1 ||
                (r.bountyFraction ?? 0) > 0 ||
                !!r.icmFinalTable;
              return (
                <RowGroup key={r.id}>
                  <tr
                    className={
                      "group border-b border-[color:var(--color-border)]/60 transition-colors hover:bg-[color:var(--color-fg)]/[0.03] " +
                      (i % 2 === 1 ? "bg-[color:var(--color-fg)]/[0.02]" : "")
                    }
                  >
                    <Td>
                      <button
                        type="button"
                        onClick={() => advanced && toggleExpand(r.id)}
                        disabled={!advanced}
                        title={advanced ? t("row.advanced") : t("controls.expandAdvanced")}
                        aria-label={t("row.advanced")}
                        className={
                          "inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)] " +
                          (isOpen ? "text-[color:var(--color-accent)]" : "")
                        }
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          style={{
                            transform: isOpen ? "rotate(90deg)" : "none",
                            transition: "transform 0.15s",
                          }}
                        >
                          <path
                            d="M9 6l6 6-6 6"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {hasAdv && !isOpen && (
                          <span className="ml-0.5 h-1 w-1 rounded-full bg-[color:var(--color-accent)]" />
                        )}
                      </button>
                    </Td>
                    <Td className="w-full">
                      <TextInput
                        value={r.label ?? ""}
                        onChange={(v) => update(r.id, { label: v })}
                        placeholder={t("row.unnamed")}
                        className="w-full"
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={r.players}
                        onChange={(v) =>
                          update(r.id, { players: Math.floor(v) })
                        }
                        min={2}
                        max={1_000_000}
                        step={1}
                      />
                    </Td>
                    <Td align="right">
                      <BuyInInput
                        buyIn={r.buyIn}
                        rake={r.rake}
                        onChange={(buyIn, rake) =>
                          update(r.id, { buyIn, rake })
                        }
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={+(r.roi * 100).toFixed(2)}
                        onChange={(v) => update(r.id, { roi: v / 100 })}
                        min={-99}
                        max={10_000}
                        step={1}
                      />
                    </Td>
                    <Td align="right">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        disabled={globalItmPct != null}
                        placeholder={
                          globalItmPct != null ? `${globalItmPct}` : "auto"
                        }
                        value={
                          globalItmPct != null
                            ? ""
                            : r.itmRate != null
                              ? +(r.itmRate * 100).toFixed(2)
                              : ""
                        }
                        onChange={(e) => {
                          if (globalItmPct != null) return;
                          const raw = e.target.value;
                          if (raw === "") {
                            update(r.id, { itmRate: undefined });
                            return;
                          }
                          const v = Number(raw);
                          if (!Number.isFinite(v) || v < 0 || v > 100) return;
                          update(r.id, { itmRate: v / 100 });
                        }}
                        className="h-8 w-16 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 px-2 text-center text-xs tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </Td>
                    <Td>
                      {(() => {
                        const grouped = STRUCTURES.map((s) => ({
                          s,
                          compat: payoutCompat(s.id, r.players),
                        }));
                        const available = grouped.filter((g) => g.compat.ok);
                        const unavailable = grouped.filter((g) => !g.compat.ok);
                        const current = grouped.find(
                          (g) => g.s.id === r.payoutStructure,
                        );
                        const currentDisabled = current && !current.compat.ok;
                        const describe = (g: (typeof grouped)[number]) => {
                          if (g.compat.ok) return "";
                          return g.compat.reason === "tooFew"
                            ? `${t("row.payoutCompat.tooFew")} (${t("row.payoutCompat.min")} ${g.compat.range.min})`
                            : `${t("row.payoutCompat.tooMany")} (${t("row.payoutCompat.max")} ${g.compat.range.max === Infinity ? "∞" : g.compat.range.max})`;
                        };
                        return (
                          <select
                            value={r.payoutStructure}
                            title={current?.s.full ?? ""}
                            onChange={(e) => {
                              const next = e.target.value as PayoutStructureId;
                              update(r.id, { payoutStructure: next });
                              if (next === "custom") {
                                const ex = new Set(expanded);
                                ex.add(r.id);
                                setExpanded(ex);
                              }
                            }}
                            className={
                              "h-8 w-full rounded-md border px-2.5 text-xs outline-none transition-colors focus:border-[color:var(--color-accent)] " +
                              (currentDisabled
                                ? "border-rose-500/70 bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
                                : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 text-[color:var(--color-fg)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev-2)] focus:bg-[color:var(--color-bg)]")
                            }
                          >
                            {available.some(({ s }) => s.real) && (
                              <optgroup
                                label={`— ${t("row.payoutGroup.real2026")} —`}
                              >
                                {available
                                  .filter(({ s }) => s.real)
                                  .map(({ s }) => (
                                    <option
                                      key={s.id}
                                      value={s.id}
                                      title={s.full}
                                    >
                                      ★ {s.short}
                                    </option>
                                  ))}
                              </optgroup>
                            )}
                            {available.some(({ s }) => !s.real) && (
                              <optgroup
                                label={`— ${t("row.payoutGroup.generic")} —`}
                              >
                                {available
                                  .filter(({ s }) => !s.real)
                                  .map(({ s }) => (
                                    <option
                                      key={s.id}
                                      value={s.id}
                                      title={s.full}
                                    >
                                      {s.short}
                                    </option>
                                  ))}
                              </optgroup>
                            )}
                            {unavailable.length > 0 && (
                              <optgroup
                                label={`— ${t("row.payoutCompat.unavailable")} —`}
                              >
                                {unavailable.map((g) => {
                                  const reasonText = describe(g);
                                  return (
                                    <option
                                      key={g.s.id}
                                      value={g.s.id}
                                      disabled
                                      title={`${g.s.full} — ${reasonText}`}
                                    >
                                      {`✕ ${g.s.short} — ${reasonText}`}
                                    </option>
                                  );
                                })}
                              </optgroup>
                            )}
                          </select>
                        );
                      })()}
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={r.count}
                        onChange={(v) =>
                          update(r.id, { count: Math.floor(v) })
                        }
                        min={1}
                        max={100_000}
                        step={1}
                      />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        <IconBtn
                          onClick={() => duplicate(r.id)}
                          label={t("row.addRow")}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </IconBtn>
                        <IconBtn
                          onClick={() => cloneAsReentry(r.id)}
                          label={t("row.cloneAsReentry")}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M4 12a8 8 0 0 1 14-5.3L20 4v6h-6l2.3-2.3A6 6 0 1 0 18 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </IconBtn>
                        <IconBtn
                          onClick={() => remove(r.id)}
                          disabled={schedule.length === 1}
                          label={t("row.delete")}
                          danger
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </IconBtn>
                      </div>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev-2)]/30">
                      <td colSpan={10} className="px-6 py-4">
                        <AdvancedRowPanel
                          row={r}
                          onChange={(patch) => update(r.id, patch)}
                        />
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/40 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {t("row.addRow")}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v10M8 9l4 4 4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("row.import")}
          </button>
          {toolbarExtras && (
            <div className="ml-auto flex items-center gap-2">{toolbarExtras}</div>
          )}
        </div>
        {importOpen && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                {t("row.importTitle")}
              </div>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const text = await f.text();
                    setImportText(text);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="rounded border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] hover:border-[color:var(--color-border-strong)]"
              >
                {t("row.importFile")}
              </button>
            </div>
            <textarea
              value={importText}
              rows={6}
              placeholder={IMPORT_PLACEHOLDER}
              onChange={(e) => setImportText(e.target.value)}
              className="resize-y rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2.5 py-2 font-mono text-[11px] text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
            />
            {importErrors.length > 0 && (
              <ul className="text-[10px] text-[color:var(--color-danger)]">
                {importErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyImport(importText, "append")}
                disabled={!importText.trim()}
                className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1 text-[11px] font-medium hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:opacity-40"
              >
                {t("row.importAppend")}
              </button>
              <button
                type="button"
                onClick={() => applyImport(importText, "replace")}
                disabled={!importText.trim()}
                className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1 text-[11px] font-medium hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:opacity-40"
              >
                {t("row.importReplace")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false);
                  setImportText("");
                  setImportErrors([]);
                }}
                className="ml-auto text-[11px] text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
              >
                {t("row.importCancel")}
              </button>
            </div>
          </div>
        )}
      </div>
      </fieldset>
    </Card>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SectionLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
      {children}
      {hint && <InfoTooltip content={hint} />}
    </label>
  );
}

function AdvancedRowPanel({
  row,
  onChange,
}: {
  row: TournamentRow;
  onChange: (patch: Partial<TournamentRow>) => void;
}) {
  const t = useT();
  const fv: FieldVariability = row.fieldVariability ?? { kind: "fixed" };
  const gt = inferGameType(row);
  const showReentry = gt === "freezeout-reentry";
  const showBounty = gt === "pko" || gt === "mystery" || gt === "mystery-royale";
  const showMysteryVar = gt === "mystery" || gt === "mystery-royale";
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {/* Field variability */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.fieldHint")}>
          {t("row.fieldSize")}
        </SectionLabel>
        <div className="flex gap-2">
          <select
            value={fv.kind}
            onChange={(e) => {
              const kind = e.target.value as FieldVariability["kind"];
              if (kind === "fixed") onChange({ fieldVariability: { kind } });
              else
                onChange({
                  fieldVariability: {
                    kind: "uniform",
                    min: Math.max(2, Math.floor(row.players * 0.6)),
                    max: Math.max(2, Math.floor(row.players * 1.4)),
                    buckets: 5,
                  },
                });
            }}
            className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-2 text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          >
            <option value="fixed">{t("row.fixed")}</option>
            <option value="uniform">{t("row.uniformRange")}</option>
          </select>
        </div>
        {fv.kind === "uniform" && (
          <div className="mt-1 grid grid-cols-3 gap-2">
            <FieldSmall label={t("row.min")}>
              <NumInputBox
                value={fv.min}
                min={2}
                max={1_000_000}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: { ...fv, min: Math.floor(v) },
                  })
                }
              />
            </FieldSmall>
            <FieldSmall label={t("row.max")}>
              <NumInputBox
                value={fv.max}
                min={2}
                max={1_000_000}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: { ...fv, max: Math.floor(v) },
                  })
                }
              />
            </FieldSmall>
            <FieldSmall label={t("row.buckets")}>
              <NumInputBox
                value={fv.buckets ?? 5}
                min={1}
                max={20}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: { ...fv, buckets: Math.floor(v) },
                  })
                }
              />
            </FieldSmall>
          </div>
        )}
      </div>

      {/* Custom payouts */}
      {row.payoutStructure === "custom" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
            {t("row.customPct")}
          </label>
          <textarea
            rows={4}
            value={
              row.customPayouts
                ? row.customPayouts.map((v) => +(v * 100).toFixed(3)).join(", ")
                : ""
            }
            placeholder="25, 18, 12, 9, 7, 5.5, 4.5, 4, 3.5, 3, 2.8, 2.5, 2, 1.2"
            onChange={(e) => {
              const parsed = parsePayoutString(e.target.value);
              onChange({ customPayouts: parsed ?? undefined });
            }}
            className="resize-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 font-mono text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
          />
          <p className="text-[10px] leading-relaxed text-[color:var(--color-fg-dim)]">
            {t("row.customHint")}
          </p>
        </div>
      )}

      {/* Re-entry */}
      {showReentry && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel hint={t("row.reentryHint")}>
            {t("row.reentry")}
          </SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <FieldSmall label={t("row.reentry")}>
              <NumInputBox
                value={row.maxEntries ?? 1}
                min={1}
                max={100}
                step={1}
                onChange={(v) => onChange({ maxEntries: Math.floor(v) })}
              />
            </FieldSmall>
            <FieldSmall label={t("row.reentryRate")}>
              <NumInputBox
                value={+((row.reentryRate ?? ((row.maxEntries ?? 1) > 1 ? 1 : 0)) * 100).toFixed(0)}
                min={0}
                max={100}
                step={10}
                onChange={(v) => onChange({ reentryRate: v / 100 })}
              />
            </FieldSmall>
          </div>
        </div>
      )}

      {/* Bounty / PKO */}
      {showBounty && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel hint={t("row.bountyHint")}>
            {t("row.bounty")}
          </SectionLabel>
          <input
            type="number"
            min={0}
            max={90}
            step={5}
            value={+((row.bountyFraction ?? 0) * 100).toFixed(1)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange({ bountyFraction: undefined });
                return;
              }
              const v = Number(raw);
              if (!Number.isFinite(v) || v < 0 || v > 90) return;
              onChange({ bountyFraction: v / 100 });
            }}
            className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          />
        </div>
      )}

      {/* ICM FT */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.icmHint")}>
          {t("row.icmFT")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
            <input
              type="checkbox"
              checked={row.icmFinalTable ?? false}
              onChange={(e) => onChange({ icmFinalTable: e.target.checked })}
              className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
            />
            on
          </label>
          {row.icmFinalTable && (
            <FieldSmall label={t("row.ftSize")}>
              <NumInputBox
                value={row.icmFinalTableSize ?? 9}
                min={2}
                max={50}
                step={1}
                onChange={(v) =>
                  onChange({ icmFinalTableSize: Math.floor(v) })
                }
              />
            </FieldSmall>
          )}
        </div>
      </div>

      {/* Sit-through-pay-jumps play style */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.sitThroughHint")}>
          {t("row.sitThrough")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
            <input
              type="checkbox"
              checked={row.sitThroughPayJumps ?? false}
              onChange={(e) =>
                onChange({ sitThroughPayJumps: e.target.checked })
              }
              className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
            />
            on
          </label>
          {row.sitThroughPayJumps && (
            <FieldSmall label={t("row.sitThroughAgg")}>
              <NumInputBox
                value={Math.round((row.payJumpAggression ?? 0.5) * 100)}
                min={0}
                max={100}
                step={5}
                onChange={(v) => onChange({ payJumpAggression: v / 100 })}
              />
            </FieldSmall>
          )}
        </div>
      </div>

      {/* Mystery bounty variance */}
      {showMysteryVar && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel hint={t("row.mysteryHint")}>
            {t("row.mystery")}
          </SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <FieldSmall label="σ²">
              <NumInputBox
                value={+(row.mysteryBountyVariance ?? 0).toFixed(2)}
                min={0}
                max={3}
                step={0.1}
                onChange={(v) => onChange({ mysteryBountyVariance: v })}
              />
            </FieldSmall>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldSmall({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumInputBox({
  value,
  onChange,
  step,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft !== null ? draft : Number.isFinite(value) ? String(value) : "";
  const invalid = computeInvalid(draft, min, max);
  return (
    <input
      type="number"
      value={display}
      min={min}
      max={max}
      step={step}
      inputMode="decimal"
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const v = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(v)) return;
        if (min !== undefined && v < min) return;
        if (max !== undefined && v > max) return;
        onChange(v);
      }}
      onBlur={() => commitDraft(draft, value, min, max, onChange, setDraft)}
      className={`w-full rounded-md border bg-[color:var(--color-bg)] px-2 py-1.5 text-center text-xs tabular-nums text-[color:var(--color-fg)] outline-none transition-colors focus:border-[color:var(--color-accent)] ${
        invalid
          ? "border-rose-500/70 ring-1 ring-rose-500/30"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]"
      }`}
    />
  );
}

function computeInvalid(
  draft: string | null,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (draft === null) return false;
  if (draft.trim() === "") return true;
  const v = Number(draft);
  if (!Number.isFinite(v)) return true;
  if (min !== undefined && v < min) return true;
  if (max !== undefined && v > max) return true;
  return false;
}

function commitDraft(
  draft: string | null,
  value: number,
  min: number | undefined,
  max: number | undefined,
  onChange: (v: number) => void,
  setDraft: (v: string | null) => void,
) {
  if (draft === null) return;
  const v = Number(draft);
  if (draft.trim() === "" || !Number.isFinite(v)) {
    setDraft(null);
    return;
  }
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  const clamped = Math.min(hi, Math.max(lo, v));
  if (clamped !== value) onChange(clamped);
  setDraft(null);
}

function Th({
  children,
  align = "left",
  hint,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hint?: React.ReactNode;
}) {
  return (
    <th
      className={
        "whitespace-nowrap px-2 py-2.5 font-medium first:pl-4 last:pr-4 " + (align === "right" ? "text-right" : "")
      }
    >
      <span
        className={
          "inline-flex items-center gap-1.5 " +
          (align === "right" ? "flex-row-reverse" : "")
        }
      >
        {children}
        {hint && <InfoTooltip content={hint} />}
      </span>
    </th>
  );
}
function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={
        "px-2 py-2 align-middle first:pl-4 last:pr-4 " +
        (align === "right" ? "text-right " : "") +
        className
      }
    >
      {children}
    </td>
  );
}

// Shared input chrome for the schedule table — always-visible border + fill
// so fields read as "editable" at a glance, accent focus ring for the hit.
const INPUT_BASE =
  "h-8 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 px-2.5 text-sm text-[color:var(--color-fg)] outline-none transition-colors placeholder:text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev-2)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-bg)]";

function TextInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={INPUT_BASE + " " + className}
    />
  );
}

function BuyInInput({
  buyIn,
  rake,
  onChange,
}: {
  buyIn: number;
  rake: number;
  onChange: (buyIn: number, rake: number) => void;
}) {
  const canonical = formatBuyIn(buyIn, rake);
  const [local, setLocal] = useState(canonical);
  const [focused, setFocused] = useState(false);
  if (!focused && local !== canonical) setLocal(canonical);
  const parsed = parseBuyIn(local, rake);
  const invalid = local.trim() !== "" && parsed === null;
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const p = parseBuyIn(local, rake);
        if (p) {
          onChange(p.buyIn, p.rake);
          setLocal(formatBuyIn(p.buyIn, p.rake));
        } else {
          setLocal(canonical);
        }
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        const p = parseBuyIn(e.target.value, rake);
        if (p) onChange(p.buyIn, p.rake);
      }}
      placeholder="50+5"
      title="50+5 = $50 buy-in + $5 rake (or just a number)"
      className={
        INPUT_BASE +
        " w-24 text-center tabular-nums " +
        (invalid ? "!border-[color:var(--color-danger)]/70" : "")
      }
    />
  );
}

function NumInput({
  value,
  onChange,
  step,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft !== null ? draft : Number.isFinite(value) ? String(value) : "";
  const invalid = computeInvalid(draft, min, max);
  return (
    <input
      type="number"
      value={display}
      min={min}
      max={max}
      step={step}
      inputMode="decimal"
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const v = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(v)) return;
        if (min !== undefined && v < min) return;
        if (max !== undefined && v > max) return;
        onChange(v);
      }}
      onBlur={() => commitDraft(draft, value, min, max, onChange, setDraft)}
      className={
        INPUT_BASE +
        " w-20 text-center tabular-nums " +
        (invalid ? "!border-rose-500/70 ring-1 ring-rose-500/30" : "")
      }
    />
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-fg)]/5 disabled:cursor-not-allowed disabled:opacity-20 " +
        (danger ? "hover:text-[color:var(--color-danger)]" : "hover:text-[color:var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}
