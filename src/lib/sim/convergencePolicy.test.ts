import { describe, it, expect } from "vitest";
import {
  CONVERGENCE_FIELD_MAX,
  CONVERGENCE_FIELD_MIN,
  CONVERGENCE_KO_ROI_MAX,
  CONVERGENCE_KO_ROI_MIN,
  CONVERGENCE_MBR_FIELD,
  CONVERGENCE_MBR_ROI_MAX,
  CONVERGENCE_MBR_ROI_MIN,
  getConvergenceBandPolicy,
  inferRowFormat,
  isInsideFitBox,
  type FitBoxSample,
} from "./convergencePolicy";
import { SIGMA_ROI_FREEZE } from "./convergenceFit";
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
    expect(
      inferRowFormat(row({ gameType: "freezeout-reentry" })),
    ).toBe("freeze");
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

describe("isInsideFitBox — per-format training boxes", () => {
  describe("freeze — field [50, 50_000], ROI unrestricted", () => {
    it("inside field bounds", () => {
      expect(isInsideFitBox(s("freeze", CONVERGENCE_FIELD_MIN, 0))).toBe(true);
      expect(isInsideFitBox(s("freeze", CONVERGENCE_FIELD_MAX, 0))).toBe(true);
      expect(isInsideFitBox(s("freeze", 1000, 0.5))).toBe(true);
    });
    it("outside field bounds", () => {
      expect(isInsideFitBox(s("freeze", 49, 0))).toBe(false);
      expect(isInsideFitBox(s("freeze", 50_001, 0))).toBe(false);
      expect(isInsideFitBox(s("freeze", 1_000_000, 0))).toBe(false);
    });
    it("tolerates floating-point noise on slider endpoints", () => {
      expect(isInsideFitBox(s("freeze", CONVERGENCE_FIELD_MIN - 1e-12, 0))).toBe(
        true,
      );
      expect(isInsideFitBox(s("freeze", CONVERGENCE_FIELD_MAX + 1e-10, 0))).toBe(
        true,
      );
    });
    it("ROI is unrestricted because freeze fit is ROI-invariant (C1=0)", () => {
      // Canary contract: if SIGMA_ROI_FREEZE.C1 ever becomes non-zero, the
      // freeze fit stops being ROI-invariant and this policy needs a ROI
      // range. We don't import the constant here (keeps policy pure), so
      // the canary test in the block below pins the contract by reading
      // ConvergenceChart.
      expect(isInsideFitBox(s("freeze", 1000, -0.99))).toBe(true);
      expect(isInsideFitBox(s("freeze", 1000, 10.0))).toBe(true);
    });
  });

  describe("pko — field [50, 50_000], ROI [−0.20, +0.80]", () => {
    it("inside box", () => {
      expect(isInsideFitBox(s("pko", 1000, 0.1))).toBe(true);
      expect(
        isInsideFitBox(
          s("pko", CONVERGENCE_FIELD_MIN, CONVERGENCE_KO_ROI_MIN),
        ),
      ).toBe(true);
      expect(
        isInsideFitBox(
          s("pko", CONVERGENCE_FIELD_MAX, CONVERGENCE_KO_ROI_MAX),
        ),
      ).toBe(true);
    });
    it("field out of box", () => {
      expect(isInsideFitBox(s("pko", 49, 0.1))).toBe(false);
      expect(isInsideFitBox(s("pko", 200_000, 0.1))).toBe(false);
    });
    it("ROI out of box (the P1 #2 gap from audit)", () => {
      expect(isInsideFitBox(s("pko", 1000, -0.30))).toBe(false);
      expect(isInsideFitBox(s("pko", 1000, 1.00))).toBe(false);
      expect(isInsideFitBox(s("pko", 1000, -0.21))).toBe(false);
      expect(isInsideFitBox(s("pko", 1000, 0.81))).toBe(false);
    });
  });

  describe("mystery — field [50, 50_000], ROI [−0.20, +0.80]", () => {
    it("inside box", () => {
      expect(isInsideFitBox(s("mystery", 1000, 0.1))).toBe(true);
    });
    it("outside box", () => {
      expect(isInsideFitBox(s("mystery", 60_000, 0.1))).toBe(false);
      expect(isInsideFitBox(s("mystery", 1000, 0.90))).toBe(false);
    });
  });

  describe("mystery-royale — field === 18 strict, ROI [−0.10, +0.10]", () => {
    it("at AFS=18 inside ROI range", () => {
      expect(isInsideFitBox(s("mystery-royale", CONVERGENCE_MBR_FIELD, 0))).toBe(
        true,
      );
      expect(
        isInsideFitBox(
          s(
            "mystery-royale",
            CONVERGENCE_MBR_FIELD,
            CONVERGENCE_MBR_ROI_MIN,
          ),
        ),
      ).toBe(true);
      expect(
        isInsideFitBox(
          s(
            "mystery-royale",
            CONVERGENCE_MBR_FIELD,
            CONVERGENCE_MBR_ROI_MAX,
          ),
        ),
      ).toBe(true);
    });
    it("any field !== 18 → outside", () => {
      expect(isInsideFitBox(s("mystery-royale", 17, 0))).toBe(false);
      expect(isInsideFitBox(s("mystery-royale", 19, 0))).toBe(false);
      expect(isInsideFitBox(s("mystery-royale", 500, 0))).toBe(false);
    });
    it("ROI outside UI band → outside", () => {
      expect(isInsideFitBox(s("mystery-royale", 18, -0.15))).toBe(false);
      expect(isInsideFitBox(s("mystery-royale", 18, 0.15))).toBe(false);
    });
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

  it("single MBR in-box → warning contains-mystery-royale", () => {
    expect(getConvergenceBandPolicy([s("mystery-royale", 18, 0)])).toEqual({
      kind: "warning",
      reason: "contains-mystery-royale",
    });
  });

  it("single Mystery in-box → warning contains-mystery", () => {
    expect(getConvergenceBandPolicy([s("mystery", 1000, 0.1)])).toEqual({
      kind: "warning",
      reason: "contains-mystery",
    });
  });

  it("freeze + PKO + Mystery + MBR all in-box → warning contains-mystery", () => {
    expect(
      getConvergenceBandPolicy([
        s("freeze", 1000, 0.1),
        s("pko", 5000, 0.2),
        s("mystery", 8000, 0.15),
        s("mystery-royale", 18, 0.05),
      ]),
    ).toEqual({ kind: "warning", reason: "contains-mystery" });
  });

  it("freeze + one Mystery row in-box → warning contains-mystery", () => {
    expect(
      getConvergenceBandPolicy([
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("freeze", 1000, 0.1),
        s("mystery", 1000, 0.1),
      ]),
    ).toEqual({ kind: "warning", reason: "contains-mystery" });
  });

  it("PKO out of ROI box (validated audit case) → warning outside-fit-box", () => {
    expect(getConvergenceBandPolicy([s("pko", 1000, -0.30)])).toEqual({
      kind: "warning",
      reason: "outside-fit-box",
    });
    expect(getConvergenceBandPolicy([s("pko", 1000, 1.0)])).toEqual({
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

  it("MBR in-box keeps point-only policy even when mixed with in-box PKO", () => {
    expect(
      getConvergenceBandPolicy([
        s("pko", 1000, 0.1),
        s("mystery-royale", 18, 0.05),
      ]),
    ).toEqual({ kind: "warning", reason: "contains-mystery-royale" });
  });

  it("freeze extreme ROI is still numeric (fit is ROI-invariant)", () => {
    expect(getConvergenceBandPolicy([s("freeze", 1000, 5)])).toEqual({
      kind: "numeric",
    });
  });

  it("Mystery outside the validated box still prioritizes contains-mystery", () => {
    expect(
      getConvergenceBandPolicy([s("mystery", 200_000, 2.0)]),
    ).toEqual({ kind: "warning", reason: "contains-mystery" });
    expect(
      getConvergenceBandPolicy([
        s("pko", 1000, 0.1),
        s("mystery", 200_000, 2.0),
      ]),
    ).toEqual({ kind: "warning", reason: "contains-mystery" });
  });

  it("Mystery still outranks MBR point-only in mixed samples", () => {
    expect(
      getConvergenceBandPolicy([
        s("mystery-royale", 18, 0.05),
        s("mystery", 1000, 0.1),
      ]),
    ).toEqual({ kind: "warning", reason: "contains-mystery" });
  });

  it("multiple out-of-box samples → single outside-fit-box", () => {
    expect(
      getConvergenceBandPolicy([
        s("pko", 200_000, 0.1),
        s("mystery-royale", 500, 0.05),
      ]),
    ).toEqual({ kind: "warning", reason: "outside-fit-box" });
  });

  it("is order-independent for mixed samples with mystery priority", () => {
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
      expect(getConvergenceBandPolicy(permuted)).toEqual({
        kind: "warning",
        reason: "contains-mystery",
      });
    }
  });
});

// Canary: if SIGMA_ROI_FREEZE ever gains a non-zero C1 (i.e. freeze sigma_ROI
// starts depending on ROI), isInsideFitBox must learn a freeze ROI range.
// This imports the real runtime constant and fails the moment the contract
// shifts, making drift impossible to miss.
describe("freeze ROI-invariant contract (canary)", () => {
  it("SIGMA_ROI_FREEZE.C1 must stay 0 — or policy needs a ROI range for freeze", () => {
    expect(SIGMA_ROI_FREEZE.kind).toBe("single-beta");
    if (SIGMA_ROI_FREEZE.kind === "single-beta") {
      expect(SIGMA_ROI_FREEZE.C1).toBe(0);
    }
  });
});
