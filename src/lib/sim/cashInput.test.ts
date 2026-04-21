import { describe, expect, it } from "vitest";
import {
  MAX_ABS_WR_BB100,
  MAX_BB_SIZE,
  MAX_HANDS,
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
});
