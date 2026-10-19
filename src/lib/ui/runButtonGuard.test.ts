import { describe, expect, it } from "vitest";

import { isStopClickTooEarly, STOP_CLICK_GRACE_MS } from "./runButtonGuard";

describe("isStopClickTooEarly", () => {
  it("ignores the second click of a double-click on Run", () => {
    expect(isStopClickTooEarly(1000, 1040)).toBe(true);
    expect(isStopClickTooEarly(1000, 1300)).toBe(true);
    expect(isStopClickTooEarly(1000, 1000 + STOP_CLICK_GRACE_MS - 1)).toBe(true);
  });

  it("lets a deliberate Stop through once the run has been going a moment", () => {
    expect(isStopClickTooEarly(1000, 1000 + STOP_CLICK_GRACE_MS)).toBe(false);
    expect(isStopClickTooEarly(1000, 60_000)).toBe(false);
  });

  it("never blocks when no run start was recorded", () => {
    expect(isStopClickTooEarly(null, 5)).toBe(false);
  });
});
