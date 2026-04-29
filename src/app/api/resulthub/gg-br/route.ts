import { NextResponse } from "next/server";

import {
  RESULTHUB_GG_BR_BASE,
  allTimeBrLeaderboardWindow,
  parseGgBrStakeResponse,
  sanitizeUsernameForLookup,
} from "@/lib/sim/resulthubLookup";

// Server-side proxy for the ResultHub GG Battle Royale per-stake aggregate.
// Lives on our origin so the browser can call it without tripping resulthub's
// CORS lock (verified 2026-04: Origin header from non-resulthub.org → 403).
//
// No process-local caching. Vercel functions are short-lived enough that a
// per-instance Map cache barely warms up, and on the rare hit it instead
// makes the user feel like "click twice → nothing changed" (a stuck cached
// response from before a code change can outlive an instance and survive a
// click). Resulthub answers in ~300 ms; just go upstream every time.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUsername = searchParams.get("username") ?? "";
  const username = sanitizeUsernameForLookup(rawUsername);
  if (!username) {
    return NextResponse.json(
      { error: "username required" },
      { status: 400 },
    );
  }

  const window = allTimeBrLeaderboardWindow();
  const upstream = new URL(
    `${RESULTHUB_GG_BR_BASE}/aggregate/result/player/game-type/stake`,
  );
  upstream.searchParams.set("name", username);
  upstream.searchParams.set("gameType", "BATTLE_ROYALE");
  upstream.searchParams.set("from", window.from);
  upstream.searchParams.set("to", window.to);

  let response: Response;
  try {
    response = await fetch(upstream, {
      // Belt-and-suspenders: keep upstream from caching by intermediaries
      // and identify ourselves so resulthub can throttle us cleanly if needed.
      headers: {
        accept: "application/json",
        "user-agent": "tournament-variance-sim/0.7 (+https://tournament-variance-sim.vercel.app)",
      },
      // Next.js gives fetch a default cache; opt out — we want every hit
      // to roundtrip upstream so a fresh click reflects fresh data.
      cache: "no-store",
      // 12s upper bound — resulthub usually answers in ~300ms.
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "timeout"
        : "network";
    return NextResponse.json(
      { error: "resulthub-unreachable", reason },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "resulthub-bad-status", status: response.status },
      { status: 502 },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json(
      { error: "resulthub-bad-json" },
      { status: 502 },
    );
  }

  const summary = parseGgBrStakeResponse(json, window);
  return NextResponse.json(summary, {
    headers: {
      // Browser / CDN caches must not stash this — every click should
      // be a fresh roundtrip. `force-dynamic` already does this on the
      // Vercel side, the explicit header covers intermediaries.
      "cache-control": "no-store, max-age=0",
    },
  });
}

export const dynamic = "force-dynamic";
