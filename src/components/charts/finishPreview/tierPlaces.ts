import type { TierRow } from "@/lib/sim/previewRowStats";

export function tierPlacesLabel(
  tier: Pick<TierRow, "posLo" | "posHi" | "placesVary">,
  varyLabel: string,
): string {
  if (tier.placesVary) return varyLabel;
  return tier.posLo === tier.posHi ? `${tier.posLo}` : `${tier.posLo}–${tier.posHi}`;
}
