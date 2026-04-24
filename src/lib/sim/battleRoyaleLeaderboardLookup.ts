import type {
  BattleRoyaleLeaderboardLookupEntry,
  BattleRoyaleLeaderboardLookupSnapshot,
} from "./types";

export interface BattleRoyaleLeaderboardLookupDay {
  snapshotId: string;
  label?: string;
  entries: number;
  rank: number | null;
  points: number | null;
  prize: number;
}

export interface BattleRoyaleLeaderboardLookupAnalysis {
  tournamentsPerDay: number;
  pointsPerTournament: number;
  targetPoints: number;
  snapshotCount: number;
  averageDailyPrize: number;
  payoutPerTournament: number;
  paidDays: number;
  days: BattleRoyaleLeaderboardLookupDay[];
}

export interface BattleRoyaleLeaderboardParseResult {
  entries: BattleRoyaleLeaderboardLookupEntry[];
  rejectedRows: number;
}

const MAX_SNAPSHOT_ENTRIES = 5_000;
const MAX_SNAPSHOTS = 60;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(text: string): string {
  return decodeEntities(
    text
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseLooseNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d.,\-]/g, "")
    .replace(/^-+/, "-")
    .trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") {
    return null;
  }

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  let normalized = unsigned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = unsigned
      .replace(new RegExp(`\\${thousandSep}`, "g"), "")
      .replace(decimalSep, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const idx = lastComma >= 0 ? lastComma : lastDot;
    const tail = unsigned.slice(idx + 1);
    const head = unsigned.slice(0, idx);
    const isThousands =
      tail.length === 3 && /^\d+$/.test(tail) && /^\d{1,3}([\s.,]\d{3})*$/.test(unsigned);
    normalized = isThousands ? head + tail : unsigned.replace(sep, ".");
  }

  const n = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(n) ? n : null;
}

function parseMoneyFromCell(cell: string): number | null {
  const normalized = cell.replace(/\s+/g, " ").trim();
  if (!/[$€£₽₴]|usd|eur|uah|rub/i.test(normalized)) return null;
  const match =
    normalized.match(/(?:[$€£₽₴]|usd|eur|uah|rub)\s*([+-]?[\d][\d\s.,]*)/i) ??
    normalized.match(/([+-]?[\d][\d\s.,]*)\s*(?:[$€£₽₴]|usd|eur|uah|rub)/i);
  if (!match) return null;
  const parsed = parseLooseNumber(match[1]);
  return parsed == null ? null : Math.max(0, parsed);
}

function parseRankFromCell(cell: string): number | null {
  const match = cell.match(/(?:^|\s|#)(\d{1,6})(?:st|nd|rd|th)?(?:\s|$|[).:#-])/i);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank >= 1 ? rank : null;
}

function numericCandidates(cell: string): number[] {
  return [...cell.matchAll(/[+-]?\d[\d\s.,]*/g)]
    .map((m) => parseLooseNumber(m[0]))
    .filter((n): n is number => n != null && Number.isFinite(n));
}

function parseEntryFromCells(
  rawCells: readonly string[],
): BattleRoyaleLeaderboardLookupEntry | null {
  const cells = rawCells.map((cell) => stripTags(cell)).filter(Boolean);
  if (cells.length < 3) return null;

  let rank: number | null = null;
  let rankCell = -1;
  for (let i = 0; i < cells.length; i++) {
    const parsed = parseRankFromCell(cells[i]);
    if (parsed != null && parsed <= 1_000_000) {
      rank = parsed;
      rankCell = i;
      break;
    }
  }
  if (rank == null) return null;

  let prize: number | null = null;
  let prizeCell = -1;
  for (let i = cells.length - 1; i >= 0; i--) {
    const parsed = parseMoneyFromCell(cells[i]);
    if (parsed != null) {
      prize = parsed;
      prizeCell = i;
      break;
    }
  }
  if (prize == null) return null;

  const candidates: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (i === rankCell || i === prizeCell) continue;
    for (const n of numericCandidates(cells[i])) {
      if (n >= 0 && n <= 100_000_000) candidates.push(n);
    }
  }
  if (candidates.length === 0) return null;
  const points = Math.max(...candidates);
  if (!(points > 0)) return null;

  const nickname =
    cells.find((cell, idx) => idx !== rankCell && idx !== prizeCell && !/\d/.test(cell)) ??
    undefined;
  return { rank, points, prize, nickname };
}

function parseHtmlTableRows(source: string): BattleRoyaleLeaderboardLookupEntry[] {
  const entries: BattleRoyaleLeaderboardLookupEntry[] = [];
  const rowMatches = [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => m[1],
    );
    const entry = parseEntryFromCells(cells.length > 0 ? cells : [row[1]]);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseDelimitedTextRows(source: string): BattleRoyaleLeaderboardLookupEntry[] {
  const entries: BattleRoyaleLeaderboardLookupEntry[] = [];
  const lines = decodeEntities(source)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|div|li|p)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cells = line.split(/\t+|\s{2,}|\s+[|·]\s+/).filter(Boolean);
    const entry = parseEntryFromCells(cells.length >= 3 ? cells : [line]);
    if (entry) entries.push(entry);
  }
  return entries;
}

