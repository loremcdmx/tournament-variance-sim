import { describe, it, expect } from "vitest";
import {
  CONVERGENCE_FIELD_MAX,
  CONVERGENCE_FIELD_MIN,
  CONVERGENCE_MBR_FIELD,
  getConvergenceBandPolicy,
  inferRowFormat,
  isInsideFitBox,
  noiseChannelsActive,
  type FitBoxSample,
} from "./convergencePolicy";
import { roiControlBoundsForFormat } from "./convergenceMath";
import { RUNTIME_SIGMA_BANDS } from "./runtimeSigmaBands";
import type { TournamentRow } from "./types";

// Minimal row builder — only the fields inferRowFormat reads.
function row(patch: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "t",
    players: 1000,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    count: 100,
    ...patch,
  };
}

function s(
  format: FitBoxSample["format"],
  field: number,
  roi: number,
): FitBoxSample {
  return { format, field, roi };
}

describe("inferRowFormat — precedence", () => {
  it("keeps explicit Ocean KO distinct from its underlying bounty payout", () => {
    expect(inferRowFormat(row({
      gameType: "ocean-ko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5,
    }))).toBe("ocean-ko");
  });
  it("explicit gameType wins over everything else", () => {
    // gameType:"mystery" with MBR variance and BR payout → still mystery.
    expect(
      inferRowFormat(
        row({
          gameType: "mystery",
          mysteryBountyVariance: 2.0,
          payoutStructure: "battle-royale",
          bountyFraction: 0.5,
        }),
      ),
    ).toBe("mystery");

    // gameType:"mystery-royale" with m=0 and no bounty → still MBR.
    expect(
      inferRowFormat(row({ gameType: "mystery-royale" })),
    ).toBe("mystery-royale");

    // gameType:"pko" with mystery payout → still pko.
    expect(
      inferRowFormat(
        row({ gameType: "pko", payoutStructure: "mtt-gg-mystery" }),
      ),
    ).toBe("pko");

    expect(inferRowFormat(row({ gameType: "freezeout" }))).toBe("freeze");
  });

  it("payoutStructure is the legacy signal when gameType is absent", () => {
    expect(
      inferRowFormat(row({ payoutStructure: "battle-royale" })),
    ).toBe("mystery-royale");
    expect(
      inferRowFormat(row({ payoutStructure: "mtt-gg-mystery" })),
    ).toBe("mystery");
    expect(
      inferRowFormat(
        row({ payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5 }),
      ),
    ).toBe("pko");
  });

  it("explicit gameType:'mystery' + mysteryBountyVariance=2.0 → mystery (not MBR)", () => {
    // Regression: this exact row shape was pre-existing in the product
    // (applyGameType('mystery') sets variance to 2.0). Pre-refactor the
    // classifier used an `m >= 1.4 → mystery-royale` threshold and
    // misrouted these rows to MBR. gameType must override.
    const r = row({
      gameType: "mystery",
      mysteryBountyVariance: 2.0,
      bountyFraction: 0.5,
      payoutStructure: "mtt-gg-mystery",
    });
    expect(inferRowFormat(r)).toBe("mystery");
  });

  it("variance alone does NOT imply MBR (no m >= 1.4 heuristic)", () => {
    // Untagged row (no gameType, no format-specific payoutStructure) with
    // bounty + high variance → mystery, not MBR. MBR can only be signaled
    // by explicit gameType or payoutStructure='battle-royale'.
    const r = row({
      bountyFraction: 0.5,
      mysteryBountyVariance: 2.0,
      payoutStructure: "mtt-standard",
    });
    expect(inferRowFormat(r)).toBe("mystery");
  });

  it("structural fallback: bounty + mystery variance → mystery", () => {
    expect(
      inferRowFormat(
        row({ bountyFraction: 0.5, mysteryBountyVariance: 0.8 }),
      ),
    ).toBe("mystery");
  });

  it("structural fallback: bounty without variance → pko", () => {
    expect(inferRowFormat(row({ bountyFraction: 0.5 }))).toBe("pko");
  });

  it("structural fallback: mtt-gg-bounty payout → pko even without bountyFraction", () => {
    expect(
      inferRowFormat(row({ payoutStructure: "mtt-gg-bounty" })),
    ).toBe("pko");
  });

  it("untagged row with no bounty signal → freeze", () => {
    expect(inferRowFormat(row())).toBe("freeze");
  });
});

