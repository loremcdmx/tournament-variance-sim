import { describe, expect, it } from "vitest";
import calibration from "../../../scripts/fit_runtime_sigma_bands.json";
import { DICT } from "../i18n/dict";
import {
  isInsideRuntimeSigmaBox,
  RUNTIME_SIGMA_BANDS,
  runtimeSigmaBandResid,
  runtimeSigmaZoneForCopy,
  fillRuntimeSigmaZone,
  type RuntimeSigmaFormat,
} from "./runtimeSigmaBands";

const FORMATS: RuntimeSigmaFormat[] = ["freeze", "pko", "mystery", "mystery-royale"];

const ceilPercent = (x: number) => Math.max(0.01, Math.ceil(x * 100 - 1e-9) / 100);

describe("runtime σ band table = the Monte-Carlo calibration artifact", () => {
  it("is a full run over the specified grid, not a smoke run", () => {
    expect(calibration.meta.quick).toBe(false);
    expect(calibration.meta.coreAfs).toEqual([100, 300, 1000, 3000, 10000]);
    expect(calibration.meta.coreRoi).toEqual([-0.2, 0, 0.1, 0.3, 0.6, 1.0]);
    for (const format of FORMATS) {
      const core = calibration.cells.filter((c) => c.format === format && c.tag === "core");
      const afs = format === "mystery-royale" ? [18] : calibration.meta.coreAfs;
      expect(core.length, format).toBe(afs.length * calibration.meta.coreRoi.length);
      for (const a of afs) {
        for (const r of calibration.meta.coreRoi) {
          expect(core.some((c) => c.afs === a && c.roi === r), `${format} ${a} ${r}`).toBe(true);
        }
      }
      // The grid rake: 10 % everywhere but Battle Royale's 8 %.
      expect(new Set(core.map((c) => c.rake)), format).toEqual(
        new Set([format === "mystery-royale" ? 0.08 : 0.1]),
      );
    }
  });

  for (const format of FORMATS) {
    it(`${format}: resid and box are what the cells say`, () => {
      const cells = calibration.cells.filter((c) => c.format === format);
      for (const c of cells) {
        expect(c.dev, c.id).toBeCloseTo(Math.abs(c.ratio - 1) + 2 * c.se, 12);
      }
      const resid = ceilPercent(Math.max(...cells.map((c) => c.dev)));
      const spec = RUNTIME_SIGMA_BANDS[format];
      expect(spec.resid).toBe(resid);
      expect(spec.resid).toBe(calibration.table[format].resid);
      expect(spec.afsMin).toBe(Math.min(...cells.map((c) => c.afs)));
      expect(spec.afsMax).toBe(Math.max(...cells.map((c) => c.afs)));
      expect(spec.roiMin).toBe(Math.min(...cells.map((c) => c.roi)));
      expect(spec.roiMax).toBe(Math.max(...cells.map((c) => c.roi)));
      expect(calibration.table[format]).toEqual(spec);
    });

    it(`${format}: every measured cell sits inside the published band`, () => {
      const { resid } = RUNTIME_SIGMA_BANDS[format];
      for (const c of calibration.cells.filter((x) => x.format === format)) {
        expect(Math.abs(c.ratio - 1) + 2 * c.se, c.id).toBeLessThanOrEqual(resid + 1e-12);
      }
    });
  }

  it("each cell realized its nominal ROI, so the σ comparison is at the ROI asked for", () => {
    for (const c of calibration.cells) {
      expect(Math.abs(c.roiAnalytic - c.roi), c.id).toBeLessThan(0.005);
      expect(Math.abs(c.roiMc - c.roiAnalytic), c.id).toBeLessThan(0.02);
    }
  });

  it("bands are narrow for the three exact formats and widest where the MC is noisiest", () => {
    for (const format of ["freeze", "pko", "mystery"] as const) {
      expect(runtimeSigmaBandResid(format)).toBeLessThanOrEqual(0.05);
    }
    expect(runtimeSigmaBandResid("mystery-royale")).toBeGreaterThan(runtimeSigmaBandResid("freeze"));
  });
});

describe("isInsideRuntimeSigmaBox", () => {
  it("is the inclusive grid extent, and Battle Royale is exactly 18-max", () => {
    expect(isInsideRuntimeSigmaBox("freeze", 50, -0.3)).toBe(true);
    expect(isInsideRuntimeSigmaBox("freeze", 50_000, 1.0)).toBe(true);
    expect(isInsideRuntimeSigmaBox("freeze", 49, 0.1)).toBe(false);
    expect(isInsideRuntimeSigmaBox("pko", 1000, 1.01)).toBe(false);
    expect(isInsideRuntimeSigmaBox("mystery", 50_001, 0.1)).toBe(false);
    expect(isInsideRuntimeSigmaBox("mystery-royale", 18, 0.1)).toBe(true);
    expect(isInsideRuntimeSigmaBox("mystery-royale", 19, 0.1)).toBe(false);
    expect(isInsideRuntimeSigmaBox("mystery-royale", 18, -0.25)).toBe(false);
  });
});

describe("runtimeSigmaZoneForCopy (the out-of-zone warning)", () => {
  it("states the same zone the gate uses, so the copy cannot drift from the table", () => {
    const zone = runtimeSigmaZoneForCopy();
    for (const format of ["freeze", "pko", "mystery"] as const) {
      const box = RUNTIME_SIGMA_BANDS[format];
      expect(zone.mtt).toEqual({ afsMin: box.afsMin, afsMax: box.afsMax, roiMin: box.roiMin, roiMax: box.roiMax });
    }
    const br = RUNTIME_SIGMA_BANDS["mystery-royale"];
    expect(zone.br).toEqual({ afsMin: br.afsMin, roiMin: br.roiMin, roiMax: br.roiMax });
  });
});

describe("fillRuntimeSigmaZone", () => {
  it("leaves no placeholder in either language and prints the table's zone", () => {
    const entry = DICT["chart.convergence.bandWarning.outsideFitBox"];
    const ru = fillRuntimeSigmaZone(entry.ru, "ru-RU");
    const en = fillRuntimeSigmaZone(entry.en, "en-US");
    expect(ru).not.toMatch(/[{}]/);
    expect(en).not.toMatch(/[{}]/);
    expect(ru).toContain("ROI −30..+100 %");
    expect(en).toContain("field 50–50,000, ROI −30..+100 %");
    expect(en).toContain("field fixed at 18, ROI −20..+100 %");
  });
});
