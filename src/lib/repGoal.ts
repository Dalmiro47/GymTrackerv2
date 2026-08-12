import type { LoggedSet } from '@/types';

/**
 * The rep goal lives in the exercise's free-text `progressiveOverload` field
 * ("8-12 reps", "12-15 reps per side", "As many as possible", …), so it has to
 * be parsed rather than read. Anything without a numeric range (AMRAP, empty)
 * simply has no goal and never highlights.
 */
export interface RepRange {
  min: number;
  max: number;
}

// Prefer a range that is explicitly followed by "reps" so "3-4 sets of 8-12 reps"
// resolves to 8-12 and not to the set count; fall back to the first bare range.
const RANGE_WITH_UNIT = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*reps?\b/i;
const BARE_RANGE = /(\d{1,2})\s*[-–—]\s*(\d{1,2})/;

export function parseRepRange(text?: string | null): RepRange | null {
  if (!text) return null;

  const match = text.match(RANGE_WITH_UNIT) ?? text.match(BARE_RANGE);
  if (!match) return null;

  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min <= 0 || max <= 0 || max < min) return null;

  return { min, max };
}

/**
 * The two cues are deliberately asymmetric — this is intended, not an oversight:
 *
 *  - Overload (every set): adding weight is only justified once the WHOLE
 *    exercise sits at the top of the range. A blank set means the exercise isn't
 *    finished, so it never fires mid-entry.
 *  - Under-range (any set): a single set dropping below the bottom is worth
 *    surfacing right away, so this fires as soon as one qualifying set exists.
 *
 * Blank sets are ignored by both — an unfilled set is not "below the range".
 */

/** Every set at (or above) the top of the range — time to add weight. */
export function isRepGoalReached(sets: LoggedSet[] | undefined, range: RepRange | null): boolean {
  if (!range || !sets || sets.length === 0) return false;
  return sets.every(set => typeof set.reps === 'number' && set.reps >= range.max);
}

/** At least one set under the bottom of the range — the load is likely too heavy. */
export function isBelowRepRange(sets: LoggedSet[] | undefined, range: RepRange | null): boolean {
  if (!range || !sets || sets.length === 0) return false;
  return sets.some(set => typeof set.reps === 'number' && set.reps < range.min);
}
