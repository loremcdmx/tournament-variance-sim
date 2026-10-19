import { describe, expect, it, vi } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "./sim/types";
import { STANDARD_PRESETS, applyModelPatch } from "./sim/modelPresets";
import { applyItmTarget } from "./sim/itmTarget";
import {
  applyGameType,
  DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
  normalizeGameTypeConsistency,
} from "./sim/gameType";
import { compileSchedule } from "./sim/engine";
import { parseAdminParam } from "./ui/AdvancedModeProvider";
import { redistributeScheduleCounts } from "./sim/scheduleTarget";
import {
  addUserPreset,
  buildShareUrl,
  decodeState,
  encodeState,
  isValidUserPreset,
  loadLocal,
  loadUserPresets,
  MAX_PERSISTED_SCHEDULE_ROWS,
  MAX_SCHEDULE_ROWS,
  PERSISTED_STATE_VERSION,
  saveLocal,
  saveUserPresets,
  type PersistedState,
  type UserPreset,
} from "./persistence";

const row: TournamentRow = {
  id: "r1",
  players: 500,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
};

const controls = {} as ControlsState;

function encoded(payload: unknown): string {
  return encodeState(payload as PersistedState);
}

describe("persistence validation", () => {
  it("round-trips Ocean KO economics and strips unrelated random channels", () => {
    const ocean = { ...row, gameType: "ocean-ko", buyIn: 92, rake: 8 / 92,
      bountyFraction: 50 / 92, payoutStructure: "mtt-gg-bounty",
      mysteryBountyVariance: 2, pkoHeat: 0.4, pkoHeadVar: 0.8 };
    const state = decodeState(encoded({ v: 2, schedule: [ocean], controls }));
    const saved = state?.schedule[0];
    expect(saved).toMatchObject({ gameType: "ocean-ko", buyIn: 92, rake: 8 / 92,
      bountyFraction: 50 / 92, payoutStructure: "mtt-gg-bounty" });
    expect(saved?.mysteryBountyVariance).toBeUndefined();
    expect(saved?.pkoHeat).toBeUndefined();
    expect(saved?.pkoHeadVar).toBeUndefined();
    expect(decodeState(encodeState(state!))?.schedule[0]).toEqual(saved);
  });

  it("decodes valid persisted state", () => {
    const state = decodeState(encoded({ v: 1, schedule: [row], controls }));

    expect(state?.schedule).toHaveLength(1);
    expect(state?.controls).toBeTruthy();
  });

  it("rejects malformed share state instead of returning a crashy shape", () => {
    expect(decodeState(encoded({ v: 1, schedule: null, controls: {} }))).toBeNull();
    expect(decodeState(encoded({ v: 1, schedule: [null], controls: {} }))).toBeNull();
    expect(decodeState(encoded({ v: 1, schedule: [row], controls: null }))).toBeNull();
    expect(decodeState(encoded({ v: 3, schedule: [row], controls: {} }))).toBeNull();
  });

  it("rejects rows whose label or tags are not strings so the editor cannot crash on render", () => {
    for (const label of [{}, 5, ["a"], null]) {
      expect(
        decodeState(encoded({ v: 2, schedule: [{ ...row, label }], controls })),
        `label=${JSON.stringify(label)}`,
      ).toBeNull();
    }
    for (const tags of ["a", 5, [1], [{}], [null], {}]) {
      expect(
        decodeState(encoded({ v: 2, schedule: [{ ...row, tags }], controls })),
        `tags=${JSON.stringify(tags)}`,
      ).toBeNull();
    }
    const ok = decodeState(
      encoded({ v: 2, schedule: [{ ...row, label: "Sunday", tags: ["a", "b"] }], controls }),
    );
    expect(ok?.schedule[0]).toMatchObject({ label: "Sunday", tags: ["a", "b"] });
  });

  it("truncates a schedule over the editor cap instead of discarding the whole state", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row, id: `r${i}` }));
    const atCap = rows(MAX_SCHEDULE_ROWS);
    expect(decodeState(encoded({ v: 2, schedule: atCap, controls }))?.schedule).toHaveLength(
      MAX_SCHEDULE_ROWS,
    );
    for (const v of [1, 2]) {
      const payload = { v, schedule: rows(400), controls: { samples: 5000 } };
      for (const loaded of [decodeState(encoded(payload)), loadLocalFromPayload(payload)]) {
        expect(loaded, `v${v}`).not.toBeNull();
        expect(loaded?.v).toBe(PERSISTED_STATE_VERSION);
        expect(loaded?.schedule).toHaveLength(MAX_SCHEDULE_ROWS);
        expect(loaded?.schedule[0]?.id).toBe("r0");
        expect(loaded?.schedule[MAX_SCHEDULE_ROWS - 1]?.id).toBe(`r${MAX_SCHEDULE_ROWS - 1}`);
        expect(loaded?.controls.samples).toBe(5000);
      }
    }
  });

  it("still refuses a payload with an absurd row count so a hostile link cannot stall validation", () => {
    const huge = Array.from({ length: MAX_PERSISTED_SCHEDULE_ROWS + 1 }, (_, i) => ({
      ...row,
      id: `r${i}`,
    }));
    expect(decodeState(encoded({ v: 2, schedule: huge, controls }))).toBeNull();
    expect(loadLocalFromPayload({ v: 2, schedule: huge, controls })).toBeNull();
    expect(
      decodeState(encoded({ v: 2, schedule: huge.slice(0, MAX_PERSISTED_SCHEDULE_ROWS), controls }))
        ?.schedule,
    ).toHaveLength(MAX_SCHEDULE_ROWS);
  });

  it("keeps an over-cap saved preset visible and in storage when another preset is saved", () => {
    let stored = JSON.stringify([
      {
        id: "history",
        name: "History",
        createdAt: 1,
        state: {
          v: 1,
          schedule: Array.from({ length: 400 }, (_, i) => ({ ...row, id: `h${i}` })),
          controls,
        },
      },
      { id: "small", name: "Small", createdAt: 2, state: { v: 2, schedule: [row], controls } },
    ]);
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    try {
      expect(loadUserPresets().map((p) => p.id)).toEqual(["history", "small"]);
      addUserPreset("new", { v: 2, schedule: [row], controls });
      const after = JSON.parse(stored) as UserPreset[];
      expect(after.map((p) => p.name)).toEqual(["History", "Small", "new"]);
      expect(after[0]?.state.schedule).toHaveLength(MAX_SCHEDULE_ROWS);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("survives load then autosave without wiping an over-cap saved schedule", () => {
    let stored = JSON.stringify({
      v: 2,
      schedule: Array.from({ length: 450 }, (_, i) => ({ ...row, id: `r${i}` })),
      controls,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    try {
      const loaded = loadLocal();
      expect(loaded).not.toBeNull();
      saveLocal(loaded!);
      expect(JSON.parse(stored).schedule).toHaveLength(MAX_SCHEDULE_ROWS);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("writes the current schema version and upgrades legacy payloads on read", () => {
    expect(PERSISTED_STATE_VERSION).toBe(2);
    const state: PersistedState = { v: PERSISTED_STATE_VERSION, schedule: [row], controls };
    expect(JSON.parse(JSON.stringify(state)).v).toBe(2);
    expect(decodeState(encodeState(state))).toEqual(state);
    expect(decodeState(encoded({ v: 1, schedule: [row], controls }))?.v).toBe(2);
  });

  it("clamps unsafe persisted row counts without imposing the direct-entry cap", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [{ ...row, count: 1e308 }],
        controls: { ...controls, samples: 1_000_000_000 },
      }),
    );

    expect(state?.schedule[0]?.count).toBe(Number.MAX_SAFE_INTEGER);
    expect(state?.controls.samples).toBe(1_000_000);
  });

  it("preserves a redistributed 400k tournament distance through share and local loading", () => {
    const schedule = redistributeScheduleCounts([row, { ...row, id: "r2", count: 3 }], 400_000);
    const payload = { v: PERSISTED_STATE_VERSION, schedule, controls: { scheduleRepeats: 1 } };
    for (const loaded of [decodeState(encoded(payload)), loadLocalFromPayload(payload)]) {
      expect(loaded?.schedule.map((entry) => entry.count)).toEqual([100001, 299999]);
      expect(loaded?.schedule.reduce((sum, entry) => sum + entry.count, 0)).toBe(400_000);
    }
  });

  it("keeps a cleared global ITM at equilibrium through persistence", () => {
    const config = { itmGlobalEnabled: true, itmGlobalPct: 0 };
    const loaded = decodeState(encoded({ v: PERSISTED_STATE_VERSION, schedule: [row], controls: config }))!;
    const before = applyItmTarget([row], { enabled: true, pct: 0 });
    const after = applyItmTarget(loaded.schedule, {
      enabled: loaded.controls.itmGlobalEnabled, pct: loaded.controls.itmGlobalPct,
    });
    expect(loaded.controls.itmGlobalPct).toBe(0);
    expect(after[0].itmRate).toBe(before[0].itmRate);
    expect(after[0].itmRate).toBeGreaterThan(0.005);
  });

  it("preserves every visible preset and its hand-tuned descendant", () => {
    for (const preset of STANDARD_PRESETS) {
      for (const id of [preset.id, "custom"]) {
        const selected = applyModelPatch(controls, preset.patch, id);
        const loaded = decodeState(encoded({ v: PERSISTED_STATE_VERSION, schedule: [row], controls: selected }));
        expect(loaded?.controls, `${preset.id} as ${id}`).toEqual(selected);
      }
    }
  });

  it("repairs a named preset from an older save that omitted its hidden profile", () => {
    const preset = STANDARD_PRESETS.find((entry) => entry.id === "realistic-solo")!;
    const loaded = loadLocalFromPayload({ v: 2, schedule: [row], controls: { modelPresetId: preset.id } });
    expect(loaded?.controls).toMatchObject({
      roiShockPerTourney: 0.3, roiShockPerSession: 0.05, roiDriftSigma: 0.01,
      tiltFastGain: -0.15, tiltFastScale: 2500,
    });
  });

  it.each([{}, [], 123, null])("drops a non-string modelPresetId %j before rendering", (modelPresetId) => {
    const loaded = decodeState(encoded({ v: 2, schedule: [row], controls: { modelPresetId } }));
    expect(loaded?.controls.modelPresetId).toBeUndefined();
  });

  it("clamps oversized persisted field sizes back to the editor max", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [{ ...row, players: 20_000_000 }],
        controls,
      }),
    );

    expect(state?.schedule[0]?.players).toBe(1_000_000);
  });

  it("clamps persisted rake back into the engine's [0,1] contract", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "high", rake: 100 },
          { ...row, id: "low", rake: -5 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.rake).toBe(1);
    expect(state?.schedule[1]?.rake).toBe(0);
  });

  it("clamps persisted ROI back into the editor range to avoid infinite EV targets", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "hi", roi: 1e308 },
          { ...row, id: "lo", roi: -5 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.roi).toBe(100);
    expect(state?.schedule[1]?.roi).toBe(-0.99);
  });

  it("raises non-positive persisted buy-ins to a minimal positive ticket", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          { ...row, id: "neg", buyIn: -5 },
          { ...row, id: "zero", buyIn: 0 },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.buyIn).toBe(0.01);
    expect(state?.schedule[1]?.buyIn).toBe(0.01);
  });

  it("drops malformed persisted custom payout arrays instead of keeping a fake zero-payout custom row", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            payoutStructure: "custom",
            customPayouts: ["oops"],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-standard");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("promotes legacy Battle Royale payout rows to canonical 18-max Mystery Royale", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 500,
            payoutStructure: "battle-royale",
            gameType: "oops",
            fieldVariability: { kind: "uniform", min: 100, max: 900, buckets: 5 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.gameType).toBe("mystery-royale");
    expect(state?.schedule[0]?.payoutStructure).toBe("battle-royale");
    expect(state?.schedule[0]?.players).toBe(18);
    expect(state?.schedule[0]?.fieldVariability).toBeUndefined();
  });

  it("repairs invalid persisted payoutStructure from a valid explicit gameType", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "mystery",
            payoutStructure: "oops",
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.gameType).toBe("mystery");
    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-gg-mystery");
  });

  it("repairs persisted Battle Royale split-brain before hydration", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "mystery",
            payoutStructure: "battle-royale",
          },
          {
            ...row,
            id: "br",
            players: 36,
            gameType: "mystery-royale",
            payoutStructure: "mtt-standard",
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "mystery",
      payoutStructure: "mtt-gg-mystery",
      players: 500,
    });
    expect(state?.schedule[1]).toMatchObject({
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      players: 18,
    });
  });

  it("drops zero-sum persisted custom payout arrays instead of simulating a no-prize tournament", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            payoutStructure: "custom",
            customPayouts: [0, 0, 0],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-standard");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("trims persisted legacy custom payout tails that exceed the field size", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 3,
            payoutStructure: "custom",
            customPayouts: [50, 30, 20, 10],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.customPayouts).toEqual([50, 30, 20]);
  });

  it("drops hidden custom payout arrays on non-custom rows before they can skew paid-place logic", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 100,
            payoutStructure: "mtt-primedope",
            customPayouts: [50, 30, 20],
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.payoutStructure).toBe("mtt-primedope");
    expect(state?.schedule[0]?.customPayouts).toBeUndefined();
  });

  it("drops hidden bounty knobs when persisted gameType is explicit freezeout", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            gameType: "freezeout",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            pkoHeadVar: 0.4,
            pkoHeat: 1.2,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "freezeout",
      bountyFraction: undefined,
      mysteryBountyVariance: undefined,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("restores required engine knobs for persisted explicit non-freezeout game types", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            id: "pko",
            gameType: "pko",
          },
          {
            ...row,
            id: "mystery",
            gameType: "mystery",
            pkoHeadVar: 0.9,
            pkoHeat: 1.1,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      gameType: "pko",
      bountyFraction: 0.5,
      pkoHeadVar: 0.4,
    });
    expect(state?.schedule[1]).toMatchObject({
      gameType: "mystery",
      bountyFraction: 0.5,
      mysteryBountyVariance: 2,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("migrates the v1 Battle Royale default bounty share from 50% to 45% but keeps an explicit v2 50%", () => {
    const brRow = {
      ...row,
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      bountyFraction: 0.5,
      mysteryBountyVariance: 1.8,
      players: 18,
    };

    expect(
      decodeState(encoded({ v: 1, schedule: [brRow], controls }))?.schedule[0],
    ).toMatchObject({
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      bountyFraction: DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
    });
    expect(
      decodeState(encoded({ v: 2, schedule: [brRow], controls }))?.schedule[0],
    ).toMatchObject({ bountyFraction: 0.5 });
    expect(
      decodeState(encoded({ v: 2, schedule: [{ ...brRow, bountyFraction: undefined }], controls }))
        ?.schedule[0],
    ).toMatchObject({ bountyFraction: DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION });
  });

  it("clamps persisted row knobs back into the engine/UI contract before hydration", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            itmRate: 5,
            bountyFraction: 5,
            payJumpAggression: -1,
            mysteryBountyVariance: -3,
            pkoHeadVar: -4,
            pkoHeat: 10,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      itmRate: 1,
      bountyFraction: 0.9,
      payJumpAggression: 0,
      mysteryBountyVariance: 0,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("drops non-boolean persisted sit-through flags so string values cannot silently enable the transform", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            sitThroughPayJumps: "false",
            payJumpAggression: 0.8,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.sitThroughPayJumps).toBeUndefined();
    expect(state?.schedule[0]?.payJumpAggression).toBe(0.8);
  });


  it("drops hidden persisted row knobs that are no longer user-visible", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            players: 500,
            guarantee: 1_000_000,
            lateRegMultiplier: 1_000_000_000,
            bountyFraction: 0.5,
            bountyEvBias: 999,
            itmRate: 0.18,
            itmTopHeavyBias: -999,
            pkoHeadVar: 9,
            pkoHeat: 9,
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]).toMatchObject({
      lateRegMultiplier: undefined,
      guarantee: 1_000_000,
      bountyEvBias: 0.25,
      itmTopHeavyBias: -1,
      pkoHeadVar: undefined,
      pkoHeat: undefined,
    });
  });

  it("round-trips the row guarantee the demo scenarios rely on", () => {
    const state: PersistedState = {
      v: PERSISTED_STATE_VERSION,
      schedule: [
        { ...row, id: "g", guarantee: 50_000 },
        { ...row, id: "none" },
      ],
      controls,
    };

    const decoded = decodeState(encodeState(state));
    expect(decoded?.schedule[0]?.guarantee).toBe(50_000);
    expect(decoded?.schedule[1]?.guarantee).toBeUndefined();
    expect(loadLocalFromPayload(state)?.schedule[0]?.guarantee).toBe(50_000);
  });

  it("clamps negative persisted guarantees to zero and drops non-finite ones", () => {
    const state = decodeState(
      encoded({
        v: 2,
        schedule: [
          { ...row, id: "neg", guarantee: -5 },
          { ...row, id: "str", guarantee: "1e6" },
          { ...row, id: "nan", guarantee: Number.NaN },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.guarantee).toBe(0);
    expect(state?.schedule[1]?.guarantee).toBeUndefined();
    expect(state?.schedule[2]?.guarantee).toBeUndefined();
  });

  it("drops malformed persisted finish-bucket locks instead of hydrating impossible shell constraints", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            itmRate: 0.16,
            finishBuckets: { first: 5, top3: 0.1 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.finishBuckets).toBeUndefined();
  });

  it("drops stale persisted finish-bucket locks when itmRate is absent", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            finishBuckets: { first: 0.01 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.finishBuckets).toBeUndefined();
  });

  it("clamps persisted field-variability ranges and bucket counts back to editor limits", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            fieldVariability: {
              kind: "uniform",
              min: 100,
              max: 20_000_000,
              buckets: 200,
            },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.fieldVariability).toEqual({
      kind: "uniform",
      min: 100,
      max: 1_000_000,
      buckets: 20,
    });
  });

  it("drops malformed persisted field-variability objects before they reach engine compile", () => {
    const state = decodeState(
      encoded({
        v: 1,
        schedule: [
          {
            ...row,
            fieldVariability: { kind: "uniform", min: "oops", max: 5000 },
          },
        ],
        controls,
      }),
    );

    expect(state?.schedule[0]?.fieldVariability).toBeUndefined();
  });

  it("drops non-numeric persisted run controls so defaults can win on hydration", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: { samples: "oops", scheduleRepeats: "bad", bankroll: 500 },
    });

    expect((state?.controls as unknown as Record<string, unknown>).samples).toBeUndefined();
    expect((state?.controls as unknown as Record<string, unknown>).scheduleRepeats).toBeUndefined();
    expect(state?.controls.bankroll).toBe(500);
  });

  it("drops malformed persisted control enums and strings before they can crash the UI", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        finishModelId: "oops",
        compareMode: "oops",
        alphaOverride: "oops",
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.finishModelId).toBeUndefined();
    expect(loaded.compareMode).toBeUndefined();
    expect(loaded.alphaOverride).toBeUndefined();
  });

  it("does not revive a hand-set alpha for a model that has no alpha field", () => {
    const withAlpha = (controls: Record<string, unknown>) =>
      decodeState(
        encoded({ v: PERSISTED_STATE_VERSION, schedule: [row], controls }),
      )?.controls as unknown as Record<string, unknown>;

    for (const finishModelId of [
      "power-law",
      "linear-skill",
      "stretched-exp",
      "plackett-luce",
      "powerlaw-realdata-influenced",
      "uniform",
      "freeze-realdata-linear",
    ]) {
      expect(withAlpha({ finishModelId, alphaOverride: 3 }).alphaOverride).toBeNull();
    }
    // An id that fails validation falls back to the default model, which has none.
    expect(withAlpha({ finishModelId: "oops", alphaOverride: 3 }).alphaOverride).toBeNull();
    expect(withAlpha({ alphaOverride: 3 }).alphaOverride).toBeNull();
  });

  it("keeps the alpha of the three real-data tilt models", () => {
    for (const finishModelId of [
      "freeze-realdata-tilt",
      "pko-realdata-tilt",
      "mystery-realdata-tilt",
    ]) {
      const state = decodeState(
        encoded({
          v: PERSISTED_STATE_VERSION,
          schedule: [row],
          controls: { finishModelId, alphaOverride: 0.2 },
        }),
      );
      expect(state?.controls.alphaOverride).toBe(0.2);
      expect(state?.controls.finishModelId).toBe(finishModelId);
    }
  });

  it("drops malformed persisted empirical buckets and non-boolean flags", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        finishModelId: "empirical",
        empiricalBuckets: ["oops"],
        usePrimedopePayouts: 1,
        usePrimedopeFinishModel: "true",
        usePrimedopeRakeMath: "true",
        compareEnabled: "true",
        itmGlobalEnabled: "true",
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.empiricalBuckets).toBeUndefined();
    expect(loaded.usePrimedopePayouts).toBeUndefined();
    expect(loaded.usePrimedopeFinishModel).toBeUndefined();
    expect(loaded.usePrimedopeRakeMath).toBeUndefined();
    expect(loaded.compareEnabled).toBeUndefined();
    expect(loaded.itmGlobalEnabled).toBeUndefined();
  });

  it("normalizes persisted observed BR leaderboard controls", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        battleRoyaleLeaderboard: {
          mode: "observed",
          observedTotalPrizes: -100,
          observedTotalTournaments: 1234.9,
          observedPointsByStake: {
            "0.25": -1,
            "1": 80,
            "3": "bad",
            "10": 120,
            "25": null,
          },
        },
      },
    });

    expect(state?.controls.battleRoyaleLeaderboard).toMatchObject({
      mode: "observed",
      observedTotalPrizes: 0,
      observedTotalTournaments: 1234,
      observedPointsByStake: {
        "0.25": 0,
        "1": 80,
        "3": 0,
        "10": 120,
        "25": 0,
      },
    });
  });

  it("normalizes persisted manual BR leaderboard planning controls", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        battleRoyaleLeaderboard: {
          mode: "manual",
          manualPayoutPerTournament: -1,
          observedTotalPrizes: 100,
          observedTotalTournaments: 10,
          observedPointsByStake: {
            "0.25": 1,
            "1": 2,
            "3": 3,
            "10": 4,
            "25": 5,
          },
        },
      },
    });

    expect(state?.controls.battleRoyaleLeaderboard).toMatchObject({
      mode: "manual",
      manualPayoutPerTournament: 0,
    });
  });

  it("drops persisted BR row leaderboard split on all rows", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [
        {
          ...row,
          id: "br-row",
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          battleRoyaleLeaderboardEnabled: true,
          battleRoyaleLeaderboardShare: 2,
        },
        {
          ...row,
          id: "freeze-row",
          battleRoyaleLeaderboardEnabled: true,
          battleRoyaleLeaderboardShare: 0.5,
        },
      ],
      controls: {},
    });

    expect(state?.schedule[0].battleRoyaleLeaderboardEnabled).toBeUndefined();
    expect(state?.schedule[0].battleRoyaleLeaderboardShare).toBeUndefined();
    expect(state?.schedule[1].battleRoyaleLeaderboardEnabled).toBeUndefined();
    expect(state?.schedule[1].battleRoyaleLeaderboardShare).toBeUndefined();
  });

  it("drops hidden persisted shock and tilt knobs so invisible state cannot silently alter runs", () => {
    const state = loadLocalFromPayload({
      v: 1,
      schedule: [row],
      controls: {
        roiShockPerTourney: 0.25,
        roiShockPerSession: 0.5,
        roiDriftSigma: 0.1,
        tiltFastGain: 0.8,
        tiltFastScale: 100,
        tiltSlowGain: 0.5,
        tiltSlowThreshold: 200,
        tiltSlowMinDuration: 20,
        tiltSlowRecoveryFrac: 0.75,
      },
    });

    const loaded = state?.controls as unknown as Record<string, unknown>;
    expect(loaded.roiShockPerTourney).toBeUndefined();
    expect(loaded.roiShockPerSession).toBeUndefined();
    expect(loaded.roiDriftSigma).toBeUndefined();
    expect(loaded.tiltFastGain).toBeUndefined();
    expect(loaded.tiltFastScale).toBeUndefined();
    expect(loaded.tiltSlowGain).toBeUndefined();
    expect(loaded.tiltSlowThreshold).toBeUndefined();
    expect(loaded.tiltSlowMinDuration).toBeUndefined();
    expect(loaded.tiltSlowRecoveryFrac).toBeUndefined();
  });

  it("ignores malformed localStorage state", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ v: 1, schedule: null, controls: {} }),
    });

    expect(loadLocal()).toBeNull();

    vi.unstubAllGlobals();
  });

  it("filters malformed user presets before they can reach UI state", () => {
    let stored = "";
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });

    const good: UserPreset = {
      id: "good",
      name: "Good",
      createdAt: 1,
      state: { v: PERSISTED_STATE_VERSION, schedule: [row], controls },
    };
    const bad = {
      id: "bad",
      name: "Bad",
      createdAt: 2,
      state: { v: 1, schedule: null, controls: {} },
    } as unknown as UserPreset;

    expect(isValidUserPreset(good)).toBe(true);
    expect(isValidUserPreset(bad)).toBe(false);

    saveUserPresets([good, bad]);

    expect(loadUserPresets()).toEqual([good]);

    vi.unstubAllGlobals();
  });

  it("preserves safe large row counts inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big",
            name: "Big",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [{ ...row, count: 1_000_000_000 }],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.count).toBe(1_000_000_000);

    vi.unstubAllGlobals();
  });

  it("normalizes oversized field sizes inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big-field",
            name: "Big field",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [{ ...row, players: 20_000_000 }],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.players).toBe(1_000_000);

    vi.unstubAllGlobals();
  });

  it("normalizes oversized field-variability ranges inside saved user presets", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          {
            id: "big-range",
            name: "Big range",
            createdAt: 1,
            state: {
              v: 1,
              schedule: [
                {
                  ...row,
                  fieldVariability: {
                    kind: "uniform",
                    min: 100,
                    max: 20_000_000,
                    buckets: 200,
                  },
                },
              ],
              controls,
            },
          },
        ]),
    });

    const presets = loadUserPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.state.schedule[0]?.fieldVariability).toEqual({
      kind: "uniform",
      min: 100,
      max: 1_000_000,
      buckets: 20,
    });

    vi.unstubAllGlobals();
  });
});

