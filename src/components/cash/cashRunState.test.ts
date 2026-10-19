import { describe, expect, it } from "vitest";
import { DICT, type DictKey, type Locale } from "@/lib/i18n/dict";
import {
  IDLE_CASH_RUN,
  cashRunErrorText,
  cashRunReducer,
  workerFailureDetail,
  type CashRunState,
} from "./cashRunState";

const failed: CashRunState = {
  running: false,
  progress: 0.4,
  error: { detail: "boom" },
};
const dictT = (locale: Locale) => (key: DictKey) => DICT[key][locale];

describe("cash run banner lifecycle", () => {
  it("clears the previous failure the moment a new run starts", () => {
    const next = cashRunReducer(failed, { type: "start" });
    expect(next).toEqual({ running: true, progress: 0, error: null });
  });

  it("clears the failure when the user cancels the next run", () => {
    const running = cashRunReducer(failed, { type: "start" });
    const failedAgain = cashRunReducer(running, { type: "fail", detail: "x" });
    expect(failedAgain.error).not.toBeNull();
    const retried = cashRunReducer(failedAgain, { type: "start" });
    expect(cashRunReducer(retried, { type: "cancel" })).toEqual(IDLE_CASH_RUN);
  });

  it("keeps a failure on screen after the worker dies, with the run stopped", () => {
    const running = cashRunReducer(IDLE_CASH_RUN, { type: "start" });
    const next = cashRunReducer(
      cashRunReducer(running, { type: "progress", value: 0.5 }),
      { type: "fail", detail: "boom" },
    );
    expect(next).toEqual({ running: false, progress: 0.5, error: { detail: "boom" } });
  });

  it("finishes with full progress and no error", () => {
    expect(cashRunReducer(failed, { type: "done" })).toEqual({
      running: false,
      progress: 1,
      error: null,
    });
  });
});

describe("cash run error text", () => {
  it("is built at render time, so it follows a language switch", () => {
    const error = { detail: "boom" };
    expect(cashRunErrorText(error, dictT("en"))).toContain("Cash simulation failed: boom.");
    expect(cashRunErrorText(error, dictT("ru"))).toContain("Симуляция кэша не удалась: boom.");
  });

  it("says what happened to a worker that never started instead of printing 'error'", () => {
    const en = cashRunErrorText({ detail: null }, dictT("en"));
    expect(en).toContain(DICT["cash.error.workerStart"].en);
    expect(en).not.toMatch(/failed: error\./);
    expect(cashRunErrorText({ detail: null }, dictT("ru"))).toContain(
      DICT["cash.error.workerStart"].ru,
    );
  });
});

describe("worker failure detail", () => {
  it("keeps a real message and drops an empty one", () => {
    expect(workerFailureDetail({ message: "Unexpected token" })).toBe("Unexpected token");
    expect(workerFailureDetail({ message: "" })).toBeNull();
    expect(workerFailureDetail({ message: "  " })).toBeNull();
    expect(workerFailureDetail({})).toBeNull();
    expect(workerFailureDetail({ message: 5 })).toBeNull();
  });
});
