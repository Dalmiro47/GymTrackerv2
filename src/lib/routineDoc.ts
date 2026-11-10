import type { RoutineData, RoutineExercise } from '@/types';

/**
 * Pure builders for the routine document, shared by the app's routineService
 * and the MCP write tools so both store the same shape.
 *
 * No timestamps here: `createdAt` / `updatedAt` are SDK sentinels (client SDK in
 * the app, Admin SDK in the MCP route), so each caller adds its own.
 */

/** The eight fields a routine stores per exercise. */
export type RoutineExerciseEntry = Required<
  Pick<
    RoutineExercise,
    'id' | 'name' | 'muscleGroup' | 'targetNotes' | 'exerciseSetup' | 'progressiveOverload' | 'dataAiHint' | 'setStructure'
  >
>;

export function toRoutineExerciseEntry(ex: RoutineExercise): RoutineExerciseEntry {
  return {
    id: ex.id,
    name: ex.name,
    muscleGroup: ex.muscleGroup,
    targetNotes: ex.targetNotes || '',
    exerciseSetup: ex.exerciseSetup || '',
    progressiveOverload: ex.progressiveOverload || '',
    dataAiHint: ex.dataAiHint || '',
    setStructure: ex.setStructure || 'normal',
  };
}

/** Fields of a new routine document, without timestamps. */
export function buildRoutineCreateFields(routineData: Omit<RoutineData, 'order'>, order: number): RoutineData {
  return {
    ...routineData,
    exercises: routineData.exercises.map(toRoutineExerciseEntry),
    order,
  };
}

/**
 * Fields of a routine update, without `updatedAt`. Only the fields passed in are
 * returned; `exercises`, when present, is reduced to the stored entries.
 */
export function buildRoutineUpdateFields<T extends { exercises?: RoutineExercise[] }>(routineData: T): T {
  const fields: T = { ...routineData };
  if (routineData.exercises) {
    fields.exercises = routineData.exercises.map(toRoutineExerciseEntry);
  }
  return fields;
}
