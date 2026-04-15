"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";

export function CornerToggles() {
  const { locale, setLocale } = useLocale();
  const { theme, toggle } = useTheme();
  const { advanced, toggle: toggleAdvanced } = useAdvancedMode();

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-1 text-[11px]">
      <div className="flex rounded-full bg-[color:var(--color-bg)] p-0.5">
        <button
          type="button"
          onClick={() => setLocale("en")}
          className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
            locale === "en"
              ? "bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-fg)]"
              : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
          }`}
          aria-label="English"
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLocale("ru")}
          className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
            locale === "ru"
              ? "bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-fg)]"
              : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
          }`}
          aria-label="Русский"
        >
          RU
        </button>
      </div>
      <button
        type="button"
        onClick={toggleAdvanced}
        className={`rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
          advanced
            ? "bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-fg)]"
            : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
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
        className="flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        {theme === "dark" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </g>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
