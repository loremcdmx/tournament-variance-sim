import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Stake = "0.25" | "1" | "3" | "10" | "25";

interface GroupResponse {
  promotions?: unknown;
}

interface PromotionWrapper {
  promotionId?: unknown;
  promotion?: {
    name?: unknown;
    status?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
  };
}

interface PrizeRow {
  maxWinners?: unknown;
  winners?: unknown;
}

interface LeaderboardRow {
  rank?: unknown;
  point?: unknown;
  prize?: {
    value?: unknown;
  };
}

interface Snapshot {
  stake: Stake;
  date: string;
  promotionId: number;
  entries: [rank: number, points: number, prize: number][];
}

interface CachedRowsFile {
  filePath: string;
  limit: number;
}

interface Options {
  groupId: number;
  days: number;
  from: string | null;
  to: string | null;
  cacheDir: string;
  cacheOnly: boolean;
  delayMs: number;
  strict: boolean;
  output: string;
}

const STAKES: Stake[] = ["0.25", "1", "3", "10", "25"];
const BASE_URL = "https://pml.good-game-service.com";
const DEFAULT_GROUP_ID = 1328;
const DEFAULT_CACHE_DIR = path.join("scripts", "br_leaderboard_cache");
const DEFAULT_OUTPUT = path.join(
  "src",
  "lib",
  "sim",
  "battleRoyaleLeaderboardManualData.ts",
);
let lastFetchAt = 0;
let requestDelayMs = 750;

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    groupId: DEFAULT_GROUP_ID,
    days: 5,
    from: null,
    to: null,
    cacheDir: DEFAULT_CACHE_DIR,
    cacheOnly: false,
    delayMs: 750,
    strict: false,
    output: DEFAULT_OUTPUT,
  };

  for (const arg of argv) {
    if (arg === "--cache-only") options.cacheOnly = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg.startsWith("--group-id=")) {
      options.groupId = Number(arg.slice("--group-id=".length));
    } else if (arg.startsWith("--days=")) {
      options.days = Number(arg.slice("--days=".length));
    } else if (arg.startsWith("--from=")) {
      options.from = arg.slice("--from=".length);
    } else if (arg.startsWith("--to=")) {
      options.to = arg.slice("--to=".length);
    } else if (arg.startsWith("--cache-dir=")) {
      options.cacheDir = arg.slice("--cache-dir=".length);
    } else if (arg.startsWith("--delay-ms=")) {
      options.delayMs = Number(arg.slice("--delay-ms=".length));
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.groupId) || options.groupId <= 0) {
    throw new Error("--group-id must be a positive integer");
  }
  if (!Number.isInteger(options.days) || options.days <= 0) {
    throw new Error("--days must be a positive integer");
  }
  if (options.from != null && !/^\d{4}-\d{2}-\d{2}$/.test(options.from)) {
    throw new Error("--from must be YYYY-MM-DD");
  }
  if (options.to != null && !/^\d{4}-\d{2}-\d{2}$/.test(options.to)) {
    throw new Error("--to must be YYYY-MM-DD");
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative integer");
  }
  return options;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stakeFromName(name: unknown): Stake | null {
  if (typeof name !== "string") return null;
  const match = name.match(/\$(0\.25|1|3|10|25)\)/);
  return match ? (match[1] as Stake) : null;
}

function dateFromStartedAt(startedAt: unknown): string | null {
  return typeof startedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(startedAt)
    ? startedAt.slice(0, 10)
    : null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const now = Date.now();
  const waitMs = Math.max(0, lastFetchAt + requestDelayMs - now);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastFetchAt = Date.now();
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      referer:
        "https://pml.good-game-service.com/pm-leaderboard/group?groupId=1328&lang=en&timezone=UTC-8",
      "user-agent":
        "Mozilla/5.0 (compatible; tournament-variance-sim data refresh)",
    },
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? `; retry-after=${retryAfter}s` : "";
    throw new Error(`HTTP ${response.status} for ${url}${suffix}`);
  }
  return response.json();
}

