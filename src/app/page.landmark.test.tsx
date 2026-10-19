import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";
import Home from "./page";

describe("page landmarks", () => {
  it("has one main landmark between the header and the footer, and a skip link to it", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <ThemeProvider>
          <AdvancedModeProvider>
            <Home />
          </AdvancedModeProvider>
        </ThemeProvider>
      </LocaleProvider>,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(/<main id="main"/);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("<footer"));
    expect(html).toContain(`href="#main"`);
    expect(html).toContain(DICT["a11y.skipToContent"].ru);
  });
});
