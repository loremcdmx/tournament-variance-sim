"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { buildShareUrl, type PersistedState } from "@/lib/persistence";
import { buildRunStatsCsv, type RunStatsSummary } from "@/lib/results/runExport";

type ActionId = "link" | "csv";
type Feedback = { action: ActionId; ok: boolean };

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]";

export function RunExportActions({
  shareState,
  stats,
}: {
  shareState: PersistedState;
  stats: RunStatsSummary;
}) {
  const t = useT();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = useCallback((action: ActionId, ok: boolean) => {
    setFeedback({ action, ok });
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setFeedback(null);
    }, 2000);
  }, []);

  const onCopyLink = useCallback(async () => {
    const url = buildShareUrl(shareState);
    if (!url) return;
    const ok = await copyText(url);
    // Insecure contexts and locked-down browsers reject the clipboard API;
    // the prompt still lets the user take the link away by hand.
    if (!ok) window.prompt(t("userPreset.shareFallback"), url);
    flash("link", ok);
  }, [shareState, t, flash]);

  const onCopyCsv = useCallback(async () => {
    flash("csv", await copyText(buildRunStatsCsv(stats)));
  }, [stats, flash]);

  const status = (action: ActionId) =>
    feedback?.action === action
      ? feedback.ok
        ? t("runExport.copied")
        : t("runExport.failed")
      : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCopyLink}
        title={t("runExport.copyLink.hint")}
        className={BUTTON_CLASS}
      >
        {status("link") ?? t("runExport.copyLink")}
      </button>
      <button
        type="button"
        onClick={onCopyCsv}
        title={t("runExport.copyCsv.hint")}
        className={BUTTON_CLASS}
      >
        {status("csv") ?? t("runExport.copyCsv")}
      </button>
    </div>
  );
}
