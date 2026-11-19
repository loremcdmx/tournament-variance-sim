"use client";

import { DraftNumberInput } from "@/components/ui/DraftNumberInput";
import { roiLabel, roiPct } from "@/lib/results/refLines";

const ROI_PCT_MIN = -99;
const ROI_PCT_MAX = 10_000;

export function RefLineRoiInput({
  roi,
  onChange,
  ariaLabel,
}: {
  roi: number;
  onChange: (patch: { roi: number; label: string }) => void;
  ariaLabel: string;
}) {
  return (
    <DraftNumberInput
      value={roiPct(roi)}
      min={ROI_PCT_MIN}
      max={ROI_PCT_MAX}
      step={5}
      onCommit={(pct) => {
        const held = roiPct(pct / 100) / 100;
        onChange({ roi: held, label: roiLabel(held) });
      }}
      className="number-control w-14 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)] px-1 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)]"
      ariaLabel={ariaLabel}
    />
  );
}
