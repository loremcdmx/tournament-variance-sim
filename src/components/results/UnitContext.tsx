"use client";

/**
 * Unit-mode context (USD ↔ ABI) extracted from `ResultsView.tsx`. The
 * pure formatters live in `src/lib/results/formatters.ts`; this module
 * adds the React-side plumbing — context, hook, scope provider — so any
 * sub-component can read or flip the active unit without prop-drilling.
 *
 * Layout:
 *   - `MoneyFmtContext` carries the active formatter pair + unit + setter
 *   - `useMoneyFmt()` hook reads the formatter pair
 *   - `AbiContext` carries the per-result ABI scalar so nested
 *     UnitScopes can build their own ABI-denominated formatters
 *   - `UnitScope` is a self-contained per-widget toggle scope, persisted
 *     under `tvs.unit.<id>.v1`
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  defaultMoneyFmt,
  loadUnitMode,
  makeAbiMoney,
  saveUnitMode,
  type MoneyFmt,
  type UnitMode,
} from "@/lib/results/formatters";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";

export interface UnitCtxValue extends MoneyFmt {
  unit: UnitMode;
  setUnit: (v: UnitMode) => void;
}

export const MoneyFmtContext = createContext<UnitCtxValue>({
  ...defaultMoneyFmt,
  unit: "abi",
  setUnit: () => {},
});

export const useMoneyFmt = (): UnitCtxValue => useContext(MoneyFmtContext);

/**
 * ABI value for the current result — exposed via context so per-widget
 * UnitScope providers can build their own ABI-denominated formatters
 * without threading the scalar through every sub-component.
 */
export const AbiContext = createContext<number>(1);

/**
 * Per-widget unit toggle scope. Owns its own `money` / `abi` state,
 * defaulting to ABI, persisted under `tvs.unit.<id>.v1`. Any
 * InlineUnitToggle rendered inside flips only this scope — sibling
 * widgets stay independent.
 */
export function UnitScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const abi = useContext(AbiContext);
  const storageKey = `tvs.unit.${id}.v1`;
  const [unit, setUnit] = useLocalStorageState<UnitMode>(
    storageKey,
    () => loadUnitMode(storageKey),
    (v) => saveUnitMode(storageKey, v),
    "abi",
  );
  const value = useMemo<UnitCtxValue>(() => {
    const fmt = unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt;
    return { ...fmt, unit, setUnit };
    // setUnit identity rotates on every render of useLocalStorageState — depend
    // on storageKey instead so the memo only refreshes when scope or unit change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, abi, storageKey]);
  return (
    <MoneyFmtContext.Provider value={value}>
      {children}
    </MoneyFmtContext.Provider>
  );
}
