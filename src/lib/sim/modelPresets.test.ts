import { describe, it, expect } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS } from "@/lib/sim/battleRoyaleLeaderboardUi";
import { SCENARIOS } from "@/lib/scenarios";
import { DICT } from "@/lib/i18n/dict";
import { decodeState, encodeState, PERSISTED_STATE_VERSION, type PersistedState } from "@/lib/persistence";
import {
  BASIC_MODE_MAX_SAMPLES,
  DEFAULT_TILT_FAST_WINDOW,
  DEFAULT_TILT_SLOW_WINDOW,
  DEFAULT_TOURNAMENTS_PER_SESSION,
  ROI_STD_ERR_MAX,
  STANDARD_PRESETS,
  applyModelPatch,
  sanitizeControlsForBasicMode,
  withSupportedAlpha,
} from "./modelPresets";
import { tiltChannelsActive } from "./convergencePolicy";
import { compileSchedule, makeCheckpointGrid, simulateShard } from "./engine";
import { applyItmTarget } from "./itmTarget";
import { buildSimulationInput } from "@/lib/ui/simulationInput";

const baseState: ControlsState = {
  scheduleRepeats: 100,
  samples: 10_000,
  bankroll: 0,
  seed: 1,
  finishModelId: "power-law",
  alphaOverride: null,
  usePrimedopePayouts: false,
  usePrimedopeFinishModel: false,
  usePrimedopeRakeMath: false,
  compareEnabled: false,
  compareMode: "primedope",
  roiStdErr: 0.02,
  roiShockPerTourney: 0.01,
  roiShockPerSession: 0,
  roiDriftSigma: 0,
  tournamentsPerSession: DEFAULT_TOURNAMENTS_PER_SESSION,
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltFastWindow: DEFAULT_TILT_FAST_WINDOW,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  tiltSlowMinDuration: 500,
  tiltSlowRecoveryFrac: 0.5,
  tiltSlowWindow: DEFAULT_TILT_SLOW_WINDOW,
  modelPresetId: "naive",
  empiricalBuckets: undefined,
  itmGlobalEnabled: false,
  itmGlobalPct: 18.7,
  rakebackPct: 5,
  battleRoyaleLeaderboard: DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
};

describe("applyModelPatch", () => {
  it("only overwrites model fields, preserves run controls", () => {
    const patch = STANDARD_PRESETS[0].patch;
    const next = applyModelPatch(baseState, patch, "primedope");
    expect(next.scheduleRepeats).toBe(baseState.scheduleRepeats);
    expect(next.samples).toBe(baseState.samples);
    expect(next.seed).toBe(baseState.seed);
    expect(next.bankroll).toBe(baseState.bankroll);
    expect(next.modelPresetId).toBe("primedope");
    expect(next.finishModelId).toBe(patch.finishModelId);
    expect(next.roiStdErr).toBe(patch.roiStdErr);
  });
});

describe("STANDARD_PRESETS", () => {
  it("all ids are unique", () => {
    const ids = STANDARD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset produces a valid patch shape", () => {
    for (const p of STANDARD_PRESETS) {
      const next = applyModelPatch(baseState, p.patch, p.id);
      expect(typeof next.finishModelId).toBe("string");
      expect(typeof next.roiStdErr).toBe("number");
      expect(Number.isFinite(next.roiStdErr)).toBe(true);
    }
  });
});

