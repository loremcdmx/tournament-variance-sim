type RiskPoint = { thresholdBI: number; probability: { value: number } };

export function riskChartMaximum(curves: readonly (readonly RiskPoint[])[], fullTail = false): number {
  const thresholds = [...new Set(curves.flatMap(curve => curve.map(point => point.thresholdBI)))]
    .filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const maximum = Math.max(10, thresholds.at(-1) ?? 0);
  if (fullTail || curves.length === 0 || curves.some(curve => curve.length === 0)) return maximum;
  const probabilities = curves.map(curve => new Map(curve.map(point => [point.thresholdBI, point.probability.value])));
  const cutoff = thresholds.findIndex(threshold => probabilities.every(curve => {
    const value = curve.get(threshold);
    return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 0.005;
  }));
  if (cutoff < 0) return maximum;
  return Math.min(maximum, Math.max(10, thresholds[cutoff + 1] ?? thresholds[cutoff]));
}
