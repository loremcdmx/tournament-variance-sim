import { describe, expect, it, vi } from "vitest";
import { closeMenu } from "./menuFocus";

describe("closeMenu", () => {
  it("closes and hands focus to the trigger after a keyboard close", () => {
    const setOpen = vi.fn();
    const trigger = { focus: vi.fn() };
    closeMenu(setOpen, trigger, true);
    expect(setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone for a pointer close, and copes with an unmounted trigger", () => {
    const trigger = { focus: vi.fn() };
    closeMenu(vi.fn(), trigger, false);
    expect(trigger.focus).not.toHaveBeenCalled();
    expect(() => closeMenu(vi.fn(), null, true)).not.toThrow();
  });
});
