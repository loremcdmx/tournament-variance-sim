import { describe, expect, it } from "vitest";
import { compileSchedule } from "../sim/compile";
import { compiledEntryMoments } from "../sim/scheduleMoments";
import {
  buildFormatComparisonScenarios, compileFormatComparison, FORMAT_COMPARISON_DEFAULTS, FORMAT_COMPARISON_LIMITS,
} from "./formatComparison";

// Its own file, so that the comparison on the largest field is the first one
// this process compiles and the code V8 builds during it does not depend on
// other tests. vitest.config.ts has V8 compile on the spot, so that code is
// the same on every run (see momentRow in formatComparison.ts).
describe("a comparison after one on the largest field", () => {
  it("gives every format its own variance, in bounds of its own", () => {
    compileFormatComparison({
      ...FORMAT_COMPARISON_DEFAULTS,
      players: FORMAT_COMPARISON_LIMITS.players.max,
      distance: FORMAT_COMPARISON_LIMITS.distance.min,
    });
    const config = { ...FORMAT_COMPARISON_DEFAULTS, players: 100, distance: 503 };
    const rows = compileFormatComparison(config).map(({ moments }) => moments);
    buildFormatComparisonScenarios(config).forEach((scenario, i) => {
      const entry = compileSchedule({ ...scenario.input, scheduleRepeats: 1 }).flat[0];
      const m = compiledEntryMoments(entry);
      const square = entry.singleCost * entry.singleCost;
      expect(rows[i].format).toBe(scenario.format);
      expect(rows[i].varianceBI2.upper).toBeCloseTo((m.secondDollar - m.meanDollar ** 2) / square, 10);
      expect(rows[i].varianceBI2.lower).toBeCloseTo(((m.secondDollarLower ?? m.secondDollar) - m.meanDollar ** 2) / square, 10);
    });
    const ocean = rows[3].varianceBI2;
    ocean.lower = -1;
    ocean.upper = -1;
    for (const row of rows.slice(0, 3)) expect(row.varianceBI2.lower).toBeGreaterThan(0);
  });
});
