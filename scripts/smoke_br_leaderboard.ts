import assert from "node:assert/strict";

import { battleRoyaleRowFromTotalTicket } from "../src/lib/sim/battleRoyaleTicket.ts";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  battleRoyaleLeaderboardPromoPerTournament,
  buildBattleRoyaleLeaderboardPromoConfig,
} from "../src/lib/sim/battleRoyaleLeaderboardUi.ts";
import { runSimulation } from "../src/lib/sim/engine.ts";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types.ts";

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

const ticket = battleRoyaleRowFromTotalTicket(1);
const schedule: TournamentRow[] = [
  {
    id: "br-1",
    label: "GG BR $1",
    gameType: "mystery-royale",
    payoutStructure: "battle-royale",
    players: 18,
    buyIn: ticket.buyIn,
    rake: ticket.rake,
    roi: 0,
    count: 7000,
    bountyFraction: 0.45,
    itmRate: 0.2,
  },
];

const controls = {
  ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  mode: "observed" as const,
  observedTotalPrizes: 350,
  observedTotalTournaments: 7000,
  observedPointsByStake: {
    "0.25": 0,
    "1": 1,
    "3": 0,
    "10": 0,
    "25": 0,
  },
};

const promoPerTournament = battleRoyaleLeaderboardPromoPerTournament(
  controls,
  schedule,
);
closeTo(promoPerTournament, 0.05);

const promoConfig = buildBattleRoyaleLeaderboardPromoConfig(controls, schedule);
assert.ok(promoConfig, "expected observed BR leaderboard promo config");

const input: SimulationInput = {
  schedule,
  scheduleRepeats: 1,
  samples: 2000,
  bankroll: 200,
  seed: 42,
  finishModel: { id: "power-law" },
  rakebackFracOfRake: 0,
  battleRoyaleLeaderboardPromo: promoConfig,
};

const result = runSimulation(input, () => {});
const promo = result.battleRoyaleLeaderboardPromo;
assert.ok(promo, "expected BR leaderboard promo result");
closeTo(promo.payoutPerTournament, 0.05);
closeTo(promo.expectedPayout, 350);
closeTo(promo.rows[0]?.payout ?? 0, 350);

console.log(
  JSON.stringify(
    {
      ok: true,
      case: "BR observed 7000 * $0.05",
      promoPerTournament,
      expectedPayout: promo.expectedPayout,
      promoRows: promo.rows.length,
    },
    null,
    2,
  ),
);
