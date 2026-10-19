import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationInput } from "./types";

// The hook is driven without a DOM: a hand-rolled slot store stands in for
// React's hooks (a "render" is one call of the hook), and the worker pool is a
// set of in-process stand-ins that run the real worker module, so a run
// computes real results and the lifecycle the UI sees is the production one.
const store = vi.hoisted(() => ({
  cells: [] as unknown[],
  ran: new Set<number>(),
  idx: 0,
}));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = store.idx++;
    if (!(i in store.cells)) {
      store.cells[i] = typeof init === "function" ? (init as () => unknown)() : init;
    }
    return [
      store.cells[i],
      (next: unknown) => {
        store.cells[i] =
          typeof next === "function" ? (next as (p: unknown) => unknown)(store.cells[i]) : next;
      },
    ];
  },
  useRef: (init: unknown) => {
    const i = store.idx++;
    if (!(i in store.cells)) store.cells[i] = { current: init };
    return store.cells[i];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    const i = store.idx++;
    if (!store.ran.has(i)) {
      store.ran.add(i);
      fn();
    }
  },
  startTransition: (fn: () => void) => fn(),
}));

vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
}));

type WorkerMessage = Record<string, unknown> & { type: string; jobId: number };
type Listener = (e: unknown) => void;

class FakeErrorEvent extends Event {
  message: string;
  constructor(type: string, init: { message: string }) {
    super(type);
    this.message = init.message;
  }
}

const net = {
  workers: [] as FakeWorker[],
  requests: [] as WorkerMessage[],
  failNextShard: false,
  current: null as FakeWorker | null,
};

const workerScope = {
  onmessage: null as null | ((e: { data: unknown }) => void),
  postMessage(msg: WorkerMessage) {
    net.current?.emit(msg);
  },
};

class FakeWorker {
  terminated = false;
  private listeners: Record<string, Set<Listener>> = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  };
  constructor() {
    net.workers.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners[type]?.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type]?.delete(fn);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: WorkerMessage) {
    for (const fn of [...this.listeners.message]) fn({ data });
  }
  fireError(message: string) {
    for (const fn of [...this.listeners.error]) fn(new FakeErrorEvent("error", { message }));
  }
  postMessage(req: WorkerMessage) {
    net.requests.push(req);
    setTimeout(() => {
      if (this.terminated) return;
      if (req.type === "shard" && net.failNextShard) {
        net.failNextShard = false;
        this.emit({ type: "shard-error", jobId: req.jobId, shardId: req.shardId, message: "boom" });
        return;
      }
      net.current = this;
      workerScope.onmessage?.({ data: req });
    }, 0);
  }
}

beforeAll(async () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("ErrorEvent", FakeErrorEvent);
  vi.stubGlobal("self", workerScope);
  await import("./worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  store.cells = [];
  store.ran = new Set();
  store.idx = 0;
  net.workers = [];
  net.requests = [];
  net.failNextShard = false;
});

import { useSimulation } from "./useSimulation";

function render() {
  store.idx = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the mocked hooks above have no renderer to call this from
  return useSimulation();
}

const input = (patch: Partial<SimulationInput> = {}): SimulationInput => ({
  schedule: [
    {
      id: "r1",
      players: 50,
      buyIn: 10,
      rake: 0.1,
      roi: 0.1,
      payoutStructure: "mtt-standard",
      count: 1,
    },
  ],
  scheduleRepeats: 1,
  samples: 100,
  bankroll: 0,
  seed: 11,
  finishModel: { id: "power-law" },
  ...patch,
});

const shardRequests = () => net.requests.filter((r) => r.type === "shard");

describe("sibling-seed precompute", () => {
  it("runs the four cached siblings after a run that asked for them", async () => {
    render();
    await render().run(input(), undefined, { precomputeSiblings: true });
    const after = render();
    expect(after.status).toBe("done");
    expect(after.availableRuns).toBe(5);
    expect(after.backgroundStatus).toBe("full");
    expect(shardRequests()).toHaveLength(5);
  });

  it("leaves them out when nothing can show them (basic mode)", async () => {
    render();
    await render().run(input(), undefined, { precomputeSiblings: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = render();
    expect(after.status).toBe("done");
    expect(after.result).not.toBeNull();
    expect(after.availableRuns).toBe(1);
    expect(after.backgroundStatus).toBe("idle");
    expect(shardRequests()).toHaveLength(1);
  });
});

describe("the run error banner", () => {
  const compare = () => input({ compareMode: "primedope" });

  it("disappears when a PrimeDope-only re-run that failed is retried and succeeds", async () => {
    render();
    await render().run(compare(), undefined, { precomputeSiblings: false });
    expect(render().status).toBe("done");

    net.failNextShard = true;
    await render().runPdOnly({ usePrimedopePayouts: false });
    expect(render().pdStatus).toBe("error");
    expect(render().error).toBe("boom");

    await render().runPdOnly({ usePrimedopeRakeMath: false });
    const after = render();
    expect(after.pdStatus).toBe("done");
    expect(after.error).toBeNull();
  });

  it("goes away with Stop, which also replaces a poisoned pool", async () => {
    render();
    net.workers[0].fireError("chunk failed to load");
    await render().run(input(), undefined, { precomputeSiblings: false });
    expect(render().status).toBe("error");
    expect(render().error).toContain("run.engineCrashed");

    render().cancel();
    const after = render();
    expect(after.status).toBe("idle");
    expect(after.error).toBeNull();
  });
});
