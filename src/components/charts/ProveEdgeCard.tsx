"use client";

/**
 * Companion to the convergence widget. Answers a different statistical
 * question — "how many tournaments to distinguish my true ROI from
 * zero?" — using the same per-format σ fits.
 *
 * Self-contained: own format / AFS / rake / CI controls. Does not read
 * from or write to ConvergenceChart state, so the existing widget
 * stays exactly as it is.
 */
import { useMemo, useState } from "react";
import {
  AFS_MAX,
  AFS_MIN,
  afsToPos,
  ciToZ,
  fmtAfs,
  posToAfs,
} from "@/lib/sim/convergenceMath";
import {
  computeProveEdgeRows,
  PROVE_EDGE_DEFAULT_CANDIDATES,
} from "@/lib/sim/proveEdge";
import type { ConvergenceRowFormat } from "@/lib/sim/convergencePolicy";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";

const FORMATS: { id: ConvergenceRowFormat; labelKey: DictKey }[] = [
  { id: "freeze", labelKey: "chart.convergence.format.freeze" },
  { id: "pko", labelKey: "chart.convergence.format.pko" },
  { id: "mystery", labelKey: "chart.convergence.format.mystery" },
  { id: "mystery-royale", labelKey: "chart.convergence.format.mystery-royale" },
];

const MBR_FIXED_AFS = 18;

