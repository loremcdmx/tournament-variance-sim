"use client";

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FieldVariability,
  GameType,
  PayoutStructureId,
  TournamentRow,
} from "@/lib/sim/types";
import {
  inferGameType,
  applyGameType,
  GAME_TYPE_ORDER,
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
  {
    id: "mtt-gg-mystery",
    short: "GG Mystery Bounty",
    full: "GG Mystery Bounty · ITM-phase envelopes · 13% paid, 1st ≈ 9–12.5%",
  },
  { id: "mtt-primedope", short: "PrimeDope payouts", full: "PrimeDope native payout curves (15% paid)" },
  { id: "mtt-standard", short: "MTT Standard 15%", full: "MTT · Standard (15% paid)" },
  { id: "mtt-flat", short: "MTT Flat 20%", full: "MTT · Flat (20% paid)" },
  { id: "mtt-top-heavy", short: "MTT Top-heavy 12%", full: "MTT · Top-heavy (12% paid)" },
  { id: "battle-royale", short: "GG Battle Royal", full: "GG Battle Royal · 18-max, top-3 paid" },
  { id: "satellite-ticket", short: "Satellite (tickets)", full: "Satellite · ticket cliff (10% seats)" },
  { id: "sng-50-30-20", short: "SNG 50/30/20", full: "SNG · 50/30/20" },
  { id: "sng-65-35", short: "SNG 65/35", full: "SNG · 65/35" },
  { id: "winner-takes-all", short: "Winner takes all", full: "Winner takes all" },
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
const PAYOUT_COMPAT: Partial<Record<PayoutStructureId, CompatRange>> = {
  "mtt-standard": { min: 30, max: Infinity },
  "mtt-primedope": { min: 30, max: Infinity },
  "mtt-flat": { min: 30, max: Infinity },
  "mtt-top-heavy": { min: 30, max: Infinity },
  "battle-royale": { min: 9, max: 36 },
  "mtt-pokerstars": { min: 50, max: Infinity },
  "mtt-gg": { min: 50, max: Infinity },
  "mtt-sunday-million": { min: 2000, max: Infinity },
  "mtt-gg-bounty": { min: 500, max: Infinity },
  "mtt-gg-mystery": { min: 500, max: Infinity },
  "satellite-ticket": { min: 10, max: Infinity },
  "sng-50-30-20": { min: 3, max: 18 },
  "sng-65-35": { min: 2, max: 2 },
  "winner-takes-all": { min: 2, max: 20 },
};

// Strict gameType → allowed payout structures. Every format has its own
// allowlist: pairing a bounty payout with a freezeout row (or vice versa)
// makes no sense — the engine reads `bountyFraction` off the row, not the
// payout. Dropdown relegates everything outside the allowlist to the
// "Недоступно" optgroup. `custom` stays available for every format since
// user-entered splits are arbitrary by design.
const PAYOUT_GAMETYPE_ALLOW: Partial<Record<GameType, PayoutStructureId[]>> = {
  freezeout: [
    "mtt-standard",
    "mtt-primedope",
    "mtt-flat",
    "mtt-top-heavy",
    "mtt-pokerstars",
    "mtt-gg",
    "mtt-sunday-million",
    "satellite-ticket",
    "sng-50-30-20",
    "sng-65-35",
    "winner-takes-all",
  ],
  "freezeout-reentry": [
    "mtt-standard",
    "mtt-primedope",
    "mtt-flat",
    "mtt-top-heavy",
    "mtt-pokerstars",
    "mtt-gg",
    "mtt-sunday-million",
    "satellite-ticket",
    "sng-50-30-20",
    "sng-65-35",
    "winner-takes-all",
  ],
  pko: ["mtt-gg-bounty"],
  mystery: ["mtt-gg-mystery"],
  "mystery-royale": ["battle-royale"],
};

type CompatFail =
  | { reason: "tooFew"; range: CompatRange }
  | { reason: "tooMany"; range: CompatRange }
  | { reason: "wrongGameType"; gameType: GameType };
function payoutCompat(
  id: PayoutStructureId,
  players: number,
  gameType?: GameType,
): { ok: true } | ({ ok: false } & CompatFail) {
  if (gameType) {
    const allow = PAYOUT_GAMETYPE_ALLOW[gameType];
    if (allow && !allow.includes(id)) {
      return { ok: false, reason: "wrongGameType", gameType };
    }
  }
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
  "battle-royale",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "mtt-gg-bounty",
  "mtt-gg-mystery",
  "satellite-ticket",
  "sng-50-30-20",
  "sng-65-35",
  "winner-takes-all",
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

export const ScheduleEditor = memo(function ScheduleEditor({
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

  // Keep refs to latest schedule/onChange so the row-level callbacks we hand
  // out to <ScheduleRow/> are referentially stable — without this every edit
  // invalidates the memoized rows below, defeating the whole point.
  const scheduleRef = useRef(schedule);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    scheduleRef.current = schedule;
    onChangeRef.current = onChange;
  });

  const applyImport = (text: string, mode: "append" | "replace") => {
    const { rows, errors } = parseImportCSV(text);
    setImportErrors(errors);
    if (rows.length === 0) return;
    onChange(mode === "replace" ? rows : [...schedule, ...rows]);
    setImportText("");
    setImportOpen(false);
  };

  const update = useCallback((id: string, patch: Partial<TournamentRow>) => {
    onChangeRef.current(
      scheduleRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }, []);
  const remove = useCallback((id: string) => {
    onChangeRef.current(scheduleRef.current.filter((r) => r.id !== id));
  }, []);
  const duplicate = useCallback((id: string) => {
    const sched = scheduleRef.current;
    const row = sched.find((r) => r.id === id);
    if (!row) return;
    const copy = { ...row, id: crypto.randomUUID() };
    const idx = sched.findIndex((r) => r.id === id);
    const next = [...sched];
    next.splice(idx + 1, 0, copy);
    onChangeRef.current(next);
  }, []);
  const cloneAsReentry = useCallback((id: string) => {
    // A late re-entry is just another entry with lower skill edge (player
    // arrives short / plays a bigger field). Clone the row, drop ROI by
    // 5pp, and tag the label. User can tune further if needed.
    const sched = scheduleRef.current;
    const row = sched.find((r) => r.id === id);
    if (!row) return;
    const baseLabel = row.label || "";
    const copy = {
      ...row,
      id: crypto.randomUUID(),
      roi: row.roi - 0.05,
      label: baseLabel ? `${baseLabel} (re-entry)` : "(re-entry)",
    };
    const idx = sched.findIndex((r) => r.id === id);
    const next = [...sched];
    next.splice(idx + 1, 0, copy);
    onChangeRef.current(next);
  }, []);
  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
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
  const canRemove = schedule.length > 1;

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
              <Th hint={t("row.gameTypeHint")}>{t("row.gameType")}</Th>
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
            {schedule.map((r, i) => (
              <ScheduleRow
                key={r.id}
                row={r}
                rowIndex={i}
                advanced={advanced}
                isOpen={advanced && expanded.has(r.id)}
                globalItmPct={globalItmPct}
                canRemove={canRemove}
                update={update}
                remove={remove}
                duplicate={duplicate}
                cloneAsReentry={cloneAsReentry}
                toggleExpand={toggleExpand}
              />
            ))}
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
});

interface ScheduleRowProps {
  row: TournamentRow;
  rowIndex: number;
  advanced: boolean;
  isOpen: boolean;
  globalItmPct: number | null;
  canRemove: boolean;
  update: (id: string, patch: Partial<TournamentRow>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  cloneAsReentry: (id: string) => void;
  toggleExpand: (id: string) => void;
}

const ScheduleRow = memo(function ScheduleRow({
  row: r,
  rowIndex: i,
  advanced,
  isOpen,
  globalItmPct,
  canRemove,
  update,
  remove,
  duplicate,
  cloneAsReentry,
  toggleExpand,
}: ScheduleRowProps) {
  const t = useT();
  const hasAdv =
    (r.fieldVariability && r.fieldVariability.kind !== "fixed") ||
    (r.maxEntries ?? 1) > 1 ||
    (r.bountyFraction ?? 0) > 0;
  const gt = inferGameType(r);

  // The payout dropdown would otherwise re-run STRUCTURES.map+filter (14×3)
  // on every keystroke in any sibling field. Only players/gameType shift the
  // compat grid, so memo on those.
  const dropdownData = useMemo(() => {
    const grouped = STRUCTURES.map((s) => ({
      s,
      compat: payoutCompat(s.id, r.players, gt),
    }));
    const available = grouped.filter((g) => g.compat.ok);
    const unavailable = grouped.filter((g) => !g.compat.ok);
    const availableReal = available.filter(({ s }) => s.real);
    const availableGeneric = available.filter(({ s }) => !s.real);
    return { grouped, available, unavailable, availableReal, availableGeneric };
  }, [r.players, gt]);

  const current = dropdownData.grouped.find(
    (g) => g.s.id === r.payoutStructure,
  );
  const legacyCustom = r.payoutStructure === "custom";
  const currentDisabled = current && !current.compat.ok;
  const describe = (g: (typeof dropdownData.grouped)[number]) => {
    if (g.compat.ok) return "";
    if (g.compat.reason === "wrongGameType") {
      const gtKey = (
        {
          freezeout: "row.gameType.freezeout",
          "freezeout-reentry": "row.gameType.freezeoutReentry",
          pko: "row.gameType.pko",
          mystery: "row.gameType.mystery",
          "mystery-royale": "row.gameType.mysteryRoyale",
        } as const
      )[g.compat.gameType];
      return t("row.payoutCompat.wrongGameType").replace(
        "{gameType}",
        t(gtKey),
      );
    }
    return g.compat.reason === "tooFew"
      ? `${t("row.payoutCompat.tooFew")} (${t("row.payoutCompat.min")} ${g.compat.range.min})`
      : `${t("row.payoutCompat.tooMany")} (${t("row.payoutCompat.max")} ${g.compat.range.max === Infinity ? "∞" : g.compat.range.max})`;
  };

  return (
    <>
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
            className="w-full min-w-[120px]"
          />
        </Td>
        <Td>
          <div className="flex items-center gap-1">
            <GameTypeSelect
              value={gt}
              onChange={(next) =>
                startTransition(() => update(r.id, applyGameType(r, next)))
              }
            />
            {gt === "mystery-royale" && (
              <BrPresetSelect
                row={r}
                onApply={(patch) =>
                  startTransition(() => update(r.id, patch))
                }
              />
            )}
          </div>
        </Td>
        <Td align="right">
          <NumInput
            value={r.players}
            onChange={(v) => update(r.id, { players: Math.floor(v) })}
            min={2}
            max={1_000_000}
            step={1}
          />
        </Td>
        <Td align="right">
          <BuyInInput
            buyIn={r.buyIn}
            rake={r.rake}
            onChange={(buyIn, rake) => update(r.id, { buyIn, rake })}
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
            placeholder={globalItmPct != null ? `${globalItmPct}` : "auto"}
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
          <select
            value={r.payoutStructure}
            title={current?.s.full ?? ""}
            onChange={(e) => {
              const next = e.target.value as PayoutStructureId;
              update(r.id, { payoutStructure: next });
            }}
            className={
              "h-8 w-full rounded-md border px-2.5 text-xs outline-none transition-colors focus:border-[color:var(--color-accent)] " +
              (currentDisabled
                ? "border-rose-500/70 bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
                : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 text-[color:var(--color-fg)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev-2)] focus:bg-[color:var(--color-bg)]")
            }
          >
            {dropdownData.availableReal.length > 0 && (
              <optgroup label={`— ${t("row.payoutGroup.real2026")} —`}>
                {dropdownData.availableReal.map(({ s }) => (
                  <option key={s.id} value={s.id} title={s.full}>
                    ★ {s.short}
                  </option>
                ))}
              </optgroup>
            )}
            {dropdownData.availableGeneric.length > 0 && (
              <optgroup label={`— ${t("row.payoutGroup.generic")} —`}>
                {dropdownData.availableGeneric.map(({ s }) => (
                  <option key={s.id} value={s.id} title={s.full}>
                    {s.short}
                  </option>
                ))}
              </optgroup>
            )}
            {legacyCustom && (
              <optgroup label="— Legacy —">
                <option value="custom">Legacy custom (read-only)</option>
              </optgroup>
            )}
            {dropdownData.unavailable.length > 0 && (
              <optgroup label={`— ${t("row.payoutCompat.unavailable")} —`}>
                {dropdownData.unavailable.map((g) => {
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
        </Td>
        <Td align="right">
          <NumInput
            value={r.count}
            onChange={(v) => update(r.id, { count: Math.floor(v) })}
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
                <rect
                  x="8"
                  y="8"
                  width="12"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </IconBtn>
            <IconBtn
              onClick={() => cloneAsReentry(r.id)}
              label={t("row.cloneAsReentry")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12a8 8 0 0 1 14-5.3L20 4v6h-6l2.3-2.3A6 6 0 1 0 18 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </IconBtn>
            <IconBtn
              onClick={() => remove(r.id)}
              disabled={!canRemove}
              label={t("row.delete")}
              danger
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
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
    </>
  );
});

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
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        startTransition(() => onChange(next));
      }}
      onBlur={() => {
        if (draft !== value) startTransition(() => onChange(draft));
      }}
      placeholder={placeholder}
      className={INPUT_BASE + " " + className}
    />
  );
}

// GGPoker Mystery Battle Royale tier ladder — five fixed total buy-ins with
// matching top-bounty prizes. Field size intentionally NOT in the preset:
// across tiers the lobby structure is identical, only the jackpot scales.
// Stored buy-in is the prize-pool portion (total / (1+rake)) at rake 8 %.
export interface BrPreset {
  total: number;
  topBounty: number;
}
export const BR_PRESETS: BrPreset[] = [
  { total: 0.25, topBounty: 5_000 },
  { total: 1, topBounty: 10_000 },
  { total: 3, topBounty: 30_000 },
  { total: 10, topBounty: 100_000 },
  { total: 25, topBounty: 250_000 },
];
const BR_RAKE = 0.08;
function brTotalLabel(p: BrPreset): string {
  const t = p.total < 1 ? p.total.toFixed(2) : p.total.toString();
  const b = p.topBounty >= 1000 ? `${p.topBounty / 1000}k` : p.topBounty.toString();
  return `$${t} · $${b} top`;
}
function brPresetMatch(
  buyIn: number,
  rake: number,
): BrPreset | null {
  const total = buyIn * (1 + rake);
  let best: BrPreset | null = null;
  let bestDiff = Infinity;
  for (const p of BR_PRESETS) {
    const d = Math.abs(total - p.total) / p.total;
    if (d < 0.08 && d < bestDiff) {
      bestDiff = d;
      best = p;
    }
  }
  return best;
}

function BrPresetSelect({
  row,
  onApply,
}: {
  row: TournamentRow;
  onApply: (patch: Partial<TournamentRow>) => void;
}) {
  const current = brPresetMatch(row.buyIn, row.rake);
  const value = current ? String(current.total) : "";
  return (
    <select
      value={value}
      onChange={(e) => {
        const p = BR_PRESETS.find((x) => String(x.total) === e.target.value);
        if (!p) return;
        const buyIn = p.total / (1 + BR_RAKE);
        onApply({ buyIn, rake: BR_RAKE });
      }}
      className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1.5 py-1 text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
      title="GG Battle Royal tier"
    >
      {current == null && <option value="">— BR tier —</option>}
      {BR_PRESETS.map((p) => (
        <option key={p.total} value={p.total}>
          {brTotalLabel(p)}
        </option>
      ))}
    </select>
  );
}

function GameTypeSelect({
  value,
  onChange,
}: {
  value: GameType;
  onChange: (next: GameType) => void;
}) {
  const t = useT();
  const labelKey = (g: GameType): string => {
    switch (g) {
      case "freezeout":
        return t("row.gameType.freezeout");
      case "freezeout-reentry":
        return t("row.gameType.freezeoutReentry");
      case "pko":
        return t("row.gameType.pko");
      case "mystery":
        return t("row.gameType.mystery");
      case "mystery-royale":
        return t("row.gameType.mysteryRoyale");
    }
  };
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as GameType)}
      className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
    >
      {GAME_TYPE_ORDER.map((g) => (
        <option key={g} value={g}>
          {labelKey(g)}
        </option>
      ))}
    </select>
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
          startTransition(() => onChange(p.buyIn, p.rake));
          setLocal(formatBuyIn(p.buyIn, p.rake));
        } else {
          setLocal(canonical);
        }
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        const p = parseBuyIn(e.target.value, rake);
        if (p) startTransition(() => onChange(p.buyIn, p.rake));
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
        startTransition(() => onChange(v));
      }}
      onBlur={() =>
        commitDraft(
          draft,
          value,
          min,
          max,
          (next) => startTransition(() => onChange(next)),
          setDraft,
        )
      }
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
