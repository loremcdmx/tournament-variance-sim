import { describe, expect, it } from "vitest";
import { composeProgress } from "../sim/progressAggregation";
import { BUILD_PROGRESS_CAP } from "../sim/progressConstants";
import {
  type BarState,
  barFillPercent,
  nextBarState,
  progressPercent,
} from "./progressBarState";

/**
 * End-to-end invariants across a simulated run. The individual helpers
 * (composeProgress, nextBarState, progressPercent, barFillPercent) are
 * unit-tested next to their source files. These tests compose them the
 * way the component actually does and pin the properties the user sees:
 *
 *   1. Bar fill width and stop-button label always render the same integer.
 *   2. Progress never decreases during a live run.
 *   3. Cancel never flashes 100 % — we skip `completing` entirely.
 *   4. The only way to reach `completing` is a terminal progress===1
 *      emitted by the build-result handler.
 *
 * The fixtures below model realistic tick sequences from `runJob`:
 *   - shard phase emits `shardDone/shardTotal` at ~30 fps
 *   - build phase emits `buildFracs` capped at BUILD_PROGRESS_CAP (0.985)
 *   - build-result fires `setProgress(1)` then `running=false`
 */

type TickKind = "shard" | "build" | "done" | "cancel";

interface Tick {
  kind: TickKind;
  shardDone?: number;
  shardTotal?: number;
  buildFracs?: ReadonlyMap<number, number>;
  totalBuildsExpected?: number;
  progressOverride?: number; // for `done` / `cancel` branches
}

function runTicks(ticks: Tick[], shardFrac = 0.8): {
  progresses: number[];
  barStates: BarState[];
  fills: string[];
  labels: string[];
} {
  const progresses: number[] = [];
  const barStates: BarState[] = [];
  const fills: string[] = [];
  const labels: string[] = [];
  let barState: BarState = "hidden";
  let running = false;

  // Mirror the external run-start edge: first tick flips running true.
  let first = true;

  for (const tick of ticks) {
    if (first && tick.kind !== "cancel") {
      running = true;
      first = false;
    }
    let progress: number;
    if (tick.kind === "done") {
      progress = tick.progressOverride ?? 1;
      running = false;
    } else if (tick.kind === "cancel") {
      progress = tick.progressOverride ?? 0;
      running = false;
    } else {
      progress = composeProgress({
        shardDone: tick.shardDone ?? 0,
        shardTotal: tick.shardTotal ?? 1,
        shardFrac,
        buildFracs: tick.buildFracs ?? new Map(),
        totalBuildsExpected: tick.totalBuildsExpected ?? 0,
      });
    }
    barState = nextBarState({ running, progress, prev: barState });
    progresses.push(progress);
    barStates.push(barState);
    fills.push(barFillPercent(barState, progress));
    labels.push(`${progressPercent(progress)}%`);
  }
  return { progresses, barStates, fills, labels };
}

