/**
 * Validates our `primedope-binary-itm` calibration mode against
 * PrimeDope's actual server-side calculator output. Reference values
 * are snapshots from `https://www.primedope.com/prime.php?p=tournament-
 * variance-calculator&sub_routine=calc` captured 2026-05-02.
 *
 * Checks both `ev` (deterministic, must be byte-exact) and `sd` (MC-
 * driven on PD's side, our analytic ≈ PD within ~0.5 % across the
 * sweep).
 *
 * If PD's site updates their PMF or our PD-mimicking calibration
 * drifts, this test fails — surfaces the parity break before it ships.
 * To refresh, re-run scripts/_pd_compare2.mjs and update REFERENCE.
 */
import { describe, expect, it } from "vitest";
import { runSimulation } from "./engine";
import { primedopeCurveForPaid } from "./pdCurves";
import type { SimulationInput, TournamentRow } from "./types";

interface PdReference {
  players: number;
  paid: number;
  evMath: number;
  sdMath: number;
}

/**
 * Snapshots from PD's actual API. Reference scenario: $50 buy-in,
 * rake = 0 %, ROI = 10 %, 1000 tournaments per row.
 */
const REFERENCE: PdReference[] = [
  { players: 100, paid: 15, evMath: 5000, sdMath: 5975.0 },
  { players: 200, paid: 30, evMath: 5000, sdMath: 7809.6 },
  { players: 500, paid: 75, evMath: 5000, sdMath: 11297.5 },
  { players: 1000, paid: 100, evMath: 5000, sdMath: 15648.4 },
  { players: 2000, paid: 100, evMath: 5000, sdMath: 22198.4 },
  { players: 100, paid: 10, evMath: 5000, sdMath: 6593.4 },
  { players: 200, paid: 20, evMath: 5000, sdMath: 8213.4 },
  { players: 500, paid: 50, evMath: 5000, sdMath: 11754.6 },
  { players: 50, paid: 9, evMath: 5000, sdMath: 4436.6 },
];

const BUYIN = 50;
const ROI = 0.10;
const N_TOURNS = 1000;

function runOurEngine(players: number, paid: number) {
  // Force PD's exact paid count via customPayouts (length pins paid)
  const customPayouts = [...primedopeCurveForPaid(paid)];
  const row: TournamentRow = {
    id: "pd-cmp",
    label: "pd",
    players,
    buyIn: BUYIN,
    rake: 0,
    roi: ROI,
    payoutStructure: "custom",
    customPayouts,
    count: N_TOURNS,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 30_000,
    bankroll: 1_000_000,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
    usePrimedopePayouts: true,
  };
  const r = runSimulation(input);
  let sumSq = 0;
  const m = r.expectedProfit;
  for (let i = 0; i < r.finalProfits.length; i++) {
    const d = r.finalProfits[i] - m;
    sumSq += d * d;
  }
  const sd = Math.sqrt(sumSq / (r.finalProfits.length - 1));
  return { ev: m, sd };
}

describe("primedope-binary-itm calibration matches PD's actual server math", () => {
  describe.each(REFERENCE)(
    "AFS=$players paid=$paid",
    ({ players, paid, evMath, sdMath }) => {
      // Cache the engine output across the two assertions for this row.
      const out = runOurEngine(players, paid);

      it(`EV matches PD (target $${evMath})`, () => {
        // EV is deterministic on both sides — should match to penny precision
        expect(out.ev).toBeCloseTo(evMath, 0);
      });

      it(`SD matches PD within 1 % (PD = $${sdMath})`, () => {
        // SD has MC noise on PD's side (1k samples) AND ours (30k samples).
        // Allow 1 % tolerance — much tighter than the ~3 % SD residual our
        // own σ-fits ship with.
        const dev = Math.abs(out.sd - sdMath) / sdMath;
        expect(dev).toBeLessThan(0.01);
      });
    },
  );
});
