/**
 * Cash-game variance engine.
 *
 * Contract — see `cashTypes.ts`. Primary units are `bb/100` and `hands`;
 * the hot loop stays in BB. `bbSize` is a display lens applied at render
 * time in `CashResult.stats.*Usd` and never touches the random walk.
 *
 * Determinism: `CashInput` + `baseSeed` → byte-identical `CashResult`
 * regardless of shard layout. Per-path RNG is
 * `sampleStreamUint32(baseSeed, sampleIdx, STREAM_CASH)` on the GLOBAL sample
 * index (plus `STREAM_CASH_WR` when `wrStdErr > 0`).
 *
 * Hot-loop model:
 *   wrPerHand = wrBb100 / 100
 *   sdPerHand = sdBb100 / sqrt(100) = sdBb100 / 10
 *   rbPerHand = rake.enabled
 *     ? (contributedRakeBb100 × rbPct/100 × pvi) / 100
 *     : 0
 *   BR[i+1] = BR[i] + wrPerHand + rbPerHand + sdPerHand × N(0,1)
 *
 * Normal deviates come from a 128-layer Marsaglia-Tsang Ziggurat fed directly
 * by xoshiro128** 32-bit draws (~98.9% fast-path without transcendental calls,
 * symmetric 1-bit sign + 24-bit magnitude, exact tail via `1 - u` under log).
 */

import { upsampleToGrid } from "./grids";
import { selectQuantilesFromCopy, selectSortedRanks } from "./orderStatistics";
import {
  STREAM_CASH,
  STREAM_CASH_WR,
  sampleStreamState,
  sampleStreamUint32,
} from "./rng";
import type {
  CashInput,
  CashResult,
  CashSamplePaths,
  CashEnvelopes,
  CashStakeRow,
  CashSwingEntry,
} from "./cashTypes";
import { normalizeCashInput } from "./cashInput";

// ---------------------------------------------------------------------------
// 128-layer Marsaglia-Tsang Ziggurat for standard normal N(0, 1).
// Uses 7 bits for layer index [0..127], 1 bit for exact 50/50 sign, and
// 24 bits for magnitude [0..2^24 - 1] (centered at mag + 0.5).
// ---------------------------------------------------------------------------
const ZIG_R = 3.442619855899;
const ZIG_V = 9.91256303526217e-3;
const ZIG_M = 16777216; // 2^24
const ZIG_KN = new Uint32Array(128);
const ZIG_WN = new Float64Array(128);
const ZIG_FN = new Float64Array(128);

(() => {
  let dn = ZIG_R;
  let tn = ZIG_R;
  const q = ZIG_V / Math.exp(-0.5 * dn * dn);
  ZIG_KN[0] = Math.floor((dn / q) * ZIG_M);
  ZIG_KN[1] = 0;
  ZIG_WN[0] = q / ZIG_M;
  ZIG_WN[127] = dn / ZIG_M;
  ZIG_FN[0] = 1.0;
  ZIG_FN[127] = Math.exp(-0.5 * dn * dn);
  for (let i = 126; i >= 1; i--) {
    dn = Math.sqrt(-2 * Math.log(ZIG_V / dn + Math.exp(-0.5 * dn * dn)));
    ZIG_KN[i + 1] = Math.floor((dn / tn) * ZIG_M);
    tn = dn;
    ZIG_FN[i] = Math.exp(-0.5 * dn * dn);
    ZIG_WN[i] = dn / ZIG_M;
  }
})();

function nextXoshiroState(st: Uint32Array): number {
  let s0 = st[0] | 0;
  let s1 = st[1] | 0;
  let s2 = st[2] | 0;
  let s3 = st[3] | 0;
  const r = Math.imul(s1, 5);
  const out = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
  const t = s1 << 9;
  s2 ^= s0;
  s3 ^= s1;
  s1 ^= s2;
  s0 ^= s3;
  s2 ^= t;
  s3 = (s3 << 11) | (s3 >>> 21);
  st[0] = s0;
  st[1] = s1;
  st[2] = s2;
  st[3] = s3;
  return out;
}

function zigguratSlowState(
  mag: number,
  iz: number,
  neg: boolean,
  st: Uint32Array,
): number {
  for (;;) {
    if (iz === 0) {
      let x: number;
      let y: number;
      do {
        x = -Math.log(1 - nextXoshiroState(st) / 4294967296) / ZIG_R;
        y = -Math.log(1 - nextXoshiroState(st) / 4294967296);
      } while (y + y < x * x);
      return neg ? -(ZIG_R + x) : ZIG_R + x;
    }
    const x = (mag + 0.5) * ZIG_WN[iz];
    const u = (nextXoshiroState(st) + 0.5) / 4294967296;
    if (ZIG_FN[iz] + u * (ZIG_FN[iz - 1] - ZIG_FN[iz]) < Math.exp(-0.5 * x * x)) {
      return neg ? -x : x;
    }
    const u32 = nextXoshiroState(st);
    iz = u32 & 127;
    neg = (u32 & 128) !== 0;
    mag = u32 >>> 8;
    if (mag < ZIG_KN[iz]) {
      const accepted = (mag + 0.5) * ZIG_WN[iz];
      return neg ? -accepted : accepted;
    }
  }
}

