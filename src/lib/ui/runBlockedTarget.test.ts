import { afterEach, describe, expect, it, vi } from "vitest";
import { focusRunBlocker, runBlockedScrollTarget } from "./runBlockedTarget";

afterEach(() => {
  vi.useRealTimers();
});

describe("runBlockedScrollTarget", () => {
  it("points at the row when one row blocks the run, at the banner when several do", () => {
    expect(runBlockedScrollTarget([{ rowId: "a" }])).toBe("schedule-row-a");
    expect(runBlockedScrollTarget([{ rowId: "a" }, { rowId: "b" }])).toBe("feasibility-banner");
  });
});

describe("focusRunBlocker", () => {
  const element = () => ({
    scrollIntoView: vi.fn(),
    classList: { add: vi.fn(), remove: vi.fn() },
  });

  it("scrolls the blocker into view and rings it for a moment", () => {
    vi.useFakeTimers();
    const el = element();
    const doc = { getElementById: vi.fn(() => el) };
    expect(focusRunBlocker(doc as unknown as Document, "schedule-row-a")).toBe(true);
    expect(doc.getElementById).toHaveBeenCalledWith("schedule-row-a");
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(el.classList.add).toHaveBeenCalledWith("ring-2", "ring-rose-500/70");
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1800);
    expect(el.classList.remove).toHaveBeenCalledWith("ring-2", "ring-rose-500/70");
  });

  it("reports a target that is not on the page", () => {
    expect(focusRunBlocker({ getElementById: () => null }, "gone")).toBe(false);
  });
});
