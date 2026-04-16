/**
 * PKO finish-shape data from a 2026-04 real-data histogram.
 *
 * Source: PKO place-probability histogram, AFS 400-10k, ranks 2-12,
 * no re-entry/rebuy. 1,722,048 finishes. x-axis convention is
 * `x = (N - place + 1) / N * 100`, so x=100 is the winner and x=0.5 is the
 * first bust.
 *
 * Unlike freeze, PKO has a non-uniform non-cash zone with distinctive
 * features: early-bust depression (x<10: ~0.3x uniform), non-cash hump
 * (x=20-30: ~1.2x uniform), bubble trough (x=65-70: ~0.76x uniform),
 * and a pre-cash rise (x=75-84).
 *
 * Two zones with independent shaping:
 *   - Cash zone (x >= 84.5, top 15.5%): carries ITM_RATE mass, shaped
 *     by cash-conditional PKO density.
 *   - Non-cash zone (x < 84.5): carries (1 - ITM_RATE) mass, shaped
 *     by non-cash-conditional PKO density (NOT uniform).
 *
 * Three interpolation variants mirror the freeze API:
 *   - step   — place density = density of the containing bucket.
 *   - linear — linear interpolation between neighbouring bucket centres.
 *   - tilt   — step with a multiplicative tilt knob.
 *
 * ITM rate forced to match freeze (18.7%) per calibration decision.
 */

export const PKO_REALDATA_CUT_X = 84.5;
export const PKO_REALDATA_BUCKET_WIDTH = 0.5;
export const PKO_REALDATA_ITM_RATE = 0.187;
export const PKO_REALDATA_CASH_BAND_PCT = 15.5; // 100 − 84.5

// Cash-conditional density per 0.5% bucket (32 buckets, x ∈ [84.5, 100], sum≈1).
// Source: 368,729 PKO finishes in the cash zone.
export const PKO_REALDATA_CASH_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [84.5, 0.02699814769112275],
  [85, 0.02730731784047363],
  [85.5, 0.02803685091218754],
  [86, 0.02863891909776557],
  [86.5, 0.02877452004046332],
  [87, 0.02939557235801903],
  [87.5, 0.02939014832031112],
  [88, 0.02923556324563568],
  [88.5, 0.03027969050440839],
  [89, 0.03065123708740023],
  [89.5, 0.03103905578351581],
  [90, 0.03086548657686268],
  [90.5, 0.03152179513951981],
  [91, 0.03026613041013861],
  [91.5, 0.03072717361531097],
  [92, 0.03172519655356644],
  [92.5, 0.03129127353693363],
  [93, 0.03119092883933729],
  [93.5, 0.03114482451882005],
  [94, 0.03109872019830282],
  [94.5, 0.03174418068554413],
  [95, 0.03208047102343455],
  [95.5, 0.03269609930328236],
  [96, 0.03236252098424588],
  [96.5, 0.03269881132213631],
  [97, 0.03301340550919510],
  [97.5, 0.03338766411104090],
  [98, 0.03394091595724773],
  [98.5, 0.03375921069403275],
  [99, 0.03432059859680144],
  [99.5, 0.03526438115797781],
  [100, 0.03515318838496565],
];