async function readOrFetchJson(params: {
  cachePath: string;
  cacheOnly: boolean;
  url: string;
}): Promise<unknown> {
  const cached = await readJsonFile(params.cachePath);
  if (cached != null) return cached;
  if (params.cacheOnly) {
    throw new Error(`Missing cache file: ${params.cachePath}`);
  }
  const fresh = await fetchJson(params.url);
  await mkdir(path.dirname(params.cachePath), { recursive: true });
  await writeFile(params.cachePath, stableStringify(fresh));
  return fresh;
}

function groupPromotions(group: unknown): PromotionWrapper[] {
  const rec = asRecord(group) as GroupResponse | null;
  return Array.isArray(rec?.promotions)
    ? (rec.promotions.filter((item) => asRecord(item)) as PromotionWrapper[])
    : [];
}

function selectPromotions(group: unknown, options: Options): PromotionWrapper[] {
  const rows = groupPromotions(group)
    .filter((row) => row.promotion?.status === "FINISHED")
    .filter((row) => stakeFromName(row.promotion?.name) != null)
    .filter((row) => dateFromStartedAt(row.promotion?.startedAt) != null);

  if (options.from != null || options.to != null) {
    return rows.filter((row) => {
      const date = dateFromStartedAt(row.promotion?.startedAt)!;
      return (
        (options.from == null || date >= options.from) &&
        (options.to == null || date <= options.to)
      );
    });
  }

  const dates = [
    ...new Set(
      rows
        .map((row) => dateFromStartedAt(row.promotion?.startedAt))
        .filter((date): date is string => date != null),
    ),
  ]
    .sort()
    .slice(-options.days);
  return rows.filter((row) => dates.includes(dateFromStartedAt(row.promotion?.startedAt)!));
}

function maxPaidRank(prizes: unknown): number {
  const ranks = paidRanks(prizes);
  return ranks.length > 0 ? ranks[ranks.length - 1] : 0;
}

function paidRanks(prizes: unknown): number[] {
  if (!Array.isArray(prizes)) return [];
  return [
    ...new Set(
      prizes
        .map((raw) => {
          const row = raw as PrizeRow;
          const maxWinners = finiteNumber(row.maxWinners);
          const winners = finiteNumber(row.winners);
          return Math.floor(maxWinners ?? winners ?? 0);
        })
        .filter((rank) => rank > 0),
    ),
  ].sort((a, b) => a - b);
}

function leaderboardRowsByRank(rows: unknown): Map<number, [number, number, number]> {
  const byRank = new Map<number, [number, number, number]>();
  if (!Array.isArray(rows)) return byRank;
  for (const raw of rows) {
    const row = raw as LeaderboardRow;
    const rank = finiteNumber(row.rank);
    const points = finiteNumber(row.point);
    const prize = finiteNumber(row.prize?.value);
    if (
      rank == null ||
      points == null ||
      prize == null ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      points < 0 ||
      prize < 0
    ) {
      continue;
    }
    byRank.set(rank, [rank, points, prize]);
  }
  return byRank;
}

function selectTierBoundaryEntries(
  prizes: unknown,
  rows: unknown,
): Snapshot["entries"] {
  const byRank = leaderboardRowsByRank(rows);
  const ranks = paidRanks(prizes);
  return ranks
    .map((rank) => byRank.get(rank))
    .filter((entry): entry is [number, number, number] => entry != null)
    .sort((a, b) => a[0] - b[0]);
}

