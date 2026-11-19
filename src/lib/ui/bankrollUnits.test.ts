import { describe, expect, it } from "vitest";

import { abiCountFromBankroll, bankrollFromAbiCount } from "./bankrollUnits";

describe("bankroll typed in ABI multiples", () => {
  it("stores the ticket multiple to the cent on a sub-dollar ABI", () => {
    expect(bankrollFromAbiCount(100, 0.25)).toBe(25);
    expect(bankrollFromAbiCount(1, 0.25)).toBe(0.25);
    expect(bankrollFromAbiCount(50, 0.25)).toBe(12.5);
    expect(bankrollFromAbiCount(100, 0.55)).toBe(55);
  });

  it.each([0.25, 0.55, 0.3273, 1, 1.1, 43.75])(
    "shows every whole count it stored at ABI %s",
    (abi) => {
      for (let n = 1; n <= 2000; n++) {
        expect(abiCountFromBankroll(bankrollFromAbiCount(n, abi), abi)).toBe(n);
      }
    },
  );

  it("has no multiple without an ABI", () => {
    expect(bankrollFromAbiCount(100, 0)).toBe(0);
    expect(abiCountFromBankroll(300, 0)).toBe(0);
  });
});
