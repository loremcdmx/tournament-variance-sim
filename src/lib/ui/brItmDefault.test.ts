import { describe, expect, it } from "vitest";

import { applyGameType } from "@/lib/sim/gameType";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import type { TournamentRow } from "@/lib/sim/types";
import {
  BR_GLOBAL_ITM_PCT,
  brItmOnEnter,
  brItmOnLeave,
  type ItmTargetControls,
} from "./brItmDefault";
import { newScheduleRow, patchRow } from "./scheduleOps";

const GENERIC_PCT = 18.7;
const FRESH: ItmTargetControls = { itmGlobalEnabled: false, itmGlobalPct: GENERIC_PCT };

describe("the Battle Royale ITM target the app sets", () => {
  it("is set on entering pure BR while the percent is the generic default", () => {
    expect(brItmOnEnter(FRESH, GENERIC_PCT)).toEqual({
      itmGlobalEnabled: true,
      itmGlobalPct: BR_GLOBAL_ITM_PCT,
    });
    expect(brItmOnEnter({ itmGlobalEnabled: true, itmGlobalPct: 25 }, GENERIC_PCT)).toBeNull();
  });

  it("is undone on leaving BR, back to what it replaced", () => {
    const written = brItmOnEnter(FRESH, GENERIC_PCT)!;
    expect(brItmOnLeave(written, FRESH)).toEqual(FRESH);
    const tickedBefore = { itmGlobalEnabled: true, itmGlobalPct: GENERIC_PCT };
    expect(brItmOnLeave(brItmOnEnter(tickedBefore, GENERIC_PCT)!, tickedBefore)).toEqual(
      tickedBefore,
    );
  });

  it("stays when the user changed the target while in BR", () => {
    expect(brItmOnLeave({ itmGlobalEnabled: true, itmGlobalPct: 22 }, FRESH)).toBeNull();
    expect(brItmOnLeave({ itmGlobalEnabled: false, itmGlobalPct: 20 }, FRESH)).toBeNull();
  });

  // GG BR then PKO at 1500 players must run at the PKO table's paid share, the
  // ITM a row that went straight to PKO gets, not at the BR 20 %.
  it("gives a row that left BR the same ITM as one that never visited it", () => {
    const row = newScheduleRow("r");
    const visible = { players: 1500, buyIn: 20, roi: 0.1 };
    let viaBr: TournamentRow[] = [row];
    viaBr = patchRow(viaBr, "r", applyGameType(viaBr[0], "mystery-royale"));
    viaBr = patchRow(viaBr, "r", applyGameType(viaBr[0], "pko"));
    viaBr = patchRow(viaBr, "r", visible);
    let direct: TournamentRow[] = [row];
    direct = patchRow(direct, "r", applyGameType(direct[0], "pko"));
    direct = patchRow(direct, "r", visible);

    const written = { ...FRESH, ...brItmOnEnter(FRESH, GENERIC_PCT)! };
    const restored = { ...written, ...brItmOnLeave(written, FRESH)! };
    const cfg = (c: ItmTargetControls) => ({ enabled: c.itmGlobalEnabled, pct: c.itmGlobalPct });
    const expected = applyItmTarget(direct, cfg(FRESH))[0].itmRate;

    expect(expected).toBeCloseTo(172 / 1500, 12);
    expect(applyItmTarget(viaBr, cfg(restored))[0].itmRate).toBe(expected);
    expect(applyItmTarget(viaBr, cfg(written))[0].itmRate).toBe(0.2);
  });
});
