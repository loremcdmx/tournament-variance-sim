"use client";

/**
 * ResultHub lookup feature, extracted from `BattleRoyaleLeaderboardControl`
 * in `src/app/page.tsx`. The control there used to inline 40+ LOC of
 * abort-controller management, status state machine, and error mapping —
 * a coherent feature with no real coupling to the surrounding component
 * other than a callback for "what to do with the summary".
 *
 * The hook owns the abort controller (cleaned up on unmount), tracks
 * pending / ok / error status, and accepts a per-call success handler
 * so the parent decides how to fold the API summary into its state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchResulthubGgBrMany,
  ResulthubLookupError,
} from "./resulthubClient";
import type { ResulthubGgBrSummary } from "./resulthubLookup";

export type LookupStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; at: number; window: { from: string; to: string } }
  | { kind: "error"; reason: string };

export interface UseResulthubLookupResult {
  status: LookupStatus;
  /** Fire a lookup for the given nicks; on success the parent receives the
   *  full summary and decides how to merge it into its own state. */
  run: (
    usernames: readonly string[],
    onSuccess: (summary: ResulthubGgBrSummary) => void,
  ) => Promise<void>;
}

export function useResulthubLookup(): UseResulthubLookupResult {
  const [status, setStatus] = useState<LookupStatus>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight request when the host component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (
      usernames: readonly string[],
      onSuccess: (summary: ResulthubGgBrSummary) => void,
    ) => {
      if (usernames.length === 0) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus({ kind: "pending" });
      try {
        const summary = await fetchResulthubGgBrMany(usernames, ctrl.signal);
        onSuccess(summary);
        setStatus({
          kind: "ok",
          at: Date.now(),
          window: summary.window,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const code =
          err instanceof ResulthubLookupError ? err.code : "network";
        setStatus({ kind: "error", reason: code });
      }
    },
    [],
  );

  return { status, run };
}
