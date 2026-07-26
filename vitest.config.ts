import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // The Monte Carlo tests are CPU-bound: the slowest sits ~1.1-1.4s idle but takes
    // 7-10x longer on a contended machine (shared CI runner, parallel build).
    // A wall-clock limit measures machine availability, not correctness, so keep
    // it far enough out that only a genuine hang trips it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