async function findCachedRowsFile(params: {
  cacheDir: string;
  limit: number;
  promotionId: number;
}): Promise<CachedRowsFile | null> {
  let names: string[];
  try {
    names = await readdir(params.cacheDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const prefix = `br-${params.promotionId}-l`;
  return (
    names
      .map((name) => {
        if (!name.startsWith(prefix) || !name.endsWith(".json")) return null;
        const limit = Number(name.slice(prefix.length, -".json".length));
        return Number.isInteger(limit) && limit >= params.limit
          ? { filePath: path.join(params.cacheDir, name), limit }
          : null;
      })
      .filter((file): file is CachedRowsFile => file != null)
      .sort((a, b) => a.limit - b.limit)[0] ?? null
  );
}

async function readOrFetchLeaderboardRows(params: {
  cacheDir: string;
  cacheOnly: boolean;
  limit: number;
  promotionId: number;
}): Promise<unknown> {
  const exactPath = path.join(
    params.cacheDir,
    `br-${params.promotionId}-l${params.limit}.json`,
  );
  const exact = await readJsonFile(exactPath);
  if (exact != null) return exact;
  const cachedRows = await findCachedRowsFile(params);
  if (cachedRows != null) {
    const cached = await readJsonFile(cachedRows.filePath);
    if (cached != null) return cached;
  }
  return readOrFetchJson({
    cachePath: exactPath,
    cacheOnly: params.cacheOnly,
    url: `${BASE_URL}/lapi/leaderboard/${params.promotionId}/?limit=${params.limit}&hasSummary=true`,
  });
}

function parsedRowsCount(rows: unknown): number {
  return leaderboardRowsByRank(rows).size;
}

function missingTierRanks(prizes: unknown, rows: unknown): number[] {
  const byRank = leaderboardRowsByRank(rows);
  return paidRanks(prizes).filter((rank) => !byRank.has(rank));
}

function maxRankFromRows(rows: unknown): number {
  let maxRank = 0;
  for (const rank of leaderboardRowsByRank(rows).keys()) {
    maxRank = Math.max(maxRank, rank);
  }
  return maxRank;
}

async function loadSnapshot(params: {
  cacheDir: string;
  cacheOnly: boolean;
  promotion: PromotionWrapper;
  stake: Stake;
  date: string;
}): Promise<Snapshot> {
  const promotionId = finiteNumber(params.promotion.promotionId);
  if (promotionId == null || !Number.isInteger(promotionId)) {
    throw new Error(`Missing promotionId for ${params.stake} ${params.date}`);
  }

  const prizePath = path.join(params.cacheDir, `br-${promotionId}-prizes.json`);
  const prizes = await readOrFetchJson({
    cachePath: prizePath,
    cacheOnly: params.cacheOnly,
    url: `${BASE_URL}/lapi/leaderboard/${promotionId}/prizes`,
  });
  const limit = Math.max(1, maxPaidRank(prizes));
  const rows = await readOrFetchLeaderboardRows({
    cacheDir: params.cacheDir,
    cacheOnly: params.cacheOnly,
    limit,
    promotionId,
  });
  const entries = selectTierBoundaryEntries(prizes, rows);
  if (entries.length === 0) {
    throw new Error(`No leaderboard rows in ${params.stake} ${params.date}`);
  }
  const missingRanks = missingTierRanks(prizes, rows);
  if (missingRanks.length > 0) {
    throw new Error(
      `Missing ${missingRanks.length} tier ranks; rows=${parsedRowsCount(
        rows,
      )}, maxRank=${maxRankFromRows(rows)}`,
    );
  }
  return {
    stake: params.stake,
    date: params.date,
    promotionId,
    entries,
  };
}

function compactEntry(entry: Snapshot["entries"][number]): string {
  return `[${entry[0]},${entry[1]},${entry[2]}]`;
}

function renderDataFile(params: {
  groupId: number;
  snapshots: readonly Snapshot[];
  warnings: readonly string[];
}): string {
  const byStake = new Map<Stake, Snapshot[]>(
    STAKES.map((stake) => [stake, [] as Snapshot[]]),
  );
  for (const snapshot of params.snapshots) byStake.get(snapshot.stake)!.push(snapshot);
  const dates = params.snapshots.map((snapshot) => snapshot.date).sort();
  const tierCount = params.snapshots.reduce(
    (acc, snapshot) => acc + snapshot.entries.length,
    0,
  );
  const generatedAt = new Date().toISOString().slice(0, 10);
  const from = dates[0] ?? "";
  const to = dates[dates.length - 1] ?? "";
  const warning =
    params.warnings.length > 0
      ? `Incomplete refresh: ${params.warnings.slice(0, 5).join(" | ")}`
      : "Complete refresh from cached/fetched public leaderboard API responses.";

  const stakeBlocks = STAKES.map((stake) => {
    const rows = byStake
      .get(stake)!
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((snapshot) => {
        const entries = snapshot.entries.map(compactEntry).join(",");
        return `    ["${snapshot.date}",${snapshot.promotionId},[${entries}]]`;
      });
    return `  "${stake}": [\n${rows.join(",\n")}\n  ]`;
  }).join(",\n");

  return `import type { BattleRoyaleLeaderboardLookupSnapshot } from "./types";

export const BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES = [
  "0.25",
  "1",
  "3",
  "10",
  "25",
] as const;

export type BattleRoyaleLeaderboardManualStake =
  (typeof BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES)[number];

type RawManualSnapshot = readonly [
  date: string,
  promotionId: number,
  entries: readonly (readonly [rank: number, points: number, prize: number])[],
];

export const BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE = {
  groupId: ${params.groupId},
  sourceUrl: "${BASE_URL}/pm-leaderboard/group?groupId=${params.groupId}&lang=en&timezone=UTC-8",
  timezone: "UTC-8",
  generatedAt: "${generatedAt}",
  finishedDateFrom: "${from}",
  finishedDateTo: "${to}",
  snapshotCount: ${params.snapshots.length},
  tierCount: ${tierCount},
  rateLimitNote: "${warning.replace(/"/g, '\\"')}",
} as const;

const RAW_MANUAL_SNAPSHOTS = {
${stakeBlocks}
} satisfies Record<BattleRoyaleLeaderboardManualStake, readonly RawManualSnapshot[]>;

export function getBattleRoyaleLeaderboardManualSnapshots(
  stake: BattleRoyaleLeaderboardManualStake,
): BattleRoyaleLeaderboardLookupSnapshot[] {
  return RAW_MANUAL_SNAPSHOTS[stake].map(([date, promotionId, entries]) => ({
    id: \`br-\${stake}-\${date}\`,
    label: \`$\${stake} \${date}\`,
    entries: entries.map(([rank, points, prize]) => ({
      rank,
      points,
      prize,
      nickname: \`promotion \${promotionId}\`,
    })),
  }));
}
`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requestDelayMs = options.delayMs;
  const groupCachePath = path.join(
    options.cacheDir,
    `br-group-${options.groupId}.json`,
  );
  const group = await readOrFetchJson({
    cachePath: groupCachePath,
    cacheOnly: options.cacheOnly,
    url: `${BASE_URL}/lapi/leaderboard/groups/${options.groupId}`,
  });
  const promotions = selectPromotions(group, options);
  const snapshots: Snapshot[] = [];
  const warnings: string[] = [];

  for (const promotion of promotions) {
    const stake = stakeFromName(promotion.promotion?.name)!;
    const date = dateFromStartedAt(promotion.promotion?.startedAt)!;
    try {
      snapshots.push(
        await loadSnapshot({
          cacheDir: options.cacheDir,
          cacheOnly: options.cacheOnly,
          promotion,
          stake,
          date,
        }),
      );
    } catch (err) {
      warnings.push(`${stake} ${date}: ${(err as Error).message}`);
    }
  }

  if (snapshots.length === 0) {
    throw new Error("No snapshots loaded; output was not updated");
  }
  if (options.strict && warnings.length > 0) {
    throw new Error(`Incomplete refresh in strict mode: ${warnings.join("; ")}`);
  }

  await writeFile(
    options.output,
    renderDataFile({
      groupId: options.groupId,
      snapshots,
      warnings,
    }),
  );
  console.log(
    `Wrote ${snapshots.length} snapshots / ${snapshots.reduce(
      (acc, snapshot) => acc + snapshot.entries.length,
      0,
    )} entries to ${options.output}`,
  );
  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const warningLine of warnings) console.warn(`- ${warningLine}`);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