function zigguratSlow(
  mag: number,
  iz: number,
  neg: boolean,
  nextU32: () => number,
): number {
  for (;;) {
    if (iz === 0) {
      let x: number;
      let y: number;
      do {
        // Strictly in (0, 1] so a zero draw can never reach Math.log.
        x = -Math.log(1 - nextU32() / 4294967296) / ZIG_R;
        y = -Math.log(1 - nextU32() / 4294967296);
      } while (y + y < x * x);
      return neg ? -(ZIG_R + x) : ZIG_R + x;
    }
    const x = (mag + 0.5) * ZIG_WN[iz];
    const u = (nextU32() + 0.5) / 4294967296;
    if (ZIG_FN[iz] + u * (ZIG_FN[iz - 1] - ZIG_FN[iz]) < Math.exp(-0.5 * x * x)) {
      return neg ? -x : x;
    }
    const u32 = nextU32();
    iz = u32 & 127;
    neg = (u32 & 128) !== 0;
    mag = u32 >>> 8;
    if (mag < ZIG_KN[iz]) {
      const accepted = (mag + 0.5) * ZIG_WN[iz];
      return neg ? -accepted : accepted;
    }
  }
}

export function sampleStandardNormal(nextU32: () => number): number {
  const u32 = nextU32();
  const iz = u32 & 127;
  const neg = (u32 & 128) !== 0;
  const mag = u32 >>> 8;
  if (mag < ZIG_KN[iz]) {
    const x = (mag + 0.5) * ZIG_WN[iz];
    return neg ? -x : x;
  }
  return zigguratSlow(mag, iz, neg, nextU32);
}

/**
 * Per-row compiled rates in reference-bb per hand. Ref bb = `input.bbSize`.
 * `rowHands` is the exact hand budget allocated to that row after share
 * normalization and rounding.
 */
interface CompiledRow {
  label?: string;
  bbSize: number;
  scale: number;
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

export const MIX_BLOCK_HANDS = 100;

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
  let floorSum = 0;
  for (let i = 0; i < rowsSource.length; i++) {
    const share = weights[i] / weightSum;
    const target = share * totalHands;
    const base = Math.floor(target);
    exact[i] = target;
    out[i] = base;
    floorSum += base;
  }

