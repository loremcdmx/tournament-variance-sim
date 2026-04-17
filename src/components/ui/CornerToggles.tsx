"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";

export function CornerToggles() {
  const { locale, setLocale } = useLocale();
  const { theme, toggle } = useTheme();
  const { advanced, toggle: toggleAdvanced } = useAdvancedMode();

  return (
    <div className="flex items-stretch divide-x divide-[color:var(--color-border)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] font-mono text-[10px]">
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`px-2.5 py-1 font-semibold uppercase tracking-[0.18em] transition-colors ${
          locale === "en"
            ? "bg-[color:var(--color-fg)] text-[color:var(--color-bg)]"
            : "text-[color:var(--color-fg-dim)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]"
        }`}
        aria-label="English"
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("ru")}
        className={`px-2.5 py-1 font-semibold uppercase tracking-[0.18em] transition-colors ${
          locale === "ru"
            ? "bg-[color:var(--color-fg)] text-[color:var(--color-bg)]"
            : "text-[color:var(--color-fg-dim)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]"
        }`}
        aria-label="Русский"
      >
        RU
      </button>
      <button
        type="button"
        onClick={toggleAdvanced}
        className={`px-2.5 py-1 font-semibold uppercase tracking-[0.18em] transition-colors ${
          advanced
            ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
            : "text-[color:var(--color-fg-dim)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]"
        }`}
        aria-label={advanced ? "Disable advanced mode" : "Enable advanced mode"}
        aria-pressed={advanced}
        title={advanced ? "Advanced mode: on" : "Advanced mode: off"}
      >
        ADV
      </button>
      <button
        type="button"
        onClick={toggle}
        className="flex h-full min-h-[22px] w-8 items-center justify-center text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        {theme === "dark" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </g>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  );
}
