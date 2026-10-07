import { describe, expect, it } from "vitest";
import { buildOceanKoModel, OCEAN_KO_ODDS } from "./oceanKo";

/** Enumerate actual heads independently of the runtime sampler and its
 * moment recurrence, including branches that cross a Legendary threshold. */
function enumerateThreePlayerTree(ticket: number): {
  means: number[];
  seconds: number[];
} {
  const bounty = ticket / 2;
  const means = [0, 0, 0];
  const seconds = [0, 0, 0];
  const wheel = (head: number) => OCEAN_KO_ODDS[
    head <= 50 * ticket || head < 10_000 ? 0
      : head < 50_000 ? 1
        : head < 250_000 ? 2
          : head < 1_000_000 ? 3 : 4
  ];
  for (let killerOfThird = 0; killerOfThird < 2; killerOfThird++) {
    const thirdWheel = wheel(bounty);
    for (let a = 0; a < thirdWheel.multipliers.length; a++) {
      const thirdTransfer = 0.5 * thirdWheel.multipliers[a] * bounty;
      const secondHead = bounty + (killerOfThird === 1 ? thirdTransfer : 0);
      const secondWheel = wheel(secondHead);
      for (let b = 0; b < secondWheel.multipliers.length; b++) {
        const secondTransfer = 0.5 * secondWheel.multipliers[b] * secondHead;
        const winnerCash = (killerOfThird === 0 ? thirdTransfer : 0) + secondTransfer;
        const winnerHead = bounty + winnerCash;
        const finalWheel = wheel(winnerHead);
        for (let c = 0; c < finalWheel.multipliers.length; c++) {
          const weight = 0.5 * thirdWheel.probabilities[a]
            * secondWheel.probabilities[b] * finalWheel.probabilities[c];
          const cash = [
            winnerCash + finalWheel.multipliers[c] * winnerHead,
            killerOfThird === 1 ? thirdTransfer : 0,
            0,
          ];
          for (let place = 0; place < 3; place++) {
            means[place] += weight * cash[place];
            seconds[place] += weight * cash[place] * cash[place];
          }
        }
      }
    }
  }
  return { means, seconds };
}

describe("Ocean KO variance bounds — independent adaptive-wheel enumeration", () => {
  it.each([2, 100, 10_000, 100_000])(
    "encloses the exact moments at every finish for a $%s ticket",
    (ticket) => {
      const exact = enumerateThreePlayerTree(ticket);
      const model = buildOceanKoModel(3, ticket / 2, ticket);
      for (let place = 0; place < 3; place++) {
        const meanScale = Math.max(1, exact.means[place]);
        expect(Math.abs(model.bountyMeanByPlace[place] - exact.means[place]) / meanScale)
          .toBeLessThan(1e-12);
        const roundoff = Math.max(1, exact.seconds[place]) * 1e-12;
        expect(model.bountySecondLowerByPlace[place])
          .toBeLessThanOrEqual(exact.seconds[place] + roundoff);
        expect(model.bountySecondUpperByPlace[place])
          .toBeGreaterThanOrEqual(exact.seconds[place] - roundoff);
      }
    },
  );

  it("shows why equal relative buy-ins cannot erase dollar-dependent tiers", () => {
    const low = enumerateThreePlayerTree(2);
    const high = enumerateThreePlayerTree(10_000);
    const normalizedSecondLow = low.seconds[0] / 2 ** 2;
    const normalizedSecondHigh = high.seconds[0] / 10_000 ** 2;
    expect(normalizedSecondLow).toBeGreaterThan(normalizedSecondHigh * 1.5);
  });
});
