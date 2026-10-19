import type { DictKey } from "@/lib/i18n/dict";

/** `detail` is null for a failure the browser reported without any message (a worker that never loaded). */
export interface CashRunError {
  detail: string | null;
}

export interface CashRunState {
  running: boolean;
  progress: number;
  error: CashRunError | null;
}

export type CashRunAction =
  | { type: "start" }
  | { type: "progress"; value: number }
  | { type: "done" }
  | { type: "fail"; detail: string | null }
  | { type: "cancel" };

export const IDLE_CASH_RUN: CashRunState = {
  running: false,
  progress: 0,
  error: null,
};

export function cashRunReducer(
  state: CashRunState,
  action: CashRunAction,
): CashRunState {
  switch (action.type) {
    case "start":
      return { running: true, progress: 0, error: null };
    case "progress":
      return { ...state, progress: action.value };
    case "done":
      return { running: false, progress: 1, error: null };
    case "fail":
      return { ...state, running: false, error: { detail: action.detail } };
    case "cancel":
      return IDLE_CASH_RUN;
  }
}

export function cashRunErrorText(
  error: CashRunError,
  t: (key: DictKey) => string,
): string {
  return t("cash.error.run").replace(
    "{detail}",
    error.detail ?? t("cash.error.workerStart"),
  );
}

export function workerFailureDetail(e: { message?: unknown }): string | null {
  return typeof e.message === "string" && e.message.trim() ? e.message : null;
}
