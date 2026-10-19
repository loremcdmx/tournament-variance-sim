import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

let caller = 0;
async function lookup(upstream: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(upstream)));
  // One bucket per call: the route rate-limits by client address.
  const response = await GET(
    new Request("http://localhost/api/resulthub/gg-br?username=nick", {
      headers: { "x-forwarded-for": `10.0.0.${++caller}` },
    }),
  );
  return { status: response.status, body: await response.json() };
}

describe("ResultHub proxy route", () => {
  it("answers 502 resulthub-bad-json when the upstream payload has changed shape", async () => {
    for (const upstream of [{ data: [] }, [{}], [{ gameType: { name: "BATTLE_ROYALE" }, results: "x" }]]) {
      const { status, body } = await lookup(upstream);
      expect(status, JSON.stringify(upstream)).toBe(502);
      expect(body).toEqual({ error: "resulthub-bad-json" });
    }
  });

  it("still answers 200 with an empty summary for a nick ResultHub has nothing on", async () => {
    const { status, body } = await lookup([]);
    expect(status).toBe(200);
    expect(body.totalPrizes).toBe(0);
    expect(body.pointsByStake).toEqual({ "0.25": 0, "1": 0, "3": 0, "10": 0, "25": 0 });
  });

  it("passes a well-formed payload through as the summary", async () => {
    const { status, body } = await lookup([
      {
        gameType: { name: "BATTLE_ROYALE" },
        results: [{ totalPrize: 70, totalPoints: 15698, stake: { name: "BR_10" } }],
      },
    ]);
    expect(status).toBe(200);
    expect(body.totalPrizes).toBe(70);
    expect(body.pointsByStake["10"]).toBe(15698);
  });
});