function loadLocalFromPayload(payload: unknown) {
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify(payload),
  });
  const loaded = loadLocal();
  vi.unstubAllGlobals();
  return loaded;
}

describe("a row switched to Battle Royale plays the same before and after a reload", () => {
  it("compiles identically in the session and from a share link", () => {
    const ranged: TournamentRow = {
      ...row,
      players: 500,
      gameType: "freezeout",
      fieldVariability: { kind: "uniform", min: 300, max: 700, buckets: 5 },
    };
    const inSession = normalizeGameTypeConsistency({ ...ranged, ...applyGameType(ranged, "mystery-royale") });
    const reloaded = decodeState(encoded({ v: 2, schedule: [inSession], controls }))!.schedule[0];
    const compile = (r: TournamentRow) =>
      compileSchedule(
        { schedule: applyItmTarget([r], { enabled: false, pct: 0 }), scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: { id: "power-law" } },
        "alpha",
      );
    expect(inSession.fieldVariability).toBeUndefined();
    expect(compile(inSession).flat).toEqual(compile(reloaded).flat);
    expect(compile(inSession).flat[0].fieldSize).toBe(18);
  });
});

describe("buildShareUrl", () => {
  const state: PersistedState = { v: PERSISTED_STATE_VERSION, schedule: [row], controls };

  function shareFrom(href: string): URL {
    vi.stubGlobal("window", { location: new URL(href) });
    try {
      return new URL(buildShareUrl(state));
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("does not carry the sender's ?admin=1 to the recipient", () => {
    for (const href of [
      "https://host.test/?admin=1",
      "https://host.test/?foo=1&admin=1",
      "https://host.test/?admin=1#s=old",
    ]) {
      const link = shareFrom(href);
      expect(link.search, href).toBe("");
      expect(parseAdminParam(link.search), href).toBe(false);
      expect(link.origin).toBe("https://host.test");
    }
  });

  it("keeps the path and puts the encoded state in the hash that decodeState reads back", () => {
    const link = shareFrom("https://host.test/app/?admin=1#s=old");
    expect(link.pathname).toBe("/app/");
    expect(link.hash.startsWith("#s=")).toBe(true);
    expect(decodeState(link.hash.slice(3))?.schedule[0]?.buyIn).toBe(50);
  });
});
