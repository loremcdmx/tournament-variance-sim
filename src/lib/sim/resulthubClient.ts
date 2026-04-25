"use client";

import type { ResulthubGgBrSummary } from "./resulthubLookup";

export type ResulthubLookupErrorCode =
  | "empty-username"
  | "network"
  | "timeout"
  | "bad-status"
  | "bad-json"
  | "no-data";

export class ResulthubLookupError extends Error {
  readonly code: ResulthubLookupErrorCode;
  constructor(code: ResulthubLookupErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ResulthubLookupError";
  }
}

/**
 * Fetch the GG Battle Royale summary for `username` via our same-origin
 * Next.js proxy. Returns a normalized summary on success; throws a typed
 * `ResulthubLookupError` so the UI can pick a localized message.
 *
 * Empty / whitespace-only username is rejected up front to avoid sending
 * garbage to the server route. The route itself caches results for 5
 * minutes per (username, window).
 */
export async function fetchResulthubGgBr(
  username: string,
  signal?: AbortSignal,
): Promise<ResulthubGgBrSummary> {
  const trimmed = username.trim();
  if (!trimmed) throw new ResulthubLookupError("empty-username");

  let response: Response;
  try {
    response = await fetch(
      `/api/resulthub/gg-br?username=${encodeURIComponent(trimmed)}`,
      { signal, cache: "no-store" },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ResulthubLookupError("network");
  }

  if (!response.ok) {
    let upstreamError: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; reason?: string };
      upstreamError = body?.error ?? body?.reason;
    } catch {
      // ignore — surface generic bad-status below
    }
    if (upstreamError === "timeout") throw new ResulthubLookupError("timeout");
    throw new ResulthubLookupError("bad-status", upstreamError);
  }

  let body: ResulthubGgBrSummary;
  try {
    body = (await response.json()) as ResulthubGgBrSummary;
  } catch {
    throw new ResulthubLookupError("bad-json");
  }

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

/**
 * Fetch BR summaries for several nicks in parallel and sum them. Used when
 * a player has rebranded on GGPoker — ResultHub doesn't link prior nicks
 * to the current profile, so the caller passes every nick they want
 * counted and we merge the per-stake totals.
 *
 * - Per-nick `no-data` failures are tolerated; we just skip that nick.
 * - Any non-`no-data` failure (network/timeout/bad-status/bad-json) on at
 *   least one nick still counts as a partial success as long as another
 *   nick returned data.
 * - If every nick fails or returns no data, throws the most informative
 *   error from the batch.
 */
export async function fetchResulthubGgBrMany(
  usernames: readonly string[],
  signal?: AbortSignal,
): Promise<ResulthubGgBrSummary> {
  const cleaned = usernames.map((u) => u.trim()).filter((u) => u.length > 0);
  if (cleaned.length === 0) throw new ResulthubLookupError("empty-username");

  const settled = await Promise.allSettled(
    cleaned.map((u) => fetchResulthubGgBr(u, signal)),
  );

  let totalPrizes = 0;
  const points = { "0.25": 0, "1": 0, "3": 0, "10": 0, "25": 0 } as Record<
    keyof ResulthubGgBrSummary["pointsByStake"],
    number
  >;
  let firstWindow: ResulthubGgBrSummary["window"] | null = null;
  let anyDataFound = false;
  let firstNonDataError: ResulthubLookupError | null = null;

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
      if (result.reason.code !== "no-data" && !firstNonDataError) {
        firstNonDataError = result.reason;
      }
    } else if (
      result.reason instanceof DOMException &&
      result.reason.name === "AbortError"
    ) {
      throw result.reason;
    } else if (!firstNonDataError) {
      firstNonDataError = new ResulthubLookupError("network");
    }
  }

  if (!anyDataFound) {
    throw firstNonDataError ?? new ResulthubLookupError("no-data");
  }
  return {
    totalPrizes,
    pointsByStake: points,
    // Window comes from the same server-side helper for every nick in a
    // batch, so picking the first non-null one is safe.
    window: firstWindow!,
  };
}
