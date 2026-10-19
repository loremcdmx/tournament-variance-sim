import type { ControlsState } from "@/components/ControlsPanel";
import { buildBattleRoyaleLeaderboardPromoConfig } from "@/lib/sim/battleRoyaleLeaderboardUi";
import { manualAlphaFor } from "@/lib/sim/finishModel";
import { sanitizeControlsForBasicMode } from "@/lib/sim/modelPresets";
import type { SimulationInput, TournamentRow } from "@/lib/sim/types";

/**
 * The `SimulationInput` the Run button sends: the schedule as the run sees it
 * (already through `applyItmTarget`) and the controls, sanitized for basic mode
 * unless the advanced switch is on.
 */
export function buildSimulationInput(
  schedule: TournamentRow[],
  controls: ControlsState,
  advanced: boolean,
): SimulationInput {
  const effectiveControls = advanced
    ? controls
    : sanitizeControlsForBasicMode(controls);
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
    tiltFastGain: effectiveControls.tiltFastGain,
    tiltFastScale: effectiveControls.tiltFastScale,
    tiltSlowGain: effectiveControls.tiltSlowGain,
    tiltSlowThreshold: effectiveControls.tiltSlowThreshold,
    tiltSlowMinDuration: effectiveControls.tiltSlowMinDuration,
    tiltSlowRecoveryFrac: effectiveControls.tiltSlowRecoveryFrac,
    rakebackFracOfRake: effectiveControls.rakebackPct / 100,
    battleRoyaleLeaderboardPromo: buildBattleRoyaleLeaderboardPromoConfig(
      effectiveControls.battleRoyaleLeaderboard,
      schedule,
    ),
  };
}