describe("sanitizeControlsForBasicMode", () => {
  it("strips variance-profile noise from custom/basic runs", () => {
    const next = sanitizeControlsForBasicMode({
      ...baseState,
      modelPresetId: "custom",
      roiStdErr: 0.07,
      roiShockPerTourney: 0.11,
      roiShockPerSession: 0.09,
      roiDriftSigma: 0.03,
      tournamentsPerSession: 7,
      tiltFastGain: -0.25,
      tiltFastScale: 1400,
      tiltFastWindow: 0,
      tiltSlowGain: 0.05,
      tiltSlowThreshold: 4500,
      tiltSlowWindow: 7,
    });
    expect(next.roiStdErr).toBe(0);
    expect(next.roiShockPerTourney).toBe(0);
    expect(next.roiShockPerSession).toBe(0);
    expect(next.roiDriftSigma).toBe(0);
    expect(next.tournamentsPerSession).toBe(DEFAULT_TOURNAMENTS_PER_SESSION);
    expect(next.tiltFastGain).toBe(0);
    expect(next.tiltFastScale).toBe(0);
    expect(next.tiltSlowGain).toBe(0);
    expect(next.tiltSlowThreshold).toBe(0);
    expect(next.tiltFastWindow).toBe(DEFAULT_TILT_FAST_WINDOW);
    expect(next.tiltSlowWindow).toBe(DEFAULT_TILT_SLOW_WINDOW);
  });

  it("does not honour a hand-picked finish model that basic mode cannot show or change", () => {
    const naive = STANDARD_PRESETS.find((preset) => preset.id === "naive")!.patch;
    for (const finishModelId of ["uniform", "empirical", "power-law", "pko-realdata-tilt"] as const) {
      const next = sanitizeControlsForBasicMode({
        ...baseState,
        modelPresetId: "custom",
        finishModelId,
        alphaOverride: finishModelId === "pko-realdata-tilt" ? 0.2 : null,
        usePrimedopePayouts: false,
        usePrimedopeFinishModel: false,
        usePrimedopeRakeMath: false,
      });
      expect(next.modelPresetId, finishModelId).toBe("naive");
      expect(next.finishModelId, finishModelId).toBe(naive.finishModelId);
      expect(next.alphaOverride, finishModelId).toBeNull();
      expect(next.usePrimedopePayouts, finishModelId).toBe(naive.usePrimedopePayouts);
      expect(next.usePrimedopeFinishModel, finishModelId).toBe(naive.usePrimedopeFinishModel);
      expect(next.usePrimedopeRakeMath, finishModelId).toBe(naive.usePrimedopeRakeMath);
    }
  });

  it("leaves the stored state alone", () => {
    const stored = { ...baseState, modelPresetId: "custom", finishModelId: "uniform" as const };
    sanitizeControlsForBasicMode(stored);
    expect(stored.modelPresetId).toBe("custom");
    expect(stored.finishModelId).toBe("uniform");
  });

  it("drops built-in advanced presets back to naive in basic mode", () => {
    const steady = STANDARD_PRESETS.find((preset) => preset.id === "steady-reg");
    expect(steady).toBeTruthy();
    const advanced = applyModelPatch(baseState, steady!.patch, steady!.id);
    const next = sanitizeControlsForBasicMode(advanced);
    expect(next.modelPresetId).toBe("naive");
    expect(next.finishModelId).toBe(
      STANDARD_PRESETS.find((preset) => preset.id === "naive")!.patch.finishModelId,
    );
    expect(next.roiStdErr).toBe(0);
    expect(next.roiShockPerTourney).toBe(0);
    expect(next.tiltSlowGain).toBe(0);
  });
});

describe("sanitizeControlsForBasicMode and the hidden simulation count", () => {
  it("caps a stored count that basic mode has no field to lower", () => {
    const next = sanitizeControlsForBasicMode({ ...baseState, samples: 1_000_000 });
    expect(next.samples).toBe(BASIC_MODE_MAX_SAMPLES);
  });

  it("keeps a count at or under the cap, so a lighter run stays lighter", () => {
    for (const samples of [100, 2_000, BASIC_MODE_MAX_SAMPLES]) {
      expect(sanitizeControlsForBasicMode({ ...baseState, samples }).samples).toBe(samples);
    }
  });

  it("covers every demo scenario, which basic users can load", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.controls.samples, scenario.id).toBeLessThanOrEqual(BASIC_MODE_MAX_SAMPLES);
    }
  });
});

