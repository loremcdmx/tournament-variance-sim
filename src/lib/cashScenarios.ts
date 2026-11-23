/**
 * Curated Cash-game demo scenarios so a user can load realistic NLHE / PLO /
 * multi-stake mixes in one click instead of manually configuring every input.
 * Mirrors `src/lib/scenarios.ts` for MTT mode.
 */
import type { DictKey } from "@/lib/i18n/dict";
import type { CashInput } from "@/lib/sim/cashTypes";

export interface CashScenario {
  id: string;
  nameKey: DictKey;
  descKey: DictKey;
  badge: string;
  input: CashInput;
}

export const CASH_SCENARIOS: CashScenario[] = [
  {
    id: "nl50-reg",
    nameKey: "cash.scenario.nl50.name",
    descKey: "cash.scenario.nl50.desc",
    badge: "NL50",
    input: {
      type: "cash",
      wrBb100: 5,
      sdBb100: 95,
      hands: 100_000,
      nSimulations: 2_000,
      bbSize: 0.5,
      rake: {
        enabled: true,
        contributedRakeBb100: 7.5,
        advertisedRbPct: 30,
        pvi: 0.9,
      },
      hoursBlock: { handsPerHour: 500 },
      riskBlock: { thresholdBb: 2_000 },
      baseSeed: 42,
    },
  },
  {
    id: "nl100-grinder",
    nameKey: "cash.scenario.nl100.name",
    descKey: "cash.scenario.nl100.desc",
    badge: "NL100",
    input: {
      type: "cash",
      wrBb100: 4,
      sdBb100: 100,
      hands: 150_000,
      nSimulations: 2_000,
      bbSize: 1,
      rake: {
        enabled: true,
        contributedRakeBb100: 6.5,
        advertisedRbPct: 35,
        pvi: 0.85,
      },
      hoursBlock: { handsPerHour: 600 },
      riskBlock: { thresholdBb: 2_500 },
      baseSeed: 100,
    },
  },
  {
    id: "nl200-shot-mix",
    nameKey: "cash.scenario.mix.name",
    descKey: "cash.scenario.mix.desc",
    badge: "MIX",
    input: {
      type: "cash",
      wrBb100: 4.5,
      sdBb100: 100,
      hands: 100_000,
      nSimulations: 2_000,
      bbSize: 1,
      rake: {
        enabled: true,
        contributedRakeBb100: 6.5,
        advertisedRbPct: 35,
        pvi: 0.85,
      },
      hoursBlock: { handsPerHour: 500 },
      riskBlock: { thresholdBb: 3_000 },
      baseSeed: 200,
      stakes: [
        {
          label: "NL100",
          wrBb100: 4.5,
          sdBb100: 98,
          bbSize: 1,
          handShare: 0.7,
          rake: {
            enabled: true,
            contributedRakeBb100: 6.5,
            advertisedRbPct: 35,
            pvi: 0.85,
          },
        },
        {
          label: "NL200",
          wrBb100: 2.5,
          sdBb100: 108,
          bbSize: 2,
          handShare: 0.3,
          rake: {
            enabled: true,
            contributedRakeBb100: 5.5,
            advertisedRbPct: 35,
            pvi: 0.85,
          },
        },
      ],
    },
  },
  {
    id: "nl500-high-stakes",
    nameKey: "cash.scenario.nl500.name",
    descKey: "cash.scenario.nl500.desc",
    badge: "NL500",
    input: {
      type: "cash",
      wrBb100: 2.5,
      sdBb100: 112,
      hands: 100_000,
      nSimulations: 2_000,
      bbSize: 5,
      rake: {
        enabled: true,
        contributedRakeBb100: 5,
        advertisedRbPct: 40,
        pvi: 0.8,
      },
      hoursBlock: { handsPerHour: 400 },
      riskBlock: { thresholdBb: 4_000 },
      wrStdErr: 1.5,
      baseSeed: 500,
    },
  },
  {
    id: "plo100-swings",
    nameKey: "cash.scenario.plo100.name",
    descKey: "cash.scenario.plo100.desc",
    badge: "PLO",
    input: {
      type: "cash",
      wrBb100: 6,
      sdBb100: 150,
      hands: 100_000,
      nSimulations: 2_000,
      bbSize: 1,
      rake: {
        enabled: true,
        contributedRakeBb100: 9.5,
        advertisedRbPct: 35,
        pvi: 0.9,
      },
      hoursBlock: { handsPerHour: 450 },
      riskBlock: { thresholdBb: 5_000 },
      baseSeed: 404,
    },
  },
  {
    id: "micro-rake-grind",
    nameKey: "cash.scenario.micro.name",
    descKey: "cash.scenario.micro.desc",
    badge: "NL10",
    input: {
      type: "cash",
      wrBb100: 3,
      sdBb100: 90,
      hands: 100_000,
      nSimulations: 2_000,
      bbSize: 0.1,
      rake: {
        enabled: true,
        contributedRakeBb100: 11,
        advertisedRbPct: 25,
        pvi: 1,
      },
      hoursBlock: { handsPerHour: 700 },
      riskBlock: { thresholdBb: 1_500 },
      baseSeed: 10,
    },
  },
  {
    id: "downswing-stress",
    nameKey: "cash.scenario.stress.name",
    descKey: "cash.scenario.stress.desc",
    badge: "±1.5",
    input: {
      type: "cash",
      wrBb100: 1.5,
      sdBb100: 105,
      hands: 200_000,
      nSimulations: 2_000,
      bbSize: 1,
      rake: {
        enabled: false,
        contributedRakeBb100: 8,
        advertisedRbPct: 30,
        pvi: 1,
      },
      hoursBlock: { handsPerHour: 500 },
      riskBlock: { thresholdBb: 3_000 },
      wrStdErr: 1.5,
      baseSeed: 777,
    },
  },
];

export interface QuickStakeTemplate {
  label: string;
  bbSize: number;
  wrBb100: number;
  sdBb100: number;
  contributedRakeBb100: number;
  advertisedRbPct: number;
  pvi: number;
}

export const QUICK_STAKE_TEMPLATES: QuickStakeTemplate[] = [
  { label: "NL25", bbSize: 0.25, wrBb100: 6, sdBb100: 92, contributedRakeBb100: 9, advertisedRbPct: 30, pvi: 0.95 },
  { label: "NL50", bbSize: 0.5, wrBb100: 5, sdBb100: 95, contributedRakeBb100: 7.5, advertisedRbPct: 30, pvi: 0.9 },
  { label: "NL100", bbSize: 1, wrBb100: 4, sdBb100: 100, contributedRakeBb100: 6.5, advertisedRbPct: 35, pvi: 0.85 },
  { label: "NL200", bbSize: 2, wrBb100: 3, sdBb100: 105, contributedRakeBb100: 5.5, advertisedRbPct: 35, pvi: 0.85 },
  { label: "NL500", bbSize: 5, wrBb100: 2.5, sdBb100: 112, contributedRakeBb100: 5, advertisedRbPct: 40, pvi: 0.8 },
  { label: "PLO100", bbSize: 1, wrBb100: 6, sdBb100: 150, contributedRakeBb100: 9.5, advertisedRbPct: 35, pvi: 0.9 },
];
