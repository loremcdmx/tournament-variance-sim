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
