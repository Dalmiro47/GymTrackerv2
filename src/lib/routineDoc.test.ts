import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutineData, RoutineExercise } from '@/types';
import { buildRoutineCreateFields, buildRoutineUpdateFields, toRoutineExerciseEntry } from './routineDoc';

// Frozen copies of the mappings that were inline in src/services/routineService.ts
// (addRoutine and updateRoutine) before the builders existed. They are the
// reference: the builders must give the same output for the same input. The
// timestamps are left out on both sides; each caller adds its own SDK sentinel.
const legacyEntry = (ex: RoutineExercise) => ({
  id: ex.id,
  name: ex.name,
  muscleGroup: ex.muscleGroup,
  targetNotes: ex.targetNotes || '',
  exerciseSetup: ex.exerciseSetup || '',
  progressiveOverload: ex.progressiveOverload || '',
  dataAiHint: ex.dataAiHint || '',
  setStructure: ex.setStructure || 'normal',
});

const legacyCreate = (routineData: Omit<RoutineData, 'order'>, newOrder: number) => ({
  ...routineData,
  exercises: routineData.exercises.map(legacyEntry),
  order: newOrder,
});

const legacyUpdate = (routineData: Partial<RoutineData>) => {
  const dataToUpdate: Partial<RoutineData> = { ...routineData };
  if (routineData.exercises) {
    dataToUpdate.exercises = routineData.exercises.map(legacyEntry);
  }
  return dataToUpdate;
};

const full: RoutineExercise = {
  id: 'bench-press_chest',
  name: 'Bench Press',
  muscleGroup: 'Chest',
  targetNotes: 'Mid chest',
  exerciseSetup: 'Bench flat',
  progressiveOverload: '6-8 reps',
  instructions: 'Lower the bar to the chest',
  dataAiHint: 'bench press',
  warmup: { template: 'HEAVY_BARBELL' },
  userEdited: true,
  trackProgression: true,
  setStructure: 'superset',
  isMissing: false,
};

const minimal: RoutineExercise = { id: 'my-lift_back', name: 'My Lift', muscleGroup: 'Back' };

test('toRoutineExerciseEntry: same output as the old inline mapping, full and minimal', () => {
  assert.deepEqual(toRoutineExerciseEntry(full), legacyEntry(full));
  assert.deepEqual(toRoutineExerciseEntry(minimal), legacyEntry(minimal));
});

test('toRoutineExerciseEntry: exactly the eight stored fields, with defaults', () => {
  assert.deepEqual(toRoutineExerciseEntry(minimal), {
    id: 'my-lift_back',
    name: 'My Lift',
    muscleGroup: 'Back',
    targetNotes: '',
    exerciseSetup: '',
    progressiveOverload: '',
    dataAiHint: '',
    setStructure: 'normal',
  });
  assert.deepEqual(Object.keys(toRoutineExerciseEntry(full)).sort(), [
    'dataAiHint', 'exerciseSetup', 'id', 'muscleGroup', 'name', 'progressiveOverload', 'setStructure', 'targetNotes',
  ]);
});

test('buildRoutineCreateFields: same output as the old addRoutine payload', () => {
  const withDescription = { name: 'Push Day', description: 'Chest and triceps', exercises: [full, minimal] };
  const withoutDescription = { name: 'Pull Day', exercises: [minimal] };
  const emptyDescription = { name: 'Leg Day', description: '', exercises: [full] };
  for (const [data, order] of [[withDescription, 0], [withoutDescription, 3], [emptyDescription, 7]] as const) {
    assert.deepEqual(buildRoutineCreateFields(data, order), legacyCreate(data, order));
  }
  assert.equal('description' in buildRoutineCreateFields(withoutDescription, 3), false);
  assert.equal(buildRoutineCreateFields(withDescription, 4).order, 4);
});

test('buildRoutineUpdateFields: same output as the old updateRoutine payload', () => {
  const cases: Partial<RoutineData>[] = [
    { name: 'Push Day', description: 'New text', exercises: [full, minimal] },
    { exercises: [minimal] },
    { name: 'Renamed' },
    { description: '' },
    // The delete cascade in ExerciseClientPage also passes `order`.
    { name: 'Push Day', description: '', order: 2, exercises: [full] },
    { exercises: [] },
    {},
  ];
  for (const data of cases) {
    assert.deepEqual(buildRoutineUpdateFields(data), legacyUpdate(data));
  }
});

test('buildRoutineUpdateFields: a payload without exercises gets no exercises key', () => {
  const renameOnly: Partial<RoutineData> = { name: 'Renamed' };
  assert.equal('exercises' in buildRoutineUpdateFields(renameOnly), false);
});

test('builders do not change their input', () => {
  const data = { name: 'Push Day', exercises: [full] };
  const before = JSON.stringify(data);
  buildRoutineCreateFields(data, 1);
  buildRoutineUpdateFields(data);
  assert.equal(JSON.stringify(data), before);
});
