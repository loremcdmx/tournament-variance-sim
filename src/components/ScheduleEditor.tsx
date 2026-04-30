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
  BATTLE_ROYALE_PLAYERS,
  inferGameType,
  applyGameType,
  VISIBLE_GAME_TYPE_ORDER,
  toVisibleGameType,
  type VisibleGameType,
} from "@/lib/sim/gameType";
import {
  preRakebackRoiFromReportedRoi,
  rakebackRoiContribution,
  reportedRoiFromPreRakebackRoi,
} from "@/lib/sim/rakebackMath";
import {
  battleRoyaleRowFromTotalTicket,
  BATTLE_ROYALE_INTERNAL_RAKE,
} from "@/lib/sim/battleRoyaleTicket";
import { normalizeNumericDraft } from "@/lib/ui/numberDraft";
import { getTournamentRowDisplayLabel } from "@/lib/ui/tournamentRowLabel";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import type { RowFeasibilityIssue } from "@/lib/sim/validation";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";

const MAX_BUY_IN_RAKE = 1;

// Parse "50+5", "50 + 5", "55", "$50+$5" → { buyIn: 50, rake: 0.1 }.
// Plain single number is treated as net buy-in (prize-pool portion); the
// caller keeps the existing rake in that case by passing `currentRake`.
export function parseBuyIn(
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
    const rake = fee / net;
    if (!isFinite(rake) || rake < 0 || rake > MAX_BUY_IN_RAKE) return null;
    return { buyIn: net, rake };
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
    short: "Mini CoinMasters (2026)",
    full: "CoinPoker Mini CoinMasters · calibrated to 2026-04-14 sample",
    real: true,
  },
  {
    id: "mtt-gg-bounty",
    short: "Mini CoinHunter PKO (2026)",
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
  /** Global rakeback %, used only for Battle Royale ROI helper copy. */
  globalRakebackPct?: number;
  /** Optional extras rendered in the toolbar row (right of Add / Import). */
  toolbarExtras?: React.ReactNode;
  /**
   * Per-row infeasibility issues from `validateSchedule`. Keyed lookup
   * inside the editor; each ScheduleRow gets its own `issue` if present
   * and renders an inline mini-banner with auto-fix / preset-fix buttons
   * — no need to scroll to a global banner to see what's wrong.
   */
  feasibilityIssues?: readonly RowFeasibilityIssue[];
  /** Auto-fix handler — clears finishBuckets locks on the row. */
  onFixRowAuto?: (rowId: string) => void;
  /** Preset-fix handler — applies the "grinder" finishBuckets preset. */
  onFixRowPreset?: (rowId: string) => void;
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
  "battle-royale": { min: BATTLE_ROYALE_PLAYERS, max: BATTLE_ROYALE_PLAYERS },
  "mtt-pokerstars": { min: 50, max: Infinity },
  "mtt-gg": { min: 50, max: Infinity },
  "mtt-sunday-million": { min: 2000, max: Infinity },
  // PKO / Mystery were originally floored at 500 because the GG-side payout
  // curves were tuned for big fields, then dropped to 50 to unblock small-
  // stakes turbo PKOs (50-200 players). Now further dropped to 2 because
  // single-table PKO turbos (HU, 6-max, 9-max sit-and-go bounty) are real
  // formats — `payouts.ts` has a small-field branch that produces SNG-style
  // top-1-3 paid for sub-50 fields, so the dropdown shouldn't gatekeep them.
  "mtt-gg-bounty": { min: 2, max: Infinity },
  "mtt-gg-mystery": { min: 2, max: Infinity },
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

// Payout structure → poker room mark. Lets each card show its venue at a
// glance. Only payouts calibrated to a specific operator get a mark; generic
// tables / SNGs / satellites stay unbranded.
type PokerRoom = "pokerstars" | "ggpoker" | "coinpoker";
const PAYOUT_ROOM: Partial<Record<PayoutStructureId, PokerRoom>> = {
  "mtt-pokerstars": "pokerstars",
  "mtt-sunday-million": "pokerstars",
  "mtt-gg-mystery": "ggpoker",
  "battle-royale": "ggpoker",
  "mtt-gg": "coinpoker",
  "mtt-gg-bounty": "coinpoker",
};
const ROOM_META: Record<PokerRoom, { label: string; src: string }> = {
  pokerstars: { label: "PokerStars", src: "/logos/pokerstars.svg" },
  ggpoker: { label: "GGPoker", src: "/logos/ggpoker.svg" },
  coinpoker: { label: "CoinPoker", src: "/logos/coinpoker.svg" },
};

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

const IMPORT_PLAYERS_MAX = 1_000_000;
const IMPORT_COUNT_MAX = 100_000;
const PLAIN_INT_RE = /^\d+$/;
const PLAIN_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function parsePlainInt(raw: string): number | null {
  if (!PLAIN_INT_RE.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePlainNumber(raw: string): number | null {
  if (!PLAIN_NUMBER_RE.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseImportCSV(raw: string): {
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
    const players = parsePlainInt(playersStr);
    if (players === null || players < 2 || players > IMPORT_PLAYERS_MAX) {
      errors.push(`line ${i + 1}: players must be 2..${IMPORT_PLAYERS_MAX}`);
      return;
    }
    const parsed = parseBuyIn(buyInStr ?? "", 0.1);
    if (!parsed) {
      errors.push(`line ${i + 1}: bad buy-in "${buyInStr}"`);
      return;
    }
    let roiPct = 0;
    if (roiStr) {
      const parsedRoi = parsePlainNumber(roiStr);
      if (parsedRoi === null) {
        errors.push(`line ${i + 1}: roi must be a plain number`);
        return;
      }
      roiPct = parsedRoi;
    }
    let count = 1;
    if (countStr) {
      const parsedCount = parsePlainNumber(countStr);
      if (
        parsedCount === null ||
        parsedCount < 1 ||
        parsedCount > IMPORT_COUNT_MAX
      ) {
        errors.push(`line ${i + 1}: count must be 1..${IMPORT_COUNT_MAX}`);
        return;
      }
      count = Math.max(1, Math.floor(parsedCount));
    }
    const payout = (
      payoutStr && PAYOUT_IDS.includes(payoutStr as PayoutStructureId)
        ? payoutStr
        : "mtt-standard"
    ) as PayoutStructureId;
    const isBattleRoyaleImport = payout === "battle-royale";
    const importedRow: TournamentRow = {
      id: crypto.randomUUID(),
      label: label || `Imported ${rows.length + 1}`,
      players: isBattleRoyaleImport ? BATTLE_ROYALE_PLAYERS : players,
      buyIn: parsed.buyIn,
      rake: parsed.rake,
      roi: roiPct / 100,
      payoutStructure: payout,
      count,
    };
    if (isBattleRoyaleImport) importedRow.gameType = "mystery-royale";
    rows.push(importedRow);
  });
  return { rows, errors };
}

export const ScheduleEditor = memo(function ScheduleEditor({
  schedule,
  onChange,
  disabled,
  globalItmPct = null,
  globalRakebackPct = 0,
  toolbarExtras,
  feasibilityIssues,
  onFixRowAuto,
  onFixRowPreset,
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
  // Build the rowId → issue index once so each ScheduleRow does an O(1)
  // lookup. The whole map is cheap to recompute (≤ schedule.length entries),
  // but rebuilding on every keystroke would re-render every row through the
  // memo barrier — keep it on `feasibilityIssues` identity, which only
  // changes when validation actually re-runs.
  const issueByRow = useMemo(() => {
    const m = new Map<string, RowFeasibilityIssue>();
    if (feasibilityIssues) {
      for (const iss of feasibilityIssues) m.set(iss.rowId, iss);
    }
    return m;
  }, [feasibilityIssues]);

  return (
    <Card>
      <fieldset
        disabled={disabled}
        className="contents disabled:opacity-60 [&:disabled_*]:cursor-not-allowed"
      >
      <div className="dense-control-table flex flex-col gap-2 p-2">
        {schedule.map((r, i) => (
          <ScheduleRow
            key={r.id}
            row={r}
            rowIndex={i}
            advanced={advanced}
            isOpen={advanced && expanded.has(r.id)}
            globalItmPct={globalItmPct}
            globalRakebackPct={globalRakebackPct}
            canRemove={canRemove}
            update={update}
            remove={remove}
            duplicate={duplicate}
            toggleExpand={toggleExpand}
            issue={issueByRow.get(r.id)}
            onFixAuto={onFixRowAuto}
            onFixPreset={onFixRowPreset}
          />
        ))}
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

// Card stripe colour keyed to the user-facing game type. Uses the existing
// suit palette from globals.css so the tint is consistent with the rest of
// the UI (no new colour tokens).
const GAME_TYPE_TINT: Record<VisibleGameType, string> = {
  freezeout: "var(--c-spade)",
  pko: "var(--c-heart)",
  mystery: "var(--c-diamond)",
  "mystery-royale": "var(--c-club)",
};

interface ScheduleRowProps {
  row: TournamentRow;
  rowIndex: number;
  advanced: boolean;
  isOpen: boolean;
  globalItmPct: number | null;
  globalRakebackPct: number;
  canRemove: boolean;
  update: (id: string, patch: Partial<TournamentRow>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  toggleExpand: (id: string) => void;
  /** When set, this row failed feasibility validation; the inline mini-
   *  banner with auto-fix / preset-fix buttons renders inside the row. */
  issue?: RowFeasibilityIssue;
  onFixAuto?: (rowId: string) => void;
  onFixPreset?: (rowId: string) => void;
}

const ScheduleRow = memo(function ScheduleRow({
  row: r,
  advanced,
  isOpen,
  globalItmPct,
  globalRakebackPct,
  canRemove,
  update,
  remove,
  duplicate,
  toggleExpand,
  issue,
  onFixAuto,
  onFixPreset,
}: ScheduleRowProps) {
  const t = useT();
  const gt = inferGameType(r);
  const isBattleRoyale = gt === "mystery-royale";
  const uiGt = toVisibleGameType(gt);
  const showBounty =
    uiGt === "pko" || uiGt === "mystery" || uiGt === "mystery-royale";
  const hasAdv =
    (r.fieldVariability && r.fieldVariability.kind !== "fixed") ||
    !!r.sitThroughPayJumps ||
    (gt === "mystery" &&
      r.mysteryBountyVariance != null &&
      Math.abs(r.mysteryBountyVariance - 2.0) > 1e-9);

  // The payout dropdown would otherwise re-run STRUCTURES.map+filter (14×3)
  // on every keystroke in any sibling field. Only players/gameType shift the
  // compat grid, so memo on those.
  const dropdownData = useMemo(() => {
    const grouped = STRUCTURES.map((s) => ({
      s,
      compat: payoutCompat(s.id, r.players, uiGt),
    }));
    const available = grouped.filter((g) => g.compat.ok);
    const unavailable = grouped.filter((g) => !g.compat.ok);
    const availableReal = available.filter(({ s }) => s.real);
    const availableGeneric = available.filter(({ s }) => !s.real);
    return { grouped, available, unavailable, availableReal, availableGeneric };
  }, [r.players, uiGt]);

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
          pko: "row.gameType.pko",
          mystery: "row.gameType.mystery",
          "mystery-royale": "row.gameType.mysteryRoyale",
        } as const
      )[toVisibleGameType(g.compat.gameType)];
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
    <div
      id={`schedule-row-${r.id}`}
      className={
        "group relative overflow-hidden rounded-lg border transition-all focus-within:border-[color:var(--color-accent)]/40 " +
        (currentDisabled
          ? "border-[color:var(--color-danger)]/55"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]")
      }
      style={{
        background:
          "linear-gradient(to bottom, color-mix(in oklab, var(--c-bg-elev), white 2%), color-mix(in oklab, var(--c-bg-elev), black 4%))",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: GAME_TYPE_TINT[uiGt] }}
      />
      <div
        className="grid gap-4 py-3 pl-5 pr-3"
        style={{
          gridTemplateColumns:
            "minmax(11rem,1.5fr) minmax(10rem,1.1fr) minmax(11rem,1.1fr) auto",
        }}
      >
        {/* IDENTITY — label + game type */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel hint={t("help.row.label")}>{t("row.label")}</SectionLabel>
          <div className="flex min-w-0 items-center gap-2">
            <RoomBadge payoutId={r.payoutStructure} />
            <TextInput
              value={r.label ?? ""}
              onChange={(v) => update(r.id, { label: v })}
              placeholder={getTournamentRowDisplayLabel(r, t)}
              className="w-full min-w-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <GameTypeSelect
              value={uiGt}
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
        </div>

        {/* MONEY — buy-in + ROI + ITM */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel hint={t("help.row.buyIn")}>{t("row.buyIn")}</SectionLabel>
          <BuyInInput
            gameType={uiGt}
            buyIn={r.buyIn}
            rake={r.rake}
            onChange={(buyIn, rake) => update(r.id, { buyIn, rake })}
          />
          <div
            className={`grid gap-2 ${showBounty ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <div className="flex flex-col gap-1">
              <SectionLabel hint={t("help.row.roi")}>{t("row.roi")}</SectionLabel>
              <PercentNumInput
                value={Math.round(r.roi * 100)}
                onChange={(v) => update(r.id, { roi: v / 100 })}
                min={-99}
                max={10_000}
                step={1}
              />
            </div>
            <div className="flex flex-col gap-1">
              <SectionLabel hint={t("row.fixedItmHint")}>
                {t("row.fixedItm")}
              </SectionLabel>
              <PercentDraftInput
                min={0}
                max={100}
                step={0.5}
                disabled={globalItmPct != null}
                value={
                  globalItmPct != null
                    ? +(globalItmPct).toFixed(1)
                    : r.itmRate != null
                      ? +(r.itmRate * 100).toFixed(2)
                      : ""
                }
                placeholder={globalItmPct != null ? "" : "auto"}
                lockedLabel={
                  globalItmPct != null ? t("row.inheritedShort") : undefined
                }
                onChange={(raw) => {
                  if (globalItmPct != null) return;
                  if (raw === "") {
                    update(r.id, { itmRate: undefined });
                    return;
                  }
                  const v = Number(raw);
                  if (!Number.isFinite(v) || v < 0 || v > 100) return;
                  update(r.id, { itmRate: v / 100 });
                }}
              />
            </div>
            {showBounty && (
              <div className="flex flex-col gap-1">
                <SectionLabel hint={t("row.bountyHint")}>
                  {t("row.bounty")}
                </SectionLabel>
                <PercentNumInput
                  value={+(((r.bountyFraction ?? 0) * 100).toFixed(1))}
                  onChange={(v) =>
                    update(r.id, { bountyFraction: Math.max(0, Math.min(90, v)) / 100 })
                  }
                  min={0}
                  max={90}
                  step={5}
                />
              </div>
            )}
          </div>
          {gt === "mystery-royale" && (
            <BrReportedRoiControl
              row={r}
              globalRakebackPct={globalRakebackPct}
              onApply={(roi) => update(r.id, { roi, bountyEvBias: 0 })}
            />
          )}
        </div>

        {/* META — AFS, payout, count (label stacked on top of each field so
             the connection between the two reads at a glance, same pattern
             as the identity/money columns). */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-col gap-1">
            <SectionLabel hint={t("help.row.players")}>
              {t("row.players")}
            </SectionLabel>
            <NumInput
              value={isBattleRoyale ? BATTLE_ROYALE_PLAYERS : r.players}
              onChange={(v) => update(r.id, { players: Math.floor(v) })}
              min={isBattleRoyale ? BATTLE_ROYALE_PLAYERS : 2}
              max={isBattleRoyale ? BATTLE_ROYALE_PLAYERS : 1_000_000}
              step={1}
              disabled={isBattleRoyale}
            />
          </div>
          <div className="flex flex-col gap-1">
            <SectionLabel hint={t("help.row.payouts")}>
              {t("row.payouts")}
            </SectionLabel>
            <select
              value={r.payoutStructure}
              title={current?.s.full ?? ""}
              onChange={(e) => {
                const next = e.target.value as PayoutStructureId;
                update(r.id, { payoutStructure: next });
              }}
              className={
                "h-8 w-full min-w-0 rounded-md border px-2 text-[11px] outline-none transition-colors focus:border-[color:var(--color-accent)] " +
                (currentDisabled
                  ? "border-rose-500/70 bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 text-[color:var(--color-fg)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev-2)] focus:bg-[color:var(--color-bg)]")
              }
            >
              {dropdownData.availableReal.length > 0 && (
                <optgroup label={`— ${t("row.payoutGroup.real2026")} —`}>
                  {dropdownData.availableReal.map(({ s }) => (
                    <option key={s.id} value={s.id} title={s.full}>
                      {s.short}
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
          </div>
          <div className="flex flex-col gap-1">
            <SectionLabel hint={t("help.row.count")}>
              {t("row.count")}
            </SectionLabel>
            <NumInput
              value={r.count}
              onChange={(v) => update(r.id, { count: Math.floor(v) })}
              min={1}
              max={100_000}
              step={1}
              commitMode="blur"
            />
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex flex-col items-center gap-1 self-start pt-5">
          <button
            type="button"
            onClick={() => advanced && toggleExpand(r.id)}
            disabled={!advanced}
            title={advanced ? t("row.advanced") : t("controls.expandAdvanced")}
            aria-label={t("row.advanced")}
            className={
              "relative inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30 " +
              (isOpen
                ? "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]"
                : "")
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
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent)]" />
            )}
          </button>
          <IconBtn onClick={() => duplicate(r.id)} label={t("row.addRow")}>
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
      </div>
      {isOpen && (
        <div
          className="border-t px-6 py-4"
          style={{
            borderColor: "var(--c-border)",
            background: "color-mix(in oklab, var(--c-bg-elev-2), transparent 70%)",
          }}
        >
          <AdvancedRowPanel
            row={r}
            onChange={(patch) => update(r.id, patch)}
          />
        </div>
      )}
      {/* Inline infeasibility mini-banner. Lives inside the row card so the
          fix is one click away from the inputs that caused it — same
          colors as the global banner so the relationship is obvious. The
          "Grinder" preset is hidden on bounty-envelope rows (PKO / Mystery
          / BR), where ITM is structural and a fixed 16% number doesn't
          belong. */}
      {issue && (onFixAuto || onFixPreset) && (
        <div className="border-t-2 border-rose-500/60 bg-rose-950/40 px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-rose-50">
              <span aria-hidden className="text-rose-300">!</span>
              {t("shape.rowBlocked")}
            </span>
            <span className="font-mono text-[11px] text-rose-200/80">
              EW ${issue.currentEv.toFixed(2)} / ${issue.targetEv.toFixed(2)} (
              {t("shape.blockedGap")} {issue.gap >= 0 ? "+" : ""}
              {issue.gap.toFixed(2)})
            </span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {onFixAuto && (
                <button
                  type="button"
                  onClick={() => onFixAuto(r.id)}
                  className="rounded border border-rose-400/50 bg-rose-500/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-rose-50 transition-colors hover:border-rose-300 hover:bg-rose-500/30"
                >
                  {t("shape.fixAuto")}
                </button>
              )}
              {onFixPreset && !showBounty && (
                <button
                  type="button"
                  onClick={() => onFixPreset(r.id)}
                  className="rounded border border-rose-400/50 bg-rose-500/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-rose-50 transition-colors hover:border-rose-300 hover:bg-rose-500/30"
                >
                  {t("shape.fixPreset")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
  const gt = inferGameType(row);
  const isBattleRoyale = gt === "mystery-royale";
  const fv: FieldVariability = isBattleRoyale
    ? { kind: "fixed" }
    : (row.fieldVariability ?? { kind: "fixed" });
  const showMysteryVar = gt === "mystery";
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
            disabled={isBattleRoyale}
            onChange={(e) => {
              if (isBattleRoyale) return;
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
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    };
  }, []);
  const clearCommitTimer = () => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };
  const display =
    draft !== null ? draft : Number.isFinite(value) ? formatStepDisplay(value, step) : "";
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
        const raw = normalizeNumericDraft(e.target.value);
        setDraft(raw);
        clearCommitTimer();
        const next = normalizeDraftValue(raw, min, max, step);
        if (next === null) return;
        commitTimerRef.current = setTimeout(() => {
          startTransition(() => {
            if (!numbersEqual(next, value)) onChange(next);
          });
        }, 140);
      }}
      onBlur={() => {
        clearCommitTimer();
        commitDraft(
          draft,
          value,
          min,
          max,
          step,
          (next) => startTransition(() => onChange(next)),
          setDraft,
        );
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearCommitTimer();
          commitDraft(
            draft,
            value,
            min,
            max,
            step,
            (next) => startTransition(() => onChange(next)),
            setDraft,
          );
        } else if (e.key === "Escape") {
          e.preventDefault();
          clearCommitTimer();
          setDraft(null);
        }
      }}
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

function stepDecimals(step: number | undefined): number {
  if (step === undefined || !Number.isFinite(step) || step <= 0) return 0;
  const text = step.toString().toLowerCase();
  if (text.includes("e-")) {
    const exp = Number(text.split("e-")[1]);
    return Number.isFinite(exp) ? exp : 0;
  }
  return text.split(".")[1]?.length ?? 0;
}

function roundToDecimals(value: number, decimals: number): number {
  if (decimals <= 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9;
}

function normalizeDraftValue(
  raw: string,
  min: number | undefined,
  max: number | undefined,
  step: number | undefined,
): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  let next = parsed;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  if (step !== undefined && Number.isFinite(step) && step > 0) {
    const decimals = stepDecimals(step);
    const base = min ?? 0;
    next = base + Math.round((next - base) / step) * step;
    next = roundToDecimals(next, decimals);
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
  }
  return next;
}

function formatStepDisplay(value: number, step: number | undefined): string {
  if (!Number.isFinite(value)) return "";
  const decimals = stepDecimals(step);
  const rounded = roundToDecimals(value, decimals);
  return decimals > 0 ? rounded.toFixed(decimals).replace(/\.?0+$/, "") : String(rounded);
}

function commitDraft(
  draft: string | null,
  value: number,
  min: number | undefined,
  max: number | undefined,
  step: number | undefined,
  onChange: (v: number) => void,
  setDraft: (v: string | null) => void,
) {
  if (draft === null) return;
  const next = normalizeDraftValue(draft, min, max, step);
  if (next === null) {
    setDraft(null);
    return;
  }
  if (!numbersEqual(next, value)) onChange(next);
  setDraft(null);
}

// Shared input chrome for the schedule table — always-visible border + fill
// so fields read as "editable" at a glance, accent focus ring for the hit.
const INPUT_BASE =
  "h-8 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/70 px-2 text-[13px] text-[color:var(--color-fg)] outline-none transition-colors placeholder:text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev-2)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-bg)]";

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
// Stored buy-in is the prize-pool portion of GG's published total ticket.
// GG markets BR as 8% of total ticket; under the app's MTT contract that
// becomes fee / net-buy-in ~= 8.6957%, e.g. $10 -> 9.20+0.80.
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
const BR_RAKE = BATTLE_ROYALE_INTERNAL_RAKE;
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

export function suggestStandardBuyInFromBrCarryover(
  buyIn: number,
  rake: number,
): { buyIn: number; rake: number } | null {
  if (Math.abs(rake - BR_RAKE) > 0.0001) return null;
  const preset = brPresetMatch(buyIn, rake);
  if (!preset) return null;
  return { buyIn: preset.total, rake: 0.1 };
}

// Tier colour escalates with reported ROI: cool → warm → hot, so even at a
// glance the row radiates "this field beats the regs" vs "this field is soft".
// Colours reuse the existing suit palette (see globals.css) — nothing new.
const BR_REPORTED_ROI_PRESETS = [
  { id: "low", reportedRoi: 0.03, labelKey: "row.brRoi.preset.low", tint: "var(--c-spade)" },
  { id: "goodLow", reportedRoi: 0.05, labelKey: "row.brRoi.preset.goodLow", tint: "var(--c-rival)" },
  { id: "goodHigh", reportedRoi: 0.07, labelKey: "row.brRoi.preset.goodHigh", tint: "var(--c-club)" },
  { id: "top", reportedRoi: 0.1, labelKey: "row.brRoi.preset.top", tint: "var(--c-accent)" },
] as const;

function formatPct(v: number, digits = 1): string {
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

function roundRoiToWholePct(roi: number): number {
  return Math.round(roi * 100) / 100;
}

function BrReportedRoiControl({
  row,
  globalRakebackPct,
  onApply,
}: {
  row: TournamentRow;
  globalRakebackPct: number;
  onApply: (preRakebackRoi: number) => void;
}) {
  const t = useT();
  const rbPct = Math.max(0, globalRakebackPct);
  const rbRoi = rakebackRoiContribution(row.rake, rbPct);
  const reportedRoi = reportedRoiFromPreRakebackRoi(row.roi, row.rake, rbPct);
  const title = t("row.brRoi.title")
    .replace("{rbPct}", `${rbPct.toFixed(0)}%`)
    .replace("{rbRoi}", formatPct(rbRoi))
    .replace("{reported}", formatPct(reportedRoi))
    .replace("{field}", formatPct(row.roi));
  return (
    <div className="w-full min-w-0" title={title}>
      <div
        className="mb-1 flex items-center justify-between px-0.5 text-[8px] font-medium uppercase leading-none tracking-[0.08em] text-[color:var(--color-fg-dim)]"
      >
        <span className="truncate">{t("row.brRoi.short")}</span>
        <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--color-fg-muted)]">
          {formatPct(reportedRoi)}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-0.5 rounded-md border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg)]/45 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        {BR_REPORTED_ROI_PRESETS.map((p) => {
          const fieldRoi = preRakebackRoiFromReportedRoi(
            p.reportedRoi,
            row.rake,
            rbPct,
          );
          const roundedFieldRoi = roundRoiToWholePct(fieldRoi);
          const isActive = Math.abs(roundedFieldRoi - row.roi) < 0.0001;
          const optionTitle = t(p.labelKey)
            .replace("{reported}", formatPct(p.reportedRoi))
            .replace("{field}", formatPct(roundedFieldRoi));
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onApply(roundedFieldRoi)}
              className={
                "h-7 min-w-0 rounded-[5px] px-0.5 text-[10px] font-semibold tabular-nums transition-colors focus:outline-none " +
                (isActive
                  ? ""
                  : "hover:bg-[color:var(--color-bg-elev-2)]/80 focus:bg-[color:var(--color-bg-elev-2)]/80")
              }
              title={optionTitle}
              aria-label={optionTitle}
              aria-pressed={isActive}
              style={{
                minHeight: 28,
                minWidth: 0,
                color: isActive
                  ? p.tint
                  : `color-mix(in oklab, ${p.tint}, var(--c-fg-muted) 38%)`,
                background: isActive
                  ? `color-mix(in oklab, ${p.tint}, transparent 78%)`
                  : undefined,
                boxShadow: isActive
                  ? `inset 0 0 0 1px color-mix(in oklab, ${p.tint}, transparent 18%)`
                  : undefined,
              }}
            >
              {(p.reportedRoi * 100).toFixed(0)}
            </button>
          );
        })}
      </div>
    </div>
  );
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
        onApply(battleRoyaleRowFromTotalTicket(p.total));
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
  value: VisibleGameType;
  onChange: (next: VisibleGameType) => void;
}) {
  const t = useT();
  const fullLabel = (g: VisibleGameType): string => {
    switch (g) {
      case "freezeout":
        return t("row.gameType.freezeout");
      case "pko":
        return t("row.gameType.pko");
      case "mystery":
        return t("row.gameType.mystery");
      case "mystery-royale":
        return t("row.gameType.mysteryRoyale");
    }
  };
  const optionLabel = (g: VisibleGameType): string =>
    g === "mystery-royale" ? "GG BR" : fullLabel(g);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as VisibleGameType)}
      title={fullLabel(value)}
      className="h-8 w-full min-w-0 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-left text-[11px] text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
    >
      {VISIBLE_GAME_TYPE_ORDER.map((g) => (
        <option key={g} value={g}>
          {optionLabel(g)}
        </option>
      ))}
    </select>
  );
}

function BuyInInput({
  gameType,
  buyIn,
  rake,
  onChange,
}: {
  gameType: VisibleGameType;
  buyIn: number;
  rake: number;
  onChange: (buyIn: number, rake: number) => void;
}) {
  const t = useT();
  const canonical = formatBuyIn(buyIn, rake);
  const [local, setLocal] = useState(canonical);
  const [focused, setFocused] = useState(false);
  if (!focused && local !== canonical) setLocal(canonical);
  const parsed = parseBuyIn(local, rake);
  const invalid = local.trim() !== "" && parsed === null;
  const snapSuggestion =
    gameType === "mystery-royale"
      ? null
      : suggestStandardBuyInFromBrCarryover(buyIn, rake);
  const snapLabel = snapSuggestion
    ? formatBuyIn(snapSuggestion.buyIn, snapSuggestion.rake)
    : "";
  return (
    <div className="flex w-full flex-col items-center gap-1">
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
          " w-full text-center tabular-nums " +
          (invalid ? "!border-[color:var(--color-danger)]/70" : "")
        }
      />
      {snapSuggestion && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFocused(false);
            setLocal(snapLabel);
            startTransition(() =>
              onChange(snapSuggestion.buyIn, snapSuggestion.rake),
            );
          }}
          className="max-w-full rounded-full border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg)]/55 px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)]/65 hover:text-[color:var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]/55"
          title={t("row.buyIn.normalizeBrHint").replace("{value}", snapLabel)}
        >
          {t("row.buyIn.normalizeBr").replace("{value}", snapLabel)}
        </button>
      )}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  step,
  min,
  max,
  commitMode = "change",
  className = "",
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  commitMode?: "change" | "blur";
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    };
  }, []);
  const clearCommitTimer = () => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };
  const display =
    draft !== null ? draft : Number.isFinite(value) ? formatStepDisplay(value, step) : "";
  const invalid = computeInvalid(draft, min, max);
  return (
    <input
      type="number"
      value={display}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      inputMode="decimal"
      onChange={(e) => {
        if (disabled) return;
        const raw = e.target.value;
        setDraft(raw);
        clearCommitTimer();
        if (commitMode === "blur") return;
        const next = normalizeDraftValue(raw, min, max, step);
        if (next === null) return;
        commitTimerRef.current = setTimeout(() => {
          startTransition(() => {
            if (!numbersEqual(next, value)) onChange(next);
          });
        }, 140);
      }}
      onBlur={() => {
        if (disabled) return;
        clearCommitTimer();
        commitDraft(
          draft,
          value,
          min,
          max,
          step,
          (next) => startTransition(() => onChange(next)),
          setDraft,
        );
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter") {
          e.preventDefault();
          clearCommitTimer();
          commitDraft(
            draft,
            value,
            min,
            max,
            step,
            (next) => startTransition(() => onChange(next)),
            setDraft,
          );
        } else if (e.key === "Escape") {
          e.preventDefault();
          clearCommitTimer();
          setDraft(null);
        }
      }}
      className={
        INPUT_BASE +
        " w-full text-center tabular-nums disabled:cursor-not-allowed disabled:opacity-55 " +
        className +
        " " +
        (invalid ? "!border-rose-500/70 ring-1 ring-rose-500/30" : "")
      }
    />
  );
}

function PercentNumInput(
  props: React.ComponentProps<typeof NumInput>,
) {
  return (
    <div className="relative w-full">
      <NumInput {...props} className="pr-7" />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-medium tabular-nums text-[color:var(--color-fg-dim)]">
        %
      </span>
    </div>
  );
}

function PercentDraftInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  disabled,
  lockedLabel,
}: {
  value: number | "";
  onChange: (raw: string) => void;
  min: number;
  max: number;
  step: number;
  placeholder?: string;
  disabled?: boolean;
  lockedLabel?: string;
}) {
  return (
    <div className="relative w-full">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          if (disabled) return;
          const raw = normalizeNumericDraft(e.target.value);
          if (raw !== e.target.value) e.target.value = raw;
          onChange(raw);
        }}
        className={
          INPUT_BASE +
          " w-full pr-7 text-center tabular-nums disabled:cursor-not-allowed disabled:border-[color:var(--color-border)]/70 disabled:bg-[color:var(--color-bg-elev)]/55 disabled:text-[color:var(--color-fg-muted)]"
        }
      />
      {lockedLabel ? (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
          {lockedLabel}
        </span>
      ) : (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-medium tabular-nums text-[color:var(--color-fg-dim)]">
          %
        </span>
      )}
    </div>
  );
}

function RoomBadge({ payoutId }: { payoutId: PayoutStructureId }) {
  const room = PAYOUT_ROOM[payoutId];
  if (!room) return null;
  const meta = ROOM_META[room];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 20px decorative room mark; static SVG, no LCP payoff from next/image.
    <img
      src={meta.src}
      alt={meta.label}
      title={meta.label}
      width={20}
      height={20}
      className="h-5 w-5 shrink-0 rounded-[4px] shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
      loading="lazy"
      decoding="async"
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
      data-compact-icon-button="true"
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={
        "inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-fg)]/5 disabled:cursor-not-allowed disabled:opacity-20 " +
        (danger ? "hover:text-[color:var(--color-danger)]" : "hover:text-[color:var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}
