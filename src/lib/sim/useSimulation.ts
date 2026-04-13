"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SimulationInput,
  SimulationResult,
  WorkerMessage,
} from "./types";

type Status = "idle" | "running" | "done" | "error";

export function useSimulation() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerMessage | { type: "error"; message: string }>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(msg.done / msg.total);
      } else if (msg.type === "result") {
        setResult(msg);
        setProgress(1);
        setStatus("done");
      } else if ((msg as { type: string }).type === "error") {
        setError((msg as { message: string }).message);
        setStatus("error");
      }
    };

    worker.onerror = (e) => {
      setError(e.message);
      setStatus("error");
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback((input: SimulationInput) => {
    if (!workerRef.current) return;
    setStatus("running");
    setProgress(0);
    setResult(null);
    setError(null);
    workerRef.current.postMessage(input);
  }, []);

  return { status, progress, result, error, run };
}
