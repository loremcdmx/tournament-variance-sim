import type { BattleRoyaleLeaderboardObservedPointsByStake } from "./types";

export interface BattleRoyaleLeaderboardObservedImport {
  totalPrizes: number | null;
  totalTournaments: number | null;
  pointsByStake: Partial<BattleRoyaleLeaderboardObservedPointsByStake>;
}

const STAKES = ["0.25", "1", "3", "10", "25"] as const;

function parseLooseNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "")
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
    const isThousands = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(
      unsigned,
    );
    normalized =
      tail.length === 3 && /^\d+$/.test(tail) && isThousands
        ? unsigned.replace(new RegExp(`\\${sep}`, "g"), "")
        : unsigned.replace(sep, ".");
  }
  const n = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(source: string): string {
  return source
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n");
}

function readNumberAfterLabel(
  lines: readonly string[],
  labels: readonly RegExp[],
): number | null {
  for (const line of lines) {
    if (!labels.some((label) => label.test(line))) continue;
    const tail = line.split(/[:=]/).slice(1).join(":") || line;
    const candidates = [...tail.matchAll(/[$€£₽₴]?\s*-?\d[\d\s.,]*/g)]
      .map((m) => parseLooseNumber(m[0]))
      .filter((n): n is number => n != null);
    if (candidates.length > 0) return Math.max(0, candidates[candidates.length - 1]);
  }
  return null;
}

function readStakePoints(
  lines: readonly string[],
  stake: (typeof STAKES)[number],
): number | null {
  const stakePattern = stake === "0.25" ? "0[.,]25" : stake;
  const patterns = [
    new RegExp(`(?:pts|points|очки|поинты)\\s*\\$?\\s*${stakePattern}\\b`, "i"),
    new RegExp(`\\$\\s*${stakePattern}\\b.*(?:pts|points|очки|поинты)`, "i"),
  ];
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const tail = line.split(/[:=]/).slice(1).join(":") || line;
    const matches = [...tail.matchAll(/-?\d[\d\s.,]*/g)];
    const parsed = matches
      .map((m) => parseLooseNumber(m[0]))
      .filter((n): n is number => n != null && n !== Number(stake));
    if (parsed.length > 0) return Math.max(0, parsed[parsed.length - 1]);
  }
  return null;
}

function readJsonObject(source: string): unknown | null {
  const trimmed = source.trim();
  const candidates = [
    trimmed,
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function walkJson(
  value: unknown,
  visit: (key: string, value: unknown) => void,
  key = "",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => walkJson(item, visit, `${key}.${idx}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value)) {
    const path = key ? `${key}.${childKey}` : childKey;
    visit(path, childValue);
    walkJson(childValue, visit, path);
  }
}

function parseJsonImport(source: string): BattleRoyaleLeaderboardObservedImport {
  const json = readJsonObject(source);
  const result: BattleRoyaleLeaderboardObservedImport = {
    totalPrizes: null,
    totalTournaments: null,
    pointsByStake: {},
  };
  if (json == null) return result;
  walkJson(json, (key, value) => {
    const lower = key.toLowerCase();
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseLooseNumber(value)
          : null;
    if (n == null) return;
    if (
      result.totalPrizes == null &&
      /(lb|leaderboard).*(prize|reward|winning)|observedtotalprizes/.test(lower)
    ) {
      result.totalPrizes = Math.max(0, n);
    }
    if (
      result.totalTournaments == null &&
      /(battle.*royale|br|tournament).*(count|total|used|played|usage)|observedtotaltournaments/.test(
        lower,
      )
    ) {
      result.totalTournaments = Math.max(0, Math.floor(n));
    }
    for (const stake of STAKES) {
      const stakeKey = stake === "0.25" ? "0[._,-]?25" : stake;
      if (
        result.pointsByStake[stake] == null &&
        new RegExp(`(pts|points|score).*${stakeKey}|${stakeKey}.*(pts|points|score)`).test(
          lower,
        )
      ) {
        result.pointsByStake[stake] = Math.max(0, Math.floor(n));
      }
    }
  });
  return result;
}

export function parseBattleRoyaleLeaderboardObservedImport(
  source: string,
): BattleRoyaleLeaderboardObservedImport {
  const jsonResult = parseJsonImport(source);
  const text = normalizeText(source);
  const lines = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|div|li|p)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const pointsByStake = { ...jsonResult.pointsByStake };
  for (const stake of STAKES) {
    pointsByStake[stake] ??= readStakePoints(lines, stake) ?? undefined;
  }
  return {
    totalPrizes:
      jsonResult.totalPrizes ??
      readNumberAfterLabel(lines, [
        /\b(lb|leaderboard)\b.*\b(prizes?|rewards?|winnings?)\b/i,
        /\bobserved\b.*\blb\b.*\bprizes?\b/i,
        /\bприз\w*\b.*\b(лб|leaderboard|лидерборд)\b/i,
      ]),
    totalTournaments:
      jsonResult.totalTournaments ??
      readNumberAfterLabel(lines, [
        /^\s*(?:observed\s*)?(?:br\s*)?(?:tournaments?|tourneys?)\b/i,
        /\b(tournaments?|tourneys?)\b.*\b(profile|played|used|usage)\b/i,
        /\b(profile|played|used|usage)\b.*\b(tournaments?|tourneys?)\b/i,
        /\bтурнир\w*\b.*\b(профил|сыгран|использ)/i,
      ]),
    pointsByStake,
  };
}
