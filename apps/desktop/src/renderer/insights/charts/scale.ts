/** Small number helpers shared by the hand-drawn charts. */

/** Round tick values covering [min, max], about `count` of them (at least two). */
export function niceTicks(min: number, max: number, count: number): number[] {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) {
    if (hi === 0) return [0, 1];
    return niceTicks(Math.min(0, lo), Math.max(0, hi), count);
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(decimals)));
  }
  return ticks;
}

/**
 * Radius of a circle sized by the square root of its count, never below `minR` so small
 * groups stay visible and never above `maxR`. A zero count (or no maximum) gives `minR`.
 */
export function sqrtRadius(count: number, maxCount: number, minR: number, maxR: number): number {
  if (!(count > 0) || !(maxCount > 0)) return minR;
  const share = Math.min(1, count / maxCount);
  return minR + (maxR - minR) * Math.sqrt(share);
}

/** A function mapping the domain [d0, d1] onto the range [r0, r1]; a flat domain maps to the middle. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}
