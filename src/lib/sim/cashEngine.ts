/**
 * Cash-game variance engine.
 *
 * Contract — see `cashTypes.ts`. Primary units are `bb/100` and `hands`;
 * the hot loop stays in BB. `bbSize` is a display lens applied at render
 * time in `CashResult.stats.*Usd` and never touches the random walk.
 *
 * Determinism: `CashInput` + `baseSeed` → byte-identical `CashResult`
 * regardless of shard layout. Per-path RNG seeds via
 * `mixSeed(baseSeed, sampleIdx)` on the GLOBAL sample index.
 *
 * Hot-loop model:
 *   wrPerHand = wrBb100 / 100
 *   sdPerHand = sdBb100 / sqrt(100) = sdBb100 / 10
 *   rbPerHand = rake.enabled
 *     ? (contributedRakeBb100 × rbPct/100 × pvi) / 100
 *     : 0
 *   BR[i+1] = BR[i] + wrPerHand + rbPerHand + sdPerHand × N(0,1)
 *
 * RB is accrued *smoothly* per hand rather than in 100-hand steps so the
 * trajectory and envelope curves read as clean slopes. The total RB over
 * the horizon is identical either way.
 */

import { mulberry32, mixSeed } from "./rng";
import type {
  CashInput,
  CashResult,
  CashSamplePaths,
  CashEnvelopes,
  CashStakeRow,
} from "./cashTypes";
import { normalizeCashInput } from "./cashInput";

/**
 * Per-row compiled rates in reference-bb per hand. Ref bb = `input.bbSize`.
 * `rowHands` is the exact hand budget allocated to that row after share
 * normalization and rounding.
 */
interface CompiledRow {
  label?: string;
  bbSize: number;
  wrBb100: number;
  sdBb100: number;
  rowHands: number;
  driftPerHand: number;
  sdPerHand: number;
  rbPerHand: number;
  /** Rake paid in ref-bb over this row's hands, totalled at compile time. */
  totalRakeRefBb: number;
  /** Rakeback earned in ref-bb, totalled. Includes PVI. */
  totalRbRefBb: number;
}

/**
 * Deterministic execution segments. In mix mode we interleave short blocks
 * instead of front-loading one stake then another, which would otherwise
 * exaggerate streak / recovery metrics.
 */
interface CompiledSegment {
  /** Last hand owned by this segment (exclusive, cumulative). */
  endHand: number;
  rowIx: number;
}

interface CompiledStakeSchedule {
  rows: CompiledRow[];
  segments: CompiledSegment[];
}

const MIX_BLOCK_HANDS = 100;

function allocateRowHands(
  totalHands: number,
  rowsSource: readonly CashStakeRow[],
): Int32Array {
  const weights = rowsSource.map((row) => Math.max(0, row.handShare));
  const weightSum = weights.reduce((acc, weight) => acc + weight, 0);
  const out = new Int32Array(rowsSource.length);
  if (totalHands <= 0) return out;
  if (weightSum <= 0) {
    const base = Math.floor(totalHands / Math.max(1, rowsSource.length));
    const remaining = totalHands - base * rowsSource.length;
    for (let i = 0; i < rowsSource.length; i++) {
      out[i] = base + (i < remaining ? 1 : 0);
    }
    return out;
  }

  const exact = new Array<number>(rowsSource.length);
  const floorSum = { value: 0 };
  for (let i = 0; i < rowsSource.length; i++) {
    const share = weights[i] / weightSum;
    const target = share * totalHands;
    const base = Math.floor(target);
    exact[i] = target;
    out[i] = base;
    floorSum.value += base;
  }

  let remaining = totalHands - floorSum.value;
  const order = exact
    .map((target, i) => ({
      i,
      frac: target - out[i],
      target,
    }))
    .sort(
      (a, b) =>
        b.frac - a.frac || b.target - a.target || a.i - b.i,
    );

  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) {
    out[order[k].i] += 1;
  }
  return out;
}

/**
 * Compile the row economics first, then build a deterministic interleaved
 * schedule of short blocks when more than one row is active. Legacy
 * single-stake inputs yield one row and one segment covering the full
 * horizon with ref-bb = row-bb (scale = 1).
 */
