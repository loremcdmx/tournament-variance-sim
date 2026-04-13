/// <reference lib="webworker" />
import { runSimulation } from "./engine";
import type {
  SimulationInput,
  SimulationResult,
  WorkerMessage,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

function collectTransfers(
  result: SimulationResult,
  transfers: Transferable[],
): void {
  transfers.push(result.finalProfits.buffer);
  for (const p of result.samplePaths.paths) transfers.push(p.buffer);
  transfers.push(
    result.samplePaths.best.buffer,
    result.samplePaths.worst.buffer,
    result.envelopes.mean.buffer,
    result.envelopes.p15.buffer,
    result.envelopes.p85.buffer,
    result.envelopes.p025.buffer,
    result.envelopes.p975.buffer,
    result.envelopes.p0015.buffer,
    result.envelopes.p9985.buffer,
  );
  if (result.comparison) collectTransfers(result.comparison, transfers);
}

self.onmessage = (e: MessageEvent<SimulationInput>) => {
  try {
    const result = runSimulation(e.data, (done, total) => {
      const msg: WorkerMessage = { type: "progress", done, total };
      self.postMessage(msg);
    });

    const transfers: Transferable[] = [];
    collectTransfers(result, transfers);

    self.postMessage(result, transfers);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
