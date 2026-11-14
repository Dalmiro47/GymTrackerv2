/**
 * Pure builders for a workout log document (users/{uid}/workoutLogs/{YYYY-MM-DD}).
 *
 * Shared by the app's save (trainingLogService.saveWorkoutLog) and the MCP workout
 * tools, so both writers store the same shape. No Firestore import: a field that
 * must be taken off the stored document is returned by name, and each writer turns
 * it into its own SDK's sentinel.
 */
import type { LoggedExercise, LoggedSet, WarmupConfig, WorkoutLog } from '@/types';
import { snapToHalf } from '@/lib/rounding';
import { stripUndefinedDeep } from '@/lib/sanitize';
import { inferWarmupTemplate } from '@/lib/utils';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A root field the save takes off the stored document when the payload does not hold it. */
export type ClearableLogField = 'routineId' | 'routineName' | 'deloadParams';

export type WorkoutLogDoc = {
  /** The document to write with merge, with no undefined value anywhere. */
  doc: Record<string, unknown>;
  /** The log is written with merge, so an absent key must be removed or its old value survives. */
  clearFields: ClearableLogField[];
};

/** The stored shape of one day's log, from the log as the Training Log page holds it. */
export function buildWorkoutLogDoc(date: string, workoutLogPayload: WorkoutLog): WorkoutLogDoc {
  const exerciseIds = workoutLogPayload.exercises.map(ex => ex.exerciseId);

  const payloadForFirestore: WorkoutLog = {
    ...workoutLogPayload,
    id: date,
    date: date,
    exerciseIds: exerciseIds,
    exercises: workoutLogPayload.exercises.map(ex => {
      // Destructure to remove UI-only fields before saving
      const { personalRecordDisplay, isProvisional, currentPR, prefill, progressionStepKg, repeatStreak, ...restOfEx } = ex;

      // Clean up optional fields that might be null or undefined on the exercise
      const exerciseToSave: { [key: string]: any } = { ...restOfEx };
      if (exerciseToSave.setStructure === 'normal' || !exerciseToSave.setStructure) {
        delete exerciseToSave.setStructure;
      }
      if (!exerciseToSave.setStructureOverride) {
        delete exerciseToSave.setStructureOverride;
      }
      // `performed` IS persisted (unlike the UI-only flags destructured above):
      // a planned exercise stores the last session's sets, so this flag is the
      // only thing that lets a later PR rescan tell a real lift from a pre-fill.
      // Written as an explicit boolean because the doc is merged — an absent key
      // would leave a stale `true` from a previous save in place.
      exerciseToSave.performed = restOfEx.performed !== false;

      return {
        ...exerciseToSave,
        sets: ex.sets
          // Drop fully-empty sets instead of persisting them as 0x0 rows
          .filter(s => s.reps != null || s.weight != null)
          .map(s => {
            const { isProvisional, ...restOfSet } = s;

            // reps: 0..99 integer
            const repsNum = Number(restOfSet.reps);
            const reps =
              Number.isFinite(repsNum) ? clamp(Math.trunc(Math.abs(repsNum)), 0, 99) : 0;

            // weight: 0..999 snapped to .0/.5 only
            const wNum = Number(restOfSet.weight);
            let weight = Number.isFinite(wNum) ? clamp(Math.abs(wNum), 0, 999) : 0;
            weight = snapToHalf(weight) ?? 0;

            return {
              id: restOfSet.id,
              reps,
              weight,
            };
          })
      } as LoggedExercise;
    })
  };

  // Clean up optional fields on the root log object before saving. The doc is
  // written with merge:true, so absent keys must be explicitly deleted or the
  // previous value (e.g. a cleared routine) survives in Firestore.
  const clearFields: ClearableLogField[] = [];
  if (payloadForFirestore.routineId === undefined || payloadForFirestore.routineId === null) {
    delete (payloadForFirestore as any).routineId;
    clearFields.push('routineId');
  }
  if (payloadForFirestore.routineName === undefined || payloadForFirestore.routineName === null) {
    delete (payloadForFirestore as any).routineName;
    clearFields.push('routineName');
  }
  // `duration` is left out, never cleared: only the MCP finish_workout tool writes it and
  // the Training Log page does not load it, so clearing it here would remove it on every app save.
  if (payloadForFirestore.duration === undefined || payloadForFirestore.duration === null) {
    delete (payloadForFirestore as any).duration;
  }

  // Always set isDeload to a boolean for consistent querying
  payloadForFirestore.isDeload = !!payloadForFirestore.isDeload;
  if (!payloadForFirestore.isDeload) {
    delete (payloadForFirestore as any).deloadParams;
    clearFields.push('deloadParams');
  }

  payloadForFirestore.notes = payloadForFirestore.notes || '';

  return { doc: stripUndefinedDeep(payloadForFirestore) as unknown as Record<string, unknown>, clearFields };
}

