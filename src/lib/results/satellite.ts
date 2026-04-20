import type { SimulationResult, TournamentRow } from "@/lib/sim/types";

export interface SatelliteStats {
  tourneysPerSession: number;
  seats: number;
  seatPrice: number;
  expectedSeats: number;
  seatsP05: number;
  seatsMedian: number;
  seatsP95: number;
  cashRate: number;
  shotsPerSeat: number;
  netPerSession: number;
  rowCount: number;
  histogram: { binEdges: number[]; counts: number[] };
}

export function isSatelliteOnlySchedule(
  schedule: TournamentRow[] | undefined,
): schedule is TournamentRow[] {
  if (!schedule || schedule.length === 0) return false;
  return schedule.every((row) => row.payoutStructure === "satellite-ticket");
}

export function hasSatelliteRow(
  schedule: TournamentRow[] | undefined,
): boolean {
  if (!schedule || schedule.length === 0) return false;
  return schedule.some((row) => row.payoutStructure === "satellite-ticket");
}

export function computeSatelliteStats(
  result: SimulationResult,
  schedule: TournamentRow[],
  scheduleRepeats: number,
): SatelliteStats | null {
  const numRows = result.decomposition.length;
  const rowProfits = result.rowProfits;

  interface SatRow {
    rpIdx: number;
    seatPrice: number;
    costPerSession: number;
    seats: number;
    tourneysPerSession: number;
    players: number;
  }

  const satRows: SatRow[] = [];
  for (const row of schedule) {
    if (row.payoutStructure !== "satellite-ticket") continue;
    const rpIdx = result.decomposition.findIndex((d) => d.rowId === row.id);
    if (rpIdx < 0) continue;

    const players = Math.max(
      10,
      Math.floor(row.players * (row.lateRegMultiplier ?? 1)),
    );
    const seats = Math.max(1, Math.floor(players * 0.1));
    const seatPrice = (players * row.buyIn) / seats;
    const costPerTourney = row.buyIn * (1 + row.rake);
    const tourneysPerSession = row.count * scheduleRepeats;
    const costPerSession = tourneysPerSession * costPerTourney;

    satRows.push({
      rpIdx,
      seatPrice,
      costPerSession,
      seats,
      tourneysPerSession,
      players,
    });
  }

  if (satRows.length === 0) return null;

  const sampleCount = result.finalProfits.length;
  const seatsWon = new Float64Array(sampleCount);
  let sum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const base = i * numRows;
    let value = 0;
    for (const satRow of satRows) {
      const profit = rowProfits[base + satRow.rpIdx];
      value += (profit + satRow.costPerSession) / satRow.seatPrice;
    }
    seatsWon[i] = value;
    sum += value;
  }

  const mean = sampleCount > 0 ? sum / sampleCount : 0;
  const sorted = new Float64Array(seatsWon);
  sorted.sort();
  const percentile = (p: number): number => {
    if (sampleCount === 0) return 0;
    const idx = Math.min(
      sampleCount - 1,
      Math.max(0, Math.floor(p * (sampleCount - 1))),
    );
    return sorted[idx];
  };

  const lo = sorted[0];
  const hi = sorted[sampleCount - 1];
  const span = Math.max(1, hi - lo);
  const binCount = Math.min(40, Math.max(8, Math.ceil(span)));
  const binEdges = new Array<number>(binCount + 1);
  for (let i = 0; i <= binCount; i++) binEdges[i] = lo + (span * i) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  for (let i = 0; i < sampleCount; i++) {
    let bin = Math.floor(((seatsWon[i] - lo) / span) * binCount);
    if (bin < 0) bin = 0;
    else if (bin >= binCount) bin = binCount - 1;
    counts[bin]++;
  }

  let satSeatsTotal = 0;
  let satPlayersTotal = 0;
  for (const satRow of satRows) {
    satSeatsTotal += satRow.seats;
    satPlayersTotal += satRow.players;
  }
  const cashRate = satPlayersTotal > 0 ? satSeatsTotal / satPlayersTotal : 0;
  const shotsPerSeat = cashRate > 0 ? 1 / cashRate : Infinity;

  let netPerSession = 0;
  for (const satRow of satRows) {
    netPerSession += result.decomposition[satRow.rpIdx].mean;
  }

  const tourneysPerSession = satRows.reduce(
    (acc, satRow) => acc + satRow.tourneysPerSession,
    0,
  );
  const representative = satRows[0];

  return {
    tourneysPerSession,
    seats: representative.seats,
    seatPrice: representative.seatPrice,
    expectedSeats: mean,
    seatsP05: percentile(0.05),
    seatsMedian: percentile(0.5),
    seatsP95: percentile(0.95),
    cashRate,
    shotsPerSeat,
    netPerSession,
    rowCount: satRows.length,
    histogram: { binEdges, counts },
  };
}
