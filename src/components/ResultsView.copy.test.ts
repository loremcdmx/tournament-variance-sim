import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";

describe("never-recovered card tooltip", () => {
  // The share counts runs that never got back to the peak their deepest
  // drawdown started from; ending below the all-time peak is a different and
  // far more common event (99% of runs against 81% on the default run).
  const tip = DICT["stat.recoveryUnrecovered.tip"];

  it("describes the deepest-drawdown event, not finishing below the peak", () => {
    expect(tip.en).toMatch(/deepest drawdown/);
    expect(tip.en).not.toMatch(/finished the distance below their own peak/);
    expect(tip.ru).toMatch(/самой глубокой просадки/);
    expect(tip.ru).not.toMatch(/закончивших дистанцию ниже своего пика/);
  });

  it("says a run that recovered and set a new high is not counted", () => {
    expect(tip.en).toMatch(/set a new high and finished a little under it is not counted/);
    expect(tip.ru).toMatch(/обновил максимум и закончил чуть ниже него, сюда не входит/);
  });
});

describe("streak chart cells", () => {
  // A subgrid cell with no column template gets one implicit auto column that
  // keeps uPlot's canvas width, so the chart never shrinks after a narrowing.
  const source = readFileSync(join(__dirname, "ResultsView.tsx"), "utf8");
  const cells = [...source.matchAll(/className="([^"]*sm:grid-rows-subgrid[^"]*)"/g)].map((m) => m[1].split(/\s+/));

  it("give each chart a column that can shrink", () => {
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell).toContain("min-w-0");
      expect(cell).toContain("sm:grid-cols-1");
    }
  });
});
