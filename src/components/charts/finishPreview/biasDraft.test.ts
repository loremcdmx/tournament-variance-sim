import { describe, expect, it } from "vitest";
import { isRepeatSubmission, settleCommitted, submitBias } from "./biasDraft";

describe("bias draft bookkeeping", () => {
  it("treats the value the row already holds, or the one just sent, as a repeat", () => {
    expect(isRepeatSubmission([], 0.2, 0.2)).toBe(true);
    expect(isRepeatSubmission([0.1, 0.2], 0.2, 0)).toBe(true);
    expect(isRepeatSubmission([0.1, 0.2], 0.1, 0)).toBe(false);
    expect(isRepeatSubmission([], 0.2, 0)).toBe(false);
  });

  it("keeps the draft while an earlier submission lands", () => {
    let inflight = submitBias(submitBias([], 0.1), 0.2);
    let step = settleCommitted(inflight, 0.1);
    expect(step).toEqual({ inflight: [0.2], external: false });
    inflight = step.inflight;
    step = settleCommitted(inflight, 0.2);
    expect(step).toEqual({ inflight: [], external: false });
  });

  it("calls any value nobody sent an outside change, and forgets what was in flight", () => {
    expect(settleCommitted([0.2], 0)).toEqual({ inflight: [], external: true });
    expect(settleCommitted([], 0.05)).toEqual({ inflight: [], external: true });
  });

  it("does not remember a value after the row shows it", () => {
    const landed = settleCommitted(submitBias([], 0.2), 0.2).inflight;
    expect(isRepeatSubmission(landed, 0.2, 0)).toBe(false);
  });
});
