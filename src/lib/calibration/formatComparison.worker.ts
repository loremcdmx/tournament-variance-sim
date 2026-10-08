/// <reference lib="webworker" />
import { compileSchedule } from "../sim/compile";
import { makeCheckpointGrid } from "../sim/grids";
import { simulateShard } from "../sim/hotLoop";
import {
  buildFormatComparisonMoments,
  buildFormatComparisonScenarios,
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
    const scenarios = buildFormatComparisonScenarios(config);
    const moments = buildFormatComparisonMoments(config);
    // Only a compact summary crosses the worker boundary. Each raw shard can
    // be reclaimed before the next format, rather than retaining five runs.
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const compiled = compileSchedule(scenario.input);
      const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
      const raw = simulateShard(scenario.input, compiled, 0, config.samples, grid, (done, total) => {
        send({ type: "progress", jobId, progress: (i + done / total) / scenarios.length });
      });
      const row = summarizeFormatComparisonScenario(scenario, compiled, raw, grid);
      row.moments = moments[i];
      send({ type: "row", jobId, row });
      send({ type: "progress", jobId, progress: (i + 1) / scenarios.length });
    }
    send({ type: "done", jobId });
  } catch (error) {
    send({ type: "error", jobId, error: error instanceof Error ? error.message : String(error) });
  }
};
