import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    environment: "node",
    // The Monte Carlo tests are CPU-bound: the slowest sits ~1.1-1.4s idle but takes
    // 7-10x longer on a contended machine (shared CI runner, parallel build).
    // A wall-clock limit measures machine availability, not correctness, so keep
    // it far enough out that only a genuine hang trips it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // V8 compiles hot code on a background thread by default, so which code a
    // call runs depends on when that compile lands, i.e. on the machine's load.
    // Compiling on the spot runs the same code on every run: a V8 miscompile
    // that gave the format comparison's rows one another's variance failed only
    // under load before, and fails formatComparisonRows.test.ts every time if
    // momentRow takes its loop back.
    execArgv: ["--no-concurrent-recompilation"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
