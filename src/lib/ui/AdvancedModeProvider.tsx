"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

interface AdvancedModeCtx {
  advanced: boolean;
  adminAvailable: boolean;
  setAdvanced: (v: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<AdvancedModeCtx | null>(null);

export function parseAdminParam(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get("admin") === "1";
  } catch {
    return false;
  }
}

function readAdminParam(): boolean {
  if (typeof window === "undefined") return false;
  return parseAdminParam(window.location.search);
}

const subscribeAdmin = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};
const serverAdminSnapshot = () => false;

export function AdvancedModeProvider({ children }: { children: React.ReactNode }) {
  const adminAvailable = useSyncExternalStore(
    subscribeAdmin,
    readAdminParam,
    serverAdminSnapshot,
  );
  const [advancedChoice, setAdvancedState] = useState(true);
  const advanced = adminAvailable && advancedChoice;

  const setAdvanced = useCallback(
    (v: boolean) => {
      if (!adminAvailable) return;
      setAdvancedState(v);
    },
    [adminAvailable],
  );

  const toggle = useCallback(() => {
    if (!adminAvailable) return;
    setAdvancedState((v) => !v);
  }, [adminAvailable]);

  const value = useMemo<AdvancedModeCtx>(
    () => ({ advanced, adminAvailable, setAdvanced, toggle }),
    [advanced, adminAvailable, setAdvanced, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdvancedMode(): AdvancedModeCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useAdvancedMode must be used inside <AdvancedModeProvider>");
  return ctx;
}
