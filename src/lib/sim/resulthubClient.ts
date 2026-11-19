"use client";

import type { ResulthubGgBrSummary } from "./resulthubLookup";

export type ResulthubLookupErrorCode =
  | "empty-username"
  | "network"
  | "timeout"
  | "bad-status"
  | "bad-json"
  | "incomplete"
  | "rate-limited"
  | "no-data";

export class ResulthubLookupError extends Error {
  readonly code: ResulthubLookupErrorCode;
  readonly retryAfterSec?: number;
  constructor(code: ResulthubLookupErrorCode, message?: string, retryAfterSec?: number) {
    super(message ?? code);
    this.code = code;
    this.name = "ResulthubLookupError";
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Fetch the GG Battle Royale summary for `username` via our same-origin
 * Next.js proxy. Returns a normalized summary on success; throws a typed
 * `ResulthubLookupError` so the UI can pick a localized message.
 *
 * Empty / whitespace-only username is rejected up front to avoid sending
 * garbage to the server route. The route does not cache — every call is a
 * fresh upstream roundtrip — and it rate-limits per client IP (429 with
 * Retry-After), one token per nick.
 */
export async function fetchResulthubGgBr(
  username: string,
  signal?: AbortSignal,
): Promise<ResulthubGgBrSummary> {
  const trimmed = username.trim();
  if (!trimmed) throw new ResulthubLookupError("empty-username");
  const response = await requestLookup(`username=${encodeURIComponent(trimmed)}`, signal);
  return readLookupAnswer(response.status, await readJson(response), retryAfterHeader(response));
}

async function requestLookup(query: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`/api/resulthub/gg-br?${query}`, { signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ResulthubLookupError("network");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function retryAfterHeader(response: Response): number {
  return Number(response.headers.get("retry-after"));
}

/** One nick's answer, whether it came as its own response or as an entry of a batch. */
function readLookupAnswer(status: number, json: unknown, retryAfterSecHeader: number): ResulthubGgBrSummary {
  if (status < 200 || status >= 300) {
    const body = (json ?? {}) as { error?: string; reason?: string; retryAfterSec?: number };
    const upstreamError = body.reason ?? body.error;
    const retryAfterSec = Number.isFinite(body.retryAfterSec) ? body.retryAfterSec! : retryAfterSecHeader;
    if (upstreamError === "timeout") throw new ResulthubLookupError("timeout");
    if (upstreamError === "resulthub-bad-json") throw new ResulthubLookupError("bad-json");
    if (status === 429) {
      throw new ResulthubLookupError("rate-limited", undefined,
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.ceil(retryAfterSec) : 60);
    }
    throw new ResulthubLookupError("bad-status", upstreamError);
  }
  if (typeof json !== "object" || json === null) throw new ResulthubLookupError("bad-json");
  const body = json as ResulthubGgBrSummary;

  const totalPoints = Object.values(body.pointsByStake ?? {}).reduce(
    (a, b) => a + (Number.isFinite(b) ? b : 0),
    0,
  );
  if (
    !(body.totalPrizes > 0) &&
    !(totalPoints > 0)
  ) {
    throw new ResulthubLookupError("no-data");
  }
  return body;
}

/** Several nicks go to the route in one call, so the click is rate-limited as one unit. */
async function fetchResulthubGgBrBatch(
  usernames: readonly string[],
  signal?: AbortSignal,
): Promise<PromiseSettledResult<ResulthubGgBrSummary>[]> {
  const query = usernames.map((u) => `username=${encodeURIComponent(u)}`).join("&");
  const response = await requestLookup(query, signal);
  const json = await readJson(response);
  if (!response.ok) readLookupAnswer(response.status, json, retryAfterHeader(response));
  const results = (json as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results) || results.length !== usernames.length) {
    throw new ResulthubLookupError("bad-json");
  }
  return results.map((entry: { status?: unknown; body?: unknown } | null) => {
    try {
      const status = typeof entry?.status === "number" ? entry.status : 502;
      return { status: "fulfilled", value: readLookupAnswer(status, entry?.body, Number.NaN) };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  });
}

/**
 * Fetch BR summaries for several nicks in parallel and sum them. Used when
 * a player has rebranded on GGPoker — ResultHub doesn't link prior nicks
 * to the current profile, so the caller passes every nick they want
 * counted and we merge the per-stake totals.
 *
 * A batch is atomic: every requested nick must resolve. Otherwise the UI
 * retains its previous observations instead of silently undercounting a
 * profile whose tournament count still includes every nick.
 */
export async function fetchResulthubGgBrMany(
  usernames: readonly string[],
  signal?: AbortSignal,
): Promise<ResulthubGgBrSummary> {
  const cleaned = usernames.map((u) => u.trim()).filter((u) => u.length > 0);
  if (cleaned.length === 0) throw new ResulthubLookupError("empty-username");

  const settled = cleaned.length === 1
    ? await Promise.allSettled([fetchResulthubGgBr(cleaned[0], signal)])
    : await fetchResulthubGgBrBatch(cleaned, signal);

  let totalPrizes = 0;
  const points = { "0.25": 0, "1": 0, "3": 0, "10": 0, "25": 0 } as Record<
    keyof ResulthubGgBrSummary["pointsByStake"],
    number
  >;
  let firstWindow: ResulthubGgBrSummary["window"] | null = null;
  let anyDataFound = false;
  let firstNonDataError: ResulthubLookupError | null = null;
  let failedCount = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const summary = result.value;
      anyDataFound = true;
      totalPrizes += summary.totalPrizes;
      for (const k of Object.keys(points) as Array<keyof typeof points>) {
        points[k] += summary.pointsByStake[k] ?? 0;
      }
      if (!firstWindow) firstWindow = summary.window;
    } else if (result.reason instanceof ResulthubLookupError) {
      failedCount++;
      if (result.reason.code !== "no-data" && !firstNonDataError) {
        firstNonDataError = result.reason;
      }
    } else if (
      result.reason instanceof DOMException &&
      result.reason.name === "AbortError"
    ) {
      throw result.reason;
    } else if (!firstNonDataError) {
      failedCount++;
      firstNonDataError = new ResulthubLookupError("network");
    }
  }

  if (!anyDataFound) {
    throw firstNonDataError ?? new ResulthubLookupError("no-data");
  }
  if (failedCount > 0) {
    throw firstNonDataError ?? new ResulthubLookupError("incomplete");
  }
  return {
    totalPrizes,
    pointsByStake: points,
    // Window comes from the same server-side helper for every nick in a
    // batch, so picking the first non-null one is safe.
    window: firstWindow!,
  };
}
