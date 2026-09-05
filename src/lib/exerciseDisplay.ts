// ─── Display-time localization of seeded default exercises ───────────
//
// Default exercises are stored in English (deterministic ids, denormalized
// copies in logs/routines/history, warm-up name heuristics). For a Spanish UI
// the English text is swapped at render time, FIELD BY FIELD, and only while
// the stored value still equals the seeded English value — a field the user
// has edited (renamed, changed the rep range) is always shown as stored.
//
// Because everything that references an exercise carries its library id
// (`Exercise.id`, `LoggedExercise.exerciseId`, `RoutineSnapshotExercise.id`,
// `ProgressionResult.exerciseId`), past logs, routines and history localize
// too, with no Firestore migration and no hash churn in routine history.

import { defaultExercises } from '@/lib/defaultExercises';
import { DEFAULT_EXERCISES_ES, type LocalizedDefaultFields } from '@/lib/defaultExercises.es';
import { getLanguage, type Language } from '@/i18n';

export type ExerciseDisplayFields = {
  name: string;
  targetNotes?: string;
  exerciseSetup?: string;
  progressiveOverload?: string;
};

/** Anything that names an exercise and carries its library id under `id` or `exerciseId`. */
export type ExerciseLike = ExerciseDisplayFields & { id?: string; exerciseId?: string };

const CANONICAL_BY_ID = new Map(defaultExercises.map((ex) => [ex.id, ex]));

const ES_BY_ID = new Map<string, LocalizedDefaultFields>();
for (const ex of defaultExercises) {
  const localized = DEFAULT_EXERCISES_ES[`${ex.name}::${ex.muscleGroup}`];
  if (localized) ES_BY_ID.set(ex.id, localized);
}

/** Ids of seeded defaults that have no Spanish entry — should stay empty. */
export const UNTRANSLATED_DEFAULT_IDS = defaultExercises
  .filter((ex) => !ES_BY_ID.has(ex.id))
  .map((ex) => ex.id);

const same = (a?: string, b?: string) => (a ?? '').trim() === (b ?? '').trim();

/**
 * The exercise's fields as they should be shown in `language`. Untouched default
 * fields come back localized; everything else is returned exactly as stored.
 */
export function displayExerciseFields(ex: ExerciseLike, language: Language = getLanguage()): ExerciseDisplayFields {
  const stored: ExerciseDisplayFields = {
    name: ex.name,
    targetNotes: ex.targetNotes,
    exerciseSetup: ex.exerciseSetup,
    progressiveOverload: ex.progressiveOverload,
  };
  if (language === 'en') return stored;

  const id = ex.exerciseId ?? ex.id;
  const canonical = id ? CANONICAL_BY_ID.get(id) : undefined;
  const localized = id ? ES_BY_ID.get(id) : undefined;
  if (!canonical || !localized) return stored;

  return {
    name: same(ex.name, canonical.name) ? localized.name : ex.name,
    targetNotes: same(ex.targetNotes, canonical.targetNotes) ? localized.targetNotes : ex.targetNotes,
    exerciseSetup: same(ex.exerciseSetup, canonical.exerciseSetup) ? localized.exerciseSetup : ex.exerciseSetup,
    progressiveOverload: same(ex.progressiveOverload, canonical.progressiveOverload)
      ? localized.progressiveOverload
      : ex.progressiveOverload,
  };
}

export function displayExerciseName(ex: ExerciseLike, language: Language = getLanguage()): string {
  return displayExerciseFields(ex, language).name;
}

/** Search hit on either the stored (English) name or the displayed one. */
export function exerciseMatchesQuery(ex: ExerciseLike, query: string, language: Language = getLanguage()): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return ex.name.toLowerCase().includes(q) || displayExerciseName(ex, language).toLowerCase().includes(q);
}

/** Sort comparator on the displayed name (Firestore orders by the stored English name). */
export function compareByDisplayName(language: Language = getLanguage()) {
  return (a: ExerciseLike, b: ExerciseLike) =>
    displayExerciseName(a, language).localeCompare(displayExerciseName(b, language), language);
}
