import { describe, expect, it, vi } from "vitest";
import { blurFocusedField } from "./blurFocusedField";

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
