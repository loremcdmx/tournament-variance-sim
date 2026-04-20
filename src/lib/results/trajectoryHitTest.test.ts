import { describe, expect, it } from "vitest";
import { visualDistanceToSeries, type PlotCursorProjection } from "./trajectoryHitTest";

const cursor = (overrides: Partial<PlotCursorProjection> = {}): PlotCursorProjection => ({
  idx: 0,
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
    );

    expect(d).toBeLessThan(1e-9);
  });

  it("ignores segments that are fully outside the plot rectangle", () => {
    const d = visualDistanceToSeries(
      cursor({ left: 50, top: 0 }),
      [0, 10],
      [150, 150],
    );

    expect(d).toBe(Infinity);
  });

  it("searches by cursor x-position when the uPlot index is stale", () => {
    const x = Array.from({ length: 101 }, (_, i) => i);
    const y = Array<number | null>(101).fill(150);
    y[50] = 90;
    y[51] = 10;

    const d = visualDistanceToSeries(
      cursor({ idx: 10, left: 50, top: 50, xMax: 100 }),
      x,
      y,
    );

    expect(d).toBeLessThan(1);
  });
});
