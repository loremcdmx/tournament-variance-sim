import type { ControlsState } from "@/components/ControlsPanel";
import { buildBattleRoyaleLeaderboardPromoConfig } from "@/lib/sim/battleRoyaleLeaderboardUi";
import { manualAlphaFor } from "@/lib/sim/finishModel";
import { sanitizeControlsForBasicMode } from "@/lib/sim/modelPresets";
import type { SimulationInput, TournamentRow } from "@/lib/sim/types";

/**
 * The average buy-in (ABI) the tilt units are counted in: the mean full ticket
 * (buy-in plus rake) over the tournaments of one pass, each row counted the
 * way the engine counts it.
 */
function averageTicket(schedule: readonly TournamentRow[]): number {
  let entries = 0;
  let cost = 0;
  for (const row of schedule) {
    const count = Math.max(1, Math.floor(row.count));
    entries += count;
    cost += count * row.buyIn * (1 + row.rake);
  }
  return entries > 0 ? cost / entries : 0;
}

/**
 * The `SimulationInput` the Run button sends: the schedule as the run sees it
 * (already through `applyItmTarget`) and the controls, sanitized for basic mode
 * unless the advanced switch is on. The two tilt depths are stored in average
 * buy-ins and leave here in dollars, the engine's unit.
 */
export function buildSimulationInput(
  schedule: TournamentRow[],
  controls: ControlsState,
  advanced: boolean,
): SimulationInput {
  const effectiveControls = advanced
    ? controls
    : sanitizeControlsForBasicMode(controls);
  const abi = averageTicket(schedule);
  return {
    schedule,
    scheduleRepeats: effectiveControls.scheduleRepeats,
    samples: effectiveControls.samples,
    bankroll: effectiveControls.bankroll,
    seed: effectiveControls.seed >>> 0,
    finishModel: {
      id: effectiveControls.finishModelId,
      alpha: manualAlphaFor(
        effectiveControls.finishModelId,
        effectiveControls.alphaOverride,
      ),
      empiricalBuckets:
        effectiveControls.finishModelId === "empirical"
          ? effectiveControls.empiricalBuckets
          : undefined,
    },
    usePrimedopePayouts: effectiveControls.usePrimedopePayouts,
    usePrimedopeFinishModel: effectiveControls.usePrimedopeFinishModel,
    usePrimedopeRakeMath: effectiveControls.usePrimedopeRakeMath,
    compareMode: effectiveControls.compareEnabled
      ? effectiveControls.compareMode
      : undefined,
    modelPresetId: effectiveControls.modelPresetId,
    roiStdErr: effectiveControls.roiStdErr,
    roiShockPerTourney: effectiveControls.roiShockPerTourney,
    roiShockPerSession: effectiveControls.roiShockPerSession,
    roiDriftSigma: effectiveControls.roiDriftSigma,
    tournamentsPerSession: effectiveControls.tournamentsPerSession,
    tiltFastGain: effectiveControls.tiltFastGain,
    tiltFastScale: effectiveControls.tiltFastScale * abi,
    tiltFastWindow: effectiveControls.tiltFastWindow,
    tiltSlowGain: effectiveControls.tiltSlowGain,
    tiltSlowThreshold: effectiveControls.tiltSlowThreshold * abi,
    tiltSlowMinDuration: effectiveControls.tiltSlowMinDuration,
    tiltSlowRecoveryFrac: effectiveControls.tiltSlowRecoveryFrac,
    tiltSlowWindow: effectiveControls.tiltSlowWindow,
    rakebackFracOfRake: effectiveControls.rakebackPct / 100,
    battleRoyaleLeaderboardPromo: buildBattleRoyaleLeaderboardPromoConfig(
      effectiveControls.battleRoyaleLeaderboard,
      schedule,
    ),
  };
}
