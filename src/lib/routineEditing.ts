import type { Exercise, RoutineExercise } from '@/types';

/**
 * Shared, pure helpers for editing a routine's exercise list.
 *
 * These are the single source of truth for the Routine editor's mutations so the
 * UI and the tests exercise the exact same logic (no duplicated picker/edit logic).
 */

/**
 * Replace the exercise at `index` in place.
 *
 * Mirrors Training Log's `replaceExerciseInLog`: the new exercise takes the same
 * slot (position is unchanged) and the slot's `setStructure` is preserved.
 */
export function replaceRoutineExerciseAt(
  list: RoutineExercise[],
  index: number,
  newExercise: Exercise,
): RoutineExercise[] {
  if (index < 0 || index >= list.length) return list;

  const prev = list[index];
  const replaced: RoutineExercise = {
    ...newExercise,
    setStructure: prev.setStructure ?? 'normal',
    isMissing: false,
  };

  const next = [...list];
  next[index] = replaced;
  return next;
}

/**
 * Remove the exercise at `index`, preserving the order of the rest.
 */
export function removeRoutineExerciseAt(
  list: RoutineExercise[],
  index: number,
): RoutineExercise[] {
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

/**
 * Deduplicate exercises by name (case-insensitive, trimmed), keeping the first
 * occurrence. The library can contain two exercises sharing a name (a user-created
 * duplicate of a seeded default, or cross-version seed remnants); rendering both
 * makes the picker untrustworthy.
 */
export function dedupeExercisesByName<T extends Exercise>(exercises: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const ex of exercises) {
    const key = ex.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ex);
  }
  return result;
}
