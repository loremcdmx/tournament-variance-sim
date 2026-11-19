import { describe, it, expect } from "vitest";
import { getPayoutTable, parsePayoutString } from "./payouts";
import type { PayoutStructureId } from "./types";
import coinHunter from "../../../data/payout-samples/gg-mini-coinhunter-pko-2026-04-14.json";

const STRUCTURES: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-primedope",
  "mtt-flat",
  "mtt-top-heavy",
  "battle-royale",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-gg-freeze",
  "mtt-sunday-million",
  "mtt-gg-bounty",
  "mtt-gg-mystery",
  "satellite-ticket",
  "sng-50-30-20",
  "sng-65-35",
  "winner-takes-all",
];

describe("payout tables", () => {
  it.each(STRUCTURES)("%s sums to 1", (s) => {
    const table = getPayoutTable(s, 500);
    const sum = table.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it.each(STRUCTURES)("%s is monotonically non-increasing", (s) => {
    const table = getPayoutTable(s, 500);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeLessThanOrEqual(table[i - 1] + 1e-12);
    }
  });

  it("top-heavy has a bigger 1st-place share than flat", () => {
    const topH = getPayoutTable("mtt-top-heavy", 500)[0];
    const flat = getPayoutTable("mtt-flat", 500)[0];
    expect(topH).toBeGreaterThan(flat);
  });

  it("mtt-primedope matches PD's live paid=15 curve byte-for-byte at N=100", () => {
    // Scraped from the live `sub_routine=payout_info` endpoint (see
    // pdCurves.ts top-of-file comment). PD updated their table post-
    // tmp_legacy.js: 1st is now 28 % (was 25.5 %), tail is flat 2.1 %
    // for places 10–15 instead of the old stepped 2.5/2.5/2.5/2/2/2.
    const expected = [
      0.28, 0.17, 0.106, 0.086, 0.076, 0.053, 0.043, 0.033, 0.027,
      0.021, 0.021, 0.021, 0.021, 0.021, 0.021,
    ];
    const table = getPayoutTable("mtt-primedope", 100);
    expect(table).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(table[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("mtt-primedope reproduces PD's σ within MC noise on the 100p reference", () => {
    // Two-bin uniform SD for the 100p/$50/10% ROI reference scenario.
    // PD reports σ_1000 = $5607 (math) / $5789 (sim). Our analytic σ
    // under mtt-primedope should land inside this range (±5 %).
    const N = 100;
    const buyIn = 50;
    const pool = N * buyIn;
    const target = buyIn * 1.1;
    const fractions = getPayoutTable("mtt-primedope", N);
    const paid = fractions.length;
    const l = (target * paid) / pool;
    const pPaid = l / paid;
    let mu = 0;
    let mu2 = 0;
    for (let i = 0; i < paid; i++) {
      const prize = fractions[i] * pool;
      mu += pPaid * prize;
      mu2 += pPaid * prize * prize;
    }
    const sd1 = Math.sqrt(mu2 - mu * mu);
    const sd1k = sd1 * Math.sqrt(1000);
    expect(sd1k).toBeGreaterThan(5350);
    expect(sd1k).toBeLessThan(6100);
  });

  it("satellite-ticket pays every seat equally", () => {
    const table = getPayoutTable("satellite-ticket", 500);
    expect(table.length).toBe(50); // 10% of 500
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeCloseTo(table[0], 12);
    }
  });

  it("drops impossible custom payout tail beyond the field size", () => {
    const table = getPayoutTable("custom", 3, [50, 30, 20, 10]);

    expect(table).toEqual([0.5, 0.3, 0.2]);
    expect(table).toHaveLength(3);
    expect(table.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  describe("small-field PKO / Mystery", () => {
    it("HU PKO pays winner-take-all", () => {
      const t = getPayoutTable("mtt-gg-bounty", 2);
      expect(t).toEqual([1]);
    });

    it("HU Mystery pays winner-take-all", () => {
      const t = getPayoutTable("mtt-gg-mystery", 2);
      expect(t).toEqual([1]);
    });

    it("6-max single-table PKO pays top 2 (65/35)", () => {
      const t = getPayoutTable("mtt-gg-bounty", 6);
      expect(t).toHaveLength(2);
      expect(t[0]).toBeCloseTo(0.65, 9);
      expect(t[1]).toBeCloseTo(0.35, 9);
    });

    it("9-max single-table PKO pays top 3 (50/30/20)", () => {
      const t = getPayoutTable("mtt-gg-bounty", 9);
      expect(t).toEqual([0.5, 0.3, 0.2]);
    });

    it("AFS=10 PKO no longer forces 9 paid", () => {
      const t = getPayoutTable("mtt-gg-bounty", 10);
      expect(t.length).toBeLessThan(10);
      expect(t.length).toBeLessThanOrEqual(3);
      expect(t[0]).toBeGreaterThan(0.4);
    });

    it("Mystery at AFS=10 also pays sane top-3 distribution", () => {
      const t = getPayoutTable("mtt-gg-mystery", 10);
      expect(t.length).toBeLessThanOrEqual(3);
      expect(t[0]).toBeGreaterThan(0.4);
    });

    it("18-max sit-and-go PKO still uses top 3 split", () => {
      const t = getPayoutTable("mtt-gg-bounty", 18);
      expect(t).toEqual([0.5, 0.3, 0.2]);
    });

    it("transition band 19-49 stays SNG-style with 3-4 paid", () => {
      for (const N of [19, 25, 35, 45, 49]) {
        const t = getPayoutTable("mtt-gg-bounty", N);
        expect(t.length).toBeGreaterThanOrEqual(3);
        expect(t.length).toBeLessThanOrEqual(4);
        expect(t[0]).toBeGreaterThan(0.3);
        for (let i = 1; i < t.length; i++) {
          expect(t[i]).toBeLessThanOrEqual(t[i - 1] + 1e-12);
        }
      }
    });

    it("crosses to big-field shape at exactly N=50", () => {
      const small = getPayoutTable("mtt-gg-bounty", 49);
      const big = getPayoutTable("mtt-gg-bounty", 50);
      expect(small.length).toBeLessThan(big.length);
      expect(big.length).toBeGreaterThanOrEqual(9);
      expect(big[0]).toBeLessThan(small[0]);
    });

    it("Mini CoinHunter sample: prizePool is the whole net pool, not the regular column", () => {
      const s = coinHunter;
      // 541 × ₹11 × 0.92 = 5475: the listed pool already includes the bounty half.
      expect(Math.abs(s.prizePool - s.entries * s.buyIn * 0.92)).toBeLessThan(2);
      // If 5474 were the regular column alone, places 35–62 would average
      // far more than place 34 pays — impossible for a payout table.
      const captured = s.places.reduce((a, p) => a + (p.to - p.from + 1) * p.prize, 0);
      const lastCaptured = s.places[s.places.length - 1];
      const missing = s.paid - lastCaptured.to;
      expect((s.prizePool - captured) / missing).toBeGreaterThan(lastCaptured.prize);
    });

    it("PKO regular column matches the Mini CoinHunter final table", () => {
      const s = coinHunter;
      const regular = s.prizePool * (1 - s.bounty.pctOfBuyIn / 100);
      const t = getPayoutTable("mtt-gg-bounty", s.entries);
      expect(t).toHaveLength(s.paid);
      // 377.61 of a ₹2737 regular column: 13.8 %, not the 6.9 % share of
      // the whole pool the table used to take.
      expect(t[0]).toBeCloseTo(s.places[0].prize / regular, 3);
      expect(t[1]).toBeCloseTo(t[0], 9);
      for (const p of s.places.filter((x) => x.to <= 9)) {
        expect(t[p.from - 1] / (p.prize / regular)).toBeGreaterThan(0.95);
        expect(t[p.from - 1] / (p.prize / regular)).toBeLessThan(1.05);
      }
    });

    it("PKO 1st share falls with the field like the GG freezeout table", () => {
      const shares = [500, 1000, 2000, 5000, 15000].map((N) => getPayoutTable("mtt-gg-bounty", N)[0]);
      expect(shares[0]).toBeCloseTo(0.139, 3);
      expect(shares[4]).toBeCloseTo(0.09, 3);
      for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    });

    it("small-field PKO sums to 1 and is monotonic", () => {
      for (const N of [2, 3, 6, 9, 10, 18, 27, 49]) {
        const t = getPayoutTable("mtt-gg-bounty", N);
        const sum = t.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 9);
        for (let i = 1; i < t.length; i++) {
          expect(t[i]).toBeLessThanOrEqual(t[i - 1] + 1e-12);
        }
      }
    });
  });
});

describe("mtt-gg-freeze (GG freezeouts, fitted to real prizes)", () => {
  it("pays the winner 16.9 % at 250 runners and 8.27 % at 10,000, log-linear between", () => {
    expect(getPayoutTable("mtt-gg-freeze", 250)[0]).toBeCloseTo(0.169, 6);
    expect(getPayoutTable("mtt-gg-freeze", 10_000)[0]).toBeCloseTo(0.0827, 6);
    const mid = Math.round(Math.sqrt(250 * 10_000));
    expect(getPayoutTable("mtt-gg-freeze", mid)[0]).toBeCloseTo((0.169 + 0.0827) / 2, 3);
  });

  it("stays well below the CoinPoker-sample table at the fields it was fitted on", () => {
    for (const N of [1000, 2000, 5000]) {
      const gg = getPayoutTable("mtt-gg", N)[0];
      const fit = getPayoutTable("mtt-gg-freeze", N)[0];
      expect(fit).toBeLessThan(gg - 0.025);
    }
    const t = getPayoutTable("mtt-gg-freeze", 1972)[0];
    expect(t).toBeGreaterThan(0.115);
    expect(t).toBeLessThan(0.125);
  });

  it("keeps the flat top step, the FT ratio, the paid share and the min-cash", () => {
    const N = 2000;
    const t = getPayoutTable("mtt-gg-freeze", N);
    expect(t).toHaveLength(290);
    expect(t[0] / t[1]).toBeCloseTo(1.22, 9);
    for (let i = 2; i < 9; i++) expect(t[i - 1] / t[i]).toBeCloseTo(1.31, 9);
    expect(t[t.length - 1] * N).toBeCloseTo(2.24, 9);
  });

  it("sums to 1 and never rises across the field range", () => {
    for (const N of [50, 100, 250, 700, 2500, 10_000, 30_000]) {
      const t = getPayoutTable("mtt-gg-freeze", N);
      expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThanOrEqual(t[i - 1] + 1e-12);
    }
  });
});

describe("paid places", () => {
  it("pays the documented share at round fields (0.145 and 0.143 are stored below their decimal value)", () => {
    const freeze: [number, number][] = [[200, 29], [400, 58], [800, 116], [3000, 435]];
    for (const [N, paid] of freeze) expect(getPayoutTable("mtt-gg-freeze", N), String(N)).toHaveLength(paid);
    const stars: [number, number][] = [[3000, 429], [5000, 715], [10_000, 1430]];
    for (const [N, paid] of stars) expect(getPayoutTable("mtt-pokerstars", N), String(N)).toHaveLength(paid);
  });

  it("matches integer arithmetic for every rate-based structure", () => {
    const perMille: [PayoutStructureId, number][] = [
      ["mtt-standard", 150], ["mtt-flat", 200], ["mtt-top-heavy", 120], ["mtt-pokerstars", 143],
      ["mtt-gg", 158], ["mtt-gg-freeze", 145], ["mtt-gg-bounty", 115], ["mtt-gg-mystery", 130],
      ["satellite-ticket", 100],
    ];
    for (const [id, rate] of perMille) {
      for (let N = 100; N <= 20_000; N += 100) {
        const expected = Math.max(id === "mtt-gg-bounty" || id === "mtt-gg-mystery" ? 9 : 1, Math.floor((N * rate) / 1000));
        expect(getPayoutTable(id, N).length, `${id} ${N}`).toBe(expected);
      }
    }
  });
});

describe("realistic-curve fallback", () => {
  const REALISTIC: PayoutStructureId[] = [
    "mtt-standard", "mtt-flat", "mtt-top-heavy", "mtt-pokerstars", "mtt-gg",
    "mtt-gg-freeze", "mtt-sunday-million", "mtt-gg-bounty", "mtt-gg-mystery",
  ];

  it.each(REALISTIC)("%s: 1st share moves smoothly where the tail can no longer hold its mass", (id) => {
    let prev = getPayoutTable(id, 120)[0];
    for (let N = 121; N <= 1200; N++) {
      const first = getPayoutTable(id, N)[0];
      // One more paid place moves 1st by up to about 2.4 % here; the old
      // regime switch moved it 6-23 %.
      expect(Math.abs(first / prev - 1), `${id} ${N - 1} -> ${N}`).toBeLessThan(0.035);
      prev = first;
    }
  });

  it("no longer flips Mystery between two shapes at 553-562 runners", () => {
    const firsts = [553, 557, 560, 561, 562].map((N) => getPayoutTable("mtt-gg-mystery", N)[0]);
    for (const f of firsts) expect(f).toBeCloseTo(0.124, 2);
    const [, , at560, at561, at562] = firsts;
    expect(at561).toBeLessThan(at560);
    expect(at561).toBeGreaterThan(at562);
  });

  // The option title quotes this range; the old fallback paid 15-29% to 1st on
  // every field from 50 to 553 under a "9-12.5%" title.
  it("pays Mystery's 1st what the payout title says", () => {
    for (let N = 550; N <= 30_000; N += N < 2000 ? 1 : 50) {
      const first = getPayoutTable("mtt-gg-mystery", N)[0];
      expect(first, String(N)).toBeGreaterThanOrEqual(0.09 - 1e-12);
      expect(first, String(N)).toBeLessThanOrEqual(0.125 + 1e-12);
    }
    expect(getPayoutTable("mtt-gg-mystery", 50)[0]).toBeCloseTo(0.29, 2);
  });

  it("takes the flat-tail limit at the boundary (mtt-standard 259 vs 260)", () => {
    const below = getPayoutTable("mtt-standard", 259);
    const at = getPayoutTable("mtt-standard", 260);
    expect(below[0]).toBeCloseTo(0.1914, 4);
    expect(at[0]).toBeCloseTo(0.19, 4);
    for (let i = 9; i < below.length - 1; i++) expect(below[i]).toBe(below[9]);
    expect(below[below.length - 1]).toBeLessThan(below[9]);
  });
});

describe("parsePayoutString", () => {
  it("parses whitespace and commas", () => {
    expect(parsePayoutString("50 30 20")).toEqual([0.5, 0.3, 0.2]);
    expect(parsePayoutString("50,30,20")).toEqual([0.5, 0.3, 0.2]);
    expect(parsePayoutString("50% 30% 20%")).toEqual([0.5, 0.3, 0.2]);
  });

  it("normalizes non-normalized inputs", () => {
    const r = parsePayoutString("1 1 1 1")!;
    expect(r).toHaveLength(4);
    for (const v of r) expect(v).toBeCloseTo(0.25, 9);
  });

  it("returns null for empty input", () => {
    expect(parsePayoutString("")).toBeNull();
    expect(parsePayoutString("   ")).toBeNull();
  });
});
