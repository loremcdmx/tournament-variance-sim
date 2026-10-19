import type { DictKey } from "@/lib/i18n/dict";
import type { CashInput, CashStakeRow } from "@/lib/sim/cashTypes";

type Translate = (key: DictKey) => string;

// $1 big blind = NL100; only a round stake gets a name, anything else stays
// unlabelled and reads "Row n" in the results.
export function stakeSeedLabel(
  bbSize: number,
  t: Translate,
): string | undefined {
  const stake = Math.round(bbSize * 100 * 1000) / 1000;
  return Number.isInteger(stake) && stake >= 1
    ? t("cash.stakes.seedLabel").replace("{n}", String(stake))
    : undefined;
}

export function seedMixRows(
  input: CashInput,
  t: Translate,
): [CashStakeRow, CashStakeRow] {
  const row = (bbSize: number, handShare: number): CashStakeRow => {
    const label = stakeSeedLabel(bbSize, t);
    return {
      ...(label ? { label } : {}),
      wrBb100: input.wrBb100,
      sdBb100: input.sdBb100,
      bbSize,
      handShare,
      rake: { ...input.rake },
    };
  };
  return [row(input.bbSize, 0.7), row(input.bbSize * 2, 0.3)];
}
