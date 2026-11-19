import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import {
  afsToPos,
  buildExactBreakdown,
  ciToZ,
  posToAfs,
} from "@/lib/sim/convergenceMath";
import { applyGameType } from "@/lib/sim/gameType";
import { applyItmTarget, type ItmTargetConfig } from "@/lib/sim/itmTarget";
import { computeProveEdge, PROVE_EDGE_POSITIVE_CANDIDATES } from "@/lib/sim/proveEdge";
import type { TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard } from "./ProveEdgeCard";

const ON: ItmTargetConfig = { enabled: true, pct: 18.7 };
const OFF: ItmTargetConfig = { enabled: false, pct: 0 };
const z95 = ciToZ(0.95);

/** The PKO row a user has in the schedule, and the one the editor would run. */
function pkoRow(): TournamentRow {
  const fresh: TournamentRow = {
    id: "pko",
    label: "pko",
    players: 1000,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 100,
  };
  return { ...fresh, ...applyGameType(fresh, "pko"), rake: 0.1, roi: 0.1, buyIn: 10 };
}

function scheduleSigma(itmTarget: ItmTargetConfig): number {
  const row = applyItmTarget([{ ...pkoRow(), count: 1 }], itmTarget)[0];
  return buildExactBreakdown([row])!.sigmaEff;
}

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

describe("planning cards compile their row with the run's global ITM target", () => {
  it("the convergence chip prints the volume of the schedule-mode σ, target on and off", () => {
    const schedule = [pkoRow()];
    const k50 = (sigma: number) => Math.ceil(Math.pow((z95 * sigma) / 0.5, 2));
    const label = (sigma: number) => `>${k50(sigma).toLocaleString("ru-RU")}</span>`;

    const sigmaOn = scheduleSigma(ON);
    const sigmaOff = scheduleSigma(OFF);
    expect(label(sigmaOn)).not.toBe(label(sigmaOff));

    const on = render(<ConvergenceChart schedule={schedule} itmTarget={ON} />);
    const off = render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />);
    expect(on).toContain(label(sigmaOn));
    expect(on).not.toContain(label(sigmaOff));
    expect(off).toContain(label(sigmaOff));
    expect(off).not.toContain(label(sigmaOn));
  });

  it("the prove-edge table is the one computed with the target", () => {
    const schedule = [pkoRow()];
    // The card opens on the field size 200 through its log slider.
    const afs = posToAfs(afsToPos(200));
    const fmtTourneys = (n: number): string =>
      n >= 10_000
        ? `${(n / 1000).toFixed(0)} k`
        : n >= 1000
          ? `${(n / 1000).toFixed(1)} k`
          : Math.round(n).toLocaleString("ru-RU");
    const cell = (itmTarget: ItmTargetConfig): string => {
      const row = computeProveEdge({
        format: "pko",
        afs,
        rake: 0.1,
        itmTarget,
        confidence: 0.95,
        currentRoi: 0.1,
        candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
      }).rows.find((r) => r.roi === 0.1)!;
      return `>${fmtTourneys(row.tourneysLo)} – ${fmtTourneys(row.tourneysHi)}</td>`;
    };
    expect(cell(ON)).not.toBe(cell(OFF));

    const on = render(<ProveEdgeCard schedule={schedule} itmTarget={ON} />);
    const off = render(<ProveEdgeCard schedule={schedule} itmTarget={OFF} />);
    expect(on).toContain(cell(ON));
    expect(on).not.toContain(cell(OFF));
    expect(off).toContain(cell(OFF));
    expect(off).not.toContain(cell(ON));
  });
});

describe("an ROI the pinned-ITM row cannot pay gets no distance on either card", () => {
  // A 50 % global ITM forces a freezeout at field 200 above +18 %, so the
  // cards' default +10 % is a row Run blocks.
  const HIGH: ItmTargetConfig = { enabled: true, pct: 50 };
  const schedule: TournamentRow[] = [{
    id: "f",
    label: "f",
    players: 200,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 100,
  }];
  const ru = (key: keyof typeof DICT) => DICT[key].ru;

  it("the convergence card says so and prints no distances", () => {
    const blocked = render(<ConvergenceChart schedule={schedule} itmTarget={HIGH} />);
    expect(blocked).toContain(ru("chart.convergence.unreachable"));
    const ok = render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />);
    expect(ok).not.toContain(ru("chart.convergence.unreachable"));
    const sigma = computeProveEdge({
      format: "freeze",
      afs: posToAfs(afsToPos(200)),
      rake: 0.1,
      itmTarget: HIGH,
      confidence: 0.95,
      currentRoi: 0.1,
      candidates: [0.1],
    }).anchor.sigma;
    const k50 = Math.ceil(Math.pow((z95 * sigma) / 0.5, 2));
    expect(blocked).not.toContain(`>${k50.toLocaleString("ru-RU")}</span>`);
  });

  it("the prove-edge card replaces the answer with the warning", () => {
    const blocked = render(<ProveEdgeCard schedule={schedule} itmTarget={HIGH} />);
    expect(blocked).toContain(ru("proveEdge.unreachable").replace("{roi}", "+10 %"));
    expect(blocked).not.toContain(ru("proveEdge.anchor.prefix"));
    expect(blocked).toContain(ru("proveEdge.row.unreachable"));
    const ok = render(<ProveEdgeCard schedule={schedule} itmTarget={OFF} />);
    expect(ok).toContain(ru("proveEdge.anchor.prefix"));
    expect(ok).not.toContain(ru("proveEdge.row.unreachable"));
  });
});
