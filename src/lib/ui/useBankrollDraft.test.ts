import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});

import { hookHarness } from "@/lib/testing/hookHarness";
import { useBankrollDraft } from "./useBankrollDraft";

function mount(initial: number, mode: "$" | "abi" = "$", abi = 10) {
  let bankroll = initial;
  const onBankroll = vi.fn((next: number) => {
    bankroll = next;
  });
  const render = () => hookHarness.render(() => useBankrollDraft(bankroll, mode, abi, onBankroll));
  return { onBankroll, render, bankroll: () => bankroll };
}

beforeEach(() => hookHarness.reset());

describe("useBankrollDraft", () => {
  it("commits each complete keystroke", () => {
    const box = mount(1000);
    box.render().change("5");
    box.render().change("50");
    expect(box.bankroll()).toBe(50);
    expect(box.render().text).toBe("50");
  });

  it("Escape puts back the bankroll from before the edit, not the last keystroke", () => {
    const box = mount(1000);
    box.render().change("5");
    box.render().change("50");
    box.render().cancel();
    expect(box.bankroll()).toBe(1000);
    expect(box.render().text).toBe("1000");
  });

  it("Escape after a committed edit keeps it", () => {
    const box = mount(1000);
    box.render().change("50");
    box.render().commit();
    box.render().cancel();
    expect(box.bankroll()).toBe(50);
  });

  it("Escape with nothing typed changes nothing", () => {
    const box = mount(1000);
    box.render().cancel();
    expect(box.onBankroll).not.toHaveBeenCalled();
  });

  it("Escape restores the dollars in ABI mode as well", () => {
    const box = mount(1234.56, "abi", 0.25);
    box.render().change("1");
    expect(box.bankroll()).toBe(0.25);
    box.render().cancel();
    expect(box.bankroll()).toBe(1234.56);
  });
});
