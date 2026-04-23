"use client";

import { useEffect, useRef, useState } from "react";
import { SCENARIOS } from "@/lib/scenarios";
import type { DictKey } from "@/lib/i18n/dict";

// Scenario → palette tint mapping. Reuses the existing suit palette from
// globals.css so we don't invent new colour tokens. Categories are loose
// but intentional: blue for canonical reference runs, club for BR, heart
// for bounty-heavy mixes, accent for high-stakes, spade for plain regs.
const SCENARIO_TINT: Record<string, string> = {
  "br-leaderboard": "var(--c-club)",
  "primedope-reference": "var(--c-rival)",
  "romeo-pro": "var(--c-accent)",
  "mid-stakes-reg": "var(--c-spade)",
  "micro-high-volume": "var(--c-spade)",
  "highroller-sunday": "var(--c-diamond)",
  "mixed-freeze-pko": "var(--c-heart)",
  "mixed-daily-all-formats": "var(--c-accent)",
  "mixed-gg-with-br": "var(--c-club)",
  "mixed-sunday-majors": "var(--c-diamond)",
  "small-field-topreg": "var(--c-spade)",
};

function tintFor(id: string): string {
  return SCENARIO_TINT[id] ?? "var(--c-fg-dim)";
}

interface Props {
  t: (key: DictKey) => string;
  activeScenarioId: string | null;
  loadScenario: (id: string) => void;
  onReset: () => void;
  disabled?: boolean;
}

export function ScheduleToolbarExtras({
  t,
  activeScenarioId,
  loadScenario,
  onReset,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = activeScenarioId
    ? SCENARIOS.find((s) => s.id === activeScenarioId) ?? null
    : null;
  const activeTint = active ? tintFor(active.id) : "var(--c-fg-dim)";

  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow whitespace-nowrap text-[color:var(--color-fg-dim)]">
        {t("demo.label")}
      </span>

      <div ref={wrapRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex h-8 w-[220px] items-center gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 text-left text-xs text-[color:var(--color-fg)] transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none disabled:opacity-40"
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{
              background: activeTint,
              boxShadow: active
                ? `0 0 0 2px color-mix(in oklab, ${activeTint}, transparent 75%)`
                : "none",
            }}
          />
          <span className="min-w-0 flex-1 truncate">
            {active ? t(active.labelKey) : t("demo.choosePlaceholder")}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 opacity-60 transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "none" }}
            aria-hidden
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute right-0 top-full z-20 mt-1 w-[320px] overflow-hidden rounded-lg border shadow-[0_18px_42px_-20px_rgba(0,0,0,0.7)]"
            style={{
              borderColor: "var(--c-border)",
              background:
                "linear-gradient(to bottom, color-mix(in oklab, var(--c-bg-elev), white 3%), color-mix(in oklab, var(--c-bg-elev), black 4%))",
              backdropFilter: "saturate(140%) blur(2px)",
            }}
          >
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {SCENARIOS.map((s) => {
                const tint = tintFor(s.id);
                const isActive = s.id === activeScenarioId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        loadScenario(s.id);
                        setOpen(false);
                      }}
                      className="group flex w-full items-center gap-2.5 border-l-[3px] border-transparent px-3 py-2 text-left text-xs transition-colors hover:bg-[color:var(--color-fg)]/[0.04] focus:bg-[color:var(--color-fg)]/[0.05] focus:outline-none"
                      style={
                        isActive
                          ? {
                              borderLeftColor: tint,
                              background: `color-mix(in oklab, ${tint}, transparent 90%)`,
                            }
                          : { borderLeftColor: "transparent" }
                      }
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.borderLeftColor = `color-mix(in oklab, ${tint}, transparent 55%)`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.borderLeftColor = "transparent";
                        }
                      }}
                    >
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: tint,
                          boxShadow: `0 0 0 2px color-mix(in oklab, ${tint}, transparent 78%)`,
                        }}
                      />
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{
                          color: isActive ? tint : "var(--c-fg)",
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        {t(s.labelKey)}
                      </span>
                      {isActive && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden
                          style={{ color: tint }}
                        >
                          <path
                            d="M5 12l5 5L20 7"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (typeof window !== "undefined") {
            const ok = window.confirm(t("schedule.resetConfirm"));
            if (!ok) return;
          }
          onReset();
        }}
        title={t("schedule.resetHint")}
        aria-label={t("schedule.reset")}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 text-xs text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-heart)]/55 hover:bg-[color:var(--color-heart)]/10 hover:text-[color:var(--color-heart)] disabled:opacity-40"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <path
            d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t("schedule.reset")}
      </button>
    </div>
  );
}