function compileStakeSchedule(input: CashInput): CompiledStakeSchedule {
  const refBb = input.bbSize;
  const rowsSource: CashStakeRow[] =
    input.stakes && input.stakes.length > 0
      ? input.stakes
      : [
          {
            wrBb100: input.wrBb100,
            sdBb100: input.sdBb100,
            bbSize: input.bbSize,
            handShare: 1,
            rake: input.rake,
          },
        ];

  const allocatedHands = allocateRowHands(input.hands, rowsSource);

  const compiledRows: CompiledRow[] = [];
  for (let r = 0; r < rowsSource.length; r++) {
    const row = rowsSource[r];
    const rowHands = allocatedHands[r];
    if (rowHands <= 0) continue;

    // Rescale each bb-denominated quantity to the reference-bb currency.
    const scale = row.bbSize / refBb;
    const wrBbRef = row.wrBb100 * scale;
    const sdBbRef = row.sdBb100 * scale;
    const rakeBbRef = row.rake.enabled ? row.rake.contributedRakeBb100 * scale : 0;

    const driftPerHand = wrBbRef / 100;
    const sdPerHand = sdBbRef / 10; // √100 = 10
    const rbRateBb100 = row.rake.enabled
      ? rakeBbRef * (row.rake.advertisedRbPct / 100) * row.rake.pvi
      : 0;
    const rbPerHand = rbRateBb100 / 100;
    const totalRakeRefBb = (rakeBbRef * rowHands) / 100;
    const totalRbRefBb = (rbRateBb100 * rowHands) / 100;

    compiledRows.push({
      ...(row.label ? { label: row.label } : {}),
      bbSize: row.bbSize,
      wrBb100: row.wrBb100,
      sdBb100: row.sdBb100,
      rowHands,
      driftPerHand,
      sdPerHand,
      rbPerHand,
      totalRakeRefBb,
      totalRbRefBb,
    });
  }

  // Guarantee at least one row covering the full horizon (edge case: all
  // handShares zero). Fall back to first source row with share = 1.
  if (compiledRows.length === 0) {
    const fallback = rowsSource[0];
    const scale = fallback.bbSize / refBb;
    const wrBbRef = fallback.wrBb100 * scale;
    const sdBbRef = fallback.sdBb100 * scale;
    const rakeBbRef = fallback.rake.enabled
      ? fallback.rake.contributedRakeBb100 * scale
      : 0;
    const rbRateBb100 = fallback.rake.enabled
      ? rakeBbRef * (fallback.rake.advertisedRbPct / 100) * fallback.rake.pvi
      : 0;
    compiledRows.push({
      ...(fallback.label ? { label: fallback.label } : {}),
      bbSize: fallback.bbSize,
      wrBb100: fallback.wrBb100,
      sdBb100: fallback.sdBb100,
      rowHands: input.hands,
      driftPerHand: wrBbRef / 100,
      sdPerHand: sdBbRef / 10,
      rbPerHand: rbRateBb100 / 100,
      totalRakeRefBb: (rakeBbRef * input.hands) / 100,
      totalRbRefBb: (rbRateBb100 * input.hands) / 100,
    });
  }

  if (compiledRows.length === 1) {
    return {
      rows: compiledRows,
      segments: [{ rowIx: 0, endHand: input.hands }],
    };
  }

  const remainingHands = compiledRows.map((row) => row.rowHands);
  const assignedBlocks = new Int32Array(compiledRows.length);
  const segments: CompiledSegment[] = [];
  let handCursor = 0;
  let blocksPlaced = 0;

  while (handCursor < input.hands) {
    const nextBlockOrdinal = blocksPlaced + 1;
    let bestIx = -1;
    let bestDeficit = -Infinity;
    let bestRemaining = -1;

    for (let i = 0; i < compiledRows.length; i++) {
      const remaining = remainingHands[i];
      if (remaining <= 0) continue;
      const targetBlocks =
        (compiledRows[i].rowHands / input.hands) * nextBlockOrdinal;
      const deficit = targetBlocks - assignedBlocks[i];
      if (
        deficit > bestDeficit + 1e-12 ||
        (Math.abs(deficit - bestDeficit) <= 1e-12 &&
          (remaining > bestRemaining ||
            (remaining === bestRemaining && (bestIx < 0 || i < bestIx))))
      ) {
        bestIx = i;
        bestDeficit = deficit;
        bestRemaining = remaining;
      }
    }

    if (bestIx < 0) {
      throw new Error("compileStakeSchedule: failed to allocate mix blocks");
    }

    const segLen = Math.min(
      MIX_BLOCK_HANDS,
      remainingHands[bestIx],
      input.hands - handCursor,
    );
    remainingHands[bestIx] -= segLen;
    assignedBlocks[bestIx] += 1;
    blocksPlaced += 1;
    handCursor += segLen;

    const last = segments[segments.length - 1];
    if (last && last.rowIx === bestIx) {
      last.endHand = handCursor;
    } else {
      segments.push({ rowIx: bestIx, endHand: handCursor });
    }
  }

  return { rows: compiledRows, segments };
}

