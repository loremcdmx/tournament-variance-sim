import { describe, it, expect, beforeEach } from "vitest";
import {
  compactMoney,
  fmt,
  GLOBAL_UNIT_KEY,
  intFmt,
  loadUnitMode,
  makeAbiMoney,
  mergedHistogramDomain,
  money,
  pct,
  pctDelta,
  saveUnitMode,
} from "./formatters";

describe("fmt — template substitution", () => {
  it("substitutes single placeholder", () => {
    expect(fmt("hi {name}", { name: "Bob" })).toBe("hi Bob");
  });

  it("substitutes multiple placeholders", () => {
    expect(fmt("{a}+{b}={c}", { a: "1", b: "2", c: "3" })).toBe("1+2=3");
  });

  it("leaves unknown placeholders verbatim", () => {
    expect(fmt("hi {missing}", {})).toBe("hi {missing}");
  });

  it("handles empty template", () => {
    expect(fmt("", { x: "1" })).toBe("");
  });
});

describe("compactMoney", () => {
  it("renders zero as '$0'", () => {
    expect(compactMoney(0)).toBe("$0");
  });

  it("rounds to whole dollars below 1k", () => {
    expect(compactMoney(420)).toBe("$420");
    expect(compactMoney(999)).toBe("$999");
  });

  it("uses k suffix above 1k with one decimal up to 10k", () => {
    expect(compactMoney(1500)).toBe("$1.5k");
    expect(compactMoney(9_999)).toBe("$10.0k");
  });

  it("drops decimal at or above 10k", () => {
    expect(compactMoney(10_000)).toBe("$10k");
    expect(compactMoney(420_000)).toBe("$420k");
  });

  it("uses M suffix above 1M", () => {
    expect(compactMoney(1_500_000)).toBe("$1.5M");
    expect(compactMoney(9_900_000)).toBe("$9.9M");
    expect(compactMoney(20_000_000)).toBe("$20M");
  });

  it("uses minus sign (Unicode −) for negatives", () => {
    expect(compactMoney(-420)).toBe("−$420");
    expect(compactMoney(-1_500_000)).toBe("−$1.5M");
  });
});

describe("money", () => {
  it("formats below 10k with thousands separators", () => {
    expect(money(1_234)).toBe("$1,234");
    expect(money(420)).toBe("$420");
  });

  it("uses k suffix at or above 10k", () => {
    expect(money(10_000)).toBe("$10.0k");
    expect(money(99_500)).toBe("$99.5k");
  });

  it("uses M suffix at or above 1M with two decimals", () => {
    expect(money(1_500_000)).toBe("$1.50M");
  });

  it("Unicode minus for negatives", () => {
    expect(money(-1234)).toBe("−$1,234");
  });
});

describe("pct", () => {
  it("converts fraction to percent with one decimal", () => {
    expect(pct(0.184)).toBe("18.4%");
    expect(pct(0)).toBe("0.0%");
    expect(pct(1)).toBe("100.0%");
    expect(pct(-0.05)).toBe("-5.0%");
  });
});

describe("intFmt", () => {
  it("rounds to integer with locale grouping", () => {
    expect(intFmt(1234)).toMatch(/^1[,. ]234$/);
    expect(intFmt(0)).toBe("0");
  });
});

describe("makeAbiMoney", () => {
  it("formats values relative to abi", () => {
    const f = makeAbiMoney(50);
    expect(f.money(50)).toBe("1.0 ABI"); // 1.0, < 100 ABI → 1 decimal
    expect(f.money(500)).toBe("10.0 ABI"); // 10.0, < 100 ABI → 1 decimal
    expect(f.money(5000)).toBe("100 ABI"); // ≥ 100 ABI → 0 decimals
    expect(f.money(0)).toBe("0.0 ABI");
  });

  it("compactMoney uses k suffix above 1000 ABI", () => {
    const f = makeAbiMoney(1);
    expect(f.compactMoney(1500)).toBe("1.5k ABI");
    expect(f.compactMoney(20_000)).toBe("20k ABI");
  });

  it("compactMoney drops decimal between 100 and 1000 ABI", () => {
    const f = makeAbiMoney(1);
    expect(f.compactMoney(420)).toBe("420 ABI");
  });

  it("compactMoney shows zero as '0 ABI'", () => {
    const f = makeAbiMoney(50);
    expect(f.compactMoney(0)).toBe("0 ABI");
  });

  it("safe-clamps abi to ≥1 (no div-by-zero on edge cases)", () => {
    const f = makeAbiMoney(0);
    expect(f.money(100)).toBe("100 ABI");
  });

  it("Unicode minus for negative values", () => {
    const f = makeAbiMoney(50);
    expect(f.money(-50)).toBe("−1.0 ABI");
    // 1500/50 = 30 ABI, falls in the 1-decimal bucket
    expect(f.compactMoney(-1500)).toBe("−30.0 ABI");
  });
});