describe("progress lifecycle — end-to-end invariants", () => {
  it("shard phase: bar fill always matches the stop-button integer percent", () => {
    const ticks: Tick[] = [];
    for (let d = 0; d <= 10_000; d += 250) {
      ticks.push({ kind: "shard", shardDone: d, shardTotal: 10_000 });
    }
    const { fills, labels, barStates } = runTicks(ticks);
    for (let i = 0; i < fills.length; i++) {
      // During a live run all frames are in "running" state (no cancel
      // or done tick in this fixture).
      expect(barStates[i]).toBe("running");
      expect(fills[i]).toBe(labels[i]);
    }
  });

  it("shard progress never decreases — monotonic integer ticks", () => {
    const ticks: Tick[] = [];
    for (let d = 0; d <= 10_000; d += 57) {
      // odd step to probe rounding edges
      ticks.push({ kind: "shard", shardDone: d, shardTotal: 10_000 });
    }
    const { progresses } = runTicks(ticks);
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
  });

  it("build phase caps bar at BUILD_PROGRESS_CAP until the terminal done tick", () => {
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 10_000, shardTotal: 10_000 },
    ];
    for (let f = 0; f <= 1; f += 0.05) {
      const buildFracs = new Map<number, number>([
        [1, Math.min(BUILD_PROGRESS_CAP, f)],
      ]);
      ticks.push({ kind: "build", buildFracs, totalBuildsExpected: 1 });
    }
    const { progresses, fills, barStates } = runTicks(ticks);
    for (let i = 0; i < progresses.length; i++) {
      expect(progresses[i]).toBeLessThanOrEqual(BUILD_PROGRESS_CAP + 1e-9);
      expect(barStates[i]).toBe("running");
      // Never over 98 % during the capped build phase.
      expect(fills[i]).not.toBe("100%");
    }
  });

  it("happy path: shard → build → done → completing (one 100 % frame)", () => {
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 5_000, shardTotal: 10_000 },
      { kind: "shard", shardDone: 10_000, shardTotal: 10_000 },
      {
        kind: "build",
        buildFracs: new Map([[1, 0.5]]),
        totalBuildsExpected: 1,
      },
      {
        kind: "build",
        buildFracs: new Map([[1, BUILD_PROGRESS_CAP]]),
        totalBuildsExpected: 1,
      },
      { kind: "done" },
    ];
    const { barStates, fills, labels } = runTicks(ticks);
    expect(barStates).toEqual([
      "running",
      "running",
      "running",
      "running",
      "completing",
    ]);
    // The completing frame ALWAYS renders 100 % regardless of the underlying
    // progress snapshot — no label/fill mismatch.
    expect(fills[fills.length - 1]).toBe("100%");
    expect(labels[labels.length - 1]).toBe("100%");
  });

  it("cancel mid-shard: bar disappears without a 100 % flash", () => {
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 2_500, shardTotal: 10_000 },
      { kind: "shard", shardDone: 5_000, shardTotal: 10_000 },
      { kind: "cancel", progressOverride: 0 },
    ];
    const { barStates, fills } = runTicks(ticks);
    expect(barStates[0]).toBe("running");
    expect(barStates[1]).toBe("running");
    // On cancel, progress reset to 0 and running=false → hidden, NOT completing.
    expect(barStates[2]).toBe("hidden");
    expect(fills[2]).toBe("0%");
  });

  it("cancel at the cap (0.985) in build phase: still hidden, never completing", () => {
    // This was the 6bf3f19 regression: any ≥0.99 progress tripped "done".
    // The fix checks === 1 strictly. Pin it here at the lifecycle level.
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 10_000, shardTotal: 10_000 },
      {
        kind: "build",
        buildFracs: new Map([[1, BUILD_PROGRESS_CAP]]),
        totalBuildsExpected: 1,
      },
      { kind: "cancel", progressOverride: BUILD_PROGRESS_CAP },
    ];
    const { barStates } = runTicks(ticks);
    expect(barStates[2]).toBe("hidden");
  });

  it("rapid re-run during completing hold: running resumes without stale fill", () => {
    // The component remounts the fill div on the false→true running edge
    // (runToken key), so the CSS transition doesn't animate 100%→0%. The
    // state machine still has to route back to running.
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 10_000, shardTotal: 10_000 },
      { kind: "done" },
    ];
    const { barStates: first } = runTicks(ticks);
    expect(first[first.length - 1]).toBe("completing");
    // Simulate a second run starting before the completing→hidden timeout.
    // The component passes prev=completing; the first tick of run 2 should
    // land us in running again.
    const prev: BarState = first[first.length - 1];
    const resumed = nextBarState({
      running: true,
      progress: 0,
      prev,
    });
    expect(resumed).toBe("running");
    expect(barFillPercent("running", 0)).toBe("0%");
  });

  it("twin-pass build: avg of two build fracs tracks smoothly", () => {
    // Two builds in parallel (twin compare mode). The shard phase ends at
    // shardFrac, then the average of the two build fracs walks to CAP.
    const ticks: Tick[] = [
      { kind: "shard", shardDone: 10_000, shardTotal: 10_000 },
    ];
    // Build A starts first, then B catches up.
    const points: Array<[number, number]> = [
      [0.1, 0],
      [0.3, 0.1],
      [0.5, 0.3],
      [0.7, 0.5],
      [0.9, 0.7],
      [BUILD_PROGRESS_CAP, BUILD_PROGRESS_CAP],
    ];
    for (const [a, b] of points) {
      ticks.push({
        kind: "build",
        buildFracs: new Map([
          [1, a],
          [2, b],
        ]),
        totalBuildsExpected: 2,
      });
    }
    const { progresses } = runTicks(ticks);
    // Must be monotonic and never exceed CAP during build.
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
    const last = progresses[progresses.length - 1];
    expect(last).toBeGreaterThan(0.9);
    expect(last).toBeLessThanOrEqual(BUILD_PROGRESS_CAP + 1e-9);
  });

  it("fill and label agree byte-for-byte across a realistic 100-tick run", () => {
    // Primary regression guard: enumerate every frame a user would actually
    // see and assert fill === label.
    const ticks: Tick[] = [];
    for (let i = 0; i <= 60; i++) {
      ticks.push({
        kind: "shard",
        shardDone: Math.floor((i / 60) * 10_000),
        shardTotal: 10_000,
      });
    }
    for (let i = 0; i <= 30; i++) {
      ticks.push({
        kind: "build",
        buildFracs: new Map([[1, (i / 30) * BUILD_PROGRESS_CAP]]),
        totalBuildsExpected: 1,
      });
    }
    ticks.push({ kind: "done" });
    const { fills, labels, barStates } = runTicks(ticks);
    for (let i = 0; i < fills.length; i++) {
      if (barStates[i] === "completing") {
        expect(fills[i]).toBe("100%");
      } else {
        expect(fills[i]).toBe(labels[i]);
      }
    }
  });

  it("zero-work edge (samples=0): progress stays 0, bar never shows >0 during running", () => {
    // If shardTotal <= 0, composeProgress returns 0 — guard that we don't
    // render a misleading partial fill.
    const p = composeProgress({
      shardDone: 0,
      shardTotal: 0,
      shardFrac: 0.8,
      buildFracs: new Map(),
      totalBuildsExpected: 0,
    });
    expect(p).toBe(0);
    expect(progressPercent(p)).toBe(0);
    expect(barFillPercent("running", p)).toBe("0%");
  });

  it("build-only fixture: bar jumps from shardFrac onto build track cleanly", () => {
    // Transition from shard phase to build phase must not regress the bar.
    const shardEnd = composeProgress({
      shardDone: 10_000,
      shardTotal: 10_000,
      shardFrac: 0.8,
      buildFracs: new Map(),
      totalBuildsExpected: 0,
    });
    const buildStart = composeProgress({
      shardDone: 10_000,
      shardTotal: 10_000,
      shardFrac: 0.8,
      buildFracs: new Map([[1, 0]]),
      totalBuildsExpected: 1,
    });
    expect(shardEnd).toBeCloseTo(0.8, 10);
    expect(buildStart).toBeCloseTo(0.8, 10);
    // Integer percents must not step down at the seam.
    expect(progressPercent(buildStart)).toBeGreaterThanOrEqual(
      progressPercent(shardEnd),
    );
  });
});