describe("withSupportedAlpha", () => {
  it("drops a hand-set alpha that the model ignores", () => {
    const next = withSupportedAlpha({ ...baseState, finishModelId: "power-law", alphaOverride: 3 });
    expect(next.alphaOverride).toBeNull();
    expect(next.finishModelId).toBe("power-law");
  });

  it("keeps the alpha of a real-data tilt model", () => {
    const state = { ...baseState, finishModelId: "pko-realdata-tilt" as const, alphaOverride: 0.2 };
    expect(withSupportedAlpha(state)).toBe(state);
  });

  it("hands back the same object when there is nothing to drop", () => {
    expect(withSupportedAlpha(baseState)).toBe(baseState);
  });
});


describe("ROI uncertainty bound", () => {
  const roiStdErrAfterDecode = (roiStdErr: number) =>
    decodeState(
      encodeState({
        v: PERSISTED_STATE_VERSION,
        schedule: [{ id: "r", label: "r", players: 500, buyIn: 10, rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", count: 1 }],
        controls: { roiStdErr },
      } as unknown as PersistedState),
    )?.controls.roiStdErr;

  it("a saved state or link above the field's bound loads at the bound", () => {
    expect(roiStdErrAfterDecode(5)).toBe(ROI_STD_ERR_MAX);
    expect(roiStdErrAfterDecode(ROI_STD_ERR_MAX + 0.01)).toBe(ROI_STD_ERR_MAX);
    expect(roiStdErrAfterDecode(0.05)).toBe(0.05);
  });

  it("every preset sits inside it", () => {
    for (const preset of STANDARD_PRESETS) {
      expect(preset.patch.roiStdErr, preset.id).toBeLessThanOrEqual(ROI_STD_ERR_MAX);
    }
  });
});

describe("tilt presets say what the hot loop does", () => {
  const patch = (id: string) => STANDARD_PRESETS.find((p) => p.id === id)!.patch;

  // The ROI shift a preset's tilt causes on one freezeout row (+10 % ROI unless given), in
  // pp of the schedule's cost: the preset against itself with both tilt gains
  // at 0, same seed, so the finishes and the noise draws are shared and only
  // the tilt differs.
  function tiltShiftPp(id: string, ticket: number, tournaments: number, samples: number, players = 1000, roi = 0.1) {
    const schedule = applyItmTarget(
      [{ id: "r", players, buyIn: ticket / 1.1, rake: 0.1, roi, payoutStructure: "mtt-standard", gameType: "freezeout", count: tournaments }],
      { enabled: false, pct: 18.7 },
    );
    const controls = applyModelPatch({ ...baseState, scheduleRepeats: 1, samples, seed: 42, rakebackPct: 20 }, patch(id), id);
    const finals = (c: ControlsState) => {
      const input = buildSimulationInput(schedule, c, true);
      const compiled = compileSchedule(input, "alpha");
      const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
      return { profits: simulateShard(input, compiled, 0, samples, grid).finalProfits, cost: compiled.totalBuyIn };
    };
    const on = finals(controls);
    const off = finals({ ...controls, tiltFastGain: 0, tiltSlowGain: 0 });
    const d = Array.from(on.profits, (p, i) => ((p - off.profits[i]) / on.cost) * 100);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
    return { mean, se: sd / Math.sqrt(d.length) };
  }
  // A quoted figure is "about" the measurement: within half a unit of its last
  // printed digit plus 3 standard errors. The seed is fixed, so the run is the
  // same every time and cannot flake; the SE term only says the quote is not
  // tuned to this seed's noise.
  const quotes = (measured: { mean: number; se: number }, quoted: number) =>
    Math.abs(measured.mean - quoted) < 0.05 + 3 * measured.se;

  it("realistic-solo: a mild fast tilt whose quoted drag the engine produces at every stake and distance", () => {
    const solo = patch("realistic-solo");
    const tagline = DICT["preset.realisticSolo.tagline"];
    expect(tagline.en).toContain(`up to ${Math.round(-solo.tiltFastGain * 100)} pp`);
    const halfDepth = Math.round((solo.tiltFastScale * Math.atanh(0.5)) / 10) * 10;
    expect(tagline.en).toContain(`about ${halfDepth} buy-ins down`);
    expect(tagline.ru).toContain(`${halfDepth} бай-инов`);
    expect(tagline.en).toContain(`best point of the last ${solo.tiltFastWindow} tournaments`);
    expect(tagline.ru).toContain(`за последние ${solo.tiltFastWindow} турниров`);
    expect(tagline.en).toContain(`session of ${solo.tournamentsPerSession} tournaments`);

    expect(tagline.en).toContain("about 0.9 pp of ROI below the expected profit over 1,000, 10,000 or 50,000 tournaments");
    expect(tagline.ru).toContain("примерно на 0,9 пп ROI — и за 1 000, и за 10 000, и за 50 000 турниров");
    const short = tiltShiftPp("realistic-solo", 55, 1000, 2000);
    const long = tiltShiftPp("realistic-solo", 55, 10_000, 200);
    const longer = tiltShiftPp("realistic-solo", 55, 50_000, 100);
    for (const run of [short, long, longer]) expect(quotes(run, -0.9)).toBe(true);
    expect(tagline.en).toContain("about 0.8 pp at 500 players and 1.2 pp at 3,000");
    expect(tagline.ru).toContain("на полях в 500 игроков это около 0,8 пп, а в 3 000 — около 1,2 пп");
    expect(quotes(tiltShiftPp("realistic-solo", 55, 10_000, 200, 500), -0.8)).toBe(true);
    expect(quotes(tiltShiftPp("realistic-solo", 55, 10_000, 200, 3000), -1.2)).toBe(true);
    // Mild: the drag stays well short of the gain's ceiling.
    expect(-longer.mean).toBeLessThan(-solo.tiltFastGain * 100 * 0.8);

    // The depths are in average buy-ins, so the same player at $5 and $530
    // loses the same share of ROI (the $55 run differs by under 0.01 pp).
    for (const ticket of [5, 530]) {
      expect(Math.abs(tiltShiftPp("realistic-solo", ticket, 1000, 2000).mean - short.mean), `$${ticket}`).toBeLessThan(0.01);
    }
  });

  it("realistic-solo: a losing player's drag stops growing with the distance", () => {
    // Against the all-time peak a -10 % player's drawdown only grows: the old
    // profile (scale 200, no window) dragged 1.73 pp over 10,000 tournaments
    // and 1.94 pp over 50,000. Over the trailing window it is 1.11 and 1.12.
    // The SE is about 0.006 pp at either distance (100 samples), so 0.05 is
    // over 5 SE of the difference, and the seed is fixed: it cannot flake.
    const ten = tiltShiftPp("realistic-solo", 55, 10_000, 100, 1000, -0.1);
    const fifty = tiltShiftPp("realistic-solo", 55, 50_000, 100, 1000, -0.1);
    expect(Math.abs(fifty.mean - ten.mean)).toBeLessThan(0.05);
    expect(-fifty.mean).toBeLessThan(1.5);
  });

  it("steady-reg: a slow tilt that fires only on long deep swings, with the field dependence it states", () => {
    const steady = patch("steady-reg");
    const tagline = DICT["preset.steadyReg.tagline"];
    const ruNumber = (n: number) => n.toLocaleString("ru-RU").replace(/\s/g, " ");
    expect(tagline.en).toContain(`After ${steady.tiltSlowMinDuration} tournaments straight more than ${steady.tiltSlowThreshold.toLocaleString("en-US")} buy-ins below your best point of the last ${steady.tiltSlowWindow.toLocaleString("en-US")} tournaments`);
    expect(tagline.ru).toContain(`глубже ${ruNumber(steady.tiltSlowThreshold)} бай-инов под лучшей точкой последних ${ruNumber(steady.tiltSlowWindow)} турниров`);
    expect(tagline.en).toContain(`drops by ${Math.round(steady.tiltSlowGain * 100)} pp until that gap is down to half`);
    expect(steady.tiltSlowRecoveryFrac).toBe(0.5);
    expect(tagline.en).toContain(`session of ${steady.tournamentsPerSession} tournaments`);

    expect(tagline.en).toContain("about 0.2 pp of ROI for the 3,000-player regular and 0.05 pp for the 1,000-player one");
    expect(tagline.ru).toContain("примерно на 0,2 пп ROI у регуляра на полях в 3 000 и на 0,05 пп — на полях в 1 000");
    const regular = tiltShiftPp("steady-reg", 55, 10_000, 1000);
    expect(Math.abs(regular.mean - 0.05)).toBeLessThan(0.005 + 3 * regular.se);
    const bigField = tiltShiftPp("steady-reg", 55, 10_000, 1000, 3000);
    expect(quotes(bigField, 0.2)).toBe(true);
    const longRun = tiltShiftPp("steady-reg", 55, 50_000, 100, 3000);
    expect(quotes(longRun, 0.2)).toBe(true);
    // Over the window every run spends about the same small share tilted, so
    // the paired shift is tight: SE 0.004 pp (1,000 players) and 0.016 pp
    // (3,000 players, 50,000 tournaments). On all-time extremes at the same
    // threshold most of a long run sits in one state that differs from run to
    // run: SE 0.077 and 0.37 pp, and both means above still pass inside them.
    expect(regular.se).toBeLessThan(0.02);
    expect(longRun.se).toBeLessThan(0.05);
    // The depth is in average buy-ins, so the stake does not move the state machine.
    const atFiftyFive = tiltShiftPp("steady-reg", 55, 10_000, 200, 3000).mean;
    for (const ticket of [5, 530]) {
      expect(Math.abs(tiltShiftPp("steady-reg", ticket, 10_000, 200, 3000).mean - atFiftyFive), `$${ticket}`).toBeLessThan(0.01);
    }
  });

  it("tiltChannelsActive follows the hot loop's gates", () => {
    const off = { tiltFastGain: 0, tiltSlowGain: 0, tiltSlowThreshold: 0, tiltSlowMinDuration: 500 };
    expect(tiltChannelsActive(off)).toBe(false);
    expect(tiltChannelsActive(patch("realistic-solo"))).toBe(true);
    expect(tiltChannelsActive(patch("steady-reg"))).toBe(true);
    expect(tiltChannelsActive(patch("naive"))).toBe(false);
    expect(tiltChannelsActive({ ...off, tiltSlowGain: 0.05 })).toBe(false);
    expect(tiltChannelsActive({ ...off, tiltSlowGain: 0.05, tiltSlowThreshold: 100, tiltSlowMinDuration: 0.5 })).toBe(false);
    // An unset streak length is the engine's 500, as noiseChannelsActive reads it.
    expect(tiltChannelsActive({ tiltSlowGain: 0.05, tiltSlowThreshold: 100 })).toBe(true);
  });

  it("a window never switches a tilt on or off, so the 'before tilt' label still mirrors the run", () => {
    const schedule = applyItmTarget(
      [{ id: "r", players: 1000, buyIn: 50, rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", gameType: "freezeout", count: 1500 }],
      { enabled: false, pct: 18.7 },
    );
    const finals = (c: ControlsState) => {
      const input = buildSimulationInput(schedule, c, true);
      const compiled = compileSchedule(input, "alpha");
      return Array.from(simulateShard(input, compiled, 0, 40, makeCheckpointGrid(compiled.tournamentsPerSample)).finalProfits);
    };
    for (const id of ["realistic-solo", "steady-reg", "naive"]) {
      for (const window of [0, 40, 400]) {
        const c = applyModelPatch({ ...baseState, scheduleRepeats: 1, samples: 40, seed: 3 }, patch(id), id);
        // Shallow and short enough that a live slow tilt fires inside 1,500 tournaments.
        const windowed = {
          ...c,
          tiltFastWindow: window,
          tiltSlowWindow: window,
          tiltSlowThreshold: c.tiltSlowThreshold && 20,
          tiltSlowMinDuration: 5,
        };
        const untilted = finals({ ...windowed, tiltFastGain: 0, tiltSlowGain: 0 });
        const moved = finals(windowed).some((p, i) => p !== untilted[i]);
        expect(moved, `${id} window ${window}`).toBe(tiltChannelsActive(windowed));
      }
    }
  });
});
