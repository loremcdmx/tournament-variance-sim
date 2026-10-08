import type { FormatComparisonConfig, FormatComparisonSummary } from "./formatComparison";

export type FormatComparisonRequest = {
  type: "run";
  jobId: number;
  config: FormatComparisonConfig;
};

export type FormatComparisonResponse =
  | { type: "progress"; jobId: number; progress: number }
  | { type: "row"; jobId: number; row: FormatComparisonSummary }
  | { type: "done"; jobId: number }
  | { type: "error"; jobId: number; error: string };
