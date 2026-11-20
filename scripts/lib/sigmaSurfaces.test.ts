import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  evalSigma,
  SIGMA_COEF_BY_FORMAT,
  SIGMA_ROI_FREEZE,
  SIGMA_ROI_MYSTERY,
  SIGMA_ROI_MYSTERY_ROYALE,
  SIGMA_ROI_PKO,
  type SigmaCoef,
} from "./sigmaSurfaces";
import type { FinishModelId, SimulationInput, TournamentRow } from "../../src/lib/sim/types";
import { compileSchedule } from "../../src/lib/sim/compile";
import { compiledEntryMoments } from "../../src/lib/sim/scheduleMoments";
import { formatRuntimeSigma, RUNTIME_SIGMA_BR_TICKET } from "../../src/lib/sim/formatRuntimeSigma";
import pkoGrid from "../fit_beta_pko.json";
import mysteryGrid from "../fit_beta_mystery.json";
import freezeGrid from "../fit_beta_freeze_realdata.json";
import brLine from "../fit_beta_mystery_royale.json";

/**
 * Canaries on the closed-form surfaces and the grids behind them. No number
 * the app prints reads a surface; the scripts that do (probe_afs_ceiling,
 * mix_effective_fit, xval_br) need each surface to stay close to its grid and
 * each grid to stay the engine's. Tests here pin known values and sanity-check
 * the functional shape (monotonicity, sign of ROI dependence, residual bands).
 */

