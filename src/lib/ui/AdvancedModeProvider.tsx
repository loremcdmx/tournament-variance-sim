"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useLocalStorageState } from "./useLocalStorageState";

const LS_KEY = "tvs:advancedMode";

interface AdvancedModeCtx {
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<AdvancedModeCtx | null>(null);

const load = (): boolean => {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
};
const save = (v: boolean) => {
  try {
    localStorage.setItem(LS_KEY, v ? "1" : "0");
  } catch {}
};

export function AdvancedModeProvider({ children }: { children: React.ReactNode }) {
  const [advanced, setAdvanced] = useLocalStorageState<boolean>(
    LS_KEY,
    load,
    save,
    false,
  );

  const toggle = useCallback(() => {
    setAdvanced(!advanced);
  }, [advanced, setAdvanced]);

  const value = useMemo<AdvancedModeCtx>(
    () => ({ advanced, setAdvanced, toggle }),
    [advanced, setAdvanced, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdvancedMode(): AdvancedModeCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useAdvancedMode must be used inside <AdvancedModeProvider>");
  return ctx;
}
