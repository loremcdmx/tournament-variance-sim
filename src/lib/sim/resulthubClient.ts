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
 * Retry-After), so the multi-nick fan-out in the control counts against
 * that budget.
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
    let retryAfterSec = Number(response.headers.get("retry-after"));
    try {
      const body = (await response.json()) as { error?: string; reason?: string; retryAfterSec?: number };
      upstreamError = body?.reason ?? body?.error;
      if (Number.isFinite(body.retryAfterSec)) retryAfterSec = body.retryAfterSec!;
    } catch {
      // ignore — surface generic bad-status below
    }
    if (upstreamError === "timeout") throw new ResulthubLookupError("timeout");
    if (response.status === 429) {
      throw new ResulthubLookupError("rate-limited", undefined,
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.ceil(retryAfterSec) : 60);
    }
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
