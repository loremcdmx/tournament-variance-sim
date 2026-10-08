import type { ComparisonFormat, FormatComparisonSummary } from "@/lib/calibration/formatComparison";
import { interpolate, oceanRatios } from "@/lib/calibration/oceanReportView";
import type { DictKey } from "@/lib/i18n/dict";
import styles from "./OceanComparisonReport.module.css";

type Translate = (key: DictKey) => string;
type NumberFormat = (value: number, digits?: number) => string;

const formatNames: Record<ComparisonFormat, DictKey> = {
  freezeout: "oceanReport.freezeout", pko: "oceanReport.pko", mystery: "oceanReport.mystery",
  "ocean-ko": "oceanReport.ocean", "mystery-royale": "oceanReport.battle",
};

/** The headline card. The longest spell below EV is shown as a median: its P95
 * is about the whole distance in every format and says nothing about the
 * difference between them. Ratios are rounded to one digit, because the second
 * one is inside Monte Carlo noise. */
export function OceanVerdictCard({ ocean, rows, t, n }: {
  ocean: FormatComparisonSummary; rows: FormatComparisonSummary[]; t: Translate; n: NumberFormat;
}) {
  const stats = [
    { label: "oceanReport.summaryDD", main: ocean.maxDrawdownBI.p95, median: ocean.maxDrawdownBI.median, unit: "BI", digits: 1, medianIsMain: false },
    { label: "oceanReport.summaryEV", main: ocean.maxEvShortfallBI.p95, median: ocean.maxEvShortfallBI.median, unit: "BI", digits: 1, medianIsMain: false },
    { label: "oceanReport.summaryTime", main: ocean.longestBelowEv.median, median: ocean.longestBelowEv.median, unit: t("oceanReport.entryShort"), digits: 0, medianIsMain: true },
  ] as const;
  const ratios = oceanRatios(rows);
  const ratio = (value: number | null) => value === null ? "—" : `${n(value, 1)}×`;
  return <section className={styles.summary}>
    <h3 className="display text-2xl">{t("oceanReport.verdict")}</h3>
    <dl className={styles.stats}>
      {stats.map(item => <div key={item.label}>
        <dt>{t(item.label)}</dt>
        <dd>
          <span className={styles.statValue}>{n(item.main, item.digits)} <small>{item.unit}</small></span>
          <span className={styles.statSecondary}>{item.medianIsMain
            ? interpolate(t("oceanReport.summaryTimeOf"), { distance: n(ocean.distance, 0) })
            : interpolate(t("oceanReport.summaryMedian"), { value: n(item.median, item.digits) })}</span>
        </dd>
      </div>)}
    </dl>
    <p className="text-sm leading-relaxed">{t("oceanReport.p95Note")}</p>
    {ratios.length > 0 && <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold">{t("oceanReport.summaryRatios")}</h4>
      <table className={styles.ratios} aria-label={t("oceanReport.summaryRatios")}>
        <thead><tr>
          <th scope="col">{t("oceanReport.format")}</th>
          <th scope="col">{t("oceanReport.ratioDD")}</th>
          <th scope="col">{t("oceanReport.ratioEV")}</th>
        </tr></thead>
        <tbody>{ratios.map(item => <tr key={item.format}>
          <th scope="row">{t(formatNames[item.format])}</th>
          <td>{ratio(item.drawdown)}</td>
          <td>{ratio(item.evShortfall)}</td>
        </tr>)}</tbody>
      </table>
      <p className={`${styles.comparisonNote} mt-2`}>{t("oceanReport.summaryRatiosNote")}</p>
      <p className="mt-2 text-sm leading-relaxed">{t("oceanReport.summaryDistanceNote")}</p>
    </div>}
  </section>;
}
