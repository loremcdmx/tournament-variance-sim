import { describe, expect, it, vi } from "vitest";
import { blurFocusedField, restoreFocusedField } from "./blurFocusedField";

const el = (tagName: string) => ({ tagName, blur: vi.fn() });

describe("blurFocusedField", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("blurs a focused %s so its draft commits", (tag) => {
    const field = el(tag);
    blurFocusedField({ activeElement: field as unknown as Element });
    expect(field.blur).toHaveBeenCalledTimes(1);
  });

  it("leaves a focused button or the page alone", () => {
    const button = el("BUTTON");
    blurFocusedField({ activeElement: button as unknown as Element });
    expect(button.blur).not.toHaveBeenCalled();
    expect(() => blurFocusedField({ activeElement: null })).not.toThrow();
  });
});

describe("blurFocusedField hands back what it blurred", () => {
  it("returns the field, and null when it blurred nothing", () => {
    const field = el("INPUT");
    expect(blurFocusedField({ activeElement: field as unknown as Element })).toBe(field);
    expect(blurFocusedField({ activeElement: el("BUTTON") as unknown as Element })).toBeNull();
    expect(blurFocusedField({ activeElement: null })).toBeNull();
  });
});

describe("restoreFocusedField", () => {
  const body = { tagName: "BODY" };
  const field = (over: Record<string, unknown> = {}) => ({
    tagName: "INPUT",
    isConnected: true,
    disabled: false,
    focus: vi.fn(),
    ...over,
  });
  const doc = (activeElement: unknown) => ({ activeElement, body }) as unknown as Document;

  it("puts focus back on the field when the page has dropped it to <body>", () => {
    const f = field();
    expect(restoreFocusedField(doc(body), f as unknown as HTMLElement)).toBe(true);
    expect(f.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    const g = field();
    expect(restoreFocusedField(doc(null), g as unknown as HTMLElement)).toBe(true);
  });

  it("leaves focus where the user put it", () => {
    const f = field();
    expect(restoreFocusedField(doc({ tagName: "BUTTON" }), f as unknown as HTMLElement)).toBe(false);
    expect(f.focus).not.toHaveBeenCalled();
  });

  it("does nothing for a field that is gone, disabled, or was never focused", () => {
    expect(restoreFocusedField(doc(body), field({ isConnected: false }) as unknown as HTMLElement)).toBe(false);
    expect(restoreFocusedField(doc(body), field({ disabled: true }) as unknown as HTMLElement)).toBe(false);
    expect(restoreFocusedField(doc(body), null)).toBe(false);
  });
});