describe("the surfaces stay out of the app", () => {
  const SRC = join(__dirname, "../../src");
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(dir, entry.name))
        : /\.tsx?$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");

  it("no file under src/ imports, defines or evaluates a closed-form σ surface", () => {
    // A surface misses its own grid by up to 35 % (Mystery, fields 50-64) and
    // the card's own row by up to 2.1x in σ: inside src/ it is one forgotten
    // argument away from a planning card.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => /sigmaSurfaces|convergenceFit|\bSIGMA_ROI_|\bSIGMA_COEF_BY_FORMAT\b|\bevalSigma\b/.test(code(file)))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("evalSigma — coefficient shape", () => {
  it("freeze is ROI-invariant (C1 must stay 0: its row plays one shape whatever the ROI)", () => {
    expect(SIGMA_ROI_FREEZE.kind).toBe("single-beta");
    if (SIGMA_ROI_FREEZE.kind !== "single-beta") return;
    expect(SIGMA_ROI_FREEZE.C1).toBe(0);
    // Concrete: σ at any ROI is the same for fixed AFS
    const at500_neg10 = evalSigma(SIGMA_ROI_FREEZE, 500, -0.10);
    const at500_zero = evalSigma(SIGMA_ROI_FREEZE, 500, 0);
    const at500_pos50 = evalSigma(SIGMA_ROI_FREEZE, 500, 0.50);
    expect(at500_neg10).toBeCloseTo(at500_zero, 12);
    expect(at500_pos50).toBeCloseTo(at500_zero, 12);
  });

  it("freeze σ scales with field as f^beta", () => {
    if (SIGMA_ROI_FREEZE.kind !== "single-beta") return;
    const at100 = evalSigma(SIGMA_ROI_FREEZE, 100, 0.10);
    const at1000 = evalSigma(SIGMA_ROI_FREEZE, 1000, 0.10);
    const ratio = at1000 / at100;
    const expected = Math.pow(10, SIGMA_ROI_FREEZE.beta);
    expect(ratio).toBeCloseTo(expected, 8);
  });

  it("PKO σ grows with ROI inside the validated box (b1 must stay positive)", () => {
    expect(SIGMA_ROI_PKO.kind).toBe("log-poly-2d");
    if (SIGMA_ROI_PKO.kind !== "log-poly-2d") return;
    // Fit-trained box: ROI ∈ [-0.20, +0.80]
    expect(SIGMA_ROI_PKO.b1).toBeGreaterThan(0);
    const lo = evalSigma(SIGMA_ROI_PKO, 500, -0.10);
    const mid = evalSigma(SIGMA_ROI_PKO, 500, 0.10);
    const hi = evalSigma(SIGMA_ROI_PKO, 500, 0.30);
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
  });

  it("Mystery σ grows with ROI more aggressively than PKO (envelope variance)", () => {
    if (SIGMA_ROI_PKO.kind !== "log-poly-2d") return;
    if (SIGMA_ROI_MYSTERY.kind !== "log-poly-2d") return;
    expect(SIGMA_ROI_MYSTERY.b1).toBeGreaterThan(SIGMA_ROI_PKO.b1);
  });

  it("MBR σ is single-beta and grows with ROI (C1 > 0)", () => {
    expect(SIGMA_ROI_MYSTERY_ROYALE.kind).toBe("single-beta");
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    expect(SIGMA_ROI_MYSTERY_ROYALE.C1).toBeGreaterThan(0);
    // beta=0 because MBR is locked at AFS=18 — field shouldn't matter
    expect(SIGMA_ROI_MYSTERY_ROYALE.beta).toBe(0);
    const lo = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, -0.05);
    const hi = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, 0.05);
    expect(hi).toBeGreaterThan(lo);
  });

  it("σ stays positive across the full validated box for every format", () => {
    for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
      const coef = SIGMA_COEF_BY_FORMAT[format];
      const fields = format === "mystery-royale" ? [18] : [50, 200, 1000, 10_000, 50_000];
      const rois = format === "mystery-royale"
        ? [-0.10, 0, 0.10]
        : [-0.20, 0, 0.10, 0.40, 0.80];
      for (const f of fields) {
        for (const roi of rois) {
          const s = evalSigma(coef, f, roi);
          expect(s).toBeGreaterThan(0);
          expect(Number.isFinite(s)).toBe(true);
        }
      }
    }
  });

  it("evalSigma clamps field to ≥1 (no log(0))", () => {
    const s0 = evalSigma(SIGMA_ROI_FREEZE, 0, 0.10);
    const s_neg = evalSigma(SIGMA_ROI_FREEZE, -100, 0.10);
    const s1 = evalSigma(SIGMA_ROI_FREEZE, 1, 0.10);
    expect(Number.isFinite(s0)).toBe(true);
    expect(Number.isFinite(s_neg)).toBe(true);
    expect(s0).toBeCloseTo(s1, 12);
    expect(s_neg).toBeCloseTo(s1, 12);
  });

  it("MBR single-beta clamps the linear part at zero (no negative σ at extreme ROI)", () => {
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    // At very negative ROI: C0 + C1·ROI could go negative without clamp.
    // C0=7.504, C1=4.031 → would cross zero at ROI ≈ -1.86. The fit-box
    // floor is -0.10 so this matters only as a defensive guard, but assert
    // the clamp is in place.
    const extreme = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, -10);
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(extreme)).toBe(true);
  });

  it("residual coefficients are within a plausible 1–25 % range", () => {
    // 1 % is the floor of the rounding: the BR line reaches the card's exact σ
    // to 0.08 % over its whole box.
    for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
      const coef = SIGMA_COEF_BY_FORMAT[format];
      expect(coef.resid).toBeGreaterThanOrEqual(0.01);
      expect(coef.resid).toBeLessThan(0.25);
    }
  });

  it("PKO residual ≤ Mystery residual (the envelope tail is the harder surface)", () => {
    // Freeze is not ordered against them: its single-β form misses its own grid
    // by up to 14 % with the field held out, while the 2D PKO surface fits a
    // noise-free grid to 5 % at p95.
    expect(SIGMA_ROI_PKO.resid).toBeLessThanOrEqual(SIGMA_ROI_MYSTERY.resid);
  });
});

/** σ per tournament in buy-ins of one canonical-grid cell, read off the compile as `resweep_sigma.ts` does. */
function compiledGridSigma(
  recipe: Pick<TournamentRow, "payoutStructure" | "gameType" | "bountyFraction" | "mysteryBountyVariance">,
  finishModel: FinishModelId,
) {
  return (field: number, roi: number) => {
    const row: TournamentRow = {
      id: "p", label: "p", players: field, buyIn: 50, rake: 0.1, roi, count: 1, ...recipe,
    };
    const input: SimulationInput = {
      schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1,
      finishModel: { id: finishModel },
    };
    const entry = compileSchedule(input, "alpha").flat[0];
    const m = compiledEntryMoments(entry);
    return Math.sqrt(m.secondDollar - m.meanDollar * m.meanDollar) / entry.singleCost;
  };
}

