import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});
const ui = vi.hoisted(() => ({ locale: "ru" as "ru" | "en", unit: "money" as "money" | "abi" }));
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useLocale: () => ({ locale: ui.locale, t: (key: string) => key }),
}));
vi.mock("@/lib/ui/useLocalStorageState", () => ({
  useLocalStorageState: () => [ui.unit, () => {}],
}));

import { hookHarness } from "@/lib/testing/hookHarness";
import { UnitScope, type UnitCtxValue } from "./UnitContext";

const scopeValue = (): UnitCtxValue => {
  const tree = hookHarness.render(() => UnitScope({ id: "x", children: null }));
  return (tree as unknown as { props: { value: UnitCtxValue } }).props.value;
};

beforeEach(() => {
  hookHarness.reset();
  ui.locale = "ru";
  ui.unit = "money";
});

describe("UnitScope money formatter and the UI language", () => {
  it("groups dollars by the UI locale, not the browser's", () => {
    const ru = scopeValue().money(5432);
    expect(ru).toBe(`$${(5432).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`);

    ui.locale = "en";
    expect(scopeValue().money(5432)).toBe("$5,432");
  });
});