  let remaining = totalHands - floorSum;
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
export function compileStakeSchedule(input: CashInput): CompiledStakeSchedule {
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

  const buildRow = (row: CashStakeRow, rowHands: number): CompiledRow => {
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

    return {
      ...(row.label ? { label: row.label } : {}),
      bbSize: row.bbSize,
      scale,
      wrBb100: row.wrBb100,
      sdBb100: row.sdBb100,
      rowHands,
      driftPerHand,
      sdPerHand,
      rbPerHand,
      totalRakeRefBb,
      totalRbRefBb,
    };
  };

  const compiledRows: CompiledRow[] = [];
  for (let r = 0; r < rowsSource.length; r++) {
    const rowHands = allocatedHands[r];
    if (rowHands <= 0) continue;
    compiledRows.push(buildRow(rowsSource[r], rowHands));
  }

  // Guarantee at least one row covering the full horizon (edge case: all
  // handShares zero). Fall back to first source row with share = 1.
  if (compiledRows.length === 0) {
    compiledRows.push(buildRow(rowsSource[0], input.hands));
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

// Envelope columns: O(S) selection per column via Floyd-Rivest.
const ENV_K = 80;
// Hi-res sample-path checkpoints: ~one chart pixel at 2k+ resolution.
const HI_RES_MAX_POINTS = 2000;
// Memory cap: store full trajectories for the first N global samples.
export const HI_RES_PATH_CAP = 500;
// Convergence pane: enough points for a smooth curve, not per-sample.
const CONV_POINTS = 80;

export interface CashShard {
  sStart: number;
  sEnd: number;
  /** BR at end of each sample (length = sEnd - sStart). */
  finalBb: Float64Array;
  /** Running minimum BR (<= 0) per sample. */
  runningMinBb: Float64Array;
  /** Max drawdown (positive magnitude, BB) per sample. */
  maxDrawdownBb: Float64Array;
  /** Max run-up (positive magnitude from running trough, BB) per sample. */
  maxRunUpBb: Float64Array;
  /** Longest breakeven stretch in hands per sample. */
  longestBreakevenHands: Int32Array;
  /** Hands from deepest drawdown to recovery; -1 if never recovered, -2 if the path never had a drawdown. */
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
  /** Pointwise min / max across ALL samples in this shard on the hi-res grid. */
  hiResMin: Float64Array;
  hiResMax: Float64Array;
  /** Best / worst final-bankroll sample across ALL samples in this shard. */
  hiResBestPath: Float64Array;
  hiResWorstPath: Float64Array;
  /** Global sample index that owns hiResBestPath / hiResWorstPath. */
  hiResBestSample: number;
  hiResWorstSample: number;
  /** Final-BR value of the best / worst sample in this shard. */
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
  onProgress?: (done: number) => void,
): CashShard {
  const shardS = sEnd - sStart;
  const H = input.hands;
  const schedule = compileStakeSchedule(input);
  const rows = schedule.rows;
  const segments = schedule.segments;
  const rowCount = rows.length;
  const segCount = segments.length;

  // Hot-loop typed arrays: driftArr folds wr + rb together; scaleArr applies
  // optional per-sample wrStdErr proportionally across mixed stakes.
  const baseDriftArr = new Float64Array(rowCount);
  const scaleArr = new Float64Array(rowCount);
  const sdArr = new Float64Array(rowCount);
  const segEndArr = new Int32Array(segCount);
  const segRowArr = new Int32Array(segCount);
  for (let r = 0; r < rowCount; r++) {
    baseDriftArr[r] = rows[r].driftPerHand + rows[r].rbPerHand;
    scaleArr[r] = rows[r].scale;
    sdArr[r] = rows[r].sdPerHand;
  }
  for (let i = 0; i < segCount; i++) {
    segEndArr[i] = segments[i].endHand;
    segRowArr[i] = segments[i].rowIx;
  }
  const wrStdErr = Math.max(0, input.wrStdErr ?? 0);
  const hasWrUncertainty = wrStdErr > 0;
  const driftArr = hasWrUncertainty ? new Float64Array(rowCount) : baseDriftArr;

  const envK1 = envGrid.K + 1;
  const envIdx = envGrid.checkpointIdx;
  const hiK1 = hiResGrid.K + 1;
  const hiIdx = hiResGrid.checkpointIdx;

  const finalBb = new Float64Array(shardS);
  const runningMinBb = new Float64Array(shardS);
  const maxDrawdownBb = new Float64Array(shardS);
  const maxRunUpBb = new Float64Array(shardS);
  const longestBreakevenHands = new Int32Array(shardS);
  const recoveryHands = new Int32Array(shardS);
  const hitBelowThreshold = new Uint8Array(shardS);
  const thresholdBb = Math.max(1, input.riskBlock?.thresholdBb ?? 100);
  const negThreshold = -thresholdBb;

  // Column-major: envMatrix[j*shardS + s].
  const envMatrix = new Float64Array(envK1 * shardS);

  const hiPrefixStart = Math.max(0, sStart);
  const hiPrefixEnd = Math.min(HI_RES_PATH_CAP, sEnd);
  const hiCount = Math.max(0, hiPrefixEnd - hiPrefixStart);
  const hiResPaths: Float64Array[] = new Array(hiCount);
  const hiResSampleIndices = new Int32Array(hiCount);
  for (let i = 0; i < hiCount; i++) hiResPaths[i] = new Float64Array(hiK1);
  for (let i = 0; i < hiCount; i++) hiResSampleIndices[i] = hiPrefixStart + i;

  // Single reusable scratch path for samples past HI_RES_PATH_CAP so we can
  // track true all-sample best/worst paths with zero inner-loop allocations.
  const scratchHiPath = new Float64Array(hiK1);
  const hiResMin = new Float64Array(hiK1);
  const hiResMax = new Float64Array(hiK1);
  hiResMin.fill(Infinity);
  hiResMax.fill(-Infinity);
  const hiResBestPath = new Float64Array(hiK1);
  const hiResWorstPath = new Float64Array(hiK1);
  let hiResBestSample = -1;
  let hiResWorstSample = -1;
  let hiResBestFinal = -Infinity;
  let hiResWorstFinal = Infinity;

  // Adaptive in-shard progress ticks (10..30 ticks).
  const progressTicks = Math.max(10, Math.min(30, shardS));
  const progressStep = Math.max(1, Math.floor(shardS / progressTicks));
  let nextProgressAt = progressStep;

  const isSingleSegment = segCount === 1;
  const lastSegIx = segCount - 1;
  // Preallocated 4-word xoshiro128** scratch state — zero per-sample closure
  // allocation and zero per-hand function call on the 98.9% Ziggurat fast path.
  const rngState = new Uint32Array(4);

  for (let s = sStart; s < sEnd; s++) {
    const localS = s - sStart;
    sampleStreamState(input.baseSeed, s, STREAM_CASH, rngState);
    let s0 = rngState[0] | 0;
    let s1 = rngState[1] | 0;
    let s2 = rngState[2] | 0;
    let s3 = rngState[3] | 0;

    if (hasWrUncertainty) {
      const wrShiftPerHand =
        (sampleStandardNormal(
          sampleStreamUint32(input.baseSeed, s, STREAM_CASH_WR),
        ) *
          wrStdErr) /
        100;
      for (let r = 0; r < rowCount; r++) {
        driftArr[r] = baseDriftArr[r] + wrShiftPerHand * scaleArr[r];
      }
    }

    let br = 0;
    let peak = 0;
    let minBr = 0;
    let maxDd = 0;
    let maxUp = 0;
    let deepestDdHand = -1;
    let peakAtDeepest = 0;
    let recoveryHand = -1;
    let longestBreakeven = 0;
    let belowPeakRun = 0;
    let hitBelow = 0;

    let nextEnv = 0;
    if (envIdx[0] === 0) {
      envMatrix[localS] = 0;
      nextEnv = 1;
    }
    let nextEnvHand = nextEnv < envK1 ? envIdx[nextEnv] : -1;

    const hiSlot = s >= hiPrefixStart && s < hiPrefixEnd ? s - hiPrefixStart : -1;
    const hiBuf = hiSlot >= 0 ? hiResPaths[hiSlot] : scratchHiPath;
    let nextHi = 0;
    if (hiIdx[0] === 0) {
      hiBuf[0] = 0;
      if (0 < hiResMin[0]) hiResMin[0] = 0;
      if (0 > hiResMax[0]) hiResMax[0] = 0;
      nextHi = 1;
    }
    let nextHiHand = nextHi < hiK1 ? hiIdx[nextHi] : -1;

    let segIx = 0;
    let curRowIx = segRowArr[0];
    let curDrift = driftArr[curRowIx];
    let curSd = sdArr[curRowIx];
    let curSegEnd = segEndArr[0];

    for (let i = 0; i < H; i++) {
      // Inlined xoshiro128** + Ziggurat fast path (~98.9% of hands).
      const r = Math.imul(s1, 5);
      const u32 = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
      const t = s1 << 9;
      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = (s3 << 11) | (s3 >>> 21);

      const iz = u32 & 127;
      const neg = (u32 & 128) !== 0;
      const mag = u32 >>> 8;
      let z: number;
      if (mag < ZIG_KN[iz]) {
        const x = (mag + 0.5) * ZIG_WN[iz];
        z = neg ? -x : x;
      } else {
        rngState[0] = s0;
        rngState[1] = s1;
        rngState[2] = s2;
        rngState[3] = s3;
        z = zigguratSlowState(mag, iz, neg, rngState);
        s0 = rngState[0] | 0;
        s1 = rngState[1] | 0;
        s2 = rngState[2] | 0;
        s3 = rngState[3] | 0;
      }

      br += curDrift + curSd * z;
      if (br <= negThreshold) hitBelow = 1;
      const handIdx = i + 1;

      if (!isSingleSegment && handIdx >= curSegEnd && segIx < lastSegIx) {
        do {
          segIx++;
          curRowIx = segRowArr[segIx];
          curDrift = driftArr[curRowIx];
          curSd = sdArr[curRowIx];
          curSegEnd = segEndArr[segIx];
        } while (handIdx >= curSegEnd && segIx < lastSegIx);
      }

      // Peak / trough / drawdown / run-up / breakeven / recovery bookkeeping.
      if (br >= peak) {
        if (br > peak) peak = br;
        belowPeakRun = 0;
        if (
          deepestDdHand > 0 &&
          recoveryHand < 0 &&
          handIdx > deepestDdHand &&
          br >= peakAtDeepest
        ) {
          recoveryHand = handIdx - deepestDdHand;
        }
      } else {
        belowPeakRun += 1;
        if (belowPeakRun > longestBreakeven) longestBreakeven = belowPeakRun;
        const dd = peak - br;
        if (dd > maxDd) {
          maxDd = dd;
          deepestDdHand = handIdx;
          peakAtDeepest = peak;
          recoveryHand = -1;
        }
      }

      if (br < minBr) {
        minBr = br;
      } else {
        const up = br - minBr;
        if (up > maxUp) maxUp = up;
      }

      if (handIdx === nextEnvHand) {
        do {
          envMatrix[nextEnv * shardS + localS] = br;
          nextEnv++;
        } while (nextEnv < envK1 && envIdx[nextEnv] === handIdx);
        nextEnvHand = nextEnv < envK1 ? envIdx[nextEnv] : -1;
      }

      if (handIdx === nextHiHand) {
        do {
          hiBuf[nextHi] = br;
          if (br < hiResMin[nextHi]) hiResMin[nextHi] = br;
          if (br > hiResMax[nextHi]) hiResMax[nextHi] = br;
          nextHi++;
        } while (nextHi < hiK1 && hiIdx[nextHi] === handIdx);
        nextHiHand = nextHi < hiK1 ? hiIdx[nextHi] : -1;
      }
    }

    finalBb[localS] = br;
    runningMinBb[localS] = minBr;
    maxDrawdownBb[localS] = maxDd;
    maxRunUpBb[localS] = maxUp;
    longestBreakevenHands[localS] = longestBreakeven;
    recoveryHands[localS] =
      deepestDdHand < 0 ? -2 : recoveryHand < 0 ? -1 : recoveryHand;
    hitBelowThreshold[localS] = hitBelow;

    if (br > hiResBestFinal) {
      hiResBestFinal = br;
      hiResBestSample = s;
      hiResBestPath.set(hiBuf);
    }
    if (br < hiResWorstFinal) {
      hiResWorstFinal = br;
      hiResWorstSample = s;
      hiResWorstPath.set(hiBuf);
    }

    if (onProgress && localS + 1 >= nextProgressAt) {
      onProgress(localS + 1);
      nextProgressAt += progressStep;
    }
  }

  return {
    sStart,
    sEnd,
    finalBb,
    runningMinBb,
    maxDrawdownBb,
    maxRunUpBb,
    longestBreakevenHands,
    recoveryHands,
    hitBelowThreshold,
    envMatrix,
    hiCheckpointIdx: hiIdx,
    hiResPaths,
    hiResSampleIndices,
    hiResMin,
    hiResMax,
    hiResBestPath,
    hiResWorstPath,
    hiResBestSample,
    hiResWorstSample,
    hiResBestFinal,
    hiResWorstFinal,
  };
}

function topThreeIndices(values: Float64Array, S: number): number[] {
  let i0 = -1;
  let i1 = -1;
  let i2 = -1;
  for (let i = 0; i < S; i++) {
    const v = values[i];
    if (i0 < 0 || v > values[i0]) {
      i2 = i1;
      i1 = i0;
      i0 = i;
    } else if (i1 < 0 || v > values[i1]) {
      i2 = i1;
      i1 = i;
    } else if (i2 < 0 || v > values[i2]) {
      i2 = i;
    }
  }
  const out: number[] = [];
  if (i0 >= 0) out.push(i0);
  if (i1 >= 0) out.push(i1);
  if (i2 >= 0) out.push(i2);
  return out;
}

/** Smallest tenth-of-a-BB strictly above `value` so tied troughs stay strictly safe. */
function tenthBbAbove(value: number): number {
  const tenths = Math.floor(value * 10) + 1;
  const rounded = tenths / 10;
  if (rounded > value) return rounded;
  return (tenths + 1) / 10;
}

/**
 * Merge N shards into a full `CashResult`. Uses Floyd-Rivest order statistics
 * (`selectSortedRanks`) instead of full sorts and gathers envelope columns
 * directly from shards to avoid allocating a throwaway K × S matrix.
 */
export function buildCashResult(
  input: CashInput,
  shards: CashShard[],
  envGrid: CashCheckpointGrid,
): CashResult {
  if (shards.length === 0) throw new Error("buildCashResult: no shards");
  const sorted = shards.slice().sort((a, b) => a.sStart - b.sStart);
  const S = input.nSimulations;
  const envK1 = envGrid.K + 1;

  const finalBb = new Float64Array(S);
  const runningMinBb = new Float64Array(S);
  const maxDd = new Float64Array(S);
  const maxRunUp = new Float64Array(S);
  const longestBe = new Int32Array(S);
  const recovery = new Int32Array(S);
  const thresholdBb = Math.max(1, input.riskBlock?.thresholdBb ?? 100);
  let belowThresholdEver = 0;

  let cursor = 0;
  for (const sh of sorted) {
    const n = sh.sEnd - sh.sStart;
    finalBb.set(sh.finalBb, cursor);
    runningMinBb.set(sh.runningMinBb, cursor);
    maxDd.set(sh.maxDrawdownBb, cursor);
    maxRunUp.set(sh.maxRunUpBb, cursor);
    longestBe.set(sh.longestBreakevenHands, cursor);
    recovery.set(sh.recoveryHands, cursor);
    for (let k = 0; k < n; k++) belowThresholdEver += sh.hitBelowThreshold[k];
    cursor += n;
  }
  if (cursor !== S) {
    throw new Error(
      `buildCashResult: shards covered ${cursor} samples, expected ${S}`,
    );
  }

  // Envelopes — gather each column directly from shards into one reusable
  // scratch vector and pick 8 order statistics via Floyd-Rivest selection.
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
  const qRankS = (p: number) =>
    Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))));
  const envRanks = Int32Array.from([
    0,
    qRankS(0.025),
    qRankS(0.05),
    qRankS(0.15),
    qRankS(0.85),
    qRankS(0.95),
    qRankS(0.975),
    S - 1,
  ]);
  const envPicked = new Float64Array(envRanks.length);

  for (let j = 0; j < envK1; j++) {
    let acc = 0;
    let profitCount = 0;
    let belowThresholdNowCount = 0;
    let dst = 0;
    for (const sh of sorted) {
      const n = sh.sEnd - sh.sStart;
      const srcBase = j * n;
      const mat = sh.envMatrix;
      for (let k = 0; k < n; k++) {
        const v = mat[srcBase + k];
        col[dst++] = v;
        acc += v;
        if (v > 0) profitCount++;
        if (v <= -thresholdBb) belowThresholdNowCount++;
      }
    }
    mean_[j] = acc / S;
    profitShare[j] = profitCount / S;
    belowThresholdNowShare[j] = belowThresholdNowCount / S;
    if (acc !== acc) {
      col.sort();
      for (let r = 0; r < envRanks.length; r++) envPicked[r] = col[envRanks[r]];
    } else {
      selectSortedRanks(col, 0, S, envRanks, envPicked);
    }
    envMin[j] = envPicked[0];
    p025[j] = envPicked[1];
    p05[j] = envPicked[2];
    p15[j] = envPicked[3];
    p85[j] = envPicked[4];
    p95[j] = envPicked[5];
    p975[j] = envPicked[6];
    envMax[j] = envPicked[7];
  }

  // Hi-res paths + global best/worst + all-sample hi-res min/max.
  const leading = sorted[0];
  const hiIdx = leading.hiCheckpointIdx;
  const xHi = new Int32Array(hiIdx);
  const hiLen = hiIdx.length;
  const paths: Float64Array[] = [];
  const sampleIndices: number[] = [];
  const hiResMaxDd: number[] = [];
  const hiResLongestBe: number[] = [];

  const hiResMin = new Float64Array(hiLen);
  const hiResMax = new Float64Array(hiLen);
  hiResMin.fill(Infinity);
  hiResMax.fill(-Infinity);

  let realBestFinal = -Infinity;
  let realWorstFinal = Infinity;
  let realBestSample = 0;
  let realWorstSample = 0;
  let realBestPath: Float64Array = new Float64Array(hiLen);
  let realWorstPath: Float64Array = new Float64Array(hiLen);

  for (const sh of sorted) {
    for (let i = 0; i < sh.hiResPaths.length; i++) {
      const localS = sh.hiResSampleIndices[i] - sh.sStart;
      paths.push(sh.hiResPaths[i]);
      sampleIndices.push(sh.hiResSampleIndices[i]);
      hiResMaxDd.push(sh.maxDrawdownBb[localS]);
      hiResLongestBe.push(sh.longestBreakevenHands[localS]);
    }
    for (let j = 0; j < hiLen; j++) {
      if (sh.hiResMin[j] < hiResMin[j]) hiResMin[j] = sh.hiResMin[j];
      if (sh.hiResMax[j] > hiResMax[j]) hiResMax[j] = sh.hiResMax[j];
    }
    if (
      sh.hiResBestSample >= 0 &&
      (sh.hiResBestFinal > realBestFinal ||
        (sh.hiResBestFinal === realBestFinal && sh.hiResBestSample < realBestSample))
    ) {
      realBestFinal = sh.hiResBestFinal;
      realBestSample = sh.hiResBestSample;
      realBestPath = sh.hiResBestPath;
    }
    if (
      sh.hiResWorstSample >= 0 &&
      (sh.hiResWorstFinal < realWorstFinal ||
        (sh.hiResWorstFinal === realWorstFinal && sh.hiResWorstSample < realWorstSample))
    ) {
      realWorstFinal = sh.hiResWorstFinal;
      realWorstSample = sh.hiResWorstSample;
      realWorstPath = sh.hiResWorstPath;
    }
  }

  // Pointwise best / worst across the stored hi-res bundle.
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
    maxDrawdownBb: Float64Array.from(hiResMaxDd),
    longestBelowPeakHands: Int32Array.from(hiResLongestBe),
    best,
    worst,
    realBestPath,
    realWorstPath,
    realBestSample,
    realWorstSample,
    hiResMin,
    hiResMax,
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

  const upsampleClamp = (src: Float64Array): Float64Array => {
    const up = upsampleToGrid(src, envGrid.checkpointIdx, xHi);
    for (let j = 0; j < hiLen; j++) {
      if (up[j] < hiResMin[j]) up[j] = hiResMin[j];
      else if (up[j] > hiResMax[j]) up[j] = hiResMax[j];
    }
    return up;
  };
  const hiResEnvelopes: CashEnvelopes = {
    x: xHi,
    mean: upsampleClamp(mean_),
    p05: upsampleClamp(p05),
    p95: upsampleClamp(p95),
    p15: upsampleClamp(p15),
    p85: upsampleClamp(p85),
    p025: upsampleClamp(p025),
    p975: upsampleClamp(p975),
    min: hiResMin,
    max: hiResMax,
  };

  // Scalar stats (selection-based, no full sorts) ----------------------------
  let sumFinal = 0;
  let profitCount = 0;
  let lossCount = 0;
  let neverBelowZeroCount = 0;
  let upNeverBelowThresholdCount = 0;
  for (let s = 0; s < S; s++) {
    const v = finalBb[s];
    sumFinal += v;
    if (v > 0) profitCount++;
    if (v < 0) lossCount++;
    if (runningMinBb[s] >= 0) neverBelowZeroCount++;
    if (v > 0 && runningMinBb[s] > -thresholdBb) upNeverBelowThresholdCount++;
  }

  const finalPicked = selectQuantilesFromCopy(
    finalBb,
    Int32Array.from([
      0,
      qRankS(0.01),
      qRankS(0.05),
      qRankS(0.5),
      qRankS(0.95),
      qRankS(0.99),
      S - 1,
    ]),
  );
  const finalBbMin = finalPicked[0];
  const finalBbP01 = finalPicked[1];
  const finalBbP05 = finalPicked[2];
  const finalBbMedian = finalPicked[3];
  const finalBbP95 = finalPicked[4];
  const finalBbP99 = finalPicked[5];
  const finalBbMax = finalPicked[6];

  // Exact mean when all paths are identical (avoids ULP drift on constant runs).
  const meanFinalBb = finalBbMin === finalBbMax ? finalBbMin : sumFinal / S;

  let varAcc = 0;
  let downVarAcc = 0;
  let cvar95Acc = 0;
  let cvar95N = 0;
  for (let s = 0; s < S; s++) {
    const v = finalBb[s];
    const d = v - meanFinalBb;
    varAcc += d * d;
    if (v < 0) downVarAcc += v * v;
    if (v <= finalBbP05) {
      cvar95Acc += v;
      cvar95N++;
    }
  }
  const sdFinalBb = Math.sqrt(varAcc / Math.max(1, S - 1));
  const downSigma = Math.sqrt(downVarAcc / S);
  const sharpe = sdFinalBb > 0 ? meanFinalBb / sdFinalBb : 0;
  const sortino = downSigma > 0 ? meanFinalBb / downSigma : 0;
  const var95Bb = -finalBbP05;
  const cvar95Bb = cvar95N > 0 ? -cvar95Acc / cvar95N : 0;

  let sumZ3 = 0;
  let sumZ4 = 0;
  if (sdFinalBb > 0) {
    for (let s = 0; s < S; s++) {
      const z = (finalBb[s] - meanFinalBb) / sdFinalBb;
      const z2 = z * z;
      sumZ3 += z2 * z;
      sumZ4 += z2 * z2;
    }
  }
  const skewness =
    sdFinalBb > 0 && S >= 3 ? (S / ((S - 1) * (S - 2))) * sumZ3 : 0;
  const kurtosis =
    sdFinalBb > 0 && S >= 4
      ? ((S * (S + 1)) / ((S - 1) * (S - 2) * (S - 3))) * sumZ4 -
        (3 * (S - 1) * (S - 1)) / ((S - 2) * (S - 3))
      : 0;

  // Drawdown & breakeven quantiles via selection.
  let ddSum = 0;
  let ddWorst = 0;
  for (let s = 0; s < S; s++) {
    const v = maxDd[s];
    ddSum += v;
    if (v > ddWorst) ddWorst = v;
  }
  const maxDrawdownMean = ddSum / S;
  const ddPicked = selectQuantilesFromCopy(
    maxDd,
    Int32Array.from([qRankS(0.5), qRankS(0.95), qRankS(0.99), qRankS(0.999)]),
  );
  const maxDrawdownMedian = ddPicked[0];
  const maxDrawdownP95 = ddPicked[1];
  const maxDrawdownP99 = ddPicked[2];
  const maxDrawdownP999 = ddPicked[3];

  const beBuf = new Float64Array(S);
  for (let s = 0; s < S; s++) beBuf[s] = longestBe[s];
  const bePicked = new Float64Array(2);
  selectSortedRanks(beBuf, 0, S, Int32Array.from([qRankS(0.5), qRankS(0.999)]), bePicked);
  const longestBreakevenMedian = bePicked[0];
  const longestBreakevenP999 = bePicked[1];

  // Empirical finite-horizon minimum bankrolls (1% / 5% RoR).
  const worstTroughs = new Float64Array(S);
  for (let s = 0; s < S; s++) worstTroughs[s] = -runningMinBb[s];
  const empRorIdx = (alpha: number) => Math.max(0, S - Math.floor(alpha * S) - 1);
  const empRorPicked = new Float64Array(2);
  selectSortedRanks(
    worstTroughs,
    0,
    S,
    Int32Array.from([empRorIdx(0.05), empRorIdx(0.01)]),
    empRorPicked,
  );
  const minBankrollEmpirical5pctBb =
    empRorPicked[0] > 0 ? tenthBbAbove(empRorPicked[0]) : 0;
  const minBankrollEmpirical1pctBb =
    empRorPicked[1] > 0 ? tenthBbAbove(empRorPicked[1]) : 0;

  // Recovery stats over recovered paths only.
  let unrecovered = 0;
  let recoveredCount = 0;
  for (let s = 0; s < S; s++) {
    if (recovery[s] === -1) unrecovered++;
    else if (recovery[s] >= 0) recoveredCount++;
  }
  const recoveryUnrecoveredShare = unrecovered / S;
  let recoveryMedian = Number.NaN;
  let recoveryP90 = Number.NaN;
  let recoveryHistogram: { binEdges: number[]; counts: number[] } = {
    binEdges: [0, 1],
    counts: [0],
  };
  if (recoveredCount > 0) {
    const recoveryArr = new Float64Array(recoveredCount);
    let k = 0;
    for (let s = 0; s < S; s++) {
      if (recovery[s] >= 0) recoveryArr[k++] = recovery[s];
    }
    const qRec = (p: number) =>
      Math.min(
        recoveredCount - 1,
        Math.max(0, Math.floor(p * (recoveredCount - 1))),
      );
    const recPicked = selectQuantilesFromCopy(
      recoveryArr,
      Int32Array.from([qRec(0.5), qRec(0.9), qRec(0.999)]),
    );
    recoveryMedian = recPicked[0];
    recoveryP90 = recPicked[1];
    recoveryHistogram = histogramOf(recoveryArr, 40, true, true, recPicked[2]);
  }

  // Top-3 downswings and upswings across all S runs.
  const downswings: CashSwingEntry[] = topThreeIndices(maxDd, S).map((idx, i) => ({
    rank: i + 1,
    sampleIndex: idx,
    magnitudeBb: maxDd[idx],
    finalBb: finalBb[idx],
    longestBreakevenHands: longestBe[idx],
    recoveryHands: recovery[idx],
  }));
  const upswings: CashSwingEntry[] = topThreeIndices(maxRunUp, S).map((idx, i) => ({
    rank: i + 1,
    sampleIndex: idx,
    magnitudeBb: maxRunUp[idx],
    finalBb: finalBb[idx],
    longestBreakevenHands: longestBe[idx],
    recoveryHands: recovery[idx],
  }));

  // Deterministic per-horizon totals & closed-form Brownian bankroll metrics.
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

  const wrPerHandRefBb = input.hands > 0 ? expectedEvBb / input.hands : 0;
  const varPerHandRefBb = input.hands > 0 ? totalVarianceBb2 / input.hands : 0;
  const effectiveWrBb100 = wrPerHandRefBb * 100;
  const effectiveSdBb100 = Math.sqrt(Math.max(0, varPerHandRefBb)) * 10;
  const mcSeMeanBb100 =
    input.hands > 0 && S > 0
      ? ((sdFinalBb / Math.sqrt(S)) / input.hands) * 100
      : 0;

  // Closed-form infinite-horizon RoR (check zero variance BEFORE wr <= 0 so a
  // deterministic zero-drift, zero-variance path reports RoR = 0, not 1).
  const riskOfRuinAsymptotic =
    varPerHandRefBb <= 0
      ? wrPerHandRefBb < 0
        ? 1
        : 0
      : wrPerHandRefBb <= 0
        ? 1
        : Math.exp((-2 * thresholdBb * wrPerHandRefBb) / varPerHandRefBb);

  const brownianBankroll = (alpha: number): number => {
    if (varPerHandRefBb <= 0) return wrPerHandRefBb < 0 ? Infinity : 0;
    if (wrPerHandRefBb <= 0) return Infinity;
    return (-varPerHandRefBb * Math.log(alpha)) / (2 * wrPerHandRefBb);
  };
  const minBankrollRoR1pctBb = brownianBankroll(0.01);
  const minBankrollRoR5pctBb = brownianBankroll(0.05);
  const minBankrollRoR10pctBb = brownianBankroll(0.1);
  const kellyBankrollBb =
    wrPerHandRefBb > 0 && varPerHandRefBb > 0
      ? varPerHandRefBb / wrPerHandRefBb
      : Infinity;

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

  // Histograms (reusing precomputed p999 quantiles — zero extra sorts).
  const histogram = histogramOf(finalBb, 60, false, false);
  const drawdownHistogram = histogramOf(maxDd, 50, true, true, maxDrawdownP999);
  const longestBreakevenHistogram = histogramOfInt(
    longestBe,
    50,
    true,
    longestBreakevenP999,
  );

  // Convergence: Welford online mean/variance of wr (bb/100) — numerically
  // stable even on constant zero-SD runs (no catastrophic cancellation).
  const convPoints = Math.min(CONV_POINTS, S);
  const convX = new Int32Array(convPoints);
  const convMean = new Float64Array(convPoints);
  const convSeLo = new Float64Array(convPoints);
  const convSeHi = new Float64Array(convPoints);
  let wMean = 0;
  let wM2 = 0;
  let nextConv = 0;
  const invHands100 = 100 / input.hands;
  for (let s = 0; s < S; s++) {
    const n = s + 1;
    const xVal = finalBb[s] * invHands100;
    const delta = xVal - wMean;
    wMean += delta / n;
    wM2 += delta * (xVal - wMean);
    const target = Math.floor(((nextConv + 1) * S) / convPoints);
    if (n === target && nextConv < convPoints) {
      const v = n > 1 ? Math.max(0, wM2 / (n - 1)) : 0;
      const se = Math.sqrt(v / n);
      convX[nextConv] = n;
      convMean[nextConv] = wMean;
      convSeLo[nextConv] = wMean - 1.96 * se;
      convSeHi[nextConv] = wMean + 1.96 * se;
      nextConv++;
    }
  }

  return {
    type: "cash-result",
    echoInput: input,
    samples: S,
    finalBb,
    histogram,
    samplePaths,
    envelopes,
    hiResEnvelopes,
    downswings,
    upswings,
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
      finalBbMedian,
      finalBbP01,
      finalBbP05,
      finalBbP95,
      finalBbP99,
      finalBbMin,
      finalBbMax,
      sdFinalBb,
      skewness,
      kurtosis,
      sharpe,
      sortino,
      var95Bb,
      cvar95Bb,
      effectiveWrBb100,
      effectiveSdBb100,
      mcSeMeanBb100,
      probProfit: profitCount / S,
      probLoss: lossCount / S,
      neverBelowZeroFrac: neverBelowZeroCount / S,
      probUpNeverBelowThreshold: upNeverBelowThresholdCount / S,
      probBelowThresholdEver: belowThresholdEver / S,
      riskOfRuinAsymptotic,
      minBankrollRoR1pctBb,
      minBankrollRoR5pctBb,
      minBankrollRoR10pctBb,
      minBankrollEmpirical1pctBb,
      minBankrollEmpirical5pctBb,
      kellyBankrollBb,
      maxDrawdownMean,
      maxDrawdownMedian,
      maxDrawdownP95,
      maxDrawdownP99,
      maxDrawdownWorst: ddWorst,
      longestBreakevenMedian,
      recoveryMedian,
      recoveryP90,
      recoveryUnrecoveredShare,
      meanRakePaidBb: totalRake,
      meanRbEarnedBb: totalRb,
      hourlyEvUsd,
    },
  };
}

