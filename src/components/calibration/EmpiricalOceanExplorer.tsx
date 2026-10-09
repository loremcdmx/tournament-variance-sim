"use client";

import { useId, useState } from "react";
import type { PublicSpaceProfile } from "@/lib/calibration/types";
import {
  exposureComponents,
  oceanSigmaGap,
  oceanTransportDistance,
  transportOceanMoments,
  type EmpiricalBridgeData,
  type ExposureComponents,
} from "@/lib/calibration/oceanTransport";
import { interpolate } from "@/lib/calibration/oceanReportView";
import {
  DISTANCE_SD_STEP_BI,
  passesPrecisionGate,
  precisionCount,
  precisionRowFor,
  roundSignificant,
  roundToStep,
  ROI_DECIMALS,
  SIGMA_DECIMALS,
  sigmaRange,
  THETA_SIGMA_DECIMALS,
} from "@/lib/calibration/explorerView";
import { useT } from "@/lib/i18n/LocaleProvider";

const MAX_CALIBRATION_ENTRIES = 1_000_000;

function parseEntryDistance(draft: string, minimum: number): number | null {
  if (!draft.trim()) return null;
  const value = Number(draft);
  return Number.isSafeInteger(value) && value >= minimum && value <= MAX_CALIBRATION_ENTRIES ? value : null;
}

const panel = "rounded-xl border border-border bg-bg-elev p-5 sm:p-6";
const muted = "text-sm leading-relaxed text-fg-muted";
const control = "w-full rounded-lg border border-border-strong bg-bg px-3 py-2.5 text-sm text-fg focus:outline-2 focus:outline-offset-2 focus:outline-accent";
const fieldBin = "1000-1499" as const;
const thetaValues = [0.5, 1, 2] as const;