describe("isInsideFitBox — per-format band boxes", () => {
  it("Ocean KO has no validated residual band, including inside the PKO box", () => {
    for (const field of [50, 500, 50_000]) {
      expect(isInsideFitBox(s("ocean-ko", field, 0.1))).toBe(false);
    }
    expect(getConvergenceBandPolicy([
      s("pko", 1000, 0.1),
      s("ocean-ko", 1000, 0.1),
    ])).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });
  for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
    const box = RUNTIME_SIGMA_BANDS[format];
    describe(`${format} — the grid its band was measured on`, () => {
      it("corners are inside", () => {
        for (const field of [box.afsMin, box.afsMax]) {
          for (const roi of [box.roiMin, box.roiMax]) {
            expect(isInsideFitBox(s(format, field, roi))).toBe(true);
          }
        }
        expect(
          isInsideFitBox(s(format, Math.sqrt(box.afsMin * box.afsMax), (box.roiMin + box.roiMax) / 2)),
        ).toBe(true);
      });
      it("one step past any edge is outside", () => {
        expect(isInsideFitBox(s(format, box.afsMin - 1, box.roiMin))).toBe(false);
        expect(isInsideFitBox(s(format, box.afsMax + 1, box.roiMax))).toBe(false);
        expect(isInsideFitBox(s(format, box.afsMin, box.roiMin - 0.01))).toBe(false);
        expect(isInsideFitBox(s(format, box.afsMax, box.roiMax + 0.01))).toBe(false);
      });
      it("tolerates floating-point noise on slider endpoints", () => {
        expect(isInsideFitBox(s(format, box.afsMin - 1e-12, box.roiMin - 1e-12))).toBe(true);
        expect(isInsideFitBox(s(format, box.afsMax + 1e-10, box.roiMax + 1e-10))).toBe(true);
      });
      it("every point the card sliders can reach carries a band", () => {
        const { min, max } = roiControlBoundsForFormat(format);
        const fields =
          format === "mystery-royale"
            ? [CONVERGENCE_MBR_FIELD]
            : [CONVERGENCE_FIELD_MIN, CONVERGENCE_FIELD_MAX];
        for (const field of fields) {
          for (const roi of [min, max]) {
            expect(isInsideFitBox(s(format, field, roi))).toBe(true);
          }
        }
      });
    });
  }

  it("Battle Royale is an 18-max format: any other field is outside", () => {
    expect(isInsideFitBox(s("mystery-royale", 17, 0))).toBe(false);
    expect(isInsideFitBox(s("mystery-royale", 19, 0))).toBe(false);
    expect(isInsideFitBox(s("mystery-royale", 500, 0))).toBe(false);
  });

  it("freeze is gated on ROI as well as on the field", () => {
    expect(isInsideFitBox(s("freeze", 1000, 5))).toBe(false);
    expect(isInsideFitBox(s("freeze", 1000, -0.99))).toBe(false);
    expect(isInsideFitBox(s("freeze", 1000, 0.5))).toBe(true);
  });
});

