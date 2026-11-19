import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it("answers a batch of nicks in one call, one entry per nick", async () => {
    const payload = [{ gameType: { name: "BATTLE_ROYALE" }, results: [{ totalPrize: 70, totalPoints: 15698, stake: { name: "BR_10" } }] }];
    const upstream = vi.fn()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal("fetch", upstream);
    const response = await GET(new Request("http://localhost/api/resulthub/gg-br?username=a&username=b", {
      headers: { "x-forwarded-for": `10.1.0.${++caller}` },
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body.totalPrizes).toBe(70);
    expect(body.results[1]).toEqual({ status: 502, body: { error: "resulthub-bad-json" } });
  });

  it("charges a ten-nick click as one unit, so waiting the stated seconds lets it through", async () => {
    const upstream = vi.fn().mockImplementation(() => Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", upstream);
    const ip = `10.2.0.${++caller}`;
    const query = Array.from({ length: 10 }, (_, i) => `username=nick${i}`).join("&");
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const click = () => GET(new Request(`http://localhost/api/resulthub/gg-br?${query}`, { headers: { "x-forwarded-for": ip } }));
    for (let i = 0; i < 3; i++) expect((await click()).status).toBe(200);
    const calls = upstream.mock.calls.length;
    const refused = await click();
    expect(refused.status).toBe(429);
    const { retryAfterSec } = await refused.json();
    expect(retryAfterSec).toBe(20);
    expect(refused.headers.get("retry-after")).toBe("20");
    expect(upstream.mock.calls.length).toBe(calls);
    now += 1000 * (retryAfterSec - 1);
    expect((await click()).status).toBe(429);
    now += 1000;
    expect((await click()).status).toBe(200);
  });
});
