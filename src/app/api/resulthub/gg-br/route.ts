import { NextResponse } from "next/server";

import {
  RESULTHUB_GG_BR_BASE,
  allTimeBrLeaderboardWindow,
  parseGgBrStakeResponse,
  sanitizeUsernameForLookup,
  type ResulthubGgBrSummary,
} from "@/lib/sim/resulthubLookup";

// Server-side proxy for the ResultHub GG Battle Royale per-stake aggregate.
// Lives on our origin so the browser can call it without tripping resulthub's
// CORS lock (verified 2026-04: Origin header from non-resulthub.org → 403).
//
// Caching: per-username 5-min in-process map. Resulthub doesn't publish rate
// limits or T&C for third-party use, so we err on the polite side and avoid
// hammering them on every UI re-render.

interface CacheEntry {
  expiresAt: number;
  payload: ResulthubGgBrSummary;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
// Prevent unbounded growth in long-lived dev sessions.
const CACHE_MAX_ENTRIES = 200;

function cacheKey(username: string, window: { from: string; to: string }): string {
  return `${username}|${window.from}|${window.to}`;
}

function readCache(key: string): ResulthubGgBrSummary | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
}

function writeCache(key: string, payload: ResulthubGgBrSummary): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Drop the oldest insertion to keep the map bounded. Map iteration is
    // insertion-ordered.
    const firstKey = cache.keys().next().value;
    if (firstKey != null) cache.delete(firstKey);
  }
  cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

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
  const key = cacheKey(username, window);
  const cached = readCache(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "hit" },
    });
  }

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
      // Next.js gives fetch a default cache; opt out so the in-process map
      // is the single source of truth.
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
  writeCache(key, summary);
  return NextResponse.json(summary, {
    headers: { "x-cache": "miss" },
  });
}

export const dynamic = "force-dynamic";
