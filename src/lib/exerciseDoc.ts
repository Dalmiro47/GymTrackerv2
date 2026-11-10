import type { ExerciseData } from '@/types';
import { stripUndefinedDeep } from '@/lib/sanitize';

/**
 * Pure builder for a NEW exercise document, shared by the app's exerciseService
 * (`addExercise`) and the MCP write tools so both store the same shape.
 * The result holds no `undefined`, so it is safe to hand to Firestore.
 */
export function buildExerciseDoc(data: ExerciseData): ExerciseData {
  const raw = {
    name: data.name.trim(),
    muscleGroup: data.muscleGroup,
    targetNotes: data.targetNotes || '',
    exerciseSetup: data.exerciseSetup || '',
    progressiveOverload: data.progressiveOverload || '',
    instructions: data.instructions || '',
    dataAiHint: data.dataAiHint || '',
    warmup: data.warmup
      ? {
          template: data.warmup.template,
          isWeightedBodyweight: data.warmup.isWeightedBodyweight,
          roundingIncrementKg: data.warmup.roundingIncrementKg,
          overrideSteps: data.warmup.overrideSteps?.map(s => ({
            type: s.type,
            percent: s.type === 'PERCENT' ? s.percent : undefined,
            reps: s.reps,
            rest: s.rest,
            appliesTo: s.appliesTo,
            note: s.note,
            label: s.type === 'LABEL' ? s.label : undefined,
          })),
        }
      : undefined,
  };

  return stripUndefinedDeep(raw);
}
