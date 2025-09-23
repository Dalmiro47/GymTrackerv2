// src/lib/rounding.ts
/**
 * Snap to nearest 0.5 (integers and .5 only).
 * Returns null for null/NaN so inputs can be cleared.
 */
export function snapToHalf(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null;
  const snapped = Math.round(n * 2) / 2;   // 0.5 steps
  // one decimal at most (e.g. 90 -> "90", 90.5 -> "90.5")
  return Number(snapped.toFixed(1));
}

/** Format for inputs: show "", integer or x.5 (no extra zeros). */
export function formatWeightHalf(w: number | null | undefined): string {
  if (w == null) return '';
  const s = Number(w).toFixed(1);         // "90.0" | "90.5"
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