function findJsonLikeValue(fragment: string, keys: readonly string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `["']?${key}["']?\\s*:\\s*(?:"([^"]+)"|'([^']+)'|([^,}]+))`,
      "i",
    );
    const match = fragment.match(re);
    if (match) return (match[1] ?? match[2] ?? match[3] ?? "").trim();
  }
  return null;
}

function parseJsonLikeRows(source: string): BattleRoyaleLeaderboardLookupEntry[] {
  const entries: BattleRoyaleLeaderboardLookupEntry[] = [];
  const fragments = [...source.matchAll(/\{[^{}]{20,1200}\}/g)].map((m) => m[0]);
  for (const fragment of fragments) {
    const rankRaw = findJsonLikeValue(fragment, ["rank", "place", "position"]);
    const pointsRaw = findJsonLikeValue(fragment, ["points", "score", "lbPoints"]);
    const prizeRaw = findJsonLikeValue(fragment, ["prize", "payout", "reward", "amount"]);
    if (!rankRaw || !pointsRaw || !prizeRaw) continue;
    const rank = parseLooseNumber(rankRaw);
    const points = parseLooseNumber(pointsRaw);
    const prize = /[$€£₽₴]|usd|eur|uah|rub/i.test(prizeRaw)
      ? parseMoneyFromCell(prizeRaw)
      : parseLooseNumber(prizeRaw);
    if (
      rank == null ||
      points == null ||
      prize == null ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      points <= 0 ||
      prize < 0
    ) {
      continue;
    }
    const nickname =
      findJsonLikeValue(fragment, ["nickname", "nick", "player", "screenName"]) ??
      undefined;
    entries.push({
      rank,
      points,
      prize,
      nickname: nickname?.slice(0, 80),
    });
  }
  return entries;
}

function dedupeAndSortEntries(
  entries: readonly BattleRoyaleLeaderboardLookupEntry[],
): BattleRoyaleLeaderboardLookupEntry[] {
  const byRank = new Map<number, BattleRoyaleLeaderboardLookupEntry>();
  for (const entry of entries) {
    if (
      !Number.isInteger(entry.rank) ||
      entry.rank < 1 ||
      !Number.isFinite(entry.points) ||
      entry.points < 0 ||
      !Number.isFinite(entry.prize) ||
      entry.prize < 0
    ) {
      continue;
    }
    const prev = byRank.get(entry.rank);
    if (!prev || entry.points > prev.points || entry.prize > prev.prize) {
      byRank.set(entry.rank, {
        rank: Math.floor(entry.rank),
        points: Math.max(0, entry.points),
        prize: Math.max(0, entry.prize),
        nickname: entry.nickname?.slice(0, 80),
      });
    }
  }
  return [...byRank.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SNAPSHOT_ENTRIES);
}

