import { describe, expect, it } from "vitest";
import { visualDistanceToSeries, type PlotCursorProjection } from "./trajectoryHitTest";

const cursor = (overrides: Partial<PlotCursorProjection> = {}): PlotCursorProjection => ({
  left: 50,
  top: 0,
  plotWidth: 100,
  plotHeight: 100,
  xMin: 0,
  xMax: 10,
  yMin: 0,
  yMax: 100,
  ...overrides,
});

describe("visualDistanceToSeries", () => {
  it("measures against the visible clipped segment at the plot edge", () => {
    const d = visualDistanceToSeries(
      cursor(),
      [0, 10],
      [50, 150],
      0,
    );

    expect(d).toBeLessThan(1e-9);
  });

  it("ignores segments that are fully outside the plot rectangle", () => {
    const d = visualDistanceToSeries(
      cursor({ left: 50, top: 0 }),
      [0, 10],
      [150, 150],
      0,
    );

    expect(d).toBe(Infinity);
  });
});
