import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import type { RowBlockCause } from "@/lib/sim/validation";
import { blockedCauseKeys, rowBlockedKey } from "./rowBlockCopy";

const CAUSES: RowBlockCause[] = [
  "inconsistent-finish-locks",
  "pinned-itm",
  "pinned-shells",
  "bounty-pool",
  "fixed-shape",
  "model-saturation",
];

describe("blocked-row copy", () => {
  it("gives every cause its own sentence in both languages", () => {
    const keys = CAUSES.map(rowBlockedKey);
    expect(new Set(keys).size).toBe(CAUSES.length);
    const en = new Set(keys.map((k) => DICT[k].en));
    const ru = new Set(keys.map((k) => DICT[k].ru));
    expect(en.size).toBe(CAUSES.length);
    expect(ru.size).toBe(CAUSES.length);
  });

  it("only the shell causes talk about locked shells, and only the pool causes about the bounty pool", () => {
    for (const cause of CAUSES) {
      const en = DICT[rowBlockedKey(cause)].en.toLowerCase();
      expect(en.includes("bounty pool"), cause).toBe(cause === "bounty-pool" || cause === "fixed-shape");
      expect(en.includes("lock"), cause).toBe(cause === "inconsistent-finish-locks" || cause === "pinned-shells");
    }
  });

  it("lists each cause of a banner once, in row order", () => {
    expect(
      blockedCauseKeys([{ cause: "bounty-pool" }, { cause: "pinned-itm" }, { cause: "bounty-pool" }]),
    ).toEqual(["shape.rowBlocked.bounty-pool", "shape.rowBlocked.pinned-itm"]);
  });
});
