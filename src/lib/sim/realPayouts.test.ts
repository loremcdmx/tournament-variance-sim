import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  validateSample,
  summarizeSample,
  expandFractions,
  type PayoutSample,
} from "./realPayouts";

function loadSamples(): PayoutSample[] {
  const dir = path.join(process.cwd(), "data", "payout-samples");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PayoutSample);
}

describe("real payout samples", () => {
  const samples = loadSamples();

  it("found at least one sample on disk", () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  for (const s of samples) {
    describe(s.id, () => {
      it("passes structural validation", () => {
        expect(() => validateSample(s)).not.toThrow();
      });

      it("per-place sum matches posted prize pool (or is flagged partial)", () => {
        let sum = 0;
        for (const p of s.places) sum += p.prize * (p.to - p.from + 1);
        const ratio = sum / s.prizePool;
        if (s.partial) {
          expect(ratio).toBeGreaterThan(0);
          expect(ratio).toBeLessThanOrEqual(1.01);
        } else {
          expect(ratio).toBeGreaterThan(0.995);
          expect(ratio).toBeLessThan(1.005);
        }
      });

      it("summarize produces sane stats", () => {
        const st = summarizeSample(s);
        expect(st.paid).toBe(s.paid);
        expect(st.firstShare).toBeGreaterThan(0);
        expect(st.firstShare).toBeLessThan(1);
        expect(st.secondShare).toBeGreaterThan(0);
        expect(st.secondShare).toBeLessThanOrEqual(st.firstShare + 1e-9);
        expect(st.minCashBuyIns).toBeGreaterThan(0.5);
        expect(st.minCashBuyIns).toBeLessThan(10);
        expect(st.paidPct).toBeGreaterThan(0);
        expect(st.paidPct).toBeLessThan(0.5);
      });

      it("expanded fractions are monotonically non-increasing", () => {
        const fr = expandFractions(s);
        for (let i = 1; i < fr.length; i++) {
          expect(fr[i]).toBeLessThanOrEqual(fr[i - 1] + 1e-12);
        }
      });
    });
  }
});
