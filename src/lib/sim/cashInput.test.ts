import { describe, expect, it } from "vitest";
import {
  cashFieldMaxima,
  MAX_ABS_WR_BB100,
  MAX_BB_SIZE,
  MAX_HANDS,
  MAX_HAND_SHARE,
  MAX_HANDS_PER_HOUR,
  MAX_RAKE_CONTRIB_BB100,
  MAX_SD_BB100,
  normalizeCashInput,
  normalizeCashInputForUi,
} from "./cashInput";

describe("cashInput persistence guardrails", () => {
  it("caps persisted nSimulations to the tighter of the UI max and work budget", () => {
    const normalized = normalizeCashInput({ nSimulations: 1_000_000_000 });

    expect(normalized.nSimulations).toBe(2_000);
  });

  it("caps destructive cash work budgets before they turn into runaway compute", () => {
    const normalized = normalizeCashInput({
      hands: 1_000_000_000,
      nSimulations: 20_000,
    });

    expect(normalized.hands).toBe(MAX_HANDS);
    expect(normalized.nSimulations).toBe(100);
  });

  it("clamps hydrated cash UI values back inside visible field bounds", () => {
    const normalized = normalizeCashInputForUi({
      hands: 1,
      nSimulations: 1,
      sdBb100: 0,
      hoursBlock: { handsPerHour: 1 },
      stakes: [
        {
          wrBb100: 5,
          sdBb100: 0,
          bbSize: 0.001,
          handShare: 2,
          rake: {
            enabled: true,
            contributedRakeBb100: 9,
            advertisedRbPct: 130,
            pvi: 9,
          },
        },
      ],
    });

    expect(normalized.hands).toBe(1_000);
    expect(normalized.nSimulations).toBe(100);
    expect(normalized.sdBb100).toBe(1);
    expect(normalized.hoursBlock?.handsPerHour).toBe(50);
    expect(normalized.stakes?.[0]).toMatchObject({
      sdBb100: 1,
      bbSize: 0.01,
      handShare: 1,
      rake: {
        advertisedRbPct: 100,
        pvi: 1,
      },
    });
  });

  it("caps absurd persisted magnitudes before they turn cash results into infinity", () => {
    const normalized = normalizeCashInput({
      wrBb100: 1e308,
      sdBb100: 1e308,
      bbSize: 1e308,
      stakes: [
        {
          wrBb100: -1e308,
          sdBb100: 1e308,
          bbSize: 1e308,
          handShare: 1,
          rake: {
            enabled: false,
            contributedRakeBb100: 0,
            advertisedRbPct: 0,
            pvi: 1,
          },
        },
      ],
    });

    expect(normalized.wrBb100).toBe(MAX_ABS_WR_BB100);
    expect(normalized.sdBb100).toBe(MAX_SD_BB100);
    expect(normalized.bbSize).toBe(MAX_BB_SIZE);
    expect(normalized.stakes?.[0]).toMatchObject({
      wrBb100: -MAX_ABS_WR_BB100,
      sdBb100: MAX_SD_BB100,
      bbSize: MAX_BB_SIZE,
    });
  });

  it("caps persisted rake and hourly volume before they overflow cash summaries", () => {
    const normalized = normalizeCashInput({
      rake: {
        enabled: true,
        contributedRakeBb100: 1e308,
        advertisedRbPct: 100,
        pvi: 1,
      },
      hoursBlock: { handsPerHour: 1e308 },
      stakes: [
        {
          wrBb100: 5,
          sdBb100: 100,
          bbSize: 1,
          handShare: 1,
          rake: {
            enabled: true,
            contributedRakeBb100: 1e308,
            advertisedRbPct: 100,
            pvi: 1,
          },
        },
      ],
    });

    expect(normalized.rake.contributedRakeBb100).toBe(MAX_RAKE_CONTRIB_BB100);
    expect(normalized.hoursBlock?.handsPerHour).toBe(MAX_HANDS_PER_HOUR);
    expect(normalized.stakes?.[0].rake.contributedRakeBb100).toBe(
      MAX_RAKE_CONTRIB_BB100,
    );
  });

  it("does not resurrect disabled optional lenses when a hydrated cash input is normalized again", () => {
    const hydratedUiState = normalizeCashInputForUi({
      type: "cash",
      wrBb100: 5,
      sdBb100: 100,
      hands: 25_000,
      nSimulations: 300,
      bbSize: 1,
      rake: {
        enabled: false,
        contributedRakeBb100: 8,
        advertisedRbPct: 30,
        pvi: 1,
      },
      hoursBlock: null,
      baseSeed: 42,
    });

    expect(hydratedUiState.hoursBlock).toBeUndefined();

    const rerunNormalized = normalizeCashInput(hydratedUiState);

    expect(rerunNormalized.hoursBlock).toBeUndefined();
  });
});

describe("cashInput stake shares and seeds", () => {
  const row = (handShare: number) => ({
    wrBb100: 5,
    sdBb100: 100,
    bbSize: 1,
    handShare,
    rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
  });

  it("caps a stake's hand share so two huge shares cannot overflow the weight sum", () => {
    const normalized = normalizeCashInput({ stakes: [row(1e308), row(1e308)] });

    expect(normalized.stakes?.map((r) => r.handShare)).toEqual([
      MAX_HAND_SHARE,
      MAX_HAND_SHARE,
    ]);
  });

  it("leaves every share an editor can produce untouched", () => {
    const normalized = normalizeCashInput({ stakes: [row(0.7), row(3), row(0)] });

    expect(normalized.stakes?.map((r) => r.handShare)).toEqual([0.7, 3, 0]);
  });

  it("folds a seed beyond 32 bits onto the seed the engine uses and keeps in-range seeds", () => {
    const seed = (baseSeed: number) => normalizeCashInput({ baseSeed }).baseSeed;

    expect(seed(1e15)).toBe(seed(1e15 + 2 ** 32));
    expect(seed(2 ** 32 + 7)).toBe(7);
    expect(seed(-(2 ** 31) - 1)).toBe(2 ** 31 - 1);
    expect(seed(42)).toBe(42);
    expect(seed(-5)).toBe(-5);
    expect(seed(3_000_000_000)).toBe(3_000_000_000);
    expect(seed(2 ** 32 - 1)).toBe(2 ** 32 - 1);
  });
});

describe("cashFieldMaxima", () => {
  it("caps Hands at 100 000 for the default 2 000 simulations", () => {
    expect(cashFieldMaxima(100_000, 2_000)).toEqual({
      maxHands: 100_000,
      maxSimulations: 2_000,
    });
  });

  it("raises the Hands ceiling when Simulations go down and stays inside the field bounds", () => {
    expect(cashFieldMaxima(100_000, 200).maxHands).toBe(1_000_000);
    expect(cashFieldMaxima(100_000, 100).maxHands).toBe(MAX_HANDS);
    expect(cashFieldMaxima(1_000, 20_000)).toEqual({
      maxHands: 10_000,
      maxSimulations: 20_000,
    });
    expect(cashFieldMaxima(MAX_HANDS, 100).maxSimulations).toBe(100);
  });

  it("agrees with the work budget that normalizeCashInput enforces", () => {
    const { maxHands } = cashFieldMaxima(100_000, 2_000);
    const normalized = normalizeCashInput({ hands: maxHands * 10, nSimulations: 2_000 });
    expect(normalized.hands * normalized.nSimulations).toBeLessThanOrEqual(200_000_000);
  });
});