// Non-cash-conditional density per 0.5% bucket (168 buckets, x ∈ [0.5, 84], sum≈1).
// Source: 1,353,319 PKO finishes outside the cash zone.
export const PKO_REALDATA_NONCASH_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.00169878646497980],
  [1, 0.00190937982840705],
  [1.5, 0.00206750958199804],
  [2, 0.00235864567038518],
  [2.5, 0.00234534503690556],
  [3, 0.00265347637918333],
  [3.5, 0.00280643366419891],
  [4, 0.00301924379987276],
  [4.5, 0.00320840836491618],
  [5, 0.00345373116020687],
  [5.5, 0.00381949858089630],
  [6, 0.00400940207002192],
  [6.5, 0.00407516631333780],
  [7, 0.00438994797235537],
  [7.5, 0.00456433405575478],
  [8, 0.00461236412109783],
  [8.5, 0.00487911571477235],
  [9, 0.00508379768554199],
  [9.5, 0.00529365212488704],
  [10, 0.00558626606143858],
  [10.5, 0.00564094644352145],
  [11, 0.00583528347714028],
  [11.5, 0.00602223126993710],
  [12, 0.00620326767007631],
  [12.5, 0.00628602716728281],
  [13, 0.00638578191837992],
  [13.5, 0.00651731040501168],
  [14, 0.00659563635772497],
  [14.5, 0.00666952876594506],
  [15, 0.00690376770000273],
  [15.5, 0.00684022022893346],
  [16, 0.00711731675975879],
  [16.5, 0.00703307941438789],
  [17, 0.00734342752891225],
  [17.5, 0.00743505411510516],
  [18, 0.00740919177222813],
  [18.5, 0.00735672816239187],
  [19, 0.00742101455754334],
  [19.5, 0.00757766646296993],
  [20, 0.00757766646296993],
  [20.5, 0.00744909367266698],
  [21, 0.00753998133477768],
  [21.5, 0.00767003197324504],
  [22, 0.00763825823771040],
  [22.5, 0.00781412216927421],
  [23, 0.00751485791598285],
  [23.5, 0.00762865222464179],
  [24, 0.00763382469321719],
  [24.5, 0.00785032944930205],
  [25, 0.00779638799130139],
  [25.5, 0.00766929304916284],
  [26, 0.00771436741817709],
  [26.5, 0.00766855412508064],
  [27, 0.00761313481891557],
  [27.5, 0.00773949083697192],
  [28, 0.00774688007779393],
  [28.5, 0.00761165697075117],
  [29, 0.00748677880085922],
  [29.5, 0.00765303671935442],
  [30, 0.00748825664902362],
  [30.5, 0.00753998133477768],
  [31, 0.00737446234036469],
  [31.5, 0.00746091645798219],
  [32, 0.00737372341628249],
  [32.5, 0.00745869968573559],
  [33, 0.00731682626195302],
  [33.5, 0.00738702404976210],
  [34, 0.00720524872554069],
  [34.5, 0.00714761264712902],
  [35, 0.00709588796137496],
  [35.5, 0.00709441011321056],
  [36, 0.00707741485931994],
  [36.5, 0.00706780884625133],
  [37, 0.00699761105844224],
  [37.5, 0.00694145282819498],
  [38, 0.00690524554816714],
  [38.5, 0.00671903667945252],
  [39, 0.00675376611131596],
  [39.5, 0.00678332307460399],
  [40, 0.00676632782071337],
  [40.5, 0.00663184363775281],
  [41, 0.00660745914304019],
  [41.5, 0.00647223603599743],
  [42, 0.00645302400986020],
  [42.5, 0.00658898604098516],
  [43, 0.00620991798681612],
  [43.5, 0.00646263002292881],
  [44, 0.00636583096816050],
  [44.5, 0.00627420438196759],
  [45, 0.00631410628240644],
  [45.5, 0.00616484361780186],
  [46, 0.00603331513117011],
  [46.5, 0.00604218222015652],
  [47, 0.00601262525686848],
  [47.5, 0.00604070437199212],
  [48, 0.00588109677023673],
  [48.5, 0.00596681196377203],
  [49, 0.00563429612678164],
  [49.5, 0.00579759834894803],
  [50, 0.00596828981193643],
  [50.5, 0.00562099549330202],
  [51, 0.00571483885174153],
  [51.5, 0.00567641479946709],
  [52, 0.00563577397494604],
  [52.5, 0.00568675973661790],
  [53, 0.00569710467376871],
  [53.5, 0.00551459042546510],
  [54, 0.00537641162209353],
  [54.5, 0.00550498441239649],
  [55, 0.00556483726305476],
  [55.5, 0.00532690370858608],
  [56, 0.00549316162708127],
  [56.5, 0.00546138789154663],
  [57, 0.00522641003340676],
  [57.5, 0.00518872490521451],
  [58, 0.00529882459346244],
  [58.5, 0.00531064737877766],
  [59, 0.00521532617217375],
  [59.5, 0.00527665687099642],
  [60, 0.00517246857540609],
  [60.5, 0.00512665528230964],
  [61, 0.00516877395499509],
  [61.5, 0.00507714736880218],
  [62, 0.00506532458348697],
  [62.5, 0.00509857616718601],
  [63, 0.00503576762019893],
  [63.5, 0.00494783565441703],
  [64, 0.00497148122504746],
  [64.5, 0.00495522489523904],
  [65, 0.00474389260772959],
  [65.5, 0.00480374545838786],
  [66, 0.00484438628290891],
  [66.5, 0.00479635621756585],
  [67, 0.00483330242167589],
  [67.5, 0.00472024703709916],
  [68, 0.00480817900288107],
  [68.5, 0.00486729292945714],
  [69, 0.00476310463386681],
  [69.5, 0.00479709514164805],
  [70, 0.00484290843474451],
  [70.5, 0.00485251444781312],
  [71, 0.00477640526734643],
  [71.5, 0.00485990368863513],
  [72, 0.00501655559406171],
  [72.5, 0.00486655400537493],
  [73, 0.00492419008378660],
  [73.5, 0.00498478185852707],
  [74, 0.00513256667496725],
  [74.5, 0.00514734515661126],
  [75, 0.00546656036012204],
  [75.5, 0.00536458883677832],
  [76, 0.00541631352253238],
  [76.5, 0.00560400023941140],
  [77, 0.00579094803220822],
  [77.5, 0.00573183410563215],
  [78, 0.00598011259725165],
  [78.5, 0.00618331671985689],
  [79, 0.00639908255185954],
  [79.5, 0.00646484679517542],
  [80, 0.00660080882630038],
  [80.5, 0.00651361578460067],
  [81, 0.00679957940441241],
  [81.5, 0.00694440852452378],
  [82, 0.00701682308457947],
  [82.5, 0.00699169966578464],
  [83, 0.00712248922833419],
  [83.5, 0.00718455885123907],
  [84, 0.00731165379337761],
];

