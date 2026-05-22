import { describe, expect, it } from "vitest";
import { parseAdminParam } from "./AdvancedModeProvider";

describe("parseAdminParam", () => {
  it("returns true when search contains admin=1", () => {
    expect(parseAdminParam("?admin=1")).toBe(true);
    expect(parseAdminParam("admin=1")).toBe(true);
    expect(parseAdminParam("?foo=bar&admin=1")).toBe(true);
    expect(parseAdminParam("?admin=1&foo=bar")).toBe(true);
  });

  it("returns false for other admin values", () => {
    expect(parseAdminParam("?admin=0")).toBe(false);
    expect(parseAdminParam("?admin=true")).toBe(false);
    expect(parseAdminParam("?admin=yes")).toBe(false);
    expect(parseAdminParam("?admin=")).toBe(false);
  });

  it("returns false when admin key is missing", () => {
    expect(parseAdminParam("")).toBe(false);
    expect(parseAdminParam("?")).toBe(false);
    expect(parseAdminParam("?foo=bar")).toBe(false);
    expect(parseAdminParam(null)).toBe(false);
    expect(parseAdminParam(undefined)).toBe(false);
  });

  it("treats admin as case-sensitive (only lowercase admin counts)", () => {
    expect(parseAdminParam("?ADMIN=1")).toBe(false);
    expect(parseAdminParam("?Admin=1")).toBe(false);
  });

  it("handles malformed input without throwing", () => {
    expect(parseAdminParam("???")).toBe(false);
  });
});
