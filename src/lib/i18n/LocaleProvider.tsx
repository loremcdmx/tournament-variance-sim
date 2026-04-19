"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DICT, LOCALES, type DictKey, type Locale } from "./dict";

const LS_KEY = "tvs:locale";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Default to RU — that's the target audience per project brief.
  const [locale, setLocaleState] = useState<Locale>("ru");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw && (LOCALES as string[]).includes(raw)) {
        startTransition(() => setLocaleState(raw as Locale));
      }
    } catch {
      // ignore
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    // Every consumer of useLocale re-renders when locale flips, which on this
    // app is the whole tree (ScheduleEditor, ControlsPanel, ResultsView,
    // charts). Deferring inside startTransition lets React paint the switcher
    // click immediately and fan out the translation pass behind the input
    // frame, so the toggle itself feels instant.
    startTransition(() => setLocaleState(l));
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: DictKey) => DICT[key][locale],
    [locale],
  );

  const value = useMemo<LocaleCtx>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

export function useT(): (key: DictKey) => string {
  return useLocale().t;
}