describe("SIGMA_ROI_PKO and its canonical grid", () => {
  // The grid must be the engine's: a stale grid is refitted faithfully and the
  // surface inherits its error. 1 % lets a sub-percent engine tweak through; a
  // payout-curve or knockout-model change fails here, and the fix is
  // `FORMAT=pko npx tsx scripts/resweep_sigma.ts`, then the refit.
  const cellSigma = compiledGridSigma(
    { payoutStructure: "mtt-gg-bounty", gameType: "pko", bountyFraction: 0.5 },
    "pko-realdata-linear",
  );
  const table = pkoGrid.table as Record<string, number[]>;

  it("is the current engine's σ of the canonical row in every cell", () => {
    for (const roiKey of Object.keys(table)) {
      pkoGrid.fields.forEach((field: number, i: number) => {
        const stored = table[roiKey][i];
        expect(Math.abs(stored / cellSigma(field, Number(roiKey)) - 1), `field ${field} roi ${roiKey}`).toBeLessThan(0.01);
      });
    }
  });

  it("fits that grid within its resid at p95, and within 9 % in every cell", () => {
    const misses: number[] = [];
    for (const roi of pkoGrid.rois) {
      pkoGrid.fields.forEach((field, i) => {
        misses.push(Math.abs(evalSigma(SIGMA_ROI_PKO, field, roi) / table[String(roi)][i] - 1));
      });
    }
    misses.sort((a, b) => a - b);
    expect(misses).toHaveLength(198);
    expect(misses[Math.floor(0.95 * misses.length)]).toBeLessThanOrEqual(SIGMA_ROI_PKO.resid);
    expect(misses[misses.length - 1]).toBeLessThan(0.09);
  });
});

/** |surface / stored − 1| over the cells of a canonical grid from `minField` up, sorted. */
function gridMisses(
  coef: SigmaCoef,
  grid: { fields: number[]; rois: number[]; table: Record<string, number[]> },
  minField = 0,
) {
  const misses: number[] = [];
  for (const roi of grid.rois) {
    grid.fields.forEach((field, i) => {
      if (field < minField) return;
      misses.push(Math.abs(evalSigma(coef, field, roi) / grid.table[String(roi)][i] - 1));
    });
  }
  return misses.sort((a, b) => a - b);
}

describe("SIGMA_ROI_MYSTERY and its canonical grid", () => {
  // Same contract as PKO; the fix is `FORMAT=mystery npx tsx scripts/resweep_sigma.ts`, then the refit.
  const cellSigma = compiledGridSigma(
    { payoutStructure: "mtt-gg-mystery", gameType: "mystery", bountyFraction: 0.5, mysteryBountyVariance: 2.0 },
    "mystery-realdata-linear",
  );
  const table = mysteryGrid.table as Record<string, number[]>;

  it("is the current engine's σ of the canonical row in every cell", () => {
    for (const roi of mysteryGrid.rois) {
      mysteryGrid.fields.forEach((field, i) => {
        expect(Math.abs(table[String(roi)][i] / cellSigma(field, roi) - 1), `field ${field} roi ${roi}`).toBeLessThan(0.01);
      });
    }
  });

  it("fits that grid within its resid at p95 and from field 75 up; field 50 is the far miss", () => {
    const misses = gridMisses(SIGMA_ROI_MYSTERY, mysteryGrid);
    expect(misses).toHaveLength(198);
    expect(misses[Math.floor(0.95 * misses.length)]).toBeLessThanOrEqual(SIGMA_ROI_MYSTERY.resid);
    expect(misses[misses.length - 1]).toBeLessThan(0.36);
    const from75 = gridMisses(SIGMA_ROI_MYSTERY, mysteryGrid, 75);
    expect(from75[from75.length - 1]).toBeLessThan(SIGMA_ROI_MYSTERY.resid);
  });
});

