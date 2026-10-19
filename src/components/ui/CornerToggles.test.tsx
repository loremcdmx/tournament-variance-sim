import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";
import { UnitToggle as CashUnitToggle } from "../cash/CashResultsShared";
import { UnitToggle as MoneyUnitToggle } from "../ResultsView";
import { CornerToggles } from "./CornerToggles";

const buttons = (markup: string) => markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const pressed = (tag: string) => /\saria-pressed="(true|false)"/.exec(tag)?.[1];

describe("segmented toggles say which choice is on", () => {
  it("marks the active language, not just colours it", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <ThemeProvider>
          <AdvancedModeProvider>
            <CornerToggles />
          </AdvancedModeProvider>
        </ThemeProvider>
      </LocaleProvider>,
    );
    const [en, ru] = buttons(markup).filter((tag) => /aria-label="(English|Русский)"/.test(tag));
    expect(pressed(en)).toBe("false");
    expect(pressed(ru)).toBe("true");
  });

  it("names the theme switch in the UI language", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <ThemeProvider>
          <AdvancedModeProvider>
            <CornerToggles />
          </AdvancedModeProvider>
        </ThemeProvider>
      </LocaleProvider>,
    );
    expect(markup).toContain(`aria-label="${DICT["corner.theme.toLight"].ru}"`);
    expect(markup).not.toContain("Switch to light theme");
  });

  it("marks the active unit on the $ / ABI toggle", () => {
    const t = (key: keyof typeof DICT) => DICT[key].en;
    const markup = renderToStaticMarkup(
      <MoneyUnitToggle value="abi" onChange={vi.fn()} t={t} />,
    );
    expect(buttons(markup).map(pressed)).toEqual(["false", "true"]);
  });

  it("marks the active unit on the cash BB / $ toggle", () => {
    const markup = renderToStaticMarkup(
      <CashUnitToggle
        value="bb"
        onChange={vi.fn()}
        options={[{ value: "bb", label: "BB" }, { value: "usd", label: "$" }]}
      />,
    );
    expect(buttons(markup).map(pressed)).toEqual(["true", "false"]);
  });
});