export function EmpiricalOceanExplorer({ profile, bridge, locale }: {
  profile: PublicSpaceProfile;
  bridge: EmpiricalBridgeData;
  locale: "ru" | "en";
}) {
  const t = useT();
  const id = useId();
  const [cap, setCap] = useState<25 | 100>(100);
  const [ticket, setTicket] = useState<10 | 100>(100);
  const [theta, setTheta] = useState<number>(1);
  const [distanceDraft, setDistanceDraft] = useState("20000");
  const entries = parseEntryDistance(distanceDraft, 1000);
  const n = (value: number, digits = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const fixed = (value: number, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const pct = (value: number) => `${n(value * 100)}%`;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ru" ? "ru" : "en-GB",
    locale === "ru" ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  ).format(new Date(`${iso}T00:00:00Z`));
  const anchorModel = profile.anchors.find(model => model.capBountyBI === cap);
  const anchor = anchorModel ? exposureComponents(anchorModel.moments) : null;
  const bridgeRecords = (weight: number) => ({
    source: bridge.records.find(record => record.theta === weight && record.roomId === "space-eur10" && record.support.capBountyBI === cap),
    target: bridge.records.find(record => record.theta === weight && record.roomId === `ocean-usd${ticket}` && record.support.capBountyBI === cap),
  });
  const transport = (weight: number) => {
    if (!anchorModel || !bridge.receipt.sourceStable) return null;
    const { source, target } = bridgeRecords(weight);
    if (!source || !target) return null;
    const result = transportOceanMoments({ anchor: anchorModel.moments, capBountyBI: cap, anchorProfileId: profile.profileId,
      anchorFieldBin: fieldBin, source, target, allowSingleEntryBridge: true, allowRepresentativeField: true });
    return result.supported ? result : null;
  };
  const current = transport(theta);
  const currentRecords = bridgeRecords(theta);
  const sigmaGap = current && currentRecords.source && currentRecords.target
    ? oceanSigmaGap(current, currentRecords.source.support, currentRecords.target.support) : null;
  const precision = bridge.numericPrecision;
  const selectedPrecision = precisionRowFor(precision, theta, cap, ticket);
  const alternatives = thetaValues.map(weight => ({ weight, result: transport(weight) }));
  const allAlternativesSupported = alternatives.every(item => item.result !== null);
  const range = sigmaRange(alternatives.flatMap(item => item.result ? [{ theta: item.weight, sigma: item.result.transported.sigma }] : []), precision, cap, ticket);
  const preliminary = current?.bridgeNumericalStatus === "pilot";
  const distance = current && entries !== null ? oceanTransportDistance(current, entries) : null;
  const terms = [
    { label: t("empiricalOcean.cash"), value: (value: ExposureComponents) => value.cashVariance },
    { label: t("empiricalOcean.bounty"), value: (value: ExposureComponents) => value.bountyVariance },
    { label: t("empiricalOcean.covariance"), value: (value: ExposureComponents) => 2 * value.cashBountyCovariance },
  ];
  const termMax = Math.max(1, ...terms.flatMap(term => [anchor ? Math.abs(term.value(anchor)) : 0, current ? Math.abs(term.value(current.transported)) : 0]));

  return <section className="space-y-5" aria-label={t("empiricalOcean.title")}>
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">{t("empiricalOcean.badge")}</p>
      <h2 className="display text-2xl font-bold leading-tight sm:text-4xl">{t("empiricalOcean.title")}</h2>
      <p className={`${muted} max-w-3xl`}>{t("empiricalOcean.intro")}</p>
      <p className="text-sm font-medium">{t("empiricalOcean.scope")}</p>
      {anchorModel && <p className="text-xs text-fg-muted">{n(profile.trainingEntries, 0)} {t("empiricalOcean.paidEntries")} · {n(profile.trainingEvents, 0)} {t("empiricalOcean.trainingCount")}</p>}
      {anchorModel && <p className="text-xs leading-relaxed text-fg-muted">{interpolate(t("empiricalOcean.cohort"), {
        from: date(profile.training.from), through: date(profile.training.through), months: n(profile.training.months, 0),
        field: n(profile.training.meanFieldEntries, 0), range: profile.training.allFieldsRange.replace("-", "–"),
        players: n(roundSignificant(profile.training.playersAllFields), 0),
      })}</p>}
    </header>

    <section className={panel}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor={`${id}-cap`}>{t("empiricalOcean.cap")}
          <select id={`${id}-cap`} className={control} value={cap} onChange={event => setCap(Number(event.target.value) as 25 | 100)}><option value={25}>25 BI</option><option value={100}>100 BI</option></select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor={`${id}-ticket`}>{t("empiricalOcean.ticket")}
          <select id={`${id}-ticket`} className={control} value={ticket} onChange={event => setTicket(Number(event.target.value) as 10 | 100)}><option value={10}>$10</option><option value={100}>$100</option></select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor={`${id}-theta`}>{t("empiricalOcean.theta")}
          <select id={`${id}-theta`} className={control} value={theta} onChange={event => setTheta(Number(event.target.value))}><option value={0.5}>{t("empiricalOcean.thetaLow")}</option><option value={1}>{t("empiricalOcean.thetaBase")}</option><option value={2}>{t("empiricalOcean.thetaHigh")}</option></select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor={`${id}-distance`}>{t("empiricalOcean.distance")}
          <input id={`${id}-distance`} className={control} type="number" inputMode="numeric" min={1000} max={MAX_CALIBRATION_ENTRIES} step={1000} value={distanceDraft} onChange={event => setDistanceDraft(event.target.value)} aria-invalid={entries === null} aria-describedby={entries === null ? `${id}-error` : `${id}-distance-note`} />
        </label>
      </div>
      {entries === null && <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-danger">{t("empiricalOcean.invalidDistance")}</p>}
      <p className={`${muted} mt-4`}>{t("empiricalOcean.capNote")}</p>
    </section>

    <div aria-live="polite" aria-atomic="true">
      {anchor && current ? <>
        <p className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm leading-relaxed">{t("empiricalOcean.tailNote")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {[{ title: t("empiricalOcean.space"), data: anchor, currency: "€10", sd: entries === null ? null : anchor.sigma * Math.sqrt(entries), error: anchorModel?.uncertainty },
            { title: t("empiricalOcean.ocean"), data: current.transported, currency: `$${ticket}`, sd: distance?.profitSdBI ?? null, error: undefined }].map(card => <section key={card.title} className={panel}>
            <h3 className="text-sm font-semibold text-fg-muted">{card.title} · {card.currency}</h3>
            <p className="mt-4 text-xs text-fg-muted">{t("empiricalOcean.sigma")}</p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-accent">{fixed(card.data.sigma, SIGMA_DECIMALS)}{card.error && <span className="text-xl font-normal text-fg-muted"> ± {fixed(card.error.sigmaSE, SIGMA_DECIMALS)}</span>} <span className="text-base font-normal">BI</span></p>
            <p className="mt-1 text-xs text-fg-muted">{t("empiricalOcean.perEntry")}</p>
            <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><dt className="text-fg-muted">{t("empiricalOcean.roi")}</dt><dd className="font-mono tabular-nums">{fixed(card.data.roi * 100, ROI_DECIMALS)}%{card.error && ` ± ${fixed(card.error.roiSE * 100, ROI_DECIMALS)} ${t("empiricalOcean.pp")}`}</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt className="text-fg-muted">{t("empiricalOcean.sd")}</dt><dd className="font-mono tabular-nums">{card.sd === null ? "—" : `≈ ${n(roundToStep(card.sd, DISTANCE_SD_STEP_BI), 0)} BI`}</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt className="text-fg-muted">{t("empiricalOcean.roiSd")}</dt><dd className="font-mono tabular-nums">{entries === null ? "—" : `${fixed(card.data.sigma / Math.sqrt(entries) * 100, 1)} ${t("empiricalOcean.pp")}`}</dd></div>
            </dl>
          </section>)}
        </div>
        {anchorModel && <p className={`${muted} mt-3`}>{interpolate(t("empiricalOcean.anchorError"), { months: n(anchorModel.uncertainty.months, 0) })}</p>}
        {sigmaGap && <p className={`${muted} mt-3`}>{interpolate(t("empiricalOcean.sigmaGap"), {
          delta: fixed(sigmaGap.gap, SIGMA_DECIMALS), percent: n(sigmaGap.gap / sigmaGap.anchorSigma * 100, 1), share: n(sigmaGap.prizeShare * 100, 0),
          ocean: n(sigmaGap.cashPoolTarget * 100, 0), space: n(sigmaGap.cashPoolSource * 100, 0), ratio: n(sigmaGap.cashMeanRatio),
        })}</p>}
        <p className={`${muted} mt-3`}>{t("empiricalOcean.roiNote")}</p>
        <p id={`${id}-distance-note`} className={`${muted} mt-2`}>{t("empiricalOcean.horizonNote")}</p>
        {allAlternativesSupported && range && <section className={`${panel} mt-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="font-semibold">{t("empiricalOcean.sensitivity")}</h3><p className="font-mono text-xl tabular-nums">{fixed(range.lower.sigma, THETA_SIGMA_DECIMALS)}–{fixed(range.upper.sigma, THETA_SIGMA_DECIMALS)} BI</p></div>
          <p className={`${muted} mt-2`}>{t("empiricalOcean.sensitivityNote")}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">{alternatives.map(item => <div key={item.weight} className={`rounded-lg border p-3 text-center ${theta === item.weight ? "border-accent bg-accent/5" : "border-border bg-bg"}`}><p className="text-xs text-fg-muted">θ = {n(item.weight, 1)}</p><p className="mt-1 font-mono text-sm tabular-nums">{fixed(item.result!.transported.sigma, THETA_SIGMA_DECIMALS)} BI</p></div>)}</div>
          {range.upper.meetsPrecision === false && <p className="mt-3 text-xs leading-relaxed text-fg-muted">{interpolate(t("empiricalOcean.rangeEndUpper"), { theta: n(range.upper.theta, 1) })}</p>}
          {range.lower.meetsPrecision === false && <p className="mt-3 text-xs leading-relaxed text-fg-muted">{interpolate(t("empiricalOcean.rangeEndLower"), { theta: n(range.lower.theta, 1) })}</p>}
          {precision && selectedPrecision ? <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs leading-relaxed">
            <p className="font-semibold">{t("empiricalOcean.precision")}</p>
            <p className="text-fg-muted">{t("empiricalOcean.precisionSd")}: <span className="font-mono text-fg">{n(selectedPrecision.bountyResidualSdRatioRelativeSE * 100, 3)}%</span> · {t("empiricalOcean.precisionGate")} {pct(precision.gates.maxResidualSdRatioRelativeSE)}</p>
            <p className="text-fg-muted">{t("empiricalOcean.precisionMean")}: <span className="font-mono text-fg">{n(selectedPrecision.bountyMeanRatioRelativeSE * 100, 3)}%</span> · {t("empiricalOcean.precisionGate")} {pct(precision.gates.maxMeanRatioRelativeSE)}</p>
            <p className={passesPrecisionGate(selectedPrecision, precision.gates) ? "text-fg-muted" : "text-danger"}>{passesPrecisionGate(selectedPrecision, precision.gates) ? t("empiricalOcean.precisionPass") : t("empiricalOcean.precisionFail")}</p>
            <p className="text-fg-muted">{interpolate(t(preliminary ? "empiricalOcean.precisionPilot" : "empiricalOcean.precisionAll"), { passed: n(precisionCount(precision).passed, 0), total: n(precisionCount(precision).total, 0) })}</p>
            {!precision.passes && <p className="text-fg-muted">{t("empiricalOcean.precisionSome")}</p>}
          </div> : preliminary && <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t("empiricalOcean.pilot")}</p>}
        </section>}
      </> : <p role="status" className={`${panel} text-sm text-fg-muted`}>{t("empiricalOcean.unavailable")}</p>}
    </div>

    {anchor && current && <section className={panel}>
      <h3 className="text-lg font-semibold">{t("empiricalOcean.risk")}</h3><p className={`${muted} mt-2`}>{t("empiricalOcean.riskNote")}</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-3 text-sm">
        <span /><span className="text-xs text-fg-muted">Space</span><span className="text-xs text-fg-muted">Ocean</span>
        {terms.map(term => <div key={term.label} className="contents"><span className="min-w-0 text-fg-muted">{term.label}</span><span className="font-mono text-right tabular-nums">{n(term.value(anchor))}</span><span className="font-mono text-right tabular-nums">{n(term.value(current.transported))}</span><div className="col-span-3 flex gap-2" aria-hidden="true">{[anchor, current.transported].map((value, index) => <div key={index} className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg"><div className={`h-full rounded-full ${index === 0 ? "bg-club" : "bg-accent"}`} style={{ width: `${Math.abs(term.value(value)) / termMax * 100}%` }} /></div>)}</div></div>)}
        <strong className="border-t border-border pt-3">{t("empiricalOcean.total")}</strong><strong className="border-t border-border pt-3 text-right font-mono">{n(anchor.variance)}</strong><strong className="border-t border-border pt-3 text-right font-mono">{n(current.transported.variance)}</strong>
      </div><p className="mt-3 text-xs text-fg-muted">BI²</p>
    </section>}

    <details className={panel}>
      <summary className="cursor-pointer text-sm font-semibold text-accent">{t("empiricalOcean.method")}</summary>
      <div className={`${muted} mt-4 space-y-3`}><p>{t("empiricalOcean.methodGrain")}</p><p>{t("empiricalOcean.methodField")}</p><p>{t("empiricalOcean.methodEconomics")}</p><p>{t("empiricalOcean.methodCap")}</p><p>{t("empiricalOcean.methodTheta")}</p></div>
    </details>
  </section>;
}
