import { describe, expect, it } from "vitest";
import {
  COMPLETING_HOLD_MS,
  type BarState,
  barFillPercent,
  nextBarState,
  progressPercent,
} from "./progressBarState";

describe("nextBarState", () => {
  it("running flag is authoritative — any prev state moves to running", () => {
    const prevStates: BarState[] = ["hidden", "running", "completing"];
    for (const prev of prevStates) {
      expect(nextBarState({ running: true, progress: 0, prev })).toBe("running");
      expect(nextBarState({ running: true, progress: 0.5, prev })).toBe("running");
      expect(nextBarState({ running: true, progress: 1, prev })).toBe("running");
    }
  });

  it("idle from scratch (hidden + !running) stays hidden", () => {
    expect(nextBarState({ running: false, progress: 0, prev: "hidden" })).toBe(
      "hidden",
    );
  });

  it("natural completion: running → completing when progress is exactly 1", () => {
    expect(nextBarState({ running: false, progress: 1, prev: "running" })).toBe(
      "completing",
    );
  });

  it("cancel mid-simulate: running + progress<1 + !running → hidden, skipping completing", () => {
    // Shard phase: progress is e.g. 0.4.
    expect(
      nextBarState({ running: false, progress: 0.4, prev: "running" }),
    ).toBe("hidden");
  });

  it("cancel in late build phase (the 6bf3f19 regression): progress at BUILD_PROGRESS_CAP does NOT trip completing", () => {
    // This is the regression that the reachedDoneRef heuristic caused:
    // during the build phase progress parks at 0.985 (BUILD_PROGRESS_CAP).
    // The old code treated "≥ 0.99" as done and showed a 100 % flash on
    // cancel. The fix gates on === 1, so 0.985 → hidden.
    expect(
      nextBarState({ running: false, progress: 0.985, prev: "running" }),
    ).toBe("hidden");
    // Even at 0.999 we still hide — only exactly 1 means success.
    expect(
      nextBarState({ running: false, progress: 0.999, prev: "running" }),
    ).toBe("hidden");
  });

  it("cancel() resetting progress to 0 → hidden", () => {
    // cancel() in useSimulation sets progress back to 0. Verify the
    // state machine still routes to hidden (it would anyway, since 0 < 1).
    expect(
      nextBarState({ running: false, progress: 0, prev: "running" }),
    ).toBe("hidden");
  });

  it("error path: progress stays wherever the last tick landed, → hidden", () => {
    // useSimulation's error handler doesn't touch progress. It could
    // sit at 0.3 from the last shard tick. No false completion flash.
    expect(
      nextBarState({ running: false, progress: 0.3, prev: "running" }),
    ).toBe("hidden");
  });

  it("completing stays completing as long as progress is still 1 and running is false", () => {
    // This is the in-the-450ms-hold case. The external timer flips us
    // back to hidden, but while the timeout is pending the effect may
    // re-run for unrelated reasons — stay in completing.
    expect(
      nextBarState({ running: false, progress: 1, prev: "completing" }),
    ).toBe("completing");
  });

  it("hidden after completing-timeout is sticky until the next run", () => {
    // Timeout fires, setBarState("hidden") → prev=hidden. Nothing else
    // changes. Stay hidden.
    expect(
      nextBarState({ running: false, progress: 1, prev: "hidden" }),
    ).toBe("hidden");
  });

  it("full sequence: hidden → running → completing → hidden", () => {
    let state: BarState = "hidden";
    // User clicks Run.
    state = nextBarState({ running: true, progress: 0, prev: state });
    expect(state).toBe("running");
    // Shards tick through.
    state = nextBarState({ running: true, progress: 0.5, prev: state });
    expect(state).toBe("running");
    // Build phase caps at 0.985.
    state = nextBarState({ running: true, progress: 0.985, prev: state });
    expect(state).toBe("running");
    // build-result arrives → setProgress(1), then setStatus("done") → running=false.
    state = nextBarState({ running: false, progress: 1, prev: state });
    expect(state).toBe("completing");
    // 450 ms later the timeout fires and forces hidden externally.
    // Simulate a subsequent render: nothing else changed, prev=hidden now.
    state = "hidden";
    state = nextBarState({ running: false, progress: 1, prev: state });
    expect(state).toBe("hidden");
  });

  it("full sequence: hidden → running → cancel mid-build → hidden (no 100 % flash)", () => {
    let state: BarState = "hidden";
    state = nextBarState({ running: true, progress: 0, prev: state });
    expect(state).toBe("running");
    state = nextBarState({ running: true, progress: 0.985, prev: state });
    expect(state).toBe("running");
    // User clicks cancel. useSimulation.cancel() flips status="idle" and
    // resets progress to 0 in the same batch.
    state = nextBarState({ running: false, progress: 0, prev: state });
    expect(state).toBe("hidden");
  });

  it("full sequence: run → complete → new run (no reverse animation handled at render layer, not here)", () => {
    let state: BarState = "hidden";
    state = nextBarState({ running: true, progress: 0, prev: state });
    state = nextBarState({ running: false, progress: 1, prev: state });
    expect(state).toBe("completing");
    // User clicks Run again before the 450 ms timeout fires. prev is
    // still "completing" but running flips to true.
    state = nextBarState({ running: true, progress: 0, prev: state });
    expect(state).toBe("running");
    // (Reverse-animation prevention is done via `runToken` remount key
    // in the component — unit-testing that belongs to the render layer.)
  });
});