export function collectCashShardTransfers(shard: CashShard): Transferable[] {
  const out: Transferable[] = [
    shard.finalBb.buffer,
    shard.runningMinBb.buffer,
    shard.maxDrawdownBb.buffer,
    shard.maxRunUpBb.buffer,
    shard.longestBreakevenHands.buffer,
    shard.recoveryHands.buffer,
    shard.hitBelowThreshold.buffer,
    shard.envMatrix.buffer,
    shard.hiCheckpointIdx.buffer,
    shard.hiResSampleIndices.buffer,
    shard.hiResMin.buffer,
    shard.hiResMax.buffer,
    shard.hiResBestPath.buffer,
    shard.hiResWorstPath.buffer,
  ];
  for (const p of shard.hiResPaths) out.push(p.buffer);
  return out;
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
// Histogram helpers
// ---------------------------------------------------------------------------

function emptyHistogram(bins: number): { binEdges: number[]; counts: number[] } {
  const binEdges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) binEdges[i] = i;
  return { binEdges, counts: new Array(bins).fill(0) };
}

function histogramOf(
  arr: Float64Array,
  bins: number,
  nonNegative: boolean,
  longTailClip: boolean,
  precomputedP999?: number,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  if (n === 0) return emptyHistogram(bins);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (nonNegative) lo = 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
    if (!Number.isFinite(lo)) lo = 0;
    hi = lo + 1;
  }
  if (longTailClip && n > 1) {
    const p999 =
      precomputedP999 !== undefined
        ? precomputedP999
        : selectQuantilesFromCopy(
            arr,
            Int32Array.from([Math.min(n - 1, Math.floor(0.999 * (n - 1)))]),
          )[0];
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
  precomputedP999?: number,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  if (n === 0) return emptyHistogram(bins);
  let hi = 0;
  for (let i = 0; i < n; i++) if (arr[i] > hi) hi = arr[i];
  if (hi === 0) return emptyHistogram(bins);
  if (longTailClip && n > 1) {
    let p999 = precomputedP999;
    if (p999 === undefined) {
      const buf = new Float64Array(n);
      for (let i = 0; i < n; i++) buf[i] = arr[i];
      const out = new Float64Array(1);
      selectSortedRanks(
        buf,
        0,
        n,
        Int32Array.from([Math.min(n - 1, Math.floor(0.999 * (n - 1)))]),
        out,
      );
      p999 = out[0];
    }
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
