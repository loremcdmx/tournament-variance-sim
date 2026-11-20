import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import {
  afsToPos,
  buildExactBreakdown,
  buildOceanKoSigmaBand,
  ciToZ,
  defaultOceanKoTicket,
  formatTargetPct,
  normalizeMix,
  posToAfs,
  roiControlBoundsForFormat,
  scheduleEffectiveRoi,
  TARGETS,
  type ConvergenceFormat,
} from "@/lib/sim/convergenceMath";
import { formatRuntimeSigma, type RuntimeSigmaFormat } from "@/lib/sim/formatRuntimeSigma";
import { applyGameType, DEFAULT_OCEAN_RAKE } from "@/lib/sim/gameType";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import type { FinishModelConfig, GameType, TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard } from "./ProveEdgeCard";

const z95 = ciToZ(0.95);
// Neither is what a band builder assumes when it is not told (power-law, the
// table's paid share), so a band compiled without the card's finish model or
// ITM target misses the cell. At field 1000, ROI +10 %, ITM 18.7 % Plackett-Luce
// reads 0.5 % (freeze) to 5 % (PKO, Mystery) over power-law, while the app's
// default model, powerlaw-realdata-influenced, reads exactly power-law's σ.
// Battle Royale's σ reads the same under all six models tried there, so the BR
// case cannot see a dropped model; the other tabs do.
const MODEL: FinishModelConfig = { id: "plackett-luce" };
const ITM: ItmTargetConfig = { enabled: true, pct: 18.7 };

function row(gameType: GameType, players: number, buyIn: number, count: number): TournamentRow {
  const base: TournamentRow = {
    id: gameType,
    label: gameType,
    players,
    buyIn,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count,
  };
  return { ...base, ...applyGameType(base, gameType), players, buyIn, count, roi: 0.1 };
}

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

/** The labels in the tournaments cell of each target row of the desktop table:
 *  the point alone, or low, point and high when the row shows its band. */
