import { describe, it, expect } from "vitest";
import {
  getConvergenceBandPolicy,
  type ConvergenceRowFormat,
} from "./convergencePolicy";

describe("getConvergenceBandPolicy", () => {
  it("pure freeze → numeric", () => {
    expect(getConvergenceBandPolicy(["freeze"])).toEqual({ kind: "numeric" });
    expect(getConvergenceBandPolicy(["freeze", "freeze", "freeze"])).toEqual({
      kind: "numeric",
    });
  });

  it("pure MBR → numeric", () => {
    expect(getConvergenceBandPolicy(["mystery-royale"])).toEqual({
      kind: "numeric",
    });
  });

  it("freeze + MBR mix → numeric", () => {
    expect(
      getConvergenceBandPolicy(["freeze", "mystery-royale", "freeze"]),
    ).toEqual({ kind: "numeric" });
  });

  it("single PKO row → warning", () => {
    expect(getConvergenceBandPolicy(["pko"])).toEqual({
      kind: "warning",
      reason: "contains-pko-or-mystery",
    });
  });

  it("single Mystery row → warning", () => {
    expect(getConvergenceBandPolicy(["mystery"])).toEqual({
      kind: "warning",
      reason: "contains-pko-or-mystery",
    });
  });

  it("freeze + one PKO row → warning (no share threshold)", () => {
    expect(
      getConvergenceBandPolicy([
        "freeze",
        "freeze",
        "freeze",
        "freeze",
        "pko",
      ]),
    ).toEqual({ kind: "warning", reason: "contains-pko-or-mystery" });
  });

  it("MBR + PKO → warning", () => {
    expect(getConvergenceBandPolicy(["mystery-royale", "pko"])).toEqual({
      kind: "warning",
      reason: "contains-pko-or-mystery",
    });
  });

  it("freeze + Mystery → warning", () => {
    expect(getConvergenceBandPolicy(["freeze", "mystery"])).toEqual({
      kind: "warning",
      reason: "contains-pko-or-mystery",
    });
  });

  it("PKO + Mystery + freeze → warning", () => {
    expect(
      getConvergenceBandPolicy(["pko", "mystery", "freeze"]),
    ).toEqual({ kind: "warning", reason: "contains-pko-or-mystery" });
  });

  it("empty schedule → numeric (no disqualifying rows)", () => {
    expect(getConvergenceBandPolicy([])).toEqual({ kind: "numeric" });
  });

  it("is order-independent", () => {
    const cases: ConvergenceRowFormat[][] = [
      ["pko", "freeze"],
      ["freeze", "pko"],
      ["mystery-royale", "pko", "freeze"],
    ];
    for (const c of cases) {
      expect(getConvergenceBandPolicy(c)).toEqual({
        kind: "warning",
        reason: "contains-pko-or-mystery",
      });
    }
  });
});
