import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { applyGameType } from "@/lib/sim/gameType";
import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import {
  fillRuntimeSigmaBrTicket,
  RUNTIME_SIGMA_BR_TICKET,
} from "@/lib/sim/formatRuntimeSigma";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import type { TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard } from "./ProveEdgeCard";

const OFF: ItmTargetConfig = { enabled: false, pct: 0 };

const freeze: TournamentRow = {
  id: "f",
  players: 500,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 100,
};
const br: TournamentRow = {
  ...freeze,
  id: "b",
  ...applyGameType(freeze, "mystery-royale"),
  ...battleRoyaleRowFromTotalTicket(3),
  roi: 0.03,
};

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

const label = fillRuntimeSigmaBrTicket(DICT["chart.convergence.brTicket"].ru);
const bandLabel = fillRuntimeSigmaBrTicket(DICT["chart.convergence.brTicket.band"].ru);

describe("the Battle Royale planning σ names its reference ticket", () => {
  it("fills the ticket the σ is actually computed for", () => {
    expect(RUNTIME_SIGMA_BR_TICKET).toBe(10);
    expect(label).toContain("$10");
    expect(label).not.toContain("{ticket}");
    expect(fillRuntimeSigmaBrTicket(DICT["chart.convergence.brTicket"].en)).toMatch(
      /^σ for a \$10 ticket/,
    );
  });

  it("is on the convergence BR tab with its range footnote, and nowhere else", () => {
    const onBr = render(<ConvergenceChart schedule={[br]} itmTarget={OFF} />);
    expect(onBr).toContain(label);
    expect(onBr).toContain(bandLabel);
    const onFreeze = render(<ConvergenceChart schedule={[freeze]} itmTarget={OFF} />);
    expect(onFreeze).not.toContain(label);
    expect(onFreeze).not.toContain(bandLabel);
  });

  it("is on the prove-edge BR tab with its range footnote, and nowhere else", () => {
    const onBr = render(<ProveEdgeCard schedule={[br]} itmTarget={OFF} />);
    expect(onBr).toContain(label);
    expect(onBr).toContain(bandLabel);
    const onFreeze = render(<ProveEdgeCard schedule={[freeze]} itmTarget={OFF} />);
    expect(onFreeze).not.toContain(label);
    expect(onFreeze).not.toContain(bandLabel);
  });
});
