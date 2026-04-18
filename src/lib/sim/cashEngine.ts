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
} from "./cashTypes";

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
  /** Envelope grid: column-major (K1 columns × shardS rows). BR at checkpoint j of sample s = envMatrix[j*shardS + s]. */
  envMatrix: Float64Array;
  /** Hi-res grid positions in hands space, length K_HI + 1. */
  hiCheckpointIdx: Int32Array;
  /** Full trajectories for up to HI_RES_PATH_CAP samples of the leading shard. */
  hiResPaths: Float64Array[];
  /** Pointwise best / worst on the hi-res grid, tracked across the shard. */
  hiResBestPath: Float64Array;
  hiResWorstPath: Float64Array;
  /** Sample index that owns hiResBestPath / hiResWorstPath (global). */
  hiResBestSample: number;
  hiResWorstSample: number;
  /** Final-BR value of the current best / worst sample — used to merge shards. */
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
  const wrPerHand = input.wrBb100 / 100;
  const sdPerHand = input.sdBb100 / 10; // √100 = 10
  const rbPerHand = input.rake.enabled
    ? (input.rake.contributedRakeBb100 *
        (input.rake.advertisedRbPct / 100) *
        input.rake.pvi) /
      100
    : 0;
  const driftPerHand = wrPerHand + rbPerHand;

  const envK1 = envGrid.K + 1;
  const envIdx = envGrid.checkpointIdx;
  const hiK1 = hiResGrid.K + 1;
  const hiIdx = hiResGrid.checkpointIdx;

  const finalBb = new Float64Array(shardS);
  const maxDrawdownBb = new Float64Array(shardS);
  const longestBreakevenHands = new Int32Array(shardS);
  const recoveryHands = new Int32Array(shardS);
  // Column-major: envMatrix[j*shardS + s] — keeps each envelope column
  // contiguous for the later sort pass.
  const envMatrix = new Float64Array(envK1 * shardS);

  const storeHi = sStart === 0;
  const hiCount = storeHi ? Math.min(HI_RES_PATH_CAP, shardS) : 0;
  const hiResPaths: Float64Array[] = new Array(hiCount);
  for (let i = 0; i < hiCount; i++) hiResPaths[i] = new Float64Array(hiK1);
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
    let peakHand = 0;
    let longestBreakeven = 0;

    // Envelope column index pointer: envIdx[nextEnv] is the next hand at
    // which we record the envelope checkpoint.
    let nextEnv = 0;
    if (envIdx[0] === 0) {
      envMatrix[0 * shardS + localS] = 0;
      nextEnv = 1;
    }
    let nextHi = 0;
    const hiPath = localS < hiCount ? hiResPaths[localS] : null;
    if (hiPath && hiIdx[0] === 0) {
      hiPath[0] = 0;
      nextHi = 1;
    }

    // Box-Muller cache.
    let haveCachedZ = false;
    let cachedZ = 0;

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
      br += driftPerHand + sdPerHand * z;
      const handIdx = i + 1;

      // Peak / drawdown / breakeven bookkeeping.
      if (br >= peak) {
        const streak = handIdx - peakHand;
        if (streak > longestBreakeven) longestBreakeven = streak;
        peak = br;
        peakHand = handIdx;
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

    // Final breakeven stretch: if we ended below peak, the trailing stretch
    // from peakHand to H may be the longest.
    const trailing = H - peakHand;
    if (trailing > longestBreakeven) longestBreakeven = trailing;

    finalBb[localS] = br;
    maxDrawdownBb[localS] = maxDd;
    longestBreakevenHands[localS] = longestBreakeven;
    recoveryHands[localS] =
      deepestDdHand < 0 ? 0 : recoveryHand < 0 ? -1 : recoveryHand;

    // Track best / worst by final BR across the shard so downstream
    // merging just compares two finals.
    if (storeHi) {
      if (br > hiResBestFinal) {
        hiResBestFinal = br;
        hiResBestSample = s;
        // Replay the checkpoint values from hiPath if we captured it,
        // otherwise we need to re-run — but we only track best/worst among
        // the first HI_RES_PATH_CAP samples where hiPath is available, so
        // this branch never triggers outside that window.
        if (hiPath) hiResBestPath.set(hiPath);
      }
      if (br < hiResWorstFinal) {
        hiResWorstFinal = br;
        hiResWorstSample = s;
        if (hiPath) hiResWorstPath.set(hiPath);
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
    envMatrix,
    hiCheckpointIdx: hiIdx,
    hiResPaths,
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

  let cursor = 0;
  for (const sh of sorted) {
    const n = sh.sEnd - sh.sStart;
    finalBb.set(sh.finalBb, cursor);
    maxDd.set(sh.maxDrawdownBb, cursor);
    longestBe.set(sh.longestBreakevenHands, cursor);
    recovery.set(sh.recoveryHands, cursor);
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
  const col = new Float64Array(S);
  for (let j = 0; j < envK1; j++) {
    let acc = 0;
    for (let s = 0; s < S; s++) {
      const v = envAll[j * S + s];
      col[s] = v;
      acc += v;
    }
    mean_[j] = acc / S;
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

  // Hi-res paths / best / worst: take from the leading shard (sStart=0).
  const leading = sorted[0];
  const hiIdx = leading.hiCheckpointIdx;
  const xHi = new Int32Array(hiIdx);
  const paths = leading.hiResPaths;
  const sampleIndices: number[] = new Array(paths.length);
  for (let i = 0; i < paths.length; i++) sampleIndices[i] = i;
  // Pointwise best / worst across leading-shard hi-res paths. Cheap: re-scan
  // the hi-res bundle rather than relying on the shard's final-BR winner,
  // because pointwise extremes can cross samples along the trajectory.
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
  let sub100 = 0;
  let lossCount = 0;
  for (let s = 0; s < S; s++) {
    const v = finalBb[s];
    sumFinal += v;
    if (v < 0) lossCount++;
    if (v <= -100) sub100++;
  }
  const meanFinalBb = sumFinal / S;
  let varAcc = 0;
  for (let s = 0; s < S; s++) {
    const d = finalBb[s] - meanFinalBb;
    varAcc += d * d;
  }
  const sdFinalBb = Math.sqrt(varAcc / Math.max(1, S - 1));

  // Unrecovered share.
  let unrecovered = 0;
  for (let s = 0; s < S; s++) if (recovery[s] === -1) unrecovered++;
  const recoveryUnrecoveredShare = unrecovered / S;

  // Deterministic per-horizon totals (identical across paths given inputs).
  const totalRake = input.rake.enabled
    ? (input.rake.contributedRakeBb100 * input.hands) / 100
    : 0;
  const totalRb = input.rake.enabled
    ? totalRake * (input.rake.advertisedRbPct / 100) * input.rake.pvi
    : 0;
  const expectedEvBb =
    ((input.wrBb100 + (input.rake.enabled
      ? input.rake.contributedRakeBb100 *
        (input.rake.advertisedRbPct / 100) *
        input.rake.pvi
      : 0)) *
      input.hands) /
    100;
  const expectedEvUsd = expectedEvBb * input.bbSize;
  const meanFinalUsd = meanFinalBb * input.bbSize;
  const hourlyEvUsd = input.hoursBlock
    ? (expectedEvUsd / input.hands) * input.hoursBlock.handsPerHour
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
      sdFinalBb,
      probLoss: lossCount / S,
      probSub100Bb: sub100 / S,
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
  const envGrid = makeCashEnvGrid(input.hands);
  const hiResGrid = makeCashHiResGrid(input.hands);
  const shard = simulateCashShard(
    input,
    0,
    input.nSimulations,
    envGrid,
    hiResGrid,
  );
  return buildCashResult(input, [shard], envGrid);
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