describe("progressPercent", () => {
  it("maps a [0,1] fraction to an integer in [0,100] via floor", () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.25)).toBe(25);
    expect(progressPercent(0.857)).toBe(85);
    expect(progressPercent(0.985)).toBe(98);
    expect(progressPercent(0.999)).toBe(99);
    expect(progressPercent(1)).toBe(100);
  });

  it("clamps to [0,100]", () => {
    expect(progressPercent(-0.01)).toBe(0);
    expect(progressPercent(-1)).toBe(0);
    expect(progressPercent(1.2)).toBe(100);
    expect(progressPercent(9999)).toBe(100);
  });

  it("rejects non-finite input as 0 — never NaN%", () => {
    expect(progressPercent(Number.NaN)).toBe(0);
    expect(progressPercent(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(progressPercent(Number.POSITIVE_INFINITY)).toBe(100);
  });

  it("never overstates: floor, not round — 0.859 renders as 85, not 86", () => {
    // Users read "85 %" as "85 % of the work has completed". Rounding to
    // the nearest integer would advertise progress that hasn't happened
    // yet. Floor makes the label a lower bound on real progress.
    expect(progressPercent(0.859)).toBe(85);
    expect(progressPercent(0.899)).toBe(89);
    expect(progressPercent(0.999999)).toBe(99);
  });
});

describe("barFillPercent", () => {
  it("hidden renders 0%", () => {
    expect(barFillPercent("hidden", 0)).toBe("0%");
    expect(barFillPercent("hidden", 0.5)).toBe("0%");
    expect(barFillPercent("hidden", 1)).toBe("0%");
  });

  it("completing pins to 100% regardless of progress snapshot", () => {
    // The raw progress may be 0.985 (cap) or 1 depending on whether the
    // build-result tick has fired yet — either way the completing frame
    // renders 100 % so the fill ends cleanly.
    expect(barFillPercent("completing", 0.985)).toBe("100%");
    expect(barFillPercent("completing", 1)).toBe("100%");
  });

  it("running tracks progress as an integer percent (matches button label)", () => {
    // Must match progressPercent exactly — the fill width and the numeric
    // label on the stop button both round via the same function, otherwise
    // users see "85 %" next to a bar filled to 85.7 %.
    expect(barFillPercent("running", 0)).toBe("0%");
    expect(barFillPercent("running", 0.25)).toBe("25%");
    expect(barFillPercent("running", 0.857)).toBe("85%");
    expect(barFillPercent("running", 0.985)).toBe("98%");
    expect(barFillPercent("running", 0.9999)).toBe("99%");
  });

  it("running clamps to [0, 100]", () => {
    // Defensive — composeProgress can't produce these, but if upstream
    // ever does, the bar shouldn't overflow or render a negative width.
    expect(barFillPercent("running", -0.1)).toBe("0%");
    expect(barFillPercent("running", 1.2)).toBe("100%");
  });

  it("NaN / non-finite progress renders 0%", () => {
    expect(barFillPercent("running", Number.NaN)).toBe("0%");
    expect(barFillPercent("running", Number.POSITIVE_INFINITY)).toBe("100%");
  });
});

describe("barFillPercent ↔ progressPercent invariant", () => {
  // The user-facing invariant: at every point in a run, the bar fill
  // width and the stop-button numeric label display the same integer.
  // This test enumerates a dense set of progress values — if anyone
  // reintroduces toFixed(1) or Math.round in one place but not the
  // other, the suite breaks loudly.
  it("bar fill in 'running' equals progressPercent()+'%' for every test progress", () => {
    const samples: number[] = [];
    for (let p = 0; p <= 1; p += 0.001) samples.push(p);
    samples.push(0.985, 0.857, 0.3333, 0.6667, 0.9999);
    for (const p of samples) {
      expect(barFillPercent("running", p)).toBe(`${progressPercent(p)}%`);
    }
  });

  it("monotonic in progress — more work done, more bar filled", () => {
    // Not strictly monotonic at the integer level (small deltas round to
    // the same percent), but must never decrease. Catches "rolled rounding"
    // bugs where a borderline value ticks down on a subsequent update.
    let last = -1;
    for (let p = 0; p <= 1; p += 0.0005) {
      const pct = progressPercent(p);
      expect(pct).toBeGreaterThanOrEqual(last);
      last = pct;
    }
  });
});

describe("COMPLETING_HOLD_MS", () => {
  it("is exported and positive so the component can reference it", () => {
    // The constant is used as the setTimeout duration in ControlsPanel
    // and drives the "how long does the user see 100 %?" UX promise.
    // Guard its existence so a rename breaks the test suite, not just
    // the bar.
    expect(COMPLETING_HOLD_MS).toBeGreaterThan(0);
    expect(COMPLETING_HOLD_MS).toBeLessThan(2000);
  });
});