// ─── A new log from a routine (same rules as useTrainingLog.handleSelectRoutine) ───

/** The warm-up of a library exercise: its stored config, else the template inferred from its name. */
export function warmupConfigFor(exercise: { name: string; warmup?: WarmupConfig }): WarmupConfig {
  if (exercise.warmup) return exercise.warmup;
  const { template, isWeightedBodyweight } = inferWarmupTemplate(exercise.name);
  return { template, isWeightedBodyweight };
}

type SetValues = { id?: string; reps: number | null; weight: number | null };

export type PlannedLogExerciseInput = {
  date: string;
  /** Position in the routine; part of the row id. */
  index: number;
  nowMs: number;
  routineExercise: { id: string; name: string; muscleGroup: LoggedExercise['muscleGroup']; setStructure?: LoggedExercise['setStructure'] };
  /** The exercise as the library holds it now, or null when it is gone from the library. */
  library: {
    name: string;
    muscleGroup: LoggedExercise['muscleGroup'];
    exerciseSetup?: string;
    progressiveOverload?: string;
    warmup?: WarmupConfig;
  } | null;
  /** The sets of the last session, or null when there is none. */
  lastSets: SetValues[] | null;
};

/**
 * One routine exercise as a planned row of a new log: its sets are a copy of the
 * last session and `performed` is false. The result goes through
 * `buildWorkoutLogDoc` before it is stored.
 */
export function plannedLogExercise({ date, index, nowMs, routineExercise, library, lastSets }: PlannedLogExerciseInput): LoggedExercise {
  const exerciseId = routineExercise.id;
  const sets: LoggedSet[] = (lastSets ?? []).map((s, i) => ({
    id: `set-${date}-${exerciseId}-${i}-${nowMs}`,
    reps: s.reps ?? null,
    weight: s.weight ?? null,
  }));
  return {
    id: `${exerciseId}-${date}-${index}-${nowMs}`,
    exerciseId,
    name: library?.name ?? routineExercise.name,
    muscleGroup: library?.muscleGroup ?? routineExercise.muscleGroup,
    exerciseSetup: library?.exerciseSetup ?? '',
    progressiveOverload: library?.progressiveOverload ?? '',
    sets,
    notes: '',
    currentPR: null,
    warmupConfig: library ? warmupConfigFor(library) : undefined,
    setStructure: routineExercise.setStructure ?? 'normal',
    setStructureOverride: null,
    performed: false,
  };
}

// ─── Reading past logs (stored documents are read as unknown) ────────

type StoredLog = Record<string, unknown>;

const exerciseIn = (log: StoredLog, exerciseId: string): Record<string, unknown> | undefined =>
  Array.isArray(log.exercises)
    ? (log.exercises as unknown[]).find(
        (ex): ex is Record<string, unknown> => typeof ex === 'object' && ex !== null && (ex as { exerciseId?: unknown }).exerciseId === exerciseId,
      )
    : undefined;

const setsOf = (exercise: Record<string, unknown>): SetValues[] =>
  Array.isArray(exercise.sets)
    ? (exercise.sets as unknown[]).filter((s): s is SetValues => typeof s === 'object' && s !== null)
    : [];

/**
 * The sets a planned exercise starts with: those of the newest log that holds the
 * exercise and is not a deload, performed or not (as getLastNonDeloadPerformance).
 * Null when no such log is in `logs`. `logs` is newest first.
 */
export function prefillSetsFrom(logs: StoredLog[], exerciseId: string): SetValues[] | null {
  for (const log of logs) {
    if (log.isDeload === true) continue;
    const exercise = exerciseIn(log, exerciseId);
    if (exercise) return setsOf(exercise);
  }
  return null;
}

/**
 * The newest session where the exercise was lifted: not a deload, and not saved as
 * a plan (`performed === false`). `logs` is newest first.
 */
export function lastPerformedSession(logs: StoredLog[], exerciseId: string): { date: string; sets: SetValues[] } | null {
  for (const log of logs) {
    if (log.isDeload === true) continue;
    const exercise = exerciseIn(log, exerciseId);
    if (!exercise || exercise.performed === false) continue;
    return { date: typeof log.date === 'string' ? log.date : '', sets: setsOf(exercise) };
  }
  return null;
}
