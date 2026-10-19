import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { SCENARIOS } from "@/lib/scenarios";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  type BattleRoyaleLeaderboardControls,
} from "@/lib/sim/battleRoyaleLeaderboardUi";
import { BattleRoyaleLeaderboardControl } from "./BattleRoyaleLeaderboardControl";
import { Field, type ControlsState } from "./ControlsPanel";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(React.createElement(LocaleProvider, null, node));
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Field caption", () => {
  it("keeps the help button out of the label, so the caption names the control and a click on it focuses the control", () => {
    const html = render(
      <Field label="Samples" hint="what it is" htmlFor="samples-box">
        <input id="samples-box" />
      </Field>,
    );
    const label = html.match(/<label[^>]*>([\s\S]*?)<\/label>/);
    expect(label).not.toBeNull();
    expect(label![0]).toContain('for="samples-box"');
    expect(label![1]).toBe("Samples");
    expect(html).toContain("<button");
  });

  it("prints a read-only value's caption without a label that points at nothing", () => {
    const html = render(
      <Field label="Target points" hint="what it is">
        <div>1 200</div>
      </Field>,
    );
    expect(html).not.toContain("<label");
    expect(html).toContain("Target points");
    expect(html).toContain("1 200");
  });
});

describe("Battle Royale leaderboard panel", () => {
  const controls = (mode: BattleRoyaleLeaderboardControls["mode"]): ControlsState =>
    ({
      ...SCENARIOS[0].controls,
      battleRoyaleLeaderboard: { ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS, mode },
    }) as ControlsState;
  const panel = (mode: BattleRoyaleLeaderboardControls["mode"]) =>
    render(
      <BattleRoyaleLeaderboardControl
        value={controls(mode)}
        onChange={vi.fn()}
        advanced
        previewTournaments={100}
        previewBuyIn={1000}
        previewTicketCost={1100}
      />,
    );
  const unnamed = (html: string) =>
    (html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []).filter((tag) => {
      if (/aria-label="[^"]+"/.test(tag)) return false;
      const id = tag.match(/\sid="([^"]+)"/)?.[1];
      return !id || !new RegExp(`<label[^>]*for="${escapeRe(id)}"`).test(html);
    });

  it.each(["off", "manual", "lookup", "observed"] as const)(
    "names every input, select and textarea in %s mode",
    (mode) => {
      const html = panel(mode);
      expect(html.match(/<(?:input|select|textarea)\b/g)?.length ?? 0).toBeGreaterThan(0);
      expect(unnamed(html)).toEqual([]);
    },
  );

  it.each(["manual", "lookup", "observed"] as const)(
    "never wraps a help button in a label in %s mode",
    (mode) => {
      for (const label of panel(mode).match(/<label[^>]*>[\s\S]*?<\/label>/g) ?? []) {
        expect(label).not.toContain("<button");
      }
    },
  );
});
