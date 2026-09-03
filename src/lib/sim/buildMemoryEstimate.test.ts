import { describe, expect, it } from "vitest";
import {
  MEMORY_HINT_THRESHOLD_BYTES,
  memoryHintGb,
  projectedBuildBytes,
} from "./buildMemoryEstimate";

describe("projectedBuildBytes", () => {
  it("reproduces the measured ≈4 GB single pass at the 1M cap", () => {
    const bytes = projectedBuildBytes({
      samples: 1_000_000,
      tournamentsPerSample: 1000,
      rowCount: 3,
      passCount: 1,
    });
    expect(bytes).toBeGreaterThan(3.8e9);
    expect(bytes).toBeLessThan(4.6e9);
  });

  it("doubles for a twin run", () => {
    const base = { samples: 200_000, tournamentsPerSample: 500, rowCount: 2 };
    expect(projectedBuildBytes({ ...base, passCount: 2 })).toBe(
      2 * projectedBuildBytes({ ...base, passCount: 1 }),
    );
  });

  it("caps the checkpoint grid at 240 so longer sessions cost no more", () => {
    const base = { samples: 50_000, rowCount: 1, passCount: 1 };
    expect(projectedBuildBytes({ ...base, tournamentsPerSample: 240 })).toBe(
      projectedBuildBytes({ ...base, tournamentsPerSample: 100_000 }),
    );
    expect(projectedBuildBytes({ ...base, tournamentsPerSample: 50 })).toBeLessThan(
      projectedBuildBytes({ ...base, tournamentsPerSample: 240 }),
    );
  });
});

describe("memoryHintGb", () => {
  it("stays silent for the default-sized runs", () => {
    const bytes = projectedBuildBytes({
      samples: 50_000,
      tournamentsPerSample: 1000,
      rowCount: 5,
      passCount: 2,
    });
    expect(bytes).toBeLessThan(MEMORY_HINT_THRESHOLD_BYTES);
    expect(memoryHintGb(bytes)).toBeNull();
  });

  it("formats decimal GB with one decimal once over the threshold", () => {
    expect(memoryHintGb(4.29e9)).toBe("4.3");
    expect(memoryHintGb(MEMORY_HINT_THRESHOLD_BYTES)).toBeNull();
    expect(memoryHintGb(MEMORY_HINT_THRESHOLD_BYTES + 1)).toBe("1.5");
  });
});