function tourneyCells(markup: string): Map<number, string[]> {
  const cells = new Map<number, string[]>();
  for (const target of TARGETS) {
    const at = markup.indexOf(`>${formatTargetPct(target)}</td>`);
    expect(at, formatTargetPct(target)).toBeGreaterThan(-1);
    const cell = markup.slice(at).match(/<\/td><td[^>]*>(.*?)<\/td>/)![1];
    const labels = [...cell.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect([1, 3]).toContain(labels.length);
    cells.set(target, labels);
  }
  return cells;
}

const point = (labels: string[]) => labels[labels.length === 3 ? 1 : 0];

/** Where the chart opens on a schedule: its count-weighted field through the
 *  log slider, its cost-weighted ROI inside the tab's box, the tab's default rake. */
function openingPoint(schedule: TournamentRow[], format: ConvergenceFormat) {
  const count = schedule.reduce((a, r) => a + r.count, 0);
  const field = schedule.reduce((a, r) => a + r.count * r.players, 0) / count;
  const { min, max } = roiControlBoundsForFormat(format);
  const rakePct =
    format === "ocean-ko" ? DEFAULT_OCEAN_RAKE * 100 : format === "mystery-royale" ? 8 : 10;
  return {
    afs: format === "mystery-royale" ? 18 : posToAfs(afsToPos(field)),
    roi: Math.max(min, Math.min(max, scheduleEffectiveRoi(schedule))),
    rake: rakePct / 100,
    finishModel: MODEL,
    itmTarget: ITM,
  };
}

describe("every convergence tab prints the σ its band builder compiles", () => {
  const single = (format: RuntimeSigmaFormat) => (schedule: TournamentRow[]) =>
    formatRuntimeSigma(format, openingPoint(schedule, format))!;
  const cases: {
    name: string;
    schedule: TournamentRow[];
    exact?: boolean;
    sigma: (schedule: TournamentRow[]) => number;
  }[] = [
    { name: "freeze", schedule: [row("freezeout", 800, 10, 10)], sigma: single("freeze") },
    { name: "PKO", schedule: [row("pko", 1000, 10, 30)], sigma: single("pko") },
    { name: "Mystery", schedule: [row("mystery", 600, 20, 5)], sigma: single("mystery") },
    { name: "Battle Royale", schedule: [row("mystery-royale", 18, 10, 40)], sigma: single("mystery-royale") },
    {
      // A $220 ticket, not the $100 the band builder assumes when not told: the
      // bounty tiers are in dollars, so σ in buy-ins depends on the ticket.
      name: "Ocean KO",
      schedule: [{ ...row("ocean-ko", 500, 200, 10), rake: 0.1 }],
      sigma: (schedule) => {
        expect(defaultOceanKoTicket(schedule)).toBeCloseTo(220, 9);
        return buildOceanKoSigmaBand({
          ...openingPoint(schedule, "ocean-ko"),
          totalTicket: defaultOceanKoTicket(schedule),
        }).s;
      },
    },
    {
      name: "Mix",
      schedule: [row("freezeout", 1000, 10, 50), row("pko", 1000, 10, 30), row("mystery", 1000, 10, 20)],
      sigma: (schedule) => {
        // The chart's own shares: PKO and Mystery by count, freeze the rest.
        const mix = normalizeMix([1 - 30 / 100 - 0 - 20 / 100 - 0, 30 / 100, 20 / 100]);
        const at = openingPoint(schedule, "mix");
        const s = (["freeze", "pko", "mystery"] as const).map((f) => formatRuntimeSigma(f, at)!);
        return Math.sqrt(mix[0] * s[0] * s[0] + mix[1] * s[1] * s[1] + mix[2] * s[2] * s[2]);
      },
    },
    {
      name: "Schedule",
      schedule: [row("freezeout", 1000, 10, 50), row("pko", 2000, 5, 30)],
      exact: true,
      sigma: (schedule) => buildExactBreakdown(schedule, { finishModel: MODEL })!.sigmaEff,
    },
  ];

  it.each(cases)("$name", ({ schedule, exact, sigma }) => {
    const markup = render(
      <ConvergenceChart
        schedule={schedule}
        finishModel={MODEL}
        itmTarget={ITM}
        defaultMode={exact ? "exact" : "avg"}
      />,
    );
    const cells = tourneyCells(markup);
    // Under 10 000 the card prints every digit, so a σ off by one part in k shows.
    const k50 = Math.ceil(Math.pow((z95 * sigma(schedule)) / 0.5, 2));
    expect(k50).toBeLessThan(10_000);
    expect(point(cells.get(0.5)!)).toBe(k50.toLocaleString("ru-RU"));
    for (const [target, labels] of cells) expect(labels, formatTargetPct(target)).not.toContain("—");
  });
});

describe("a schedule that does not compile gets no volume on either card", () => {
  // No buy-in leaves no ROI base: buildExactBreakdown returns null. The editor
  // refuses such a row; a programmatic schedule can still carry one.
  const free = [{ ...row("freezeout", 1000, 10, 10), buyIn: 0 }];

  it("the convergence card's Schedule tab prints a dash in every row", () => {
    expect(buildExactBreakdown(free, { finishModel: MODEL })).toBeNull();
    const cells = tourneyCells(render(
      <ConvergenceChart schedule={free} finishModel={MODEL} itmTarget={ITM} defaultMode="exact" />,
    ));
    for (const labels of cells.values()) expect(new Set(labels)).toEqual(new Set(["—"]));
  });

  it("the prove-edge card prints a dash, not 0 tournaments", () => {
    const markup = render(
      <ProveEdgeCard schedule={free} finishModel={MODEL} itmTarget={ITM} defaultMode="exact" />,
    );
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    const cells = [...body.matchAll(/<td[^>]*font-mono[^>]*>(.*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, ""),
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).toBe("—");
  });

  // Without a σ there is no answer for the answer line to state and nothing for
  // the zone warning, the band footnote or the noise readout to qualify. The
  // compiled twins, the same row at a $10 buy-in inside and below the 50-player
  // zone, show that each check reads text the card prints. The static render
  // has no effect to read a stored locale, so it is Russian.
  const qualifiers: DictKey[] = [
    "proveEdge.anchor.prefix",
    "proveEdge.outOfBox.exact",
    "proveEdge.footnote.point",
    "proveEdge.footnote.banded",
    "proveEdge.footnote.oceanKo",
  ];
  const shownQualifiers = (markup: string) =>
    qualifiers.filter((key) => markup.replace(/<[^>]*>/g, "").includes(DICT[key].ru));
  const noise = (markup: string) =>
    markup.match(new RegExp(`${DICT["proveEdge.schedule.noise"].ru} ([^<]*)<`))?.[1];

  it("the prove-edge card prints no NaN, answer line, zone warning, band footnote or noise", () => {
    const markup = render(
      <ProveEdgeCard schedule={free} finishModel={MODEL} itmTarget={ITM} defaultMode="exact" />,
    );
    expect(markup).not.toContain("NaN");
    expect(shownQualifiers(markup)).toEqual([]);
    expect(noise(markup)).toBe("—");
  });

  it.each([
    { players: 1000, shown: ["proveEdge.anchor.prefix", "proveEdge.footnote.banded"] },
    {
      players: 30,
      shown: ["proveEdge.anchor.prefix", "proveEdge.outOfBox.exact", "proveEdge.footnote.point"],
    },
  ])("its compiled twin at field $players prints its σ and the lines that go with it", ({ players, shown }) => {
    const twin = [{ ...free[0], buyIn: 10, players }];
    const markup = render(
      <ProveEdgeCard schedule={twin} finishModel={MODEL} itmTarget={ITM} defaultMode="exact" />,
    );
    expect(shownQualifiers(markup)).toEqual(shown);
    expect(noise(markup)).toBe(buildExactBreakdown(twin, { finishModel: MODEL })!.sigmaEff.toFixed(2));
  });
});
