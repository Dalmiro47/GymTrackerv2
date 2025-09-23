// Snap to a step (nearest by default). Fixes float noise and clamps precision.
export function snapToStep(
  value: number,
  step = 0.25,
  mode: 'nearest' | 'floor' | 'ceil' = 'nearest'
): number {
  if (!Number.isFinite(value)) return 0;
  const q = value / step;
  const snapped =
    mode === 'floor' ? Math.floor(q) * step :
    mode === 'ceil'  ? Math.ceil(q)  * step :
                       Math.round(q) * step;
  // keep at most 2 decimals for 0.25 increments (avoids 90.249999...)
  return Number(snapped.toFixed(2));
}