// Envelope columns (sorted per x): cheap O(S log S) × K.
const ENV_K = 80;
// Hi-res sample-path checkpoints: ~one chart pixel at 2k+ resolution.
const HI_RES_MAX_POINTS = 2000;
// Memory cap: store full trajectories for only the first N samples.
const HI_RES_PATH_CAP = 200;
// Convergence pane: enough points for a smooth curve, not per-sample.
const CONV_POINTS = 80;

export interface CashShard {
  sStart: number;
  sEnd: number;
  /** BR at end of each sample (length = sEnd - sStart). */
  finalBb: Float64Array;
  /** Max drawdown (positive magnitude, BB) per sample. */
  maxDrawdownBb: Float64Array;
  /** Longest breakeven stretch in hands per sample. */
  longestBreakevenHands: Int32Array;
  /** Hands from deepest drawdown to recovery; -1 if never recovered. */
  recoveryHands: Int32Array;
  /** 1 if the running minimum touched <= -thresholdBb at any point. */
  hitBelowThreshold: Uint8Array;
  /** Envelope grid: column-major (K1 columns × shardS rows). BR at checkpoint j of sample s = envMatrix[j*shardS + s]. */
  envMatrix: Float64Array;
  /** Hi-res grid positions in hands space, length K_HI + 1. */
  hiCheckpointIdx: Int32Array;
  /** Full trajectories for this shard's overlap with the global hi-res prefix. */
  hiResPaths: Float64Array[];
  /** Global sample ids parallel to `hiResPaths`. */
  hiResSampleIndices: Int32Array;
  /** Best / worst final-bankroll sample among this shard's stored hi-res paths. */
  hiResBestPath: Float64Array;
  hiResWorstPath: Float64Array;
  /** Sample index that owns hiResBestPath / hiResWorstPath (global). */
  hiResBestSample: number;
  hiResWorstSample: number;
  /** Final-BR value of the current best / worst stored sample. */
  hiResBestFinal: number;
  hiResWorstFinal: number;
}

export interface CashCheckpointGrid {
  K: number;
  /** Hand index (0..hands) at each checkpoint, length K+1. */
  checkpointIdx: Int32Array;
}

export function makeCashEnvGrid(hands: number): CashCheckpointGrid {
  const K = Math.min(ENV_K, hands);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * hands) / K);
  return { K, checkpointIdx };
}

export function makeCashHiResGrid(hands: number): CashCheckpointGrid {
  const K = Math.min(HI_RES_MAX_POINTS, hands);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * hands) / K);
  return { K, checkpointIdx };
}

/**
 * Simulate a disjoint slice [sStart, sEnd) of sample paths. Safe to call
 * from a Web Worker; the returned buffers are transferable.
 */
