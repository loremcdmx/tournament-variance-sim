import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The determinism contract (AGENTS.md, docs/ARCHITECTURE.md) is about the
 * engine path: everything a worker runs to turn a SimulationInput and a seed
 * into a SimulationResult. `src/lib/sim/` also holds browser-side bridges, and
 * these are the only files allowed to touch the clock, `Math.random` or React.
 */
const CLOCK_OR_RANDOM_ALLOWED = new Map<string, string>([
  ["useSimulation.ts", "wall-clock timing around the worker pool; the engine-only 'random' compare seed"],
  ["useResulthubLookup.ts", "cache timestamps of the ResultHub lookup hook"],
  ["resulthubLookup.ts", "defaults the all-time leaderboard window to the current date"],
]);
const REACT_ALLOWED = ["useResulthubLookup.ts", "useSimulation.ts"];

const SIM_DIR = __dirname;

function sourceFiles(): string[] {
  return readdirSync(SIM_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .sort();
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function code(file: string): string {
  return stripComments(readFileSync(join(SIM_DIR, file), "utf8"));
}

const CLOCK_OR_RANDOM = /\b(?:Date\.now|performance\.now|Math\.random)\b|\bnew Date\b/;
const REACT_IMPORT = /from\s+["']react(?:-dom)?(?:\/[^"']*)?["']/;

describe("engine source purity", () => {
  it("finds the engine files it is meant to scan", () => {
    const files = sourceFiles();
    for (const must of ["hotLoop.ts", "compile.ts", "buildResult.ts", "finishModel.ts", "cashEngine.ts"]) {
      expect(files).toContain(must);
    }
  });

  it("keeps the clock and Math.random out of every module but the listed bridges", () => {
    const offenders = sourceFiles().filter(
      (file) => !CLOCK_OR_RANDOM_ALLOWED.has(file) && CLOCK_OR_RANDOM.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("lists only bridges that still use the clock or Math.random", () => {
    for (const file of CLOCK_OR_RANDOM_ALLOWED.keys()) {
      expect(CLOCK_OR_RANDOM.test(code(file)), file).toBe(true);
    }
  });

  it("keeps React inside the two hook files", () => {
    const importers = sourceFiles().filter((file) => REACT_IMPORT.test(code(file)));
    expect(importers).toEqual(REACT_ALLOWED);
  });

  it("the scan sees a violation when one is planted", () => {
    expect(CLOCK_OR_RANDOM.test(stripComments("const t = Date.now();\n"))).toBe(true);
    expect(CLOCK_OR_RANDOM.test(stripComments("const r = Math.random(); // seeded\n"))).toBe(true);
    expect(CLOCK_OR_RANDOM.test(stripComments("// Date.now() only in a comment\n/* new Date() too */\n"))).toBe(false);
    expect(REACT_IMPORT.test(stripComments('import { useState } from "react";\n'))).toBe(true);
  });
});
