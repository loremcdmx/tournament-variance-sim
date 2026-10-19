import { describe, expect, it, vi } from "vitest";
import { preferredScrollBehavior } from "./scrollBehavior";

const win = (matches: boolean) => ({ matchMedia: vi.fn(() => ({ matches })) }) as unknown as Window;

describe("preferredScrollBehavior", () => {
  it("jumps instantly when the user prefers reduced motion", () => {
    const w = win(true);
    expect(preferredScrollBehavior(w)).toBe("auto");
    expect(w.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("scrolls smoothly otherwise, and when there is no window to ask", () => {
    expect(preferredScrollBehavior(win(false))).toBe("smooth");
    expect(preferredScrollBehavior(null)).toBe("smooth");
    expect(preferredScrollBehavior(undefined)).toBe("smooth");
  });

  it("falls back to smooth if matchMedia throws", () => {
    const throwing = { matchMedia: () => { throw new Error("blocked"); } } as unknown as Window;
    expect(preferredScrollBehavior(throwing)).toBe("smooth");
  });
});