export function simulateCashShard(
  input: CashInput,
  sStart: number,
  sEnd: number,
  envGrid: CashCheckpointGrid,
  hiResGrid: CashCheckpointGrid,
): CashShard {
  const shardS = sEnd - sStart;
  const H = input.hands;
  const schedule = compileStakeSchedule(input);
  const rows = schedule.rows;
  const segments = schedule.segments;
  const rowCount = rows.length;
  // Hot-loop arrays — Float64Array for tight access patterns. driftPerHand is
  // wr + rb folded together; keeping them separate would cost an extra add
  // per hand for no gain.
  const driftArr = new Float64Array(rowCount);
  const sdArr = new Float64Array(rowCount);
  const segEndArr = new Int32Array(segments.length);
  const segRowArr = new Int32Array(segments.length);
  for (let r = 0; r < rowCount; r++) {
    driftArr[r] = rows[r].driftPerHand + rows[r].rbPerHand;
    sdArr[r] = rows[r].sdPerHand;
  }
  for (let i = 0; i < segments.length; i++) {
    segEndArr[i] = segments[i].endHand;
    segRowArr[i] = segments[i].rowIx;
  }

  const envK1 = envGrid.K + 1;
  const envIdx = envGrid.checkpointIdx;
  const hiK1 = hiResGrid.K + 1;
  const hiIdx = hiResGrid.checkpointIdx;

  const finalBb = new Float64Array(shardS);
  const maxDrawdownBb = new Float64Array(shardS);
  const longestBreakevenHands = new Int32Array(shardS);
  const recoveryHands = new Int32Array(shardS);
  const hitBelowThreshold = new Uint8Array(shardS);
  const thresholdBb = Math.max(1, input.riskBlock?.thresholdBb ?? 100);
  // Column-major: envMatrix[j*shardS + s] — keeps each envelope column
  // contiguous for the later sort pass.
  const envMatrix = new Float64Array(envK1 * shardS);

  const hiPrefixStart = Math.max(0, sStart);
  const hiPrefixEnd = Math.min(HI_RES_PATH_CAP, sEnd);
  const hiCount = Math.max(0, hiPrefixEnd - hiPrefixStart);
  const hiResPaths: Float64Array[] = new Array(hiCount);
  const hiResSampleIndices = new Int32Array(hiCount);
  for (let i = 0; i < hiCount; i++) hiResPaths[i] = new Float64Array(hiK1);
  for (let i = 0; i < hiCount; i++) hiResSampleIndices[i] = hiPrefixStart + i;
  const hiResBestPath = new Float64Array(hiK1);
  const hiResWorstPath = new Float64Array(hiK1);
  let hiResBestSample = -1;
  let hiResWorstSample = -1;
  let hiResBestFinal = -Infinity;
  let hiResWorstFinal = Infinity;

  // Work buffers for Box-Muller — we pull two uniforms to produce two
  // standard normals; cache the second one for the next hand.
  for (let s = sStart; s < sEnd; s++) {
    const localS = s - sStart;
    const rng = mulberry32(mixSeed(input.baseSeed, s));

    let br = 0;
    let peak = 0;
    let maxDd = 0;
    let deepestDdHand = -1;
    let peakAtDeepest = 0;
    let recoveryHand = -1;
    let longestBreakeven = 0;
    let belowPeakRun = 0;

    // Envelope column index pointer: envIdx[nextEnv] is the next hand at
    // which we record the envelope checkpoint.
    let nextEnv = 0;
    if (envIdx[0] === 0) {
      envMatrix[0 * shardS + localS] = 0;
      nextEnv = 1;
    }
    let nextHi = 0;
    const hiSlot = s >= hiPrefixStart && s < hiPrefixEnd ? s - hiPrefixStart : -1;
    const hiPath = hiSlot >= 0 ? hiResPaths[hiSlot] : null;
    if (hiPath && hiIdx[0] === 0) {
      hiPath[0] = 0;
      nextHi = 1;
    }

    // Box-Muller cache.
    let haveCachedZ = false;
    let cachedZ = 0;

    // Current execution segment — advances as handIdx crosses segEndArr[i].
    let segIx = 0;
    let curRowIx = segRowArr[0];
    let curDrift = driftArr[curRowIx];
    let curSd = sdArr[curRowIx];
    let curSegEnd = segEndArr[0];

    for (let i = 0; i < H; i++) {
      let z: number;
      if (haveCachedZ) {
        z = cachedZ;
        haveCachedZ = false;
      } else {
        // Avoid log(0) by clamping u1 off zero; mulberry32 can return exactly 0.
        const u1 = Math.max(rng(), 1e-300);
        const u2 = rng();
        const r = Math.sqrt(-2 * Math.log(u1));
        const theta = 2 * Math.PI * u2;
        z = r * Math.cos(theta);
        cachedZ = r * Math.sin(theta);
        haveCachedZ = true;
      }
      br += curDrift + curSd * z;
      if (br <= -thresholdBb) hitBelowThreshold[localS] = 1;
      const handIdx = i + 1;
      while (handIdx >= curSegEnd && segIx < segEndArr.length - 1) {
        segIx++;
        curRowIx = segRowArr[segIx];
        curDrift = driftArr[curRowIx];
        curSd = sdArr[curRowIx];
        curSegEnd = segEndArr[segIx];
      }

      // Peak / drawdown / breakeven bookkeeping.
      if (br > peak) {
        peak = br;
        belowPeakRun = 0;
      } else if (br < peak) {
        belowPeakRun += 1;
        if (belowPeakRun > longestBreakeven) longestBreakeven = belowPeakRun;
      } else {
        belowPeakRun = 0;
      }
      const dd = peak - br;
      if (dd > maxDd) {
        maxDd = dd;
        deepestDdHand = handIdx;
        peakAtDeepest = peak;
        recoveryHand = -1;
      }
      if (
        deepestDdHand > 0 &&
        recoveryHand < 0 &&
        handIdx > deepestDdHand &&
        br >= peakAtDeepest
      ) {
        recoveryHand = handIdx - deepestDdHand;
      }

      // Env checkpoint.
      while (nextEnv < envK1 && envIdx[nextEnv] === handIdx) {
        envMatrix[nextEnv * shardS + localS] = br;
        nextEnv++;
      }
      // Hi-res checkpoint.
      if (hiPath && nextHi < hiK1 && hiIdx[nextHi] === handIdx) {
        hiPath[nextHi] = br;
        nextHi++;
      }
    }
    finalBb[localS] = br;
    maxDrawdownBb[localS] = maxDd;
    longestBreakevenHands[localS] = longestBreakeven;
    recoveryHands[localS] =
      deepestDdHand < 0 ? 0 : recoveryHand < 0 ? -1 : recoveryHand;

    // Track best / worst by final BR across the shard so downstream
    // merging just compares two finals.
    if (hiPath) {
      if (br > hiResBestFinal) {
        hiResBestFinal = br;
        hiResBestSample = s;
        hiResBestPath.set(hiPath);
      }
      if (br < hiResWorstFinal) {
        hiResWorstFinal = br;
        hiResWorstSample = s;
        hiResWorstPath.set(hiPath);
      }
    }
  }

  return {
    sStart,
    sEnd,
    finalBb,
    maxDrawdownBb,
    longestBreakevenHands,
    recoveryHands,
    hitBelowThreshold,
    envMatrix,
    hiCheckpointIdx: hiIdx,
    hiResPaths,
    hiResSampleIndices,
    hiResBestPath,
    hiResWorstPath,
    hiResBestSample,
    hiResWorstSample,
    hiResBestFinal,
    hiResWorstFinal,
  };
}

