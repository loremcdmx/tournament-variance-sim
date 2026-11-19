import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { makeAbiMoney, makeUsdMoney, type UnitMode } from "@/lib/results/formatters";
import { buildBattleRoyalePromoResult } from "@/lib/sim/battleRoyaleLeaderboardObserved";
import type { BattleRoyaleLeaderboardPromoConfig, TournamentRow } from "@/lib/sim/types";
import { BattleRoyaleLeaderboardPromoSection } from "./ResultsView";
import { AbiContext, MoneyFmtContext } from "./results/UnitContext";

const brRow: TournamentRow = {
  id: "br", label: "BR $1", players: 18, buyIn: 0.92, rake: 0.08 / 0.92, roi: 0.05,
  payoutStructure: "battle-royale", gameType: "mystery-royale", bountyFraction: 0.5, count: 1000,
};

function renderPromo(config: BattleRoyaleLeaderboardPromoConfig, unit: UnitMode): string {
  const promo = buildBattleRoyalePromoResult({
    config, schedule: [brRow], rowCounts: [1000], rowBuyIns: [1000],
  })!;
  const fmt = unit === "abi" ? makeAbiMoney(1) : makeUsdMoney("ru-RU");
  const text = renderToStaticMarkup(
    <LocaleProvider>
      <AbiContext.Provider value={1}>
        <MoneyFmtContext.Provider value={{ ...fmt, unit, setUnit: () => {} }}>
          <BattleRoyaleLeaderboardPromoSection promo={promo} />
        </MoneyFmtContext.Provider>
      </AbiContext.Provider>
    </LocaleProvider>,
  );
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("BR leaderboard promo card", () => {
  it("prints the cents a promo pays per tournament and per day in ABI", () => {
    const text = renderPromo({ mode: "manual", payoutPerTournament: 0.0375, tournamentsPerDay: 160 }, "abi");
    expect(text).toContain("Промо / турнир 0.0375 ABI");
    expect(text).toContain("Промо / день 6.00 ABI");
    expect(text).toContain("Формула 0.0375 ABI × 1 000");
    expect(text).toContain("Проекция промо 37.5 ABI");
    expect(text).not.toMatch(/(?<![\d.])0\.0 ABI/);
  });

  it("prints the cents a promo pays per tournament and per day in dollars", () => {
    const text = renderPromo({ mode: "manual", payoutPerTournament: 0.0375, tournamentsPerDay: 160 }, "money");
    expect(text).toContain("Промо / турнир $0,0375");
    expect(text).toContain("Промо / день $6,00");
    expect(text).toContain("взял $0,0375 за BR-турнир");
    expect(text).not.toMatch(/\$0(?![,\d])/);
  });

  it("prints a formula whose product reads back the projected promo", () => {
    const text = renderPromo({ mode: "manual", payoutPerTournament: 0.015625 }, "abi");
    const formula = /Формула (\d+\.\d+) ABI × 1 000/.exec(text);
    const projected = /Проекция промо (\d+\.\d+) ABI/.exec(text);
    expect(formula?.[1]).toBe("0.0156");
    expect(projected?.[1]).toBe("15.6");
    expect((Number(formula![1]) * 1000).toFixed(1)).toBe(projected![1]);
    expect(text).toContain("взял 0.0156 ABI за BR-турнир");
  });
});

describe("BR leaderboard promo note", () => {
  // The "with LB cashflow" box starts ticked whenever a promo exists, so the
  // trajectory, distribution, mean and chance to be up already carry the promo.
  it.each([
    ["observed", { mode: "observed", totalPrizes: 450, totalTournaments: 3000,
      pointsByStake: { "0.25": 0, "1": 120_000, "3": 0, "10": 0, "25": 0 } }],
    ["manual", { mode: "manual", payoutPerTournament: 0.0375 }],
    ["lookup", { mode: "lookup", payoutPerTournament: 0.0375, tournamentsPerDay: 160,
      pointsPerTournament: 40, targetPoints: 6400, snapshotCount: 1, paidDays: 1, averageDailyPrize: 6 }],
  ] as const)("says the %s promo is in the trajectories and not in drawdowns", (_mode, config) => {
    const text = renderPromo(config as BattleRoyaleLeaderboardPromoConfig, "abi");
    expect(text).not.toMatch(/не входит в траектории|вне траекторий/);
    expect(text).toMatch(/траектории, распределение профита, среднее и шанс плюса тоже прибавляют/);
    expect(text).toMatch(/В просадки, стрики и риск разорения оно не входит/);
  });

  it("says the same in English", () => {
    for (const key of ["chart.brLeaderboardObserved.note", "chart.brLeaderboardManual.note",
      "chart.brLeaderboardLookup.note"] as const) {
      expect(DICT[key].en).not.toMatch(/outside (the )?trajector|stays outside/i);
      expect(DICT[key].en).toMatch(/trajectories, the profit distribution, the mean and the chance to be up/);
      expect(DICT[key].en).toMatch(/Drawdowns, streaks and risk of ruin leave it out/);
    }
  });
});
