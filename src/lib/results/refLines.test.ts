import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRefLines, roiLabel } from "./refLines";

function stubStorage(value: unknown) {
  const raw = JSON.stringify(value);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "tvs.refLines.v1" ? raw : null),
    setItem: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("loadRefLines", () => {
  it("names a saved line by the ROI it is drawn at, not by the label saved with it", () => {
    stubStorage([
      { roi: 0.075, label: "ROI +8%", color: "#fff", enabled: true },
      { roi: -0.0226, label: "ROI −2%", color: "#000", enabled: false },
      { roi: 0.2, label: "ROI +20%", color: "#0f0", enabled: true },
    ]);
    expect(loadRefLines()).toEqual([
      { roi: 0.075, label: "ROI +7.5%", color: "#fff", enabled: true },
      { roi: -0.0226, label: "ROI −2.26%", color: "#000", enabled: false },
      { roi: 0.2, label: "ROI +20%", color: "#0f0", enabled: true },
    ]);
  });

  it("labels hold hundredths of a percent", () => {
    expect(roiLabel(0.075)).toBe("ROI +7.5%");
    expect(roiLabel(0.07523)).toBe("ROI +7.52%");
    expect(roiLabel(-0.2)).toBe("ROI −20%");
    expect(roiLabel(0.00004)).toBe("ROI 0%");
  });
});
