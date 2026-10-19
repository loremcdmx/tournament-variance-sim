import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import {
  formatTailPercent,
  trajectoryLineTitle,
  type TrajectoryLineMeta,
} from "./trajectoryLabels";

const tFor = (locale: "en" | "ru") => (key: DictKey) => DICT[key][locale];

const line = (over: Partial<TrajectoryLineMeta>): TrajectoryLineMeta => ({
  label: "x",
  color: "#fff",
  seriesIdx: 1,
  kind: "ref",
  ...over,
});

describe("tail share printed in the hover", () => {
  it("prints the 0.15% tail as 0.15 from both sides, not 0.1", () => {
    expect(formatTailPercent(0.0015)).toBe("0.15");
    expect(formatTailPercent(0.9985)).toBe("0.15");
  });

  it("prints the other tails without trailing zeros", () => {
    expect(formatTailPercent(0.025)).toBe("2.5");
    expect(formatTailPercent(0.975)).toBe("2.5");
    expect(formatTailPercent(0.15)).toBe("15");
    expect(formatTailPercent(0.85)).toBe("15");
    expect(formatTailPercent(0.05)).toBe("5");
    expect(formatTailPercent(0.95)).toBe("5");
  });
});

describe("trajectory hover title", () => {
  it("names the extremes and individual runs from the dictionary, in both languages", () => {
    const real = line({ kind: "best", variant: "real", label: "Real best run" });
    const agg = line({ kind: "worst", variant: "agg", label: "Aggregated worst" });
    const run = line({ kind: "path", label: "Run 11", runNumber: 11 });
    expect(trajectoryLineTitle(real, tFor("ru"))).toBe(DICT["chart.traj.extreme.realBest"].ru);
    expect(trajectoryLineTitle(agg, tFor("ru"))).toBe(DICT["chart.traj.extreme.aggWorst"].ru);
    expect(trajectoryLineTitle(run, tFor("ru"))).toBe("Ран 11");
    expect(trajectoryLineTitle(real, tFor("en"))).toBe(DICT["chart.traj.extreme.realBest"].en);
    expect(trajectoryLineTitle(run, tFor("en"))).toBe("Run 11");
  });

  it("keeps the overlay's name in front of a translated extreme", () => {
    const overlay = line({
      kind: "best",
      variant: "agg",
      label: "PrimeDope agg best",
      overlayLabel: "PrimeDope",
    });
    expect(trajectoryLineTitle(overlay, tFor("ru"))).toBe(
      `PrimeDope · ${DICT["chart.traj.extreme.aggBest"].ru}`,
    );
  });

  it("translates the zero line and leaves universal labels alone", () => {
    const zero = line({ label: "zero", titleKey: "chart.traj.line.zero" });
    expect(trajectoryLineTitle(zero, tFor("ru"))).toBe(DICT["chart.traj.line.zero"].ru);
    expect(trajectoryLineTitle(line({ label: "EV" }), tFor("ru"))).toBe("EV");
    expect(trajectoryLineTitle(line({ label: "ROI +20%" }), tFor("ru"))).toBe("ROI +20%");
  });

  it("titles a percentile edge by its coverage and side", () => {
    const edge = line({ kind: "band", percentile: 0.0015, label: "p0.15" });
    expect(trajectoryLineTitle(edge, tFor("en"))).toBe("99.7% interval · lower edge");
    expect(trajectoryLineTitle(edge, tFor("ru"))).toBe("99.7% интервал · нижняя граница");
  });
});
