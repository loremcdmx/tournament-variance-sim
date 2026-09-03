"use client";

import { startTransition, useEffect, useState } from "react";
import { DICT, type DictKey, type Locale } from "@/lib/i18n/dict";
import { readPersistedLocale } from "@/lib/i18n/LocaleProvider";

/**
 * Shared body for the Next.js error boundaries. They mount outside
 * `LocaleProvider`, so the locale is read from storage after mount — the
 * server-rendered fallback stays RU to avoid a hydration mismatch.
 */
export function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  const [locale, setLocale] = useState<Locale>("ru");

  useEffect(() => {
    const persisted = readPersistedLocale();
    if (persisted) startTransition(() => setLocale(persisted));
  }, []);

  const t = (key: DictKey) => DICT[key][locale];

  return (
    <main
      lang={locale}
      className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)] px-6 text-[color:var(--color-fg)]"
    >
      <div className="flex max-w-md flex-col gap-4 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-6">
        <h1 className="text-lg font-semibold">{t("errorPage.title")}</h1>
        <p className="text-sm text-[color:var(--color-fg-muted)]">{t("errorPage.body")}</p>
        {error.digest ? (
          <p className="font-mono text-xs text-[color:var(--color-fg-dim)]">
            {t("errorPage.digest").replace("{n}", error.digest)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start border border-[color:var(--color-border)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          {t("errorPage.reload")}
        </button>
      </div>
    </main>
  );
}
