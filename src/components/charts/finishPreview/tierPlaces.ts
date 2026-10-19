import type { DictKey } from "@/lib/i18n/dict";
import type { TierKey, TierRow } from "@/lib/sim/previewRowStats";

export function tierPlacesLabel(
  tier: Pick<TierRow, "posLo" | "posHi" | "placesVary">,
  varyLabel: string,
): string {
  if (tier.placesVary) return varyLabel;
  return tier.posLo === tier.posHi ? `${tier.posLo}` : `${tier.posLo}–${tier.posHi}`;
}

/** The places each tier's dictionary label prints. A small field pays fewer
 *  places, so the tier's real range can be shorter than the printed one. */
const PRINTED_PLACES: Partial<Record<TierKey, readonly [number, number]>> = {
  top3: [2, 3],
  ft: [4, 9],
  ftNonCash: [5, 9],
  top27: [10, 27],
};

export function tierLabel(
  tier: Pick<TierRow, "key" | "labelKey" | "posLo" | "posHi" | "placesVary">,
  t: (key: DictKey) => string,
): string {
  const printed = PRINTED_PLACES[tier.key];
  if (
    !printed ||
    tier.placesVary ||
    (tier.posLo === printed[0] && tier.posHi === printed[1])
  ) {
    return t(tier.labelKey);
  }
  if (tier.posLo === tier.posHi) {
    return t("preview.tierPlaceOne").replace("{n}", String(tier.posLo));
  }
  return t("preview.tierPlaceRange")
    .replace("{lo}", String(tier.posLo))
    .replace("{hi}", String(tier.posHi));
}
