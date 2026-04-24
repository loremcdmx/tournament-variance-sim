import { isBattleRoyaleRow } from "./battleRoyaleLeaderboardUi";
import type {
  BattleRoyaleLeaderboardObservedConfig,
  BattleRoyaleLeaderboardObservedPromoResult,
  BattleRoyaleLeaderboardPromoConfig,
  BattleRoyaleLeaderboardPromoResult,
  TournamentRow,
} from "./types";

const STAKE_ORDER = [0.25, 1, 3, 10, 25] as const;
type ResultHubStakeKey = "0.25" | "1" | "3" | "10" | "25";
const STAKE_KEYS: ResultHubStakeKey[] = ["0.25", "1", "3", "10", "25"];

function sum(values: readonly number[]): number {
  let acc = 0;
  for (const value of values) acc += value;
  return acc;
}

function collectCurrentBrRows(params: {
  schedule: readonly TournamentRow[];
  rowCounts: readonly number[];
  rowBuyIns: readonly number[];
}): {
  currentRows: BattleRoyaleLeaderboardPromoResult["rows"];
  currentTournaments: number;
  currentBuyIn: number;
} {
  const { schedule, rowCounts, rowBuyIns } = params;
  const currentRows: BattleRoyaleLeaderboardPromoResult["rows"] = [];
  let currentTournaments = 0;
  let currentBuyIn = 0;
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    if (!isBattleRoyaleRow(row)) continue;
    const tournaments = Math.max(0, rowCounts[i] ?? 0);
    if (tournaments <= 0) continue;
    const buyIn = Math.max(0, rowBuyIns[i] ?? 0);
    currentRows.push({
      rowId: row.id,
      label: row.label || `Row ${i + 1}`,
      tournaments,
      buyIn,
      payout: 0,
    });
    currentTournaments += tournaments;
    currentBuyIn += buyIn;
  }
  return { currentRows, currentTournaments, currentBuyIn };
}

