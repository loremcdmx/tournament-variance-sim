import { beforeEach, describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { SCENARIOS } from "@/lib/scenarios";

// With no DOM, the hooks are stand-ins: the open flag is a spy, both refs are one
// element stub, and the effect body is kept so the document listeners it adds can
// be fired by hand.
const menu = {
  setOpen: vi.fn(),
  element: { focus: vi.fn(), contains: vi.fn(() => false) },
  effect: null as null | (() => void),
};
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: () => [true, menu.setOpen],
    useRef: () => ({ current: menu.element }),
    useId: () => "menu",
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void) => {
      menu.effect = fn;
    },
  };
});

import { ScheduleToolbarExtras } from "./ScheduleToolbarExtras";

type El = { type: unknown; props: { children?: unknown; [k: string]: unknown } };
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

const listeners: Record<string, (e: unknown) => void> = {};
const loadScenario = vi.fn();

function mount() {
  const tree = ScheduleToolbarExtras({
    t: (key) => DICT[key].ru,
    activeScenarioId: null,
    loadScenario,
    onReset: vi.fn(),
  });
  menu.effect?.();
  return elements(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  menu.effect = null;
  for (const key of Object.keys(listeners)) delete listeners[key];
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    removeEventListener: vi.fn(),
  });
});

describe("scenario picker focus", () => {
  it("gives focus back to the trigger when an option is picked, so it does not fall to <body>", () => {
    const options = mount().filter(
      (el) => el.type === "button" && String(el.props.className).startsWith("group flex w-full"),
    );
    expect(options).toHaveLength(SCENARIOS.length);
    (options[0].props.onClick as () => void)();
    expect(loadScenario).toHaveBeenCalledExactlyOnceWith(SCENARIOS[0].id);
    expect(menu.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(menu.element.focus).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    mount();
    listeners.keydown({ key: "Tab" });
    expect(menu.setOpen).not.toHaveBeenCalled();
    listeners.keydown({ key: "Escape" });
    expect(menu.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(menu.element.focus).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside without pulling focus back from where the click went", () => {
    mount();
    listeners.mousedown({ target: {} });
    expect(menu.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(menu.element.focus).not.toHaveBeenCalled();
  });

  it("stays open for a click inside the picker", () => {
    menu.element.contains.mockReturnValueOnce(true);
    mount();
    listeners.mousedown({ target: {} });
    expect(menu.setOpen).not.toHaveBeenCalled();
  });
});
