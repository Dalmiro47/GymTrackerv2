import type { LoggedSet, WarmupTemplate } from '@/types';
import { snapToHalf } from '@/lib/rounding';

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

export interface NextRepTarget {
  /** 0-based position of the ONE set to push next. */
  setIndex: number;
  /** What that set actually did — the entry itself is never modified. */
  current: number;
  /** `current + 1`, capped at the top of the range. */
  target: number;
}

/**
 * "What do I do next?" for an exercise sitting inside its range — the gap the two
 * cues above leave open. Deliberately returns a SINGLE set: progression is one
 * rep on one set per session, so flagging several at once would overstate the
 * jump. The result is only ever *rendered beside* the logged reps; nothing is
 * written back, so the last entry stands.
 *
 * The pick is the weakest set (earliest one on a tie), because the weakest set is
 * what caps the exercise — with 11/11 you push set 1 to 12, with 11/10 you push
 * set 2 to 11. Once every set reaches the top, `isRepGoalReached` takes over and
 * asks for weight instead.
 *
 * Returns null whenever another cue owns the card (any set under the range, every
 * set at the top) or the exercise isn't finished — a blank set means there is
 * nothing to plan from yet.
 */
export function getNextRepTarget(sets: LoggedSet[] | undefined, range: RepRange | null): NextRepTarget | null {
  if (!range || !sets || sets.length === 0) return null;

  const reps: number[] = [];
  for (const set of sets) {
    if (typeof set.reps !== 'number') return null; // unfinished exercise
    reps.push(set.reps);
  }

  if (reps.some(r => r < range.min)) return null;   // "below range" cue owns the card
  if (reps.every(r => r >= range.max)) return null; // "rep goal reached" cue owns the card

  let setIndex = 0;
  for (let i = 1; i < reps.length; i++) {
    if (reps[i] < reps[setIndex]) setIndex = i;
  }

  return {
    setIndex,
    current: reps[setIndex],
    target: Math.min(reps[setIndex] + 1, range.max),
  };
}

export interface WeightBump {
  /** Working weight = the heaviest set, same definition the warm-up panel uses. */
  current: number;
  /** What to load next session. */
  next: number;
  step: number;
}

/**
 * How much the user actually adds when they progress, read off the warm-up
 * template — the only equipment signal the app stores. Used ONLY when this
 * exercise has no increase in its recent history to copy.
 */
const TEMPLATE_STEP_KG: Record<WarmupTemplate, number> = {
  HEAVY_BARBELL: 10,
  MACHINE_COMPOUND: 5,
  HEAVY_DB: 2.5,
  ISOLATION: 2.5,
  BODYWEIGHT: 2.5,   // weighted dips/pull-ups: the added load moves in plate-sized steps
  NONE: 2.5,
};

export interface WeightBumpInput {
  /** kg added the last time this exercise's working weight went up, if known. */
  historyStepKg?: number | null;
  /** Equipment proxy, used only when there is no history. */
  template?: WarmupTemplate;
}

/**
 * The load to try once `isRepGoalReached` fires — the last step of the loop, so
 * it lands on a number instead of "increase the weight".
 *
 * The step is what the user themselves last added on THIS exercise: the jump
 * that already worked beats any formula. A percentage-based guess is what made
 * this suggest +1kg on lifts that only move in 2.5/5/10kg plates. With no
 * increase in recent history, fall back to the equipment's usual jump.
 * Bodyweight work has no weight to bump and returns null — the caller keeps its
 * generic wording.
 */
export function suggestWeightBump(
  sets: LoggedSet[] | undefined,
  { historyStepKg, template }: WeightBumpInput = {}
): WeightBump | null {
  if (!sets || sets.length === 0) return null;

  const current = sets.reduce((max, set) => Math.max(max, set.weight ?? 0), 0);
  if (current <= 0) return null;

  // Snapped to 0.5kg, the only granularity the app stores.
  const fromHistory = historyStepKg && historyStepKg > 0 ? snapToHalf(historyStepKg) : null;
  const step = fromHistory && fromHistory > 0
    ? fromHistory
    : TEMPLATE_STEP_KG[template ?? 'ISOLATION'] ?? 2.5;

  return { current, next: Number((current + step).toFixed(1)), step };
}
