import { NextResponse } from "next/server";

import {
  RESULTHUB_GG_BR_BASE,
  allTimeBrLeaderboardWindow,
  parseGgBrStakeResponse,
  sanitizeUsernameForLookup,
} from "@/lib/sim/resulthubLookup";
import { TokenBucketLimiter } from "@/lib/rateLimit";
import { OBSERVED_USERNAMES_MAX_COUNT } from "@/lib/sim/battleRoyaleLeaderboardUi";

// Server-side proxy for the ResultHub GG Battle Royale per-stake aggregate.
// Lives on our origin so the browser can call it without tripping resulthub's
// CORS lock (verified 2026-04: Origin header from non-resulthub.org → 403).
//
// No process-local caching. Vercel functions are short-lived enough that a
// per-instance Map cache barely warms up, and on the rare hit it instead
// makes the user feel like "click twice → nothing changed" (a stuck cached
// response from before a code change can outlive an instance and survive a
// click). Resulthub answers in ~300 ms; just go upstream every time.
//
// A click asks for every saved nick (up to 10) in one call, repeated
// `username` params, and is charged one token per nick all at once: a refused
// click spends nothing and its Retry-After lets the whole click through.
// The per-IP budget is sized for a few honest clicks a minute, not one.

const RATE_LIMIT_PER_MINUTE = 30;
const limiter = new TokenBucketLimiter(RATE_LIMIT_PER_MINUTE, RATE_LIMIT_PER_MINUTE);
const NO_STORE = {
  // Browser / CDN caches must not stash this — every click should
  // be a fresh roundtrip. `force-dynamic` already does this on the
  // Vercel side, the explicit header covers intermediaries.
  "cache-control": "no-store, max-age=0",
};

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

interface LookupAnswer {
  status: number;
  body: unknown;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const usernames = searchParams.getAll("username").map(sanitizeUsernameForLookup);
  const cost = Math.min(Math.max(1, usernames.length), OBSERVED_USERNAMES_MAX_COUNT);
  const limit = limiter.take(clientKey(request), Date.now(), cost);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate-limited", retryAfterSec: limit.retryAfterSec },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSec) },
      },
    );
  }

  if (usernames.length === 0 || usernames.some((username) => !username)) {
    return NextResponse.json(
      { error: "username required" },
      { status: 400 },
    );
  }
  if (usernames.length > OBSERVED_USERNAMES_MAX_COUNT) {
    return NextResponse.json(
      { error: "too many usernames" },
      { status: 400 },
    );
  }

  if (usernames.length === 1) {
    const answer = await lookupUsername(usernames[0]);
    return NextResponse.json(answer.body, {
      status: answer.status,
      headers: answer.status === 200 ? NO_STORE : undefined,
    });
  }
  const results = await Promise.all(usernames.map(lookupUsername));
  return NextResponse.json({ results }, { headers: NO_STORE });
}

async function lookupUsername(username: string): Promise<LookupAnswer> {
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
    return { status: 502, body: { error: "resulthub-unreachable", reason } };
  }

  if (!response.ok) {
    return { status: 502, body: { error: "resulthub-bad-status", status: response.status } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: 502, body: { error: "resulthub-bad-json" } };
  }

  const summary = parseGgBrStakeResponse(json, window);
  if (!summary) {
    return { status: 502, body: { error: "resulthub-bad-json" } };
  }
  return { status: 200, body: summary };
}

export const dynamic = "force-dynamic";
