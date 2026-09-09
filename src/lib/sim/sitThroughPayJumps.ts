/** Apply the cash-EV-preserving finish transform shared by compile and preview. */
export function applySitThroughPayJumps(
  pmf: Float64Array,
  prizeByPlace: Float64Array,
  paidCount: number,
  aggression = 0.5,
): void {
  const N = pmf.length;
  // The compensating bust mass needs unpaid places to preserve cash EV.
  if (paidCount < 4 || paidCount >= N) return;
  const q = Math.max(0, Math.min(1, aggression));
  if (q > 0) {
    const half = Math.max(1, Math.floor(paidCount / 2));
    // Top-half paid = [0, half); bottom-half paid = [half, paidCount).
    let massBottom = 0;
    let ePrizeBottom = 0; // Σ pmf[i]·prize[i] over bottom
    let massTop = 0;
    let ePrizeTop = 0;
    let ePrize2Top = 0; // Σ pmf[i]·prize[i]² over top
    for (let i = 0; i < half; i++) {
      massTop += pmf[i];
      ePrizeTop += pmf[i] * prizeByPlace[i];
      ePrize2Top += pmf[i] * prizeByPlace[i] * prizeByPlace[i];
    }
    for (let i = half; i < paidCount; i++) {
      massBottom += pmf[i];
      ePrizeBottom += pmf[i] * prizeByPlace[i];
    }
    const removed = q * massBottom;
    if (removed > 0 && massTop > 0 && ePrizeTop > 0 && ePrize2Top > 0) {
      // Top is redistributed in proportion to pmf[i]·prize[i] so deeper
      // finishes absorb more. That means the prize-weighted mean gain
      // per unit of `toTop` is (Σ pmf·prize²) / (Σ pmf·prize) = T2/T1
      // — NOT the plain conditional mean ePrizeTop/massTop. Getting this
      // wrong leaks EV (the old derivation assumed pmf-weighted redist).
      //
      // EV delta setting:
      //   ΔEV = x · removed · (ePrize2Top / ePrizeTop)   ← top bonus
      //       − removed · (ePrizeBottom / massBottom)    ← bottom loss
      // Set ΔEV = 0:
      //   x = (ePrizeBottom / massBottom) · (ePrizeTop / ePrize2Top)
      const avgBottom = ePrizeBottom / massBottom;
      const prizeWeightedTop = ePrize2Top / ePrizeTop;
      let x = avgBottom / prizeWeightedTop;
      if (!Number.isFinite(x) || x < 0) x = 0;
      if (x > 1) x = 1;
      const toTop = removed * x;
      const toBust = removed * (1 - x);
      // Shrink bottom bracket.
      const bottomScale = 1 - q;
      for (let i = half; i < paidCount; i++) pmf[i] *= bottomScale;
      // Distribute `toTop` across top paid proportional to pmf[i]·prize[i]
      // (so pricier places pick up more of the absorption).
      for (let i = 0; i < half; i++) {
        pmf[i] += toTop * ((pmf[i] * prizeByPlace[i]) / ePrizeTop);
      }
      // Distribute `toBust` uniformly across unpaid places.
      const bustCount = N - paidCount;
      if (bustCount > 0 && toBust > 0) {
        const perBust = toBust / bustCount;
        for (let i = paidCount; i < N; i++) pmf[i] += perBust;
      }
      // Floating-point guard: re-normalize to 1.
      let s = 0;
      for (let i = 0; i < N; i++) s += pmf[i];
      if (s > 0 && Math.abs(s - 1) > 1e-12) {
        const k = 1 / s;
        for (let i = 0; i < N; i++) pmf[i] *= k;
      }
    }
  }
}
