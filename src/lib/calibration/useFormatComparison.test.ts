import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormatComparisonConfig, FormatComparisonSummary } from "./formatComparison";
import type { FormatComparisonRequest, FormatComparisonResponse } from "./formatComparisonProtocol";

const reactHarness = vi.hoisted(() => ({
  state: undefined as unknown,
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    reactHarness.state = initial;
    return [initial, (next: unknown) => {
      reactHarness.state = typeof next === "function" ? next(reactHarness.state) : next;
    }];
  },
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | undefined) => { reactHarness.cleanup = effect(); },
}));

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<FormatComparisonResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: FormatComparisonRequest | null = null;
  terminated = false;
  constructor() { TestWorker.instances.push(this); }
  terminate() { this.terminated = true; }
  postMessage(request: FormatComparisonRequest) { this.request = request; }
  emit(message: FormatComparisonResponse) { this.onmessage?.({ data: message } as MessageEvent<FormatComparisonResponse>); }
  complete() {
    const jobId = this.request!.jobId;
    for (const format of ["freezeout", "pko", "mystery", "ocean-ko", "mystery-royale"] as const) {
      this.emit({ type: "row", jobId, row: { format } as FormatComparisonSummary });
    }
    this.emit({ type: "done", jobId });
  }
}

const config: FormatComparisonConfig = {
  ticket: 100, players: 1000, roi: 0.1, distance: 1000,
  samples: 2000, seed: 20261008, mysteryLogVariance: 2,
};

beforeEach(() => {
  vi.resetModules();
  TestWorker.instances = [];
  reactHarness.state = undefined;
  reactHarness.cleanup = undefined;
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => { reactHarness.cleanup?.(); vi.unstubAllGlobals(); });

describe("comparison worker lifecycle and repeat calculation", () => {
  it("keeps the executed snapshot and restores a complete run without constructing a worker", async () => {
    const { useFormatComparison } = await import("./useFormatComparison");
    const report = useFormatComparison();
    const draft = { ...config };
    report.run(draft);
    const worker = TestWorker.instances[0];
    draft.distance = 20000;
    expect(worker.request!.config).toEqual(config);
    worker.complete();
    expect(worker.terminated).toBe(true);
    expect(reactHarness.state).toMatchObject({ status: "done", progress: 1, configSnapshot: config });
    const completed = reactHarness.state;
    report.run(config);
    expect(TestWorker.instances).toHaveLength(1);
    expect(reactHarness.state).toEqual(completed);
  });

  it("terminates immediately on cancel, ignores late messages and never caches partial rows", async () => {
    const { useFormatComparison } = await import("./useFormatComparison");
    const report = useFormatComparison();
    report.run(config);
    const worker = TestWorker.instances[0];
    worker.emit({ type: "row", jobId: worker.request!.jobId, row: { format: "freezeout" } as FormatComparisonSummary });
    report.cancel();
    expect(worker.terminated).toBe(true);
    const cancelled = reactHarness.state;
    worker.complete();
    expect(reactHarness.state).toBe(cancelled);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    report.run(config);
    expect(TestWorker.instances).toHaveLength(2);
    expect(reactHarness.state).toMatchObject({ status: "running", rows: [] });
  });

  it("ignores replaced jobs and preserves completed cache across a tab unmount", async () => {
    const { useFormatComparison } = await import("./useFormatComparison");
    const firstReport = useFormatComparison();
    firstReport.run(config);
    const oldWorker = TestWorker.instances[0];
    const edited = { ...config, roi: 0.25 };
    firstReport.run(edited);
    expect(oldWorker.terminated).toBe(true);
    const pending = reactHarness.state;
    oldWorker.complete();
    expect(reactHarness.state).toBe(pending);
    TestWorker.instances[1].complete();
    reactHarness.cleanup?.();
    const reopenedReport = useFormatComparison();
    reopenedReport.run(edited);
    expect(TestWorker.instances).toHaveLength(2);
    expect(reactHarness.state).toMatchObject({ status: "done", configSnapshot: edited });
    reopenedReport.run(config);
    expect(TestWorker.instances).toHaveLength(3);
    reactHarness.cleanup?.();
    expect(TestWorker.instances[2].terminated).toBe(true);
  });

  it("does not cache failed jobs", async () => {
    const { useFormatComparison } = await import("./useFormatComparison");
    const report = useFormatComparison();
    report.run(config);
    const worker = TestWorker.instances[0];
    worker.emit({ type: "error", jobId: worker.request!.jobId, error: "bad worker" });
    expect(worker.terminated).toBe(true);
    expect(reactHarness.state).toMatchObject({ status: "error", error: "bad worker" });
    report.run(config);
    expect(TestWorker.instances).toHaveLength(2);
  });
});