/**
 * Merge N shards into a single RawCashShard-equivalent, then compute the
 * full `CashResult`. Shards are stitched sample-index-ordered; the first
 * shard must start at sStart=0 so hi-res paths are well-defined.
 */
export function buildCashResult(
  input: CashInput,
  shards: CashShard[],
  envGrid: CashCheckpointGrid,
): CashResult {
  if (shards.length === 0) throw new Error("buildCashResult: no shards");
  // Sort defensively; worker pool may return out of order.
  const sorted = shards.slice().sort((a, b) => a.sStart - b.sStart);
  const S = input.nSimulations;
  const envK1 = envGrid.K + 1;

  const finalBb = new Float64Array(S);
  const maxDd = new Float64Array(S);
  const longestBe = new Int32Array(S);
  const recovery = new Int32Array(S);
  // Row-major env matrix for merged samples: envAll[j*S + s].
  const envAll = new Float64Array(envK1 * S);
  const thresholdBb = Math.max(1, input.riskBlock?.thresholdBb ?? 100);
  let belowThresholdEver = 0;

  let cursor = 0;
  for (const sh of sorted) {
    const n = sh.sEnd - sh.sStart;
    finalBb.set(sh.finalBb, cursor);
    maxDd.set(sh.maxDrawdownBb, cursor);
    longestBe.set(sh.longestBreakevenHands, cursor);
    recovery.set(sh.recoveryHands, cursor);
    for (let k = 0; k < n; k++) belowThresholdEver += sh.hitBelowThreshold[k];
    for (let j = 0; j < envK1; j++) {
      // Copy env column j from shard into [cursor..cursor+n).
      const dstBase = j * S + cursor;
      const srcBase = j * n;
      for (let k = 0; k < n; k++) envAll[dstBase + k] = sh.envMatrix[srcBase + k];
    }
    cursor += n;
  }
  if (cursor !== S) {
    throw new Error(
      `buildCashResult: shards covered ${cursor} samples, expected ${S}`,
    );
  }

  // Envelopes — sort each column once, read percentiles.
  const mean_ = new Float64Array(envK1);
  const p05 = new Float64Array(envK1);
  const p95 = new Float64Array(envK1);
  const p15 = new Float64Array(envK1);
  const p85 = new Float64Array(envK1);
  const p025 = new Float64Array(envK1);
  const p975 = new Float64Array(envK1);
  const envMin = new Float64Array(envK1);
  const envMax = new Float64Array(envK1);
  const profitShare = new Float64Array(envK1);
  const belowThresholdNowShare = new Float64Array(envK1);
  const col = new Float64Array(S);
  for (let j = 0; j < envK1; j++) {
    let acc = 0;
    let profitCount = 0;
    let belowThresholdNowCount = 0;
    for (let s = 0; s < S; s++) {
      const v = envAll[j * S + s];
      col[s] = v;
      acc += v;
      if (v > 0) profitCount++;
      if (v <= -thresholdBb) belowThresholdNowCount++;
    }
    mean_[j] = acc / S;
    profitShare[j] = profitCount / S;
    belowThresholdNowShare[j] = belowThresholdNowCount / S;
    col.sort();
    envMin[j] = col[0];
    envMax[j] = col[S - 1];
    const qIdx = (p: number) =>
      Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))));
    p05[j] = col[qIdx(0.05)];
    p95[j] = col[qIdx(0.95)];
    p15[j] = col[qIdx(0.15)];
    p85[j] = col[qIdx(0.85)];
    p025[j] = col[qIdx(0.025)];
    p975[j] = col[qIdx(0.975)];
  }

  // Hi-res paths: concatenate each shard's overlap with the global hi-res
  // prefix so the displayed path budget is invariant to shard size.
  const leading = sorted[0];
  const hiIdx = leading.hiCheckpointIdx;
  const xHi = new Int32Array(hiIdx);
  const paths: Float64Array[] = [];
  const sampleIndices: number[] = [];
  for (const sh of sorted) {
    for (let i = 0; i < sh.hiResPaths.length; i++) {
      paths.push(sh.hiResPaths[i]);
      sampleIndices.push(sh.hiResSampleIndices[i]);
    }
  }
  // Pointwise best / worst across the stored hi-res bundle.
  const hiLen = hiIdx.length;
  const best = new Float64Array(hiLen);
  const worst = new Float64Array(hiLen);
  if (paths.length > 0) {
    best.set(paths[0]);
    worst.set(paths[0]);
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      for (let j = 0; j < hiLen; j++) {
        const v = p[j];
        if (v > best[j]) best[j] = v;
        if (v < worst[j]) worst[j] = v;
      }
    }
  }

  const samplePaths: CashSamplePaths = {
    x: xHi,
    paths,
    sampleIndices,
    best,
    worst,
  };

  const envelopes: CashEnvelopes = {
    x: envGrid.checkpointIdx,
    mean: mean_,
    p05,
    p95,
    p15,
    p85,
    p025,
    p975,
    min: envMin,
    max: envMax,
  };

  // Stats --------------------------------------------------------------------
  let sumFinal = 0;
  let profitCount = 0;
  let lossCount = 0;
  for (let s = 0; s < S; s++) {
    const v = finalBb[s];
    sumFinal += v;
    if (v > 0) profitCount++;
    if (v < 0) lossCount++;
  }
  const meanFinalBb = sumFinal / S;
  let varAcc = 0;
  for (let s = 0; s < S; s++) {
    const d = finalBb[s] - meanFinalBb;
    varAcc += d * d;
  }
  const sdFinalBb = Math.sqrt(varAcc / Math.max(1, S - 1));
  const finalSorted = new Float64Array(finalBb);
  finalSorted.sort();
  const maxDdSorted = new Float64Array(maxDd);
  maxDdSorted.sort();
  const longestBeSorted = new Int32Array(longestBe);
  longestBeSorted.sort();

  // Unrecovered share.
  let unrecovered = 0;
  for (let s = 0; s < S; s++) if (recovery[s] === -1) unrecovered++;
  const recoveryUnrecoveredShare = unrecovered / S;

  // Deterministic per-horizon totals. In mix mode these aggregate across
  // rows after rescaling to the reference bb. compileStakes does the math,
  // we just sum.
  const rows = compileStakeSchedule(input).rows;
  let totalRake = 0;
  let totalRb = 0;
  let expectedEvBb = 0;
  let totalVarianceBb2 = 0;
  for (const row of rows) {
    totalRake += row.totalRakeRefBb;
    totalRb += row.totalRbRefBb;
    expectedEvBb += (row.driftPerHand + row.rbPerHand) * row.rowHands;
    totalVarianceBb2 += row.rowHands * row.sdPerHand * row.sdPerHand;
  }
  const expectedEvUsd = expectedEvBb * input.bbSize;
  const meanFinalUsd = meanFinalBb * input.bbSize;
  const hourlyEvUsd = input.hoursBlock
    ? (expectedEvUsd / input.hands) * input.hoursBlock.handsPerHour
    : undefined;
  // Closed-form infinite-horizon RoR (Brownian motion absorbing
  // barrier). Uses cost-weighted aggregate drift / variance per hand
  // — collapses to Galfond's `exp(-2·br·wr/sd²)` in single-stake.
  const wrPerHandRefBb =
    input.hands > 0 ? expectedEvBb / input.hands : 0;
  const varPerHandRefBb =
    input.hands > 0 ? totalVarianceBb2 / input.hands : 0;
  const riskOfRuinAsymptotic =
    wrPerHandRefBb <= 0
      ? 1
      : varPerHandRefBb <= 0
        ? 0
        : Math.exp(
            -2 * thresholdBb * wrPerHandRefBb / varPerHandRefBb,
          );
  const mixBreakdown =
    input.stakes && input.stakes.length > 1
      ? {
          rows: rows.map((row) => {
            const varianceBb2 = row.rowHands * row.sdPerHand * row.sdPerHand;
            return {
              ...(row.label ? { label: row.label } : {}),
              wrBb100: row.wrBb100,
              sdBb100: row.sdBb100,
              bbSize: row.bbSize,
              hands: row.rowHands,
              handShare: input.hands > 0 ? row.rowHands / input.hands : 0,
              expectedEvBb: (row.driftPerHand + row.rbPerHand) * row.rowHands,
              varianceBb2,
              varianceShare:
                totalVarianceBb2 > 0 ? varianceBb2 / totalVarianceBb2 : 0,
              rakePaidBb: row.totalRakeRefBb,
              rakeShare: totalRake > 0 ? row.totalRakeRefBb / totalRake : 0,
              rbEarnedBb: row.totalRbRefBb,
              rbShare: totalRb > 0 ? row.totalRbRefBb / totalRb : 0,
            };
          }),
          totalVarianceBb2,
        }
      : undefined;

  // Histograms.
  const histogram = histogramOf(finalBb, 60, false, false);
  const drawdownHistogram = histogramOf(maxDd, 50, true, true);
  const longestBreakevenHistogram = histogramOfInt(longestBe, 50, true);
  // Recovery: skip -1 (unrecovered), hist the recovered-only slice.
  const recovered: number[] = [];
  for (let s = 0; s < S; s++) {
    if (recovery[s] >= 0) recovered.push(recovery[s]);
  }
  const recoveryArr = new Float64Array(recovered.length);
  for (let i = 0; i < recovered.length; i++) recoveryArr[i] = recovered[i];
  if (recoveryArr.length > 1) recoveryArr.sort();
  const recoveryHistogram =
    recoveryArr.length > 0
      ? histogramOf(recoveryArr, 40, true, true)
      : { binEdges: [0, 1], counts: [0] };

  // Convergence: running-mean of wr (bb/100) as samples accumulate.
  const convPoints = Math.min(CONV_POINTS, S);
  const convX = new Int32Array(convPoints);
  const convMean = new Float64Array(convPoints);
  const convSeLo = new Float64Array(convPoints);
  const convSeHi = new Float64Array(convPoints);
  let runSum = 0;
  let runSumSq = 0;
  const perPathWr = new Float64Array(S);
  for (let s = 0; s < S; s++) {
    perPathWr[s] = (finalBb[s] / input.hands) * 100;
  }
  let nextConv = 0;
  for (let s = 0; s < S; s++) {
    runSum += perPathWr[s];
    runSumSq += perPathWr[s] * perPathWr[s];
    const target = Math.floor(((nextConv + 1) * S) / convPoints);
    if (s + 1 === target && nextConv < convPoints) {
      const n = s + 1;
      const m = runSum / n;
      const v = n > 1 ? Math.max(0, (runSumSq - n * m * m) / (n - 1)) : 0;
      const se = Math.sqrt(v / n);
      convX[nextConv] = n;
      convMean[nextConv] = m;
      convSeLo[nextConv] = m - 1.96 * se;
      convSeHi[nextConv] = m + 1.96 * se;
      nextConv++;
    }
  }

  const result: CashResult = {
    type: "cash-result",
    echoInput: input,
    samples: S,
    finalBb,
    histogram,
    samplePaths,
    envelopes,
    drawdownHistogram,
    longestBreakevenHistogram,
    recoveryHistogram,
    ...(mixBreakdown ? { mixBreakdown } : {}),
    oddsOverDistance: {
      x: envGrid.checkpointIdx,
      thresholdBb,
      profitShare,
      belowThresholdNowShare,
    },
    convergence: {
      x: convX,
      mean: convMean,
      seLo: convSeLo,
      seHi: convSeHi,
    },
    stats: {
      expectedEvBb,
      expectedEvUsd,
      meanFinalBb,
      meanFinalUsd,
      finalBbMedian: quantileOfSorted(finalSorted, 0.5),
      finalBbP05: quantileOfSorted(finalSorted, 0.05),
      finalBbP95: quantileOfSorted(finalSorted, 0.95),
      sdFinalBb,
      probProfit: profitCount / S,
      probLoss: lossCount / S,
      probBelowThresholdEver: belowThresholdEver / S,
      riskOfRuinAsymptotic,
      maxDrawdownMedian: quantileOfSorted(maxDdSorted, 0.5),
      maxDrawdownP95: quantileOfSorted(maxDdSorted, 0.95),
      longestBreakevenMedian: quantileOfSorted(longestBeSorted, 0.5),
      recoveryMedian:
        recoveryArr.length > 0 ? quantileOfSorted(recoveryArr, 0.5) : Number.NaN,
      recoveryP90:
        recoveryArr.length > 0 ? quantileOfSorted(recoveryArr, 0.9) : Number.NaN,
      recoveryUnrecoveredShare,
      meanRakePaidBb: totalRake,
      meanRbEarnedBb: totalRb,
      hourlyEvUsd,
    },
  };
  return result;
}

