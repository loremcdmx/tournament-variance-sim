"use client";

import { useEffect, useMemo, useState, type ReactEventHandler } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { Card } from "./ui/Section";

const COLLAPSE_KEY = "tvs.bench.convergence.open.v2";

interface BenchPoint {
  players: number;
  tourneys: number;
  ours: { p5: number; p50: number; p95: number };
  pd: { p5: number; p50: number; p95: number };
}

interface BenchData {
  version: number;
  srcHash: string;
  generatedAt: string;
  reference: { buyIn: number; fee: number; rake: number; roi: number };
  samples: number;
  nTourneys: number;
  xAxis: string;
  points: BenchPoint[];
}

function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
function fmtInt(v: number): string {
  return Math.round(v).toLocaleString();
}
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/**
 * PrimeDope calibration cross-check. Reads the precomputed bench JSON and
 * renders a side-by-side table of our ROI 90%-band vs PD's on the fixed
 * reference scenario. Single "engine quality" badge, no per-run projection.
 */
export function BenchConvergenceCard() {
  const t = useT();
  const [bench, setBench] = useState<BenchData | null>(null);
  const [benchFailed, setBenchFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/bench/convergence.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: BenchData) => {
        if (!alive) return;
        setBench(json);
      })
      .catch(() => {
        if (!alive) return;
        setBenchFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const calibration = useMemo(() => {
    if (!bench) return null;
    const rows = bench.points.map((p) => {
      const oursHalf = (p.ours.p95 - p.ours.p5) / 2;
      const pdHalf = (p.pd.p95 - p.pd.p5) / 2;
      return {
        players: p.players,
        tourneys: p.tourneys,
        oursHalf,
        pdHalf,
        delta: oursHalf - pdHalf,
      };
    });
    const meanAbsDelta =
      rows.reduce((s, r) => s + Math.abs(r.delta), 0) / rows.length;
    const good = meanAbsDelta < 0.003;
    return { rows, meanAbsDelta, good };
  }, [bench]);

  const [open, setOpen] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const onToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    const next = e.currentTarget.open;
    setOpen(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {}
  };

  if (!bench && !benchFailed) return null;

  return (
    <Card className="p-0">
      <details open={open} onToggle={onToggle} className="group">
        <summary className="flex cursor-pointer select-none items-center gap-3 px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]">
          <span>{t("bench.calibrationTitle")}</span>
          <span className="ml-auto text-[10px] transition-transform group-open:rotate-90">▶</span>
        </summary>
        <div className="border-t border-[color:var(--color-border)] p-5">
      {bench && calibration ? (
        <div className="space-y-3 text-sm leading-relaxed text-[color:var(--color-fg)]">
          <p className="text-[color:var(--color-fg-dim)]">
            {fill(t("bench.calibrationRef"), {
              tourneys: fmtInt(bench.nTourneys),
              buyIn: bench.reference.buyIn.toString(),
              fee: bench.reference.fee.toString(),
              roi: (bench.reference.roi * 100).toFixed(0),
              samples: fmtInt(bench.samples),
            })}
          </p>
          <p className="text-xs text-[color:var(--color-fg-dim)]">
            {t("bench.calibrationExplainer")}
          </p>
          <table className="w-full text-xs tabular-nums">
            <thead className="text-[color:var(--color-fg-dim)]">
              <tr>
                <th
                  className="cursor-help py-1 text-left font-normal underline decoration-dotted underline-offset-2"
                  title={t("bench.th.players.hint")}
                >
                  {t("bench.th.players")}
                </th>
                <th
                  className="cursor-help py-1 text-right font-normal underline decoration-dotted underline-offset-2"
                  title={t("bench.th.ours.hint")}
                >
                  {t("bench.th.ours")}
                </th>
                <th
                  className="cursor-help py-1 text-right font-normal underline decoration-dotted underline-offset-2"
                  title={t("bench.th.pd.hint")}
                >
                  {t("bench.th.pd")}
                </th>
                <th
                  className="cursor-help py-1 text-right font-normal underline decoration-dotted underline-offset-2"
                  title={t("bench.th.delta.hint")}
                >
                  {t("bench.th.delta")}
                </th>
              </tr>
            </thead>
            <tbody>
              {calibration.rows.map((r) => (
                <tr key={r.players} className="border-t border-[color:var(--color-border)]/40">
                  <td className="py-1">{fmtInt(r.players)}</td>
                  <td className="py-1 text-right">±{fmtPct(r.oursHalf, 1)}</td>
                  <td className="py-1 text-right">±{fmtPct(r.pdHalf, 1)}</td>
                  <td
                    className={`py-1 text-right ${
                      Math.abs(r.delta) < 0.003
                        ? "text-[color:var(--color-fg-dim)]"
                        : "text-amber-400"
                    }`}
                  >
                    {r.delta >= 0 ? "+" : ""}
                    {fmtPct(r.delta, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={calibration.good ? "text-emerald-400" : "text-amber-400"}>
            {fill(
              calibration.good
                ? t("bench.calibrationVerdictGood")
                : t("bench.calibrationVerdictDrift"),
              { delta: fmtPct(calibration.meanAbsDelta, 2) },
            )}
          </p>
        </div>
      ) : (
        <p className="text-sm text-[color:var(--color-fg-dim)]">
          {t("bench.unavailable")}
        </p>
      )}
        </div>
      </details>
    </Card>
  );
}
