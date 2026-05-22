"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
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

export function AdvancedModeProvider({ children }: { children: React.ReactNode }) {
  // adminAvailable is read once on mount and not reactive — admin status
  // flips only on navigation, which remounts the provider in practice.
  const [adminAvailable] = useState<boolean>(readAdminParam);
  const [advanced, setAdvancedState] = useState<boolean>(adminAvailable);

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