/**
 * One-shot convenience: run every sample on the main thread. Workers call
 * `simulateCashShard` + `buildCashResult` directly. Tests use this.
 */
export function simulateCash(input: CashInput): CashResult {
  const normalized = normalizeCashInput(input);
  const envGrid = makeCashEnvGrid(normalized.hands);
  const hiResGrid = makeCashHiResGrid(normalized.hands);
  const shard = simulateCashShard(
    normalized,
    0,
    normalized.nSimulations,
    envGrid,
    hiResGrid,
  );
  return buildCashResult(normalized, [shard], envGrid);
}

// ---------------------------------------------------------------------------
// Histogram helpers — smaller variants of engine.ts's private functions,
// duplicated rather than exported from there because those are internal and
// the cash-mode shape is simple enough not to earn a shared abstraction.
// ---------------------------------------------------------------------------

function histogramOf(
  arr: Float64Array,
  bins: number,
  nonNegative: boolean,
  longTailClip: boolean,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  if (n === 0) return { binEdges: [0, 1], counts: new Array(bins).fill(0) };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (nonNegative) lo = 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) hi = lo + 1;
  if (longTailClip && n > 1) {
    const sorted = new Float64Array(arr);
    sorted.sort();
    const idx = Math.min(n - 1, Math.floor(0.999 * (n - 1)));
    const p999 = sorted[idx];
    if (p999 > lo + 1e-9 && p999 < hi) hi = p999;
  }
  const span = hi - lo;
  const binEdges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) binEdges[i] = lo + (span * i) / bins;
  const counts: number[] = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    let b = v >= hi ? bins - 1 : Math.floor(((v - lo) / span) * bins);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return { binEdges, counts };
}

