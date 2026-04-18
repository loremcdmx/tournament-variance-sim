import { describe, expect, it } from "vitest";

import { rankedRunIndices } from "./trajectorySelection";

describe("rankedRunIndices", () => {
  const mk = (...vals: number[]) => Float64Array.from(vals);

  it("keeps engine order in random mode", () => {
    const paths = [mk(0, 5), mk(0, -3), mk(0, 11), mk(0, 2)];
    expect(rankedRunIndices(paths, "random")).toEqual([0, 1, 2, 3]);
  });

  it("sorts best mode by final profit descending", () => {
    const paths = [mk(0, 5), mk(0, -3), mk(0, 11), mk(0, 2)];
    expect(rankedRunIndices(paths, "best")).toEqual([2, 0, 3, 1]);
  });

  it("sorts worst mode by final profit ascending", () => {
    const paths = [mk(0, 5), mk(0, -3), mk(0, 11), mk(0, 2)];
    expect(rankedRunIndices(paths, "worst")).toEqual([1, 3, 0, 2]);
  });

  it("breaks ties by original order for deterministic filtering", () => {
    const paths = [mk(0, 5), mk(0, 5), mk(0, -1), mk(0, -1)];
    expect(rankedRunIndices(paths, "best")).toEqual([0, 1, 2, 3]);
    expect(rankedRunIndices(paths, "worst")).toEqual([2, 3, 0, 1]);
  });
});
