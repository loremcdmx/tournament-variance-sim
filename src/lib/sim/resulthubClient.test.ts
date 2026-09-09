import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResulthubGgBr, fetchResulthubGgBrMany } from "./resulthubClient";
import { mergeResulthubSummary } from "./resulthubControls";
import { SCENARIOS } from "../scenarios";

const summary = {
  totalPrizes: 100,
  pointsByStake: { "0.25": 0, "1": 0, "3": 2000, "10": 0, "25": 0 },
  window: { from: "2020-01-01", to: "2026-09-09" },
};
afterEach(() => vi.unstubAllGlobals());

describe("ResultHub client", () => {
  it("keeps a batch atomic when one nickname is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(summary))
      .mockResolvedValueOnce(Response.json({ error: "rate-limited", retryAfterSec: 12 }, { status: 429 })));
    await expect(fetchResulthubGgBrMany(["current", "previous"]))
      .rejects.toMatchObject({ code: "rate-limited", retryAfterSec: 12 });
  });

  it("does not write a successful subset when another nickname has no data", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(summary))
      .mockResolvedValueOnce(Response.json({ ...summary, totalPrizes: 0, pointsByStake: {} })));
    await expect(fetchResulthubGgBrMany(["current", "misspelled"]))
      .rejects.toMatchObject({ code: "incomplete" });
  });

  it("sums the complete batch and uses the proxy timeout reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json(summary))));
    const result = await fetchResulthubGgBrMany(["current", "previous"]);
    expect(result.totalPrizes).toBe(200);
    expect(result.pointsByStake["3"]).toBe(4000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "resulthub-unreachable", reason: "timeout" }, { status: 502 })));
    await expect(fetchResulthubGgBr("current")).rejects.toMatchObject({ code: "timeout" });
  });

  it("applies fetched totals to the latest controls and rejects a changed nickname set", () => {
    const latest = {
      ...SCENARIOS[0].controls,
      samples: 12300,
      bankroll: 234,
      battleRoyaleLeaderboard: {
        ...SCENARIOS[0].controls.battleRoyaleLeaderboard,
        observedResultHubUsernames: ["current"],
        observedTotalTournaments: 7654,
      },
    };
    const merged = mergeResulthubSummary(latest, ["current"], summary)!;
    expect(merged).toMatchObject({ samples: 12300, bankroll: 234,
      battleRoyaleLeaderboard: { observedTotalTournaments: 7654, observedTotalPrizes: 100 } });
    expect(mergeResulthubSummary(latest, ["previous"], summary)).toBeNull();
  });
});
