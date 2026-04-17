/**
 * Declarative demo scenarios shown in the landing grid. Each entry is a
 * ready-to-run `{schedule, controls}` snapshot with an i18n key for the
 * label and blurb. Pure data — rendered by `page.tsx`, no engine coupling
 * beyond the shared `TournamentRow` / `ControlsState` types.
 */
import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "./sim/types";
import type { DictKey } from "./i18n/dict";

export interface DemoScenario {
  id: string;
  labelKey: DictKey;
  description: string;
  schedule: TournamentRow[];
  controls: ControlsState;
  icon?: string;
}

const BASE_CONTROLS: ControlsState = {
  scheduleRepeats: 200,
  samples: 10_000,
  bankroll: 0,
  seed: 42,
  finishModelId: "power-law",
  alphaOverride: null,
  compareWithPrimedope: true,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  compareMode: "primedope",
  roiStdErr: 0,
  roiShockPerTourney: 0,
  roiShockPerSession: 0,
  roiDriftSigma: 0,
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  tiltSlowMinDuration: 500,
  tiltSlowRecoveryFrac: 0.5,
  modelPresetId: "naive",
  itmGlobalEnabled: true,
  itmGlobalPct: 15,
};

export const SCENARIOS: DemoScenario[] = [
  {
    id: "primedope-reference",
    labelKey: "demo.primedopeReference",
    description:
      "Обычный $50 турнир: 5000 игроков, рейк 10%, ROI 10%, 10 000 турниров. Базовый сценарий для оценки дисперсии.",
    schedule: [
      {
        id: "pd-1",
        label: "$50 обычный MTT",
        players: 5000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 10_000,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 1,
      samples: 10_000,
      bankroll: 1000,
      compareWithPrimedope: true,
      compareMode: "primedope",
      // Explicit opt-in on the "reproduce PD" demo — this is the one scenario
      // where the PD pane is supposed to run on PD's native curve.
      usePrimedopePayouts: true,
    },
  },
  {
    id: "romeo-pro",
    labelKey: "demo.romeoPro",
    icon: "/scenarios/romeo.png",
    description:
      "RomeoPro mode — ~250 турниров за сессию, 60% ноки / 40% фризы, у каждого турика отдельными слотами стоят лейт-ре-реги с пониженным ROI.",
    schedule: [
      // ---- PKO generics (60% of load, ~148 tourneys) ----
      {
        id: "romeo-pko25-1",
        label: "GG PKO $25 (1st)",
        players: 2500,
        buyIn: 22,
        rake: 3 / 22,
        roi: 0.12,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 50_000,
        count: 40,
      },
      {
        id: "romeo-pko25-2",
        label: "GG PKO $25 (re-1)",
        players: 2500,
        buyIn: 22,
        rake: 3 / 22,
        roi: 0.06,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 50_000,
        count: 20,
      },
      {
        id: "romeo-pko25-3",
        label: "GG PKO $25 (re-2)",
        players: 2500,
        buyIn: 22,
        rake: 3 / 22,
        roi: 0.03,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 50_000,
        count: 10,
      },
      {
        id: "romeo-pko55-1",
        label: "GG PKO $55 (1st)",
        players: 2000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.09,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 100_000,
        count: 25,
      },
      {
        id: "romeo-pko55-2",
        label: "GG PKO $55 (re-1)",
        players: 2000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.045,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 100_000,
        count: 12,
      },
      {
        id: "romeo-pko55-3",
        label: "GG PKO $55 (re-2)",
        players: 2000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.0225,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 100_000,
        count: 6,
      },
      {
        id: "romeo-pko22ps-1",
        label: "PS BB $22 (1st)",
        players: 1800,
        buyIn: 20,
        rake: 0.09,
        roi: 0.1,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 40_000,
        count: 20,
      },
      {
        id: "romeo-pko22ps-2",
        label: "PS BB $22 (re-1)",
        players: 1800,
        buyIn: 20,
        rake: 0.09,
        roi: 0.05,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 40_000,
        count: 10,
      },
      {
        id: "romeo-pko22ps-3",
        label: "PS BB $22 (re-2)",
        players: 1800,
        buyIn: 20,
        rake: 0.09,
        roi: 0.025,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 40_000,
        count: 5,
      },
      // ---- Freezeout generics (40% of load, ~104 tourneys) ----
      {
        id: "romeo-fr22-1",
        label: "GG $22 freeze (1st)",
        players: 1500,
        buyIn: 20,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-gg",
        guarantee: 25_000,
        count: 30,
      },
      {
        id: "romeo-fr22-2",
        label: "GG $22 freeze (re-1)",
        players: 1500,
        buyIn: 20,
        rake: 0.1,
        roi: 0.05,
        payoutStructure: "mtt-gg",
        guarantee: 25_000,
        count: 15,
      },
      {
        id: "romeo-fr22-3",
        label: "GG $22 freeze (re-2)",
        players: 1500,
        buyIn: 20,
        rake: 0.1,
        roi: 0.025,
        payoutStructure: "mtt-gg",
        guarantee: 25_000,
        count: 7,
      },
      {
        id: "romeo-fr55-1",
        label: "PS Big $55 (1st)",
        players: 1800,
        buyIn: 50,
        rake: 0.09,
        roi: 0.08,
        payoutStructure: "mtt-pokerstars",
        guarantee: 75_000,
        count: 30,
      },
      {
        id: "romeo-fr55-2",
        label: "PS Big $55 (re-1)",
        players: 1800,
        buyIn: 50,
        rake: 0.09,
        roi: 0.04,
        payoutStructure: "mtt-pokerstars",
        guarantee: 75_000,
        count: 15,
      },
      {
        id: "romeo-fr55-3",
        label: "PS Big $55 (re-2)",
        players: 1800,
        buyIn: 50,
        rake: 0.09,
        roi: 0.02,
        payoutStructure: "mtt-pokerstars",
        guarantee: 75_000,
        count: 7,
      },
      // ---- Named events, 1 shot each ----
      {
        id: "romeo-named-thrill",
        label: "PS Thursday Thrill $109",
        players: 1500,
        buyIn: 100,
        rake: 0.09,
        roi: 0.07,
        payoutStructure: "mtt-pokerstars",
        guarantee: 150_000,
        count: 1,
      },
      {
        id: "romeo-named-bhmain",
        label: "GG BH Main $210",
        players: 2000,
        buyIn: 200,
        rake: 0.05,
        roi: 0.05,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 400_000,
        count: 1,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 50,
      samples: 8_000,
      bankroll: 15_000,
      finishModelId: "power-law",
    },
  },
  // ---- Typical reg profiles ----
  // Mid-stakes regular grinder: 1000p fields, $55 buy-in, moderate ROI.
  // Representative of a solid reg's weekly grind.
  {
    id: "mid-stakes-reg",
    labelKey: "demo.midStakesReg",
    description:
      "Мид-стейкс рег: $55 турниры, 1000 игроков, ROI +8%, 5000 турниров. Типичный профиль солидного рега.",
    schedule: [
      {
        id: "mid-55",
        label: "$55 MTT (1000p)",
        players: 1000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.08,
        payoutStructure: "mtt-standard",
        count: 5_000,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 1,
      samples: 10_000,
      bankroll: 3_000,
      compareWithPrimedope: true,
      compareMode: "primedope",
    },
  },
  // Microstakes high-volume: $5 buy-in, 3000-player fields, 10k tourneys/mo.
  // Shows how massive volume smooths variance at small stakes.
  {
    id: "micro-high-volume",
    labelKey: "demo.microHighVolume",
    description:
      "Микростейкс гринд: $5 турниры, 3000 игроков, ROI +12%, 10 000 турниров в месяц. Большой объём сглаживает дисперсию, но σ всё равно видна.",
    schedule: [
      {
        id: "micro-5",
        label: "$5 MTT (3000p)",
        players: 3000,
        buyIn: 4.5,
        rake: 0.5 / 4.5,
        roi: 0.12,
        payoutStructure: "mtt-standard",
        count: 10_000,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 1,
      samples: 10_000,
      bankroll: 500,
      compareWithPrimedope: true,
      compareMode: "primedope",
    },
  },
  // HighRoller Sunday Major: $530 buy-in, 500-player fields. Top-heavy payouts
  // + small-ish field = high variance per tourney. Sunday-Sunday grind over
  // a year — ~200 tourneys.
  {
    id: "highroller-sunday",
    labelKey: "demo.highRollerSunday",
    description:
      "HighRoller Sunday: $530 с 500 игроков, top-heavy пейауты, ROI +5%, ~200 турниров в год. Дисперсия высокая — малые поля + топ-хеви.",
    schedule: [
      {
        id: "hr-530",
        label: "$530 Sunday Major",
        players: 500,
        buyIn: 500,
        rake: 0.06,
        roi: 0.05,
        payoutStructure: "mtt-top-heavy",
        count: 200,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 1,
      samples: 10_000,
      bankroll: 25_000,
      compareWithPrimedope: true,
      compareMode: "primedope",
    },
  },
  // Mixed freeze + PKO grind: typical sunday, mixing both formats.
  // Shows how PKO and freeze variance interact on a blended bankroll.
  {
    id: "mixed-freeze-pko",
    labelKey: "demo.mixedFreezePko",
    description:
      "Микс-режим: 60/40 PKO и фризы, $22-$55 лимиты. Два разных источника дисперсии в одном графике.",
    schedule: [
      {
        id: "mix-pko22",
        label: "GG PKO $22",
        players: 1500,
        buyIn: 20,
        rake: 0.09,
        roi: 0.1,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 25_000,
        count: 60,
      },
      {
        id: "mix-pko55",
        label: "GG PKO $55",
        players: 1200,
        buyIn: 50,
        rake: 0.1,
        roi: 0.08,
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        guarantee: 60_000,
        count: 40,
      },
      {
        id: "mix-fr22",
        label: "PS $22 freeze",
        players: 1500,
        buyIn: 20,
        rake: 0.09,
        roi: 0.1,
        payoutStructure: "mtt-pokerstars",
        guarantee: 25_000,
        count: 40,
      },
      {
        id: "mix-fr55",
        label: "PS Big $55",
        players: 1800,
        buyIn: 50,
        rake: 0.09,
        roi: 0.08,
        payoutStructure: "mtt-pokerstars",
        guarantee: 75_000,
        count: 25,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 40,
      samples: 8_000,
      bankroll: 5_000,
      finishModelId: "power-law",
    },
  },
  // ---- Max-divergence presets ----
  // Max-divergence preset: small fields where PD's √field and ROI-σ
  // coupling errors are largest. ITM 18.7%, AFS ~6.5.
  {
    id: "small-field-topreg",
    labelKey: "demo.smallFieldTopReg",
    description:
      "Топ-рег малых полей: 100p, $109, ROI +15%, ITM 18.7%, AFS ~6.5. PD занижает σ на 12%+: √field (−31%), ROI-σ coupling, top-heavy.",
    schedule: [
      {
        id: "sftr-109",
        label: "$109 MTT (100p, top-heavy)",
        players: 100,
        buyIn: 100,
        rake: 0.09,
        roi: 0.15,
        payoutStructure: "mtt-top-heavy",
        count: 5_000,
      },
    ],
    controls: {
      ...BASE_CONTROLS,
      scheduleRepeats: 1,
      samples: 10_000,
      bankroll: 5_000,
      compareWithPrimedope: true,
      compareMode: "primedope",
      usePrimedopePayouts: true,
    },
  },
];

export function findScenario(id: string): DemoScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