describe("loadUnitMode / saveUnitMode", () => {
  // Stub localStorage in Node environment (vitest runs without jsdom).
  let store: Record<string, string> = {};
  beforeEach(() => {
    store = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      get length() {
        return Object.keys(store).length;
      },
    };
  });

  it("returns 'abi' as default when no saved value exists", () => {
    expect(loadUnitMode("test.key")).toBe("abi");
  });

  it("returns 'abi' for unrecognized stored values", () => {
    store["test.key"] = "garbage";
    expect(loadUnitMode("test.key")).toBe("abi");
  });

  it("round-trips 'money' and 'abi'", () => {
    saveUnitMode("test.key", "money");
    expect(loadUnitMode("test.key")).toBe("money");
    saveUnitMode("test.key", "abi");
    expect(loadUnitMode("test.key")).toBe("abi");
  });

  it("global key is namespaced", () => {
    expect(GLOBAL_UNIT_KEY).toBe("tvs.unit.global.v1");
  });

  it("loadUnitMode returns 'abi' default when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadUnitMode("any.key")).toBe("abi");
  });

  it("saveUnitMode is a no-op when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => saveUnitMode("any.key", "money")).not.toThrow();
  });
});

describe("pctDelta", () => {
  it("returns null when current is non-finite", () => {
    expect(pctDelta(NaN, 1)).toBeNull();
    expect(pctDelta(Infinity, 1)).toBeNull();
  });

  it("returns null when pd is non-finite", () => {
    expect(pctDelta(1, NaN)).toBeNull();
  });

  it("returns null when both are essentially zero", () => {
    expect(pctDelta(0, 0)).toBeNull();
    expect(pctDelta(1e-15, 1e-15)).toBeNull();
  });

  it("computes signed relative delta against current as anchor", () => {
    expect(pctDelta(100, 113)).toBeCloseTo(0.13, 6);
    expect(pctDelta(100, 87)).toBeCloseTo(-0.13, 6);
    expect(pctDelta(100, 100)).toBe(0);
  });

  it("uses |pd| as anchor when current is essentially zero (avoids divide-by-tiny)", () => {
    // pd=10, cur=0 → anchor=10, delta=10/10=1
    expect(pctDelta(0, 10)).toBe(1);
  });

  it("uses |cur| (not signed) as anchor for negative current", () => {
    // cur=-100, pd=-87 → anchor=100, delta=(-87 - -100)/100 = 0.13
    expect(pctDelta(-100, -87)).toBeCloseTo(0.13, 6);
  });
});

describe("mergedHistogramDomain", () => {
  it("returns undefined for no input", () => {
    expect(mergedHistogramDomain()).toBeUndefined();
  });

  it("returns undefined when all inputs are null/undefined", () => {
    expect(mergedHistogramDomain(null, undefined)).toBeUndefined();
  });

  it("returns undefined for histograms with insufficient bin edges", () => {
    expect(mergedHistogramDomain({ binEdges: [] })).toBeUndefined();
    expect(mergedHistogramDomain({ binEdges: [5] })).toBeUndefined();
  });

  it("returns single-histogram domain when only one is valid", () => {
    expect(mergedHistogramDomain({ binEdges: [-100, 0, 100] })).toEqual([
      -100,
      100,
    ]);
  });

  it("merges multiple histograms by extreme min/max", () => {
    const a = { binEdges: [-50, 0, 50] };
    const b = { binEdges: [-200, 0, 200] };
    expect(mergedHistogramDomain(a, b)).toEqual([-200, 200]);
  });

  it("returns undefined when merged span collapses (hi <= lo)", () => {
    expect(mergedHistogramDomain({ binEdges: [5, 5] })).toBeUndefined();
  });

  it("ignores null entries while honoring valid ones", () => {
    expect(
      mergedHistogramDomain(null, { binEdges: [-10, 10] }, undefined),
    ).toEqual([-10, 10]);
  });
});
