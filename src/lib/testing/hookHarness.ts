/**
 * Renders a component as a plain function with call-order hook cells, for
 * tests that run in vitest's node environment (no DOM, no react-dom client).
 *
 * `render` keeps cells between calls, so a second render sees the previous
 * state and the previous memo and effect dependencies. After the function
 * returns, layout effects run in declaration order, then passive effects, as in
 * a React commit. State setters change the cell and do not re-render: the test
 * calls `render` again.
 *
 * Wire it in with a hoisted module mock:
 *
 *   vi.mock("react", async (importOriginal) => {
 *     const { reactHookMocks } = await import("@/lib/testing/hookHarness");
 *     return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
 *   });
 */
type Deps = readonly unknown[] | undefined;
type Cleanup = void | (() => void);

interface Cell {
  state?: { value: unknown; set: (next: unknown) => void };
  ref?: { current: unknown };
  memo?: { deps: Deps; value: unknown };
  effect?: { deps: Deps; cleanup?: Cleanup };
}

let cells: Cell[] = [];
let at = 0;
let layoutJobs: Array<() => void> = [];
let passiveJobs: Array<() => void> = [];

const sameDeps = (a: Deps, b: Deps): boolean =>
  a != null &&
  b != null &&
  a.length === b.length &&
  a.every((value, i) => Object.is(value, b[i]));

function take(): Cell {
  const cell = (cells[at] ??= {});
  at++;
  return cell;
}

function useState<T>(initial: T | (() => T)) {
  const cell = take();
  if (!cell.state) {
    const state = {
      value: (typeof initial === "function" ? (initial as () => T)() : initial) as unknown,
      set: (next: unknown) => {
        state.value =
          typeof next === "function" ? (next as (prev: unknown) => unknown)(state.value) : next;
      },
    };
    cell.state = state;
  }
  return [cell.state.value as T, cell.state.set] as const;
}

function useRef<T>(initial: T) {
  const cell = take();
  cell.ref ??= { current: initial };
  return cell.ref as { current: T };
}

function memoized<T>(factory: () => T, deps: Deps): T {
  const cell = take();
  if (!cell.memo || !sameDeps(cell.memo.deps, deps)) {
    cell.memo = { deps, value: factory() };
  }
  return cell.memo.value as T;
}

const useMemo = memoized;

function useCallback<T>(fn: T, deps: Deps): T {
  return memoized(() => fn, deps);
}

function effectHook(jobs: () => Array<() => void>) {
  return (fn: () => Cleanup, deps?: Deps) => {
    const cell = take();
    if (cell.effect && deps != null && sameDeps(cell.effect.deps, deps)) return;
    const effect = (cell.effect ??= { deps });
    effect.deps = deps;
    jobs().push(() => {
      if (typeof effect.cleanup === "function") effect.cleanup();
      effect.cleanup = fn();
    });
  };
}

const useEffect = effectHook(() => passiveJobs);
const useLayoutEffect = effectHook(() => layoutJobs);

export const reactHookMocks = {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useDeferredValue: <T>(value: T): T => value,
  // Default value of the context: there is no provider tree to read from.
  useContext: <T>(context: { _currentValue: T }): T => context._currentValue,
};

export const hookHarness = {
  reset() {
    cells = [];
    at = 0;
    layoutJobs = [];
    passiveJobs = [];
  },
  /** `beforeEffects` sees the returned tree before any effect runs, to attach refs. */
  render<T>(component: () => T, beforeEffects?: (out: T) => void): T {
    at = 0;
    layoutJobs = [];
    passiveJobs = [];
    const out = component();
    beforeEffects?.(out);
    for (const job of layoutJobs) job();
    for (const job of passiveJobs) job();
    return out;
  },
  unmount() {
    for (const cell of cells) {
      if (typeof cell.effect?.cleanup === "function") cell.effect.cleanup();
    }
    cells = [];
  },
};
