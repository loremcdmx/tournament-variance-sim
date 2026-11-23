import { describe, expect, it } from "vitest";
import { DEFAULT_CASH_INPUT } from "./cashInput";
import { checkCashInputSanity } from "./cashSanity";

describe("checkCashInputSanity", () => {
  it("returns no findings for default healthy inputs", () => {
    expect(checkCashInputSanity(DEFAULT_CASH_INPUT)).toEqual([]);
  });

  it("flags non-positive winrate, extreme SD, zero-share mix row, zero-RB rake, and wide wrStdErr", () => {
    const findings = checkCashInputSanity({
      ...DEFAULT_CASH_INPUT,
      wrBb100: -2,
      sdBb100: 250,
      rake: { enabled: true, contributedRakeBb100: 0, advertisedRbPct: 30, pvi: 1 },
      stakes: [
        {
          label: "NL100",
          wrBb100: -1,
          sdBb100: 250,
          bbSize: 1,
          handShare: 1,
          rake: { enabled: true, contributedRakeBb100: 0, advertisedRbPct: 30, pvi: 1 },
        },
        {
          label: "NL200",
          wrBb100: 5,
          sdBb100: 100,
          bbSize: 2,
          handShare: 0,
          rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
        },
      ],
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("nonPositiveWinrate");
    expect(codes).toContain("extremeSd");
    expect(codes).toContain("zeroShareRow");
    expect(codes).toContain("rakeEnabledZeroRb");
  });

  it("flags wrStdErr >= effectiveWrBb100 on a winning player", () => {
    const findings = checkCashInputSanity({
      ...DEFAULT_CASH_INPUT,
      wrBb100: 2,
      wrStdErr: 2.5,
    });
    expect(findings.map((f) => f.code)).toContain("wrUncertaintyWide");
  });
});
