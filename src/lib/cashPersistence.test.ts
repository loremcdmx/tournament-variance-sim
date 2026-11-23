import { describe, expect, it } from "vitest";
import {
  buildCashStatsCsv,
  decodeCashState,
  encodeCashState,
  readCashShareHash,
} from "./cashPersistence";
import { simulateCash } from "./sim/cashEngine";
import { DEFAULT_CASH_INPUT } from "./sim/cashInput";

describe("cashPersistence — share URL & CSV export", () => {
  it("round-trips a full CashInput including mix rows and wrStdErr", () => {
    const input = {
      ...DEFAULT_CASH_INPUT,
      hands: 120_000,
      nSimulations: 1_500,
      wrStdErr: 1.5,
      hoursBlock: undefined,
      stakes: [
        {
          label: "NL100",
          wrBb100: 4.5,
          sdBb100: 98,
          bbSize: 1,
          handShare: 0.7,
          rake: { enabled: true, contributedRakeBb100: 6.5, advertisedRbPct: 35, pvi: 0.85 },
        },
        {
          label: "NL200",
          wrBb100: 2.5,
          sdBb100: 108,
          bbSize: 2,
          handShare: 0.3,
          rake: { enabled: true, contributedRakeBb100: 5.5, advertisedRbPct: 35, pvi: 0.85 },
        },
      ],
    };
    const encoded = encodeCashState(input);
    const decoded = decodeCashState(encoded);
    expect(decoded).toEqual(input);
  });

  it("distinguishes valid #c=, invalid #c=, and non-cash #s= hashes", () => {
    const encoded = encodeCashState(DEFAULT_CASH_INPUT);
    expect(readCashShareHash(`#c=${encoded}`).kind).toBe("state");
    expect(readCashShareHash("#c=not-valid-lz-payload").kind).toBe("invalid");
    expect(readCashShareHash("#s=some-mtt-payload").kind).toBe("none");
    expect(readCashShareHash("").kind).toBe("none");
  });

  it("exports a well-formed CSV with headline stats and RoR bankrolls", () => {
    const res = simulateCash({
      ...DEFAULT_CASH_INPUT,
      hands: 2_000,
      nSimulations: 100,
    });
    const csv = buildCashStatsCsv(res);
    expect(csv).toContain("metric,value");
    expect(csv).toContain("hands,2000");
    expect(csv).toContain("simulations,100");
    expect(csv).toContain("min_bankroll_ror_1pct_bb,");
    expect(csv).toContain("kelly_bankroll_bb,");
  });
});