function fmtTourneys(n: number, locale: Intl.LocalesArgument): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(0)} M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)} k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} k`;
  return Math.round(n).toLocaleString(locale);
}

function fmtFields(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function fmtRoi(roi: number): string {
  const abs = Math.abs(roi * 100);
  const sign = roi < 0 ? "−" : "+";
  if (abs >= 10) return `${sign}${abs.toFixed(0)} %`;
  if (abs >= 1) return `${sign}${abs.toFixed(1)} %`;
  return `${sign}${abs.toFixed(2)} %`;
}

export function ProveEdgeCard() {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = locale === "ru" ? "ru-RU" : "en-US";

  const [format, setFormat] = useState<ConvergenceRowFormat>("pko");
  const [afsPos, setAfsPos] = useState<number>(afsToPos(200));
  const [rakePct, setRakePct] = useState<number>(10);
  const [ciPct, setCiPct] = useState<number>(95);
  const [currentRoiPct, setCurrentRoiPct] = useState<number>(10);

  const isMbr = format === "mystery-royale";
  const effectiveAfs = isMbr ? MBR_FIXED_AFS : posToAfs(afsPos);

  const rows = useMemo(
    () =>
      computeProveEdgeRows({
        format,
        afs: effectiveAfs,
        rake: rakePct / 100,
        z: ciToZ(ciPct / 100),
        currentRoi: currentRoiPct / 100,
        candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
      }),
    [format, effectiveAfs, rakePct, ciPct, currentRoiPct],
  );

  const currentRow = rows.find((r) => r.isCurrent);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--color-fg)]">
            {t("proveEdge.title")}
          </div>
          <div className="mt-0.5 text-[11px] italic text-[color:var(--color-fg-dim)]">
            {t("proveEdge.question")}
          </div>
        </div>
      </div>

      <div className="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {t("proveEdge.intro")}
      </div>

      {/* Format tabs */}
      <div className="flex flex-wrap gap-1">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFormat(f.id)}
            className={`rounded border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider transition-colors ${
              format === f.id
                ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elev)]"
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {/* Compact controls strip */}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {/* AFS */}
        <div
          className={`flex items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)] ${isMbr ? "opacity-60" : ""}`}
          title={isMbr ? t("proveEdge.afs.lockedBR") : undefined}
        >
          <span className="w-10 shrink-0 uppercase tracking-wider text-emerald-400/80">
            AFS
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={isMbr ? afsToPos(MBR_FIXED_AFS) : afsPos}
            onChange={(e) => setAfsPos(Number(e.target.value))}
            disabled={isMbr}
            className="flex-1"
            aria-label="AFS"
          />
          <input
            type="number"
            min={isMbr ? MBR_FIXED_AFS : AFS_MIN}
            max={isMbr ? MBR_FIXED_AFS : AFS_MAX}
            step={1}
            value={Math.round(effectiveAfs)}
            onChange={(e) => {
              if (isMbr) return;
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                const clamped = Math.max(AFS_MIN, Math.min(AFS_MAX, n));
                setAfsPos(afsToPos(clamped));
              }
            }}
            disabled={isMbr}
            className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed"
            aria-label="AFS value"
          />
        </div>

        {/* Rake */}
        <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
          <span className="w-10 shrink-0 uppercase tracking-wider text-orange-400/80">
            {t("proveEdge.label.rake")}
          </span>
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={rakePct}
            onChange={(e) => setRakePct(Number(e.target.value))}
            className="flex-1"
            aria-label="Rake percent"
          />
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={rakePct}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setRakePct(Math.max(0, Math.min(50, n)));
            }}
            className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-orange-400 focus:outline-none"
            aria-label="Rake percent value"
          />
        </div>

        {/* CI */}
        <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
          <span className="w-10 shrink-0 uppercase tracking-wider text-sky-400/80">
            CI
          </span>
          <input
            type="range"
            min={50}
            max={99.9}
            step={0.1}
            value={ciPct}
            onChange={(e) => setCiPct(Number(e.target.value))}
            className="flex-1"
            aria-label="Confidence percent"
          />
          <input
            type="number"
            min={50}
            max={99.99}
            step={0.1}
            value={ciPct}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setCiPct(Math.max(50, Math.min(99.99, n)));
            }}
            className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-sky-400 focus:outline-none"
            aria-label="CI value"
          />
        </div>

        {/* Your ROI (highlight anchor) */}
        <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
          <span className="w-10 shrink-0 uppercase tracking-wider text-[color:var(--color-accent)]/85">
            {t("proveEdge.label.yourRoi")}
          </span>
          <input
            type="range"
            min={0.1}
            max={30}
            step={0.1}
            value={currentRoiPct}
            onChange={(e) => setCurrentRoiPct(Number(e.target.value))}
            className="flex-1"
            aria-label="Your ROI percent"
          />
          <input
            type="number"
            min={-30}
            max={50}
            step={0.1}
            value={currentRoiPct}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                setCurrentRoiPct(Math.max(-30, Math.min(50, n)));
              }
            }}
            className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
            aria-label="Your ROI percent value"
          />
        </div>
      </div>

      {/* Anchor summary */}
      {currentRow && (
        <div className="rounded border-l-2 border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/5 px-3 py-2 text-[11px] leading-snug text-[color:var(--color-fg-muted)]">
          <span className="text-[color:var(--color-accent)]">
            {t("proveEdge.anchor.prefix")}
          </span>{" "}
          {t("proveEdge.anchor.body")
            .replace("{roi}", fmtRoi(currentRow.roi))
            .replace(
              "{tourneys}",
              fmtTourneys(currentRow.tourneys, numberLocale),
            )
            .replace("{ci}", `${ciPct}`)
            .replace("{afs}", fmtAfs(effectiveAfs, numberLocale))
            .replace(
              "{fields}",
              fmtFields(currentRow.fields),
            )}
        </div>
      )}

      {/* Candidate-ROI table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
              <th className="border-b border-[color:var(--color-border)] px-2 py-1.5 text-left">
                {t("proveEdge.col.roi")}
              </th>
              <th className="border-b border-[color:var(--color-border)] px-2 py-1.5 text-right">
                {t("proveEdge.col.sigma")}
              </th>
              <th className="border-b border-[color:var(--color-border)] px-2 py-1.5 text-right">
                {t("proveEdge.col.tourneys")}
              </th>
              <th className="border-b border-[color:var(--color-border)] px-2 py-1.5 text-right">
                {t("proveEdge.col.fields")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const huge = r.tourneys > 1_000_000;
              return (
                <tr
                  key={`${r.roi}-${i}`}
                  className={
                    r.isCurrent
                      ? "bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]"
                      : ""
                  }
                >
                  <td className="border-b border-[color:var(--color-border)]/40 px-2 py-1.5 text-[color:var(--color-fg-muted)]">
                    {r.isCurrent && (
                      <span className="mr-1 text-[color:var(--color-accent)]">▸</span>
                    )}
                    {fmtRoi(r.roi)}
                  </td>
                  <td className="border-b border-[color:var(--color-border)]/40 px-2 py-1.5 text-right font-mono">
                    {r.sigma.toFixed(2)}
                  </td>
                  <td
                    className={`border-b border-[color:var(--color-border)]/40 px-2 py-1.5 text-right font-mono ${
                      huge && !r.isCurrent
                        ? "text-[color:var(--color-danger)]"
                        : ""
                    }`}
                  >
                    {fmtTourneys(r.tourneys, numberLocale)}
                  </td>
                  <td
                    className={`border-b border-[color:var(--color-border)]/40 px-2 py-1.5 text-right font-mono ${
                      huge && !r.isCurrent
                        ? "text-[color:var(--color-danger)]"
                        : ""
                    }`}
                  >
                    {fmtFields(r.fields)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[10.5px] leading-relaxed text-[color:var(--color-fg-dim)]">
        {t("proveEdge.footnote")}
      </div>
    </div>
  );
}
