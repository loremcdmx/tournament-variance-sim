/** Deterministic model comparison. Full-field independent KO implementation;
 * integrates the winner's last wheel and every possible finish rank instead
 * of hoping a short one-player simulation happens to hit rare winner spins.
 * Run: npx tsx scripts/compare_ocean_ko.ts <trees> <output.json>
 */
import { writeFileSync } from "node:fs";
import { compileSchedule } from "../src/lib/sim/compile";
import { compiledEntryMoments } from "../src/lib/sim/scheduleMoments";
import { getPayoutTable } from "../src/lib/sim/payouts";
import { mulberry32 } from "../src/lib/sim/rng";
import type { TournamentRow } from "../src/lib/sim/types";

const trees = Number(process.argv[2] ?? 100_000);
const destination = process.argv[3];
if (!destination || !Number.isSafeInteger(trees) || trees < 100 || trees % 100 !== 0) {
  throw new Error("Provide trees (multiple of 100) and an output path");
}

// Independently transcribed from GG's detailed odds image, 2026-10-07.
const wheels = [
  [[400, .00002], [100, .0008], [10, .024], [2, .025], [1.5, .027], [1, .2], [.7, .22], [.5, .26228], [.4, .2409]],
  [[50, .001], [10, .01], [2, .03], [1.5, .12], [1, .381], [.5, .458]],
  [[10, .005], [2.5, .04], [1.5, .2], [1, .2425], [.6, .5125]],
  [[2.5, .05], [1.5, .2], [1, .25], [.65, .5]],
  [[1.5, .2], [1, .3], [.8, .5]],
];
const second = wheels.map((w) => w.reduce((s, [m, p]) => s + m * m * p, 0));
function band(head: number, ticket: number): number {
  if (head <= ticket * 50 || head < 10_000) return 0;
  if (head < 50_000) return 1;
  if (head < 250_000) return 2;
  if (head < 1_000_000) return 3;
  return 4;
}
function spin(head: number, ticket: number, rng: () => number): number {
  let u = rng();
  const w = wheels[band(head, ticket)];
  for (const [m, p] of w) {
    u -= p;
    if (u < 0) return m;
  }
  return w[w.length - 1][0];
}
function entry(row: TournamentRow) {
  return compileSchedule({ schedule: [row], scheduleRepeats: 1, samples: 1,
    seed: 91276007, bankroll: 0, finishModel: { id: "power-law" } }).flat[0];
}
function pmfOf(e: ReturnType<typeof entry>) {
  const pmf = new Float64Array(e.fieldSize);
  for (let i = 0; i < pmf.length; i++) {
    pmf[i] += e.aliasProb[i] / pmf.length;
    pmf[e.aliasIdx[i]] += (1 - e.aliasProb[i]) / pmf.length;
  }
  return pmf;
}
function stats(v: number[]) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  const sorted = [...v].sort((a, b) => a - b);
  return { mean, se: Math.sqrt(variance / v.length), min: sorted[0], max: sorted.at(-1) };
}
function compare(ticket: number, field: number, seed: number) {
  const row: TournamentRow = { id: "matched", players: field, buyIn: ticket * .92,
    rake: 8 / 92, bountyFraction: 50 / 92, roi: .1, count: 1,
    gameType: "ocean-ko", payoutStructure: "custom",
    customPayouts: getPayoutTable("mtt-gg-bounty", field) };
  const e = entry(row);
  const model = e.oceanKo!;
  if (!model) throw new Error("Ocean model missing");
  const pmf = pmfOf(e);
  const b = model.initialBounty;
  const scale = model.payoutScale;
  const meanW = e.analyticMeanSingle;
  const heads = new Float64Array(field);
  const control = new Float64Array(field);
  const parentRng = mulberry32(seed);
  const wheelRng = mulberry32(seed ^ 0x724836ba);
  const batchOcean: number[] = [];
  const batchPko: number[] = [];
  const batchMean: number[] = [];
  const wheelCounts = { x100: 0, x400: 0, legendary: 0, total: 0 };
  let maximumHead = b;
  const batches = 100;
  const perBatch = trees / batches;
  for (let batch = 0; batch < batches; batch++) {
    let e2Sum = 0, controlE2Sum = 0, meanSum = 0;
    for (let run = 0; run < perBatch; run++) {
      heads.fill(b); control.fill(b);
      let e2 = 0, controlE2 = 0, ew = 0;
      for (let eliminated = field - 1; eliminated > 0; eliminated--) {
        const cash = e.prizeByPlace[eliminated];
        const w = cash + scale * (heads[eliminated] - b);
        const cw = cash + scale * (control[eliminated] - b);
        const p = pmf[eliminated];
        e2 += p * w * w; controlE2 += p * cw * cw; ew += p * w;
        const killer = Math.floor(parentRng() * eliminated);
        const victimHead = heads[eliminated];
        const multiplier = spin(victimHead, ticket, wheelRng);
        wheelCounts.total++;
        if (multiplier === 100) wheelCounts.x100++;
        if (multiplier === 400) wheelCounts.x400++;
        if (band(victimHead, ticket) > 0) wheelCounts.legendary++;
        heads[killer] += victimHead * multiplier / 2;
        maximumHead = Math.max(maximumHead, heads[killer]);
        control[killer] += control[eliminated] / 2;
      }
      const h = heads[0], k = control[0], prize = e.prizeByPlace[0];
      const base = prize + scale * (h - b);
      // E[(base + scale * M * h)^2 | tree] with E[M|h] = 1.
      e2 += pmf[0] * (base * base + 2 * base * scale * h + scale * scale * second[band(h, ticket)] * h * h);
      ew += pmf[0] * (base + scale * h);
      controlE2 += pmf[0] * (prize + scale * (2 * k - b)) ** 2;
      e2Sum += e2; controlE2Sum += controlE2; meanSum += ew;
    }
    batchOcean.push((e2Sum / perBatch - meanW * meanW) / (ticket * ticket));
    batchPko.push((controlE2Sum / perBatch - meanW * meanW) / (ticket * ticket));
    batchMean.push(meanSum / perBatch / ticket - 1);
  }
  const ocean = stats(batchOcean), pkoControl = stats(batchPko);
  const empiricalSdInterval = [Math.sqrt(Math.max(0, ocean.mean - 1.984 * ocean.se)), Math.sqrt(ocean.mean + 1.984 * ocean.se)];
  let lowerSecond = 0, upperSecond = 0;
  for (let i = 0; i < field; i++) {
    const prize = e.prizeByPlace[i], mu = model.bountyMeanByPlace[i];
    lowerSecond += pmf[i] * (prize * prize + 2 * prize * mu + model.bountySecondLowerByPlace[i]);
    upperSecond += pmf[i] * (prize * prize + 2 * prize * mu + model.bountySecondUpperByPlace[i]);
  }
  const otherFormats = (["freezeout", "pko", "mystery"] as const).map((gameType) => {
    const reference = { ...row, gameType,
      bountyFraction: gameType === "freezeout" ? undefined : row.bountyFraction,
      mysteryBountyVariance: gameType === "mystery" ? 2 : undefined,
      pkoHeadVar: gameType === "pko" ? .4 : undefined };
    const c = entry(reference), m = compiledEntryMoments(c);
    return { format: gameType, sigmaBI: Math.sqrt(m.secondDollar - m.meanDollar ** 2) / ticket,
      roi: m.meanDollar / ticket - 1, source: "existing-engine-analytic-model" };
  });
  return { ticket, field, roi: .1, bountyFraction: 50 / 92, seed, trees, batches,
    payoutScale: scale, itm: e.itm, winProbability: pmf[0],
    ocean: { varianceBI2: ocean.mean, secondMomentBatchSE: ocean.se, sigmaBI: Math.sqrt(ocean.mean),
      empiricalSdInterval, batchVarianceRange: [ocean.min, ocean.max],
      analyticSdBounds: [Math.sqrt(Math.max(0, lowerSecond - meanW ** 2)) / ticket, Math.sqrt(Math.max(0, upperSecond - meanW ** 2)) / ticket],
      observedROI: stats(batchMean), label: "Monte Carlo estimate; interval is batch sampling error, not a guaranteed bound or real-world model uncertainty" },
    pkoSameTreeControl: { sigmaBI: Math.sqrt(pkoControl.mean), varianceBI2: pkoControl.mean },
    oceanVsSameTreePkoVarianceRatio: ocean.mean / pkoControl.mean,
    otherFormats,
    tailDiagnostics: { wheelCounts, maximumHead,
      firstHalfVariance: stats(batchOcean.slice(0, 50)).mean,
      secondHalfVariance: stats(batchOcean.slice(50)).mean,
      maxBatchShare: Math.max(...batchOcean) / batchOcean.reduce((a, b) => a + b, 0) },
    rawBatches: { oceanVarianceBI2: batchOcean, pkoControlVarianceBI2: batchPko, oceanROI: batchMean } };
}

const pilotOffset = trees < 100_000 ? 901 : 0;
const results = [compare(100, 1000, 1719276007 + pilotOffset), compare(10, 1000, 918627600 + pilotOffset)];
const br = entry({ id: "br", gameType: "mystery-royale", players: 18,
  buyIn: 9.2, rake: .8 / 9.2, bountyFraction: .45, roi: .1,
  count: 1, payoutStructure: "battle-royale", mysteryBountyVariance: 1.8 });
const bm = compiledEntryMoments(br);
writeFileSync(destination, JSON.stringify({ method: "Full random-killer fields; weighted over calibrated finishing PMF; analytic champion spin; 100 independent batches", results,
  battleRoyale: { ticket: 10, field: 18, roi: bm.meanDollar / br.singleCost - 1,
    sigmaBI: Math.sqrt(bm.secondDollar - bm.meanDollar ** 2) / br.singleCost,
    warning: "Different field size and payout/bounty structure; contextual reference only" } }, null, 2) + "\n");
process.stdout.write(JSON.stringify(results.map(({ rawBatches: _raw, ...summary }) => summary), null, 2) + "\n");