export type PkoRealDataVariant = "step" | "linear" | "tilt";

const CASH_COUNT = PKO_REALDATA_CASH_BUCKETS.length;
const NONCASH_COUNT = PKO_REALDATA_NONCASH_BUCKETS.length;

function cashStepDensity(x: number): number {
  if (x <= PKO_REALDATA_CUT_X) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (x >= 100) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  const bx = Math.ceil(x * 2) / 2;
  const idx = Math.round((bx - PKO_REALDATA_CUT_X) * 2);
  if (idx < 0) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (idx >= CASH_COUNT) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  return PKO_REALDATA_CASH_BUCKETS[idx][1];
}

function cashLinearDensity(x: number): number {
  if (x <= PKO_REALDATA_CUT_X) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (x >= 100) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  const t = (x - PKO_REALDATA_CUT_X) / PKO_REALDATA_BUCKET_WIDTH;
  const lo = Math.floor(t);
  const hi = Math.min(CASH_COUNT - 1, lo + 1);
  const frac = t - lo;
  return (
    PKO_REALDATA_CASH_BUCKETS[lo][1] * (1 - frac) +
    PKO_REALDATA_CASH_BUCKETS[hi][1] * frac
  );
}

function nonCashStepDensity(x: number): number {
  if (x <= 0.5) return PKO_REALDATA_NONCASH_BUCKETS[0][1];
  if (x >= 84) return PKO_REALDATA_NONCASH_BUCKETS[NONCASH_COUNT - 1][1];
  const bx = Math.ceil(x * 2) / 2;
  const idx = Math.round((bx - 0.5) * 2);
  if (idx < 0) return PKO_REALDATA_NONCASH_BUCKETS[0][1];
  if (idx >= NONCASH_COUNT) return PKO_REALDATA_NONCASH_BUCKETS[NONCASH_COUNT - 1][1];
  return PKO_REALDATA_NONCASH_BUCKETS[idx][1];
}

function nonCashLinearDensity(x: number): number {
  if (x <= 0.5) return PKO_REALDATA_NONCASH_BUCKETS[0][1];
  if (x >= 84) return PKO_REALDATA_NONCASH_BUCKETS[NONCASH_COUNT - 1][1];
  const t = (x - 0.5) / PKO_REALDATA_BUCKET_WIDTH;
  const lo = Math.floor(t);
  const hi = Math.min(NONCASH_COUNT - 1, lo + 1);
  const frac = t - lo;
  return (
    PKO_REALDATA_NONCASH_BUCKETS[lo][1] * (1 - frac) +
    PKO_REALDATA_NONCASH_BUCKETS[hi][1] * frac
  );
}

function tiltMultiplier(x: number, alphaTilt: number): number {
  const u = Math.max(1e-4, 1 - (x - 0.25) / 100);
  return Math.pow(u, -alphaTilt);
}

/**
 * Build the full finish PMF (length N) for one of the three real-data
 * PKO shapes. Cash zone = top `CASH_BAND_PCT%` of N, carrying `ITM_RATE`
 * mass; non-cash zone gets (1 − ITM_RATE) shaped by empirical PKO density.
 */
export function buildPkoCashPMF(
  N: number,
  variant: PkoRealDataVariant,
  alphaTilt: number,
): Float64Array {
  const pmf = new Float64Array(N);
  if (N <= 0) return pmf;
  if (N === 1) {
    pmf[0] = 1;
    return pmf;
  }

  const cashCount = Math.max(
    1,
    Math.min(N, Math.ceil((N * PKO_REALDATA_CASH_BAND_PCT) / 100)),
  );
  const cashMass = PKO_REALDATA_ITM_RATE;

  // Cash zone: shaped by PKO cash-conditional density
  let cs = 0;
  for (let rank = 1; rank <= cashCount; rank++) {
    const x = ((N - rank + 1) / N) * 100;
    let d: number;
    if (variant === "linear") d = cashLinearDensity(x);
    else if (variant === "tilt") d = cashStepDensity(x) * tiltMultiplier(x, alphaTilt);
    else d = cashStepDensity(x);
    pmf[rank - 1] = d;
    cs += d;
  }

  if (cs > 0) {
    const scale = cashMass / cs;
    for (let i = 0; i < cashCount; i++) pmf[i] *= scale;
  }

  // Non-cash zone: shaped by PKO non-cash-conditional density
  const ootmCount = N - cashCount;
  if (ootmCount > 0) {
    let ns = 0;
    for (let rank = cashCount + 1; rank <= N; rank++) {
      const x = ((N - rank + 1) / N) * 100;
      let d: number;
      if (variant === "linear") d = nonCashLinearDensity(x);
      else if (variant === "tilt") d = nonCashStepDensity(x) * tiltMultiplier(x, alphaTilt);
      else d = nonCashStepDensity(x);
      pmf[rank - 1] = d;
      ns += d;
    }
    if (ns > 0) {
      const scale = (1 - cashMass) / ns;
      for (let i = cashCount; i < N; i++) pmf[i] *= scale;
    }
  }

  return pmf;
}
