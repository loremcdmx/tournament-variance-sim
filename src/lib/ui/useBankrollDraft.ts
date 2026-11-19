import { useRef, useState } from "react";

import { abiCountFromBankroll, bankrollFromAbiCount } from "./bankrollUnits";
import { commitDraftValue, liveDraftValue, normalizeNumericDraft } from "./numberDraft";

/**
 * The bankroll box keeps the typed text while focused: rebuilt from the stored
 * dollars, an ABI count is rounded between keystrokes and the next digit lands
 * on the rounded value. Each complete keystroke is committed at once, so Escape
 * has to put back the bankroll from before the edit, not just drop the text.
 */
export function useBankrollDraft(
  bankroll: number,
  mode: "$" | "abi",
  abi: number,
  onBankroll: (bankroll: number) => void,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const editStart = useRef<number | null>(null);
  const max = mode === "$" ? 1_000_000_000 : 100_000;
  const shown = mode === "$" ? bankroll : abiCountFromBankroll(bankroll, abi);
  const commit = (v: number) => {
    const next = mode === "$" ? v : bankrollFromAbiCount(v, abi);
    if (next !== bankroll) onBankroll(next);
  };
  return {
    max,
    text: draft ?? String(shown),
    change(raw: string) {
      const text = normalizeNumericDraft(raw);
      editStart.current ??= bankroll;
      setDraft(text);
      const next = liveDraftValue(text, 0, max);
      if (next !== null) commit(next);
    },
    commit() {
      editStart.current = null;
      if (draft === null) return;
      const next = commitDraftValue(draft, 0, max);
      if (next !== null) commit(next);
      setDraft(null);
    },
    cancel() {
      const start = editStart.current;
      editStart.current = null;
      setDraft(null);
      if (start !== null && start !== bankroll) onBankroll(start);
    },
    discard() {
      editStart.current = null;
      setDraft(null);
    },
  };
}
