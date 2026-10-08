/// <reference lib="webworker" />
import { makeCheckpointGrid } from "../sim/grids";
import { simulateDownsideShard } from "../sim/hotLoop";
import {
  compileFormatComparison,
  summarizeFormatComparisonScenario,
} from "./formatComparison";
import type { FormatComparisonRequest, FormatComparisonResponse } from "./formatComparisonProtocol";

declare const self: DedicatedWorkerGlobalScope;

function send(message: FormatComparisonResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<FormatComparisonRequest>) => {
  const { jobId, config } = event.data;
  if (event.data.type !== "run") return;
  try {
    const scenarios = compileFormatComparison(config);
    // Only a compact summary crosses the worker boundary. Each raw shard can
    // be reclaimed before the next format, rather than retaining five runs.
    for (let i = 0; i < scenarios.length; i++) {
      const { scenario, compiled, moments } = scenarios[i];
      const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
      const raw = simulateDownsideShard(scenario.input, compiled, 0, config.samples, grid, (done, total) => {
        send({ type: "progress", jobId, progress: (i + done / total) / scenarios.length });
      });
      const row = summarizeFormatComparisonScenario(scenario, compiled, raw, grid, moments);
      send({ type: "row", jobId, row });
      send({ type: "progress", jobId, progress: (i + 1) / scenarios.length });
    }
    send({ type: "done", jobId });
  } catch (error) {
    send({ type: "error", jobId, error: error instanceof Error ? error.message : String(error) });
  }
};
