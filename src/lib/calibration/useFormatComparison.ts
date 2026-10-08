"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormatComparisonConfig, FormatComparisonSummary } from "./formatComparison";
import type { FormatComparisonRequest, FormatComparisonResponse } from "./formatComparisonProtocol";

export type FormatComparisonStatus = "idle" | "running" | "done" | "error" | "cancelled";

interface ComparisonState {
  status: FormatComparisonStatus;
  progress: number;
  rows: FormatComparisonSummary[];
  configSnapshot: FormatComparisonConfig | null;
  error: string | null;
}

export function useFormatComparison() {
  const [state, setState] = useState<ComparisonState>({
    status: "idle", progress: 0, rows: [], configSnapshot: null, error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  const run = useCallback((config: FormatComparisonConfig) => {
    stopWorker();
    const jobId = ++jobRef.current;
    const configSnapshot = { ...config };
    setState({ status: "running", progress: 0, rows: [], configSnapshot, error: null });
    try {
      const worker = new Worker(new URL("./formatComparison.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      const isCurrent = () => workerRef.current === worker && jobRef.current === jobId;
      const fail = (error: string) => {
        if (!isCurrent()) return;
        stopWorker();
        setState((previous) => ({ ...previous, status: "error", error }));
      };
      worker.onmessage = (event: MessageEvent<FormatComparisonResponse>) => {
        const message = event.data;
        if (!isCurrent() || message.jobId !== jobId) return;
        if (message.type === "error") {
          fail(message.error);
        } else if (message.type === "progress") {
          setState((previous) => ({ ...previous, progress: message.progress }));
        } else if (message.type === "row") {
          setState((previous) => ({ ...previous, rows: [...previous.rows, message.row] }));
        } else if (message.type === "done") {
          stopWorker();
          setState((previous) => ({ ...previous, status: "done", progress: 1 }));
        }
      };
      worker.onerror = (event) => fail(event.message || "Comparison worker failed");
      worker.onmessageerror = () => fail("Comparison worker returned an unreadable result");
      const request: FormatComparisonRequest = { type: "run", jobId, config: configSnapshot };
      worker.postMessage(request);
    } catch (error) {
      stopWorker();
      setState((previous) => ({
        ...previous, status: "error", error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [stopWorker]);

  const cancel = useCallback(() => {
    stopWorker();
    setState((previous) => previous.status === "running" ? { ...previous, status: "cancelled" } : previous);
  }, [stopWorker]);

  return { ...state, completed: state.rows.length, total: 5, run, cancel };
}