function histogramOfInt(
  arr: Int32Array,
  bins: number,
  longTailClip: boolean,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  if (n === 0) return { binEdges: [0, 1], counts: new Array(bins).fill(0) };
  let hi = 0;
  for (let i = 0; i < n; i++) if (arr[i] > hi) hi = arr[i];
  if (hi === 0) return { binEdges: [0, 1], counts: new Array(bins).fill(0) };
  if (longTailClip && n > 1) {
    const sorted = new Int32Array(arr);
    sorted.sort();
    const idx = Math.min(n - 1, Math.floor(0.999 * (n - 1)));
    const p999 = sorted[idx];
    if (p999 > 0 && p999 < hi) hi = p999;
  }
  const w = hi <= bins ? 1 : Math.ceil(hi / bins);
  const realBins = Math.max(1, Math.ceil(hi / w));
  hi = realBins * w;
  const binEdges: number[] = new Array(realBins + 1);
  for (let i = 0; i <= realBins; i++) binEdges[i] = i * w;
  const counts: number[] = new Array(realBins).fill(0);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v <= 0) continue;
    let b = v >= hi ? realBins - 1 : Math.floor(v / w);
    if (b < 0) b = 0;
    else if (b >= realBins) b = realBins - 1;
    counts[b]++;
  }
  return { binEdges, counts };
}

function quantileOfSorted(
  sorted: ArrayLike<number>,
  p: number,
): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))));
  return sorted[idx];
}
