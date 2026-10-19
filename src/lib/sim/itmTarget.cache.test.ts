import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPayoutTable } from "./payouts";
import { applyItmTarget, equilibriumItmRateForRow } from "./itmTarget";
import { normalizeGameTypeConsistency } from "./gameType";
import type { PayoutStructureId, TournamentRow } from "./types";

vi.mock("./payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payouts")>();
  return { ...actual, getPayoutTable: vi.fn(actual.getPayoutTable) };
});

const row = (patch: Partial<TournamentRow> = {}): TournamentRow => ({
  id: "r",
  players: 5000,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
  ...patch,
});

// The formula the cache must reproduce, written without it.
function uncachedRate(raw: TournamentRow): number {
  const normalized = normalizeGameTypeConsistency(raw);
  const lateRegMult = Math.max(1, normalized.lateRegMultiplier ?? 1);
  const players = Math.max(2, Math.floor(normalized.players * lateRegMult));
  const payouts = getPayoutTable(normalized.payoutStructure, players, normalized.customPayouts);
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  return paidCount >= players ? 1 : Math.min(0.99, Math.max(1 / players, paidCount / players));
}

beforeEach(() => {
  vi.mocked(getPayoutTable).mockClear();
});

describe("the equilibrium ITM rate of a row", () => {
  it("builds one payout table for any number of rows with the same structure and field", () => {
    const schedule = Array.from({ length: 300 }, (_, i) => row({ id: `r${i}`, players: 41_234 }));
    applyItmTarget(schedule, { enabled: false, pct: 18.7 });
    expect(vi.mocked(getPayoutTable).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("does not rebuild the tables of the rows an edit did not touch", () => {
    const schedule = Array.from({ length: 50 }, (_, i) => row({ id: `r${i}`, players: 1000 + i * 37 }));
    applyItmTarget(schedule, { enabled: false, pct: 18.7 });
    vi.mocked(getPayoutTable).mockClear();
    const edited = schedule.map((r, i) => (i === 7 ? { ...r, buyIn: 75, roi: 0.2 } : r));
    applyItmTarget(edited, { enabled: false, pct: 18.7 });
    expect(vi.mocked(getPayoutTable)).not.toHaveBeenCalled();
    const grown = schedule.map((r, i) => (i === 7 ? { ...r, players: 123_457 } : r));
    applyItmTarget(grown, { enabled: false, pct: 18.7 });
    expect(vi.mocked(getPayoutTable).mock.calls.length).toBe(1);
  });

  it("is the same number the uncached formula gives, for every structure and field size", () => {
    const structures: PayoutStructureId[] = [
      "mtt-standard", "mtt-primedope", "mtt-flat", "mtt-top-heavy", "battle-royale",
      "mtt-pokerstars", "mtt-gg", "mtt-gg-freeze", "mtt-sunday-million", "mtt-gg-bounty",
      "mtt-gg-mystery", "satellite-ticket", "sng-50-30-20", "sng-65-35", "winner-takes-all",
    ];
    for (const payoutStructure of structures) {
      for (const players of [2, 9, 18, 45, 100, 777, 5000, 40_000]) {
        for (const lateRegMultiplier of [undefined, 1.3]) {
          const r = row({ payoutStructure, players, lateRegMultiplier });
          const expected = uncachedRate(r);
          expect(equilibriumItmRateForRow(r), `${payoutStructure} ${players}`).toBe(expected);
          expect(equilibriumItmRateForRow(r), `${payoutStructure} ${players} again`).toBe(expected);
        }
      }
    }
  });

  it("keeps two custom payout lists on the same field apart", () => {
    const a = row({ payoutStructure: "custom", players: 100, customPayouts: [0.5, 0.3, 0.2] });
    const b = row({ payoutStructure: "custom", players: 100, customPayouts: Array(10).fill(0.1) });
    expect(equilibriumItmRateForRow(a)).toBe(0.03);
    expect(equilibriumItmRateForRow(b)).toBe(0.1);
    expect(equilibriumItmRateForRow(a)).toBe(0.03);
  });
});
