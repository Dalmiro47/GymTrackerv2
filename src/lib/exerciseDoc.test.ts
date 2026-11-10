import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExerciseData } from '@/types';
import { stripUndefinedDeep } from '@/lib/sanitize';
import { buildExerciseDoc } from './exerciseDoc';

// Frozen copy of the payload that was inline in addExercise
// (src/services/exerciseService.ts) before the builder existed. It is the
// reference: the builder must give the same output for the same input.
const legacyExerciseDoc = (data: ExerciseData) => {
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
};

const minimal: ExerciseData = { name: 'My Lift', muscleGroup: 'Back' };

const full: ExerciseData = {
  name: '  Cable Fly  ',
  muscleGroup: 'Chest',
  targetNotes: 'Lower chest',
  exerciseSetup: 'Pulleys high',
  progressiveOverload: '10-12 reps',
  instructions: 'Slow on the way back',
  dataAiHint: 'cable fly',
  userEdited: true,
  trackProgression: false,
};

const warmupPlain: ExerciseData = { ...minimal, warmup: { template: 'ISOLATION' } };

const warmupSteps: ExerciseData = {
  ...minimal,
  warmup: {
    template: 'BODYWEIGHT',
    isWeightedBodyweight: true,
    roundingIncrementKg: 2.5,
    overrideSteps: [
      // `label` on a PERCENT step and `percent` on a LABEL step are not stored.
      { type: 'PERCENT', percent: 0.5, reps: '8', rest: '60s', appliesTo: 'ADDED', note: 'easy', label: 'ignored' },
      { type: 'LABEL', label: 'Bodyweight', reps: '10', rest: '45s', percent: 0.9 },
    ],
  },
};

test('buildExerciseDoc: same output as the old addExercise payload', () => {
  for (const data of [minimal, full, warmupPlain, warmupSteps]) {
    assert.deepEqual(buildExerciseDoc(data), legacyExerciseDoc(data));
  }
});

test('buildExerciseDoc: minimal input gives the seven base fields and no warmup', () => {
  assert.deepEqual(buildExerciseDoc(minimal), {
    name: 'My Lift',
    muscleGroup: 'Back',
    targetNotes: '',
    exerciseSetup: '',
    progressiveOverload: '',
    instructions: '',
    dataAiHint: '',
  });
});

test('buildExerciseDoc: trims the name and drops fields the app never writes on create', () => {
  const doc = buildExerciseDoc(full) as Record<string, unknown>;
  assert.equal(doc.name, 'Cable Fly');
  assert.equal('userEdited' in doc, false);
  assert.equal('trackProgression' in doc, false);
  assert.equal('warmup' in doc, false);
});

test('buildExerciseDoc: warmup steps keep only the fields of their type, with no undefined', () => {
  const doc = buildExerciseDoc(warmupSteps);
  assert.deepEqual(doc.warmup, {
    template: 'BODYWEIGHT',
    isWeightedBodyweight: true,
    roundingIncrementKg: 2.5,
    overrideSteps: [
      { type: 'PERCENT', percent: 0.5, reps: '8', rest: '60s', appliesTo: 'ADDED', note: 'easy' },
      { type: 'LABEL', reps: '10', rest: '45s', label: 'Bodyweight' },
    ],
  });
  assert.deepEqual(buildExerciseDoc(warmupPlain).warmup, { template: 'ISOLATION' });
});