describe("SIGMA_ROI_FREEZE and its canonical grid", () => {
  // Same contract as PKO; the fix is `FORMAT=freeze npx tsx scripts/resweep_sigma.ts`, then the refit.
  const cellSigma = compiledGridSigma(
    { payoutStructure: "mtt-standard", gameType: "freezeout" },
    "freeze-realdata-linear",
  );
  const table = freezeGrid.table as Record<string, number[]>;

  it("is the current engine's σ of the canonical row in every cell, the same at every ROI", () => {
    for (const roi of freezeGrid.rois) {
      freezeGrid.fields.forEach((field, i) => {
        expect(Math.abs(table[String(roi)][i] / cellSigma(field, roi) - 1), `field ${field} roi ${roi}`).toBeLessThan(0.01);
      });
      expect(table[String(roi)]).toEqual(table["0"]);
    }
  });

  // The columns are copies, so the grid holds 18 distinct cells: σ by field.
  const fields = freezeGrid.fields;
  const sigmas = table["0"];
  const lineThrough = (keep: number[]) => {
    const xs = keep.map((i) => Math.log(fields[i]));
    const ys = keep.map((i) => Math.log(sigmas[i]));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    xs.forEach((x, k) => {
      num += (x - mx) * (ys[k] - my);
      den += (x - mx) ** 2;
    });
    const beta = num / den;
    return { C0: Math.exp(my - beta * mx), beta };
  };
  const everyField = fields.map((_, i) => i);

  it("is the least-squares line through that grid", () => {
    if (SIGMA_ROI_FREEZE.kind !== "single-beta") throw new Error("freeze is a single-β line");
    const fit = lineThrough(everyField);
    expect(SIGMA_ROI_FREEZE.C0).toBeCloseTo(fit.C0, 4);
    expect(SIGMA_ROI_FREEZE.beta).toBeCloseTo(fit.beta, 4);
    expect(SIGMA_ROI_FREEZE.C1).toBe(0);
  });

  it("misses every field held out of the fit by at most its resid", () => {
    // Leaving out one cell would keep its six copies in the fit (the in-sample
    // miss); the held-out unit is the field. With 18 fields the p95 is the max:
    // 14.24 % at field 50 000.
    const misses = everyField.map((i) => {
      const fit = lineThrough(everyField.filter((j) => j !== i));
      return Math.abs((fit.C0 * Math.pow(fields[i], fit.beta)) / sigmas[i] - 1);
    });
    expect(Math.max(...misses)).toBeGreaterThan(0.14);
    expect(Math.max(...misses)).toBeLessThanOrEqual(SIGMA_ROI_FREEZE.resid);
  });
});

describe("SIGMA_ROI_MYSTERY_ROYALE follows the BR card's own row", () => {
  const cardSigma = (roi: number) =>
    formatRuntimeSigma("mystery-royale", {
      afs: 18, roi, rake: 0.08, finishModel: { id: "powerlaw-realdata-influenced" },
    })!;

  it("every stored point is the card's σ today, within 1 %", () => {
    expect(brLine.meta.ticket).toBe(RUNTIME_SIGMA_BR_TICKET);
    brLine.rois.forEach((roi, i) => {
      expect(Math.abs(brLine.sigmas[i] / cardSigma(roi) - 1), `roi ${roi}`).toBeLessThan(0.01);
    });
  });

  it("stays within its resid of the card's σ over the whole BR slider box", () => {
    // Another ticket draws another envelope table: a line through a $50 row
    // reads 27 % under the card here.
    for (let roi = -0.1; roi <= 0.1 + 1e-9; roi += 0.01) {
      expect(Math.abs(evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, roi) / cardSigma(roi) - 1), `roi ${roi}`)
        .toBeLessThanOrEqual(SIGMA_ROI_MYSTERY_ROYALE.resid);
    }
  });
});

/**
 * Reference-value canaries — pin the σ at a known box-center for every fit.
 * If a future refit shifts these by more than 5 %, the canary fails and the
 * dev must consciously update the snapshot, and with it the scripts' reports.
 */
describe("σ reference canaries (5% tolerance)", () => {
  it("freeze @ AFS=500 ROI=0% lands near the engine's 6.28", () => {
    // 0.6459 × 500^0.3715 ≈ 6.50: the line sits 3.5 % over the grid here.
    const s = evalSigma(SIGMA_ROI_FREEZE, 500, 0);
    expect(s).toBeGreaterThan(5.97);
    expect(s).toBeLessThan(6.6);
  });

  it("PKO @ AFS=500 ROI=10% lands near the engine's 4.22", () => {
    const s = evalSigma(SIGMA_ROI_PKO, 500, 0.10);
    expect(s).toBeGreaterThan(4.0);
    expect(s).toBeLessThan(4.45);
  });

  it("Mystery @ AFS=500 ROI=10% lands near the engine's 5.29", () => {
    const s = evalSigma(SIGMA_ROI_MYSTERY, 500, 0.10);
    expect(s).toBeGreaterThan(5.03);
    expect(s).toBeLessThan(5.55);
  });

  it("MBR @ AFS=18 ROI=0% lands near the card's 7.51 (C0)", () => {
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    const s = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, 0);
    expect(s).toBeCloseTo(SIGMA_ROI_MYSTERY_ROYALE.C0, 6);
    expect(s).toBeGreaterThan(7.13);
    expect(s).toBeLessThan(7.89);
  });
});
