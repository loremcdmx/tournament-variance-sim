import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey, Locale } from "@/lib/i18n/dict";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import type { CashMoneyUnit } from "./CashResultsShared";

type Translate = (key: DictKey) => string;

function grouped(
  abs: number,
  numberLocale: string,
  maxDigits: number,
  minDigits = 0,
): string {
  return abs.toLocaleString(numberLocale, {
    maximumFractionDigits: maxDigits,
    minimumFractionDigits: minDigits,
  });
}

// A negative that rounds to nothing at the printed precision reads "-0" otherwise.
function minusFor(value: number, digits: number): string {
  return value < 0 && Math.round(Math.abs(value) * 10 ** digits) > 0 ? "-" : "";
}

function usdDigits(abs: number): number {
  return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

function bb100Digits(abs: number): number {
  return abs >= 100 || Number.isInteger(abs) ? 0 : 1;
}

export function makeCashFormat(locale: Locale, t: Translate) {
  const numberLocale = numberLocaleTag(locale);
  const bbUnit = t("cash.unit.bb");
  const perHour = t("cash.unit.perHour");

  const amountUsd = (value: number): string => {
    const abs = Math.abs(value);
    const digits = usdDigits(abs);
    return `${minusFor(value, digits)}$${grouped(abs, numberLocale, digits)}`;
  };

  const bbAmount = (value: number): string =>
    `${minusFor(value, 1)}${grouped(Math.abs(value), numberLocale, 1)}`;

  const bb = (value: number): string => `${bbAmount(value)} ${bbUnit}`;

  const riskThresholdBb = (value: number): string => {
    const abs = Math.abs(value);
    return `−${grouped(abs, numberLocale, bb100Digits(abs))} ${bbUnit}`;
  };

  return {
    numberLocale,
    bbUnit,
    amountUsd,
    bbAmount,
    bb,
    money: (valueBb: number, unit: CashMoneyUnit, bbSize: number): string =>
      unit === "usd" ? amountUsd(valueBb * bbSize) : bb(valueBb),
    usdRate: (value: number): string => `${amountUsd(value)}${perHour}`,
    pct: (value: number): string =>
      `${grouped(value * 100, numberLocale, 1, 1)}%`,
    winrate: (value: number): string =>
      `${minusFor(value, 2)}${grouped(Math.abs(value), numberLocale, 2, 2)}`,
    signedBb100: (value: number): string => {
      const abs = Math.abs(value);
      const digits = bb100Digits(abs);
      return `${minusFor(value, digits) || "+"}${grouped(abs, numberLocale, digits)}`;
    },
    unsignedBb100: (value: number): string => {
      const abs = Math.abs(value);
      return grouped(abs, numberLocale, bb100Digits(abs));
    },
    usdBbSize: (value: number): string => {
      const digits = value >= 10 ? 0 : value >= 1 ? 2 : 3;
      return `$${grouped(value, numberLocale, digits, digits >= 2 ? 2 : 0)} ${bbUnit}`;
    },
    riskThresholdBb,
    riskThreshold: (
      valueBb: number,
      unit: CashMoneyUnit,
      bbSize: number,
    ): string => {
      if (unit === "bb") return riskThresholdBb(valueBb);
      const usd = Math.abs(valueBb * bbSize);
      return `−$${grouped(usd, numberLocale, usdDigits(usd))}`;
    },
  };
}

export type CashFormat = ReturnType<typeof makeCashFormat>;

/** One bankroll figure per unit: the hover readout lists BB and $ once each. */
export function bankrollReadout(
  rawBb: number,
  bbSize: number,
  fmt: CashFormat,
  t: Translate,
): { key: "bb" | "usd"; label: string; value: string; negative: boolean }[] {
  const negative = rawBb < 0;
  return [
    {
      key: "bb",
      label: t("cash.chart.trajectory.bankrollBb"),
      value: fmt.bbAmount(rawBb),
      negative,
    },
    {
      key: "usd",
      label: t("cash.chart.trajectory.bankrollUsd"),
      value: fmt.amountUsd(rawBb * bbSize),
      negative,
    },
  ];
}

export function useCashFormat(): CashFormat {
  const { locale, t } = useLocale();
  return useMemo(() => makeCashFormat(locale, t), [locale, t]);
}
