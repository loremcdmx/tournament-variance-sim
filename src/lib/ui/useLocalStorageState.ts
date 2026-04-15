"use client";

import { useSyncExternalStore } from "react";

// Module-level cache per storage key. Shared across components using the same
// key, so e.g. saving a user preset in one component immediately notifies any
// other component subscribed to the same key. This is the React 19-friendly
// replacement for the `useState + useEffect(setX(loadX()))` hydration pattern,
// which trips `react-hooks/set-state-in-effect`.
interface Slot<T> {
  value: T;
  hydrated: boolean;
  listeners: Set<() => void>;
}

const slots = new Map<string, Slot<unknown>>();

function getSlot<T>(key: string, fallback: T): Slot<T> {
  let s = slots.get(key) as Slot<T> | undefined;
  if (!s) {
    s = { value: fallback, hydrated: false, listeners: new Set() };
    slots.set(key, s as unknown as Slot<unknown>);
  }
  return s;
}

function subscribe<T>(slot: Slot<T>, cb: () => void): () => void {
  slot.listeners.add(cb);
  return () => {
    slot.listeners.delete(cb);
  };
}

function hydrateAndRead<T>(slot: Slot<T>, load: () => T): T {
  if (!slot.hydrated) {
    slot.value = load();
    slot.hydrated = true;
  }
  return slot.value;
}

function commit<T>(
  key: string,
  next: T,
  save: (next: T) => void,
): void {
  const slot = slots.get(key) as Slot<T> | undefined;
  if (!slot) return;
  slot.value = next;
  slot.hydrated = true;
  save(next);
  slot.listeners.forEach((l) => l());
}

export function useLocalStorageState<T>(
  key: string,
  load: () => T,
  save: (next: T) => void,
  fallback: T,
): [T, (next: T) => void] {
  const slot = getSlot<T>(key, fallback);

  const value = useSyncExternalStore(
    (cb) => subscribe(slot, cb),
    () => hydrateAndRead(slot, load),
    () => fallback,
  );

  const setValue = (next: T) => commit(key, next, save);

  return [value, setValue];
}