describe("getConvergenceBandPolicy — overall verdict", () => {
  it("empty sample list → numeric (no disqualifying rows)", () => {
    expect(getConvergenceBandPolicy([])).toEqual({ kind: "numeric" });
  });

  it("single freeze / pko in-box → numeric", () => {
    expect(getConvergenceBandPolicy([s("freeze", 1000, 0.1)])).toEqual({
      kind: "numeric",
    });
    expect(getConvergenceBandPolicy([s("pko", 1000, 0.1)])).toEqual({
      kind: "numeric",
    });
  });

  it("single MBR in-box → numeric", () => {
    expect(getConvergenceBandPolicy([s("mystery-royale", 18, 0)])).toEqual({
      kind: "numeric",
    });
  });

  it("single Mystery anywhere inside the validated UI box → numeric", () => {
    expect(getConvergenceBandPolicy([s("mystery", 1000, 0.1)])).toEqual({
      kind: "numeric",
    });
    expect(getConvergenceBandPolicy([s("mystery", 20_000, 0.5)])).toEqual({
      kind: "numeric",
    });
    expect(getConvergenceBandPolicy([s("mystery", 50, -0.2)])).toEqual({
      kind: "numeric",
    });
    expect(getConvergenceBandPolicy([s("mystery", 50_000, 0.8)])).toEqual({
      kind: "numeric",
    });
  });

  it("freeze + PKO + Mystery + MBR all in-box → numeric", () => {
    expect(
      getConvergenceBandPolicy([
        s("freeze", 1000, 0.1),
        s("pko", 5000, 0.2),
        s("mystery", 8000, 0.15),
        s("mystery-royale", 18, 0.05),
      ]),
    ).toEqual({ kind: "numeric" });
  });

  it("freeze + one Mystery row in-box → numeric", () => {
    expect(
      getConvergenceBandPolicy([
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("mystery", 20_000, 0.5),
      ]),
    ).toEqual({ kind: "numeric" });
  });

  it("PKO beyond the ROI the band was measured on → warning outside-fit-box", () => {
    const { roiMin, roiMax } = RUNTIME_SIGMA_BANDS.pko;
    expect(getConvergenceBandPolicy([s("pko", 1000, roiMin - 0.1)])).toEqual({
      kind: "warning",
      reason: "outside-fit-box",
    });
    expect(getConvergenceBandPolicy([s("pko", 1000, roiMax + 0.5)])).toEqual({
      kind: "warning",
      reason: "outside-fit-box",
    });
  });

  it("exact PKO row field > 50_000 → warning outside-fit-box", () => {
    expect(
      getConvergenceBandPolicy([
        s("freeze", 2000, 0.1),
        s("pko", 100_000, 0.1),
      ]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });

  it("exact MBR row with players !== 18 → warning outside-fit-box", () => {
    expect(
      getConvergenceBandPolicy([s("mystery-royale", 500, 0.05)]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });

  it("MBR in-box stays numeric when mixed with in-box PKO", () => {
    expect(
      getConvergenceBandPolicy([
        s("pko", 1000, 0.1),
        s("mystery-royale", 18, 0.05),
      ]),
    ).toEqual({ kind: "numeric" });
  });

  it("freeze extreme ROI → warning outside-fit-box (the point follows ROI, the band was not measured there)", () => {
    expect(getConvergenceBandPolicy([s("freeze", 1000, 5)])).toEqual({
      kind: "warning",
      reason: "outside-fit-box",
    });
  });

  it("Mystery outside the validated box → warning outside-fit-box", () => {
    expect(
      getConvergenceBandPolicy([s("mystery", 200_000, 2.0)]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
    expect(
      getConvergenceBandPolicy([
        s("pko", 1000, 0.1),
        s("mystery", 200_000, 2.0),
      ]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });

  it("Mystery inside its validated box stays numeric next to in-box MBR", () => {
    expect(
      getConvergenceBandPolicy([
        s("mystery-royale", 18, 0.05),
        s("mystery", 20_000, 0.5),
      ]),
    ).toEqual({ kind: "numeric" });
  });

  it("multiple out-of-box samples → single outside-fit-box", () => {
    expect(
      getConvergenceBandPolicy([
        s("pko", 200_000, 0.1),
        s("mystery-royale", 500, 0.05),
      ]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });

  it("is order-independent for mixed samples when all rows are numeric-eligible", () => {
    const samples: FitBoxSample[] = [
      s("freeze", 1000, 0.1),
      s("mystery", 1000, 0.1),
      s("pko", 1000, 0.1),
    ];
    for (const permute of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
    ]) {
      const permuted = permute.map((i) => samples[i]);
      expect(getConvergenceBandPolicy(permuted)).toEqual({ kind: "numeric" });
    }
  });

  it("is order-independent when mystery sits near the box edges but stays in-box", () => {
    const samples: FitBoxSample[] = [
      s("freeze", 1000, 0.1),
      s("mystery", 50_000, 0.8),
      s("pko", 1000, 0.1),
    ];
    for (const permute of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
    ]) {
      const permuted = permute.map((i) => samples[i]);
      expect(getConvergenceBandPolicy(permuted)).toEqual({ kind: "numeric" });
    }
  });
});

describe("noiseChannelsActive", () => {
  it("false when every channel is off / unset", () => {
    expect(noiseChannelsActive({})).toBe(false);
    expect(
      noiseChannelsActive({
        roiStdErr: 0,
        roiShockPerTourney: 0,
        roiShockPerSession: 0,
        roiDriftSigma: 0,
        tiltFastGain: 0,
        tiltSlowGain: 0,
      }),
    ).toBe(false);
  });

  it("true for any active shock channel", () => {
    expect(noiseChannelsActive({ roiStdErr: 0.05 })).toBe(true);
    expect(noiseChannelsActive({ roiShockPerTourney: 0.1 })).toBe(true);
    expect(noiseChannelsActive({ roiShockPerSession: 0.1 })).toBe(true);
    expect(noiseChannelsActive({ roiDriftSigma: 0.1 })).toBe(true);
  });

  it("fast tilt is live for any nonzero gain — engine floors scale at 1", () => {
    expect(noiseChannelsActive({ tiltFastGain: 0.3 })).toBe(true);
    expect(noiseChannelsActive({ tiltFastGain: 0.3, tiltFastScale: 0 })).toBe(
      true,
    );
    expect(noiseChannelsActive({ tiltFastGain: 0, tiltFastScale: 100 })).toBe(
      false,
    );
  });

  it("slow tilt needs gain, threshold and a positive min-duration (mirrors engine)", () => {
    expect(noiseChannelsActive({ tiltSlowGain: 0.2 })).toBe(false);
    expect(
      noiseChannelsActive({ tiltSlowGain: 0.2, tiltSlowThreshold: 500 }),
    ).toBe(true);
    expect(
      noiseChannelsActive({
        tiltSlowGain: 0.2,
        tiltSlowThreshold: 500,
        tiltSlowMinDuration: 0,
      }),
    ).toBe(false);
    expect(
      noiseChannelsActive({
        tiltSlowGain: 0.2,
        tiltSlowThreshold: 500,
        tiltSlowMinDuration: 0.5,
      }),
    ).toBe(false);
    expect(
      noiseChannelsActive({
        tiltSlowGain: 0.2,
        tiltSlowThreshold: 500,
        tiltSlowMinDuration: 10,
      }),
    ).toBe(true);
  });
});