export function buildBattleRoyalePromoResult(params: {
  config: BattleRoyaleLeaderboardPromoConfig | undefined;
  schedule: readonly TournamentRow[];
  rowCounts: readonly number[];
  rowBuyIns: readonly number[];
  activeDays: number;
}): BattleRoyaleLeaderboardPromoResult | undefined {
  const { config, schedule, rowCounts, rowBuyIns, activeDays } = params;
  if (!config) return undefined;

  const { currentRows, currentTournaments, currentBuyIn } = collectCurrentBrRows(
    { schedule, rowCounts, rowBuyIns },
  );
  if (currentTournaments <= 0) return undefined;

  if (config.mode === "manual" || config.mode === "lookup") {
    const payoutPerTournament = Math.max(0, config.payoutPerTournament);
    if (payoutPerTournament <= 0) return undefined;
    const expectedPayout = currentTournaments * payoutPerTournament;
    const currentAbi = currentTournaments > 0 ? currentBuyIn / currentTournaments : null;
    const pctOfCurrentBuyIns =
      currentBuyIn > 0 ? expectedPayout / currentBuyIn : 0;
    const base = {
      expectedPayout,
      payoutPerTournament,
      payoutPerDay:
        activeDays > 0 ? expectedPayout / Math.max(1, activeDays) : expectedPayout,
      pctOfCurrentBuyIns,
      notInPathRisk: true as const,
      current: {
        activeDays: Math.max(1, activeDays),
        tournaments: currentTournaments,
        tournamentsPerDay: currentTournaments / Math.max(1, activeDays),
        totalBuyIn: currentBuyIn,
        abi: currentAbi,
      },
      rows: currentRows.map((row) => ({
        ...row,
        payout: row.tournaments * payoutPerTournament,
      })),
    };
    if (config.mode === "manual") {
      return {
        ...base,
        mode: "manual",
        manual: {
          payoutPerTournament,
          stake: config.stake,
          tournamentsPerDay: config.tournamentsPerDay,
          pointsPerTournament: config.pointsPerTournament,
          targetPoints: config.targetPoints,
          snapshotCount: config.snapshotCount,
          paidDays: config.paidDays,
          averageDailyPrize: config.averageDailyPrize,
        },
      };
    }
    return {
      ...base,
      mode: "lookup",
      lookup: {
        payoutPerTournament,
        tournamentsPerDay: config.tournamentsPerDay,
        pointsPerTournament: config.pointsPerTournament,
        targetPoints: config.targetPoints,
        snapshotCount: config.snapshotCount,
        paidDays: config.paidDays,
        averageDailyPrize: config.averageDailyPrize,
      },
    };
  }

  const totalPoints = sum(
    STAKE_KEYS.map((stake) => Math.max(0, config.pointsByStake[stake])),
  );
  const pointsByStake = STAKE_ORDER.map((stake, idx) => {
    const key = STAKE_KEYS[idx];
    const points = Math.max(0, config.pointsByStake[key]);
    const share = totalPoints > 0 ? points / totalPoints : 0;
    const tournaments = share * config.totalTournaments;
    const buyIn = tournaments * stake;
    return { stake, points, share, tournaments, buyIn };
  });
  const reconstructedBuyIn = sum(pointsByStake.map((row) => row.buyIn));
  const reconstructedAbi =
    config.totalTournaments > 0 ? reconstructedBuyIn / config.totalTournaments : null;
  const payoutPerTournament =
    config.totalTournaments > 0 ? config.totalPrizes / config.totalTournaments : 0;
  const expectedPayout = currentTournaments * payoutPerTournament;
  const currentAbi = currentTournaments > 0 ? currentBuyIn / currentTournaments : null;
  const pctOfObservedBuyIns =
    reconstructedBuyIn > 0 ? config.totalPrizes / reconstructedBuyIn : null;
  const pctOfCurrentBuyIns =
    currentBuyIn > 0 ? expectedPayout / currentBuyIn : 0;
  const abiDriftPct =
    reconstructedAbi && currentAbi
      ? Math.abs(currentAbi - reconstructedAbi) / reconstructedAbi
      : null;
  const confidenceLevel =
    abiDriftPct == null
      ? "unknown"
      : abiDriftPct <= 0.15
        ? "aligned"
        : abiDriftPct <= 0.4
          ? "approximate"
          : "mismatch";
  const payoutPerRowTournament =
    currentTournaments > 0 ? expectedPayout / currentTournaments : 0;

  return {
    mode: "observed",
    expectedPayout,
    payoutPerTournament,
    payoutPerDay:
      activeDays > 0 ? expectedPayout / Math.max(1, activeDays) : expectedPayout,
    pctOfCurrentBuyIns,
    notInPathRisk: true,
    observed: {
      totalPrizes: config.totalPrizes,
      totalTournaments: config.totalTournaments,
      totalPoints,
      reconstructedBuyIn,
      reconstructedAbi,
      pctOfObservedBuyIns,
      pointsByStake,
    },
    current: {
      activeDays: Math.max(1, activeDays),
      tournaments: currentTournaments,
      tournamentsPerDay: currentTournaments / Math.max(1, activeDays),
      totalBuyIn: currentBuyIn,
      abi: currentAbi,
    },
    confidence: {
      level: confidenceLevel,
      abiDriftPct,
    },
    rows: currentRows.map((row) => ({
      ...row,
      payout: row.tournaments * payoutPerRowTournament,
    })),
  };
}

export function buildObservedBattleRoyalePromoResult(params: {
  config: BattleRoyaleLeaderboardObservedConfig | undefined;
  schedule: readonly TournamentRow[];
  rowCounts: readonly number[];
  rowBuyIns: readonly number[];
  activeDays: number;
}): BattleRoyaleLeaderboardObservedPromoResult | undefined {
  const result = buildBattleRoyalePromoResult(params);
  return result?.mode === "observed" ? result : undefined;
}
