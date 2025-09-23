// Snap to a step (nearest by default). Fixes float noise and clamps precision.
export function snapToStep(
  value: number,
  step = 0.5,
  mode: 'nearest' | 'floor' | 'ceil' = 'nearest'
): number {
  if (!Number.isFinite(value)) return 0;
  const q = value / step;
  const snapped =
    mode === 'floor' ? Math.floor(q) * step :
    mode === 'ceil'  ? Math.ceil(q)  * step :
                       Math.round(q) * step;
  // normalize precision: 0.25 → 2 decimals, 0.5 → 1 decimal
  const decimals = step === 0.25 ? 2 : step === 0.5 ? 1 : 3;
  return Number(snapped.toFixed(decimals));
}