export function parseBattleRoyaleLeaderboardSnapshot(
  source: string,
): BattleRoyaleLeaderboardParseResult {
  const tableRows = parseHtmlTableRows(source);
  const fallbackRows =
    tableRows.length > 0
      ? []
      : [...parseJsonLikeRows(source), ...parseDelimitedTextRows(source)];
  const entries = dedupeAndSortEntries(tableRows.length > 0 ? tableRows : fallbackRows);
  return {
    entries,
    rejectedRows: Math.max(0, tableRows.length || fallbackRows.length) - entries.length,
  };
}

export function normalizeBattleRoyaleLeaderboardLookupSnapshots(
  value: unknown,
): BattleRoyaleLeaderboardLookupSnapshot[] {
  if (!Array.isArray(value)) return [];
  const snapshots: BattleRoyaleLeaderboardLookupSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const rawEntries = Array.isArray(rec.entries) ? rec.entries : [];
    const entries = dedupeAndSortEntries(
      rawEntries.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return { rank: 0, points: 0, prize: 0 };
        }
        const e = entry as Record<string, unknown>;
        return {
          rank: typeof e.rank === "number" ? e.rank : 0,
          points: typeof e.points === "number" ? e.points : 0,
          prize: typeof e.prize === "number" ? e.prize : 0,
          nickname: typeof e.nickname === "string" ? e.nickname : undefined,
        };
      }),
    );
    if (entries.length === 0) continue;
    snapshots.push({
      id:
        typeof rec.id === "string" && rec.id
          ? rec.id.slice(0, 80)
          : `lb-${snapshots.length + 1}`,
      label:
        typeof rec.label === "string" && rec.label
          ? rec.label.slice(0, 80)
          : undefined,
      entries,
    });
    if (snapshots.length >= MAX_SNAPSHOTS) break;
  }
  return snapshots;
}

export function findBattleRoyaleLeaderboardDayPayout(
  snapshot: BattleRoyaleLeaderboardLookupSnapshot,
  targetPoints: number,
): BattleRoyaleLeaderboardLookupDay {
  const byPoints = snapshot.entries
    .filter((entry) => entry.points >= 0)
    .sort((a, b) => b.points - a.points || a.rank - b.rank);
  const matched = byPoints.find((entry) => targetPoints >= entry.points);
  return {
    snapshotId: snapshot.id,
    label: snapshot.label,
    entries: snapshot.entries.length,
    rank: matched?.rank ?? null,
    points: matched?.points ?? null,
    prize: matched?.prize ?? 0,
  };
}

export function analyzeBattleRoyaleLeaderboardLookup(params: {
  tournamentsPerDay: number;
  pointsPerTournament: number;
  snapshots: readonly BattleRoyaleLeaderboardLookupSnapshot[];
}): BattleRoyaleLeaderboardLookupAnalysis {
  const tournamentsPerDay = Number.isFinite(params.tournamentsPerDay)
    ? Math.max(0, params.tournamentsPerDay)
    : 0;
  const pointsPerTournament = Number.isFinite(params.pointsPerTournament)
    ? Math.max(0, params.pointsPerTournament)
    : 0;
  const targetPoints = tournamentsPerDay * pointsPerTournament;
  const snapshots = params.snapshots.filter((snapshot) => snapshot.entries.length > 0);
  const days =
    targetPoints > 0
      ? snapshots.map((snapshot) =>
          findBattleRoyaleLeaderboardDayPayout(snapshot, targetPoints),
        )
      : [];
  const averageDailyPrize =
    days.length > 0
      ? days.reduce((acc, day) => acc + day.prize, 0) / days.length
      : 0;
  return {
    tournamentsPerDay,
    pointsPerTournament,
    targetPoints,
    snapshotCount: days.length,
    averageDailyPrize,
    payoutPerTournament:
      tournamentsPerDay > 0 ? averageDailyPrize / tournamentsPerDay : 0,
    paidDays: days.filter((day) => day.prize > 0).length,
    days,
  };
}
