import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { WorkoutLog } from '@/types';
import {
  buildWorkoutLogDoc,
  lastPerformedSession,
  plannedLogExercise,
  prefillSetsFrom,
  warmupConfigFor,
} from './workoutLogDoc';

const DATE = '2027-01-15';

const payload = (over: Partial<WorkoutLog> = {}): WorkoutLog => ({
  id: 'ignored',
  date: 'ignored',
  routineId: 'push-day',
  routineName: 'Push Day',
  notes: '',
  isDeload: false,
  deloadApplied: false,
  deloadParams: undefined,
  exerciseIds: [],
  exercises: [
    {
      id: 'row-1',
      exerciseId: 'bench-press_chest',
      name: 'Bench Press',
      muscleGroup: 'Chest',
      exerciseSetup: 'Flat',
      progressiveOverload: '6-8',
      notes: '',
      sets: [
        { id: 's1', reps: 8, weight: 82.5, isProvisional: false },
        { id: 's2', reps: null, weight: null },
        { id: 's3', reps: 7.9, weight: 82.74 },
        { id: 's4', reps: 150, weight: 1200 },
        { id: 's5', reps: null, weight: 60 },
      ],
      personalRecordDisplay: 'PR: 8x82.5kg',
      currentPR: { reps: 8, weight: 82.5 },
      isProvisional: false,
      prefill: { sets: [], lastPerformedDate: null },
      progressionStepKg: 2.5,
      repeatStreak: 2,
      warmupConfig: { template: 'HEAVY_BARBELL' },
      setStructure: 'superset',
      setStructureOverride: null,
      performed: true,
    },
    {
      id: 'row-2',
      exerciseId: 'dips_triceps',
      name: 'Dips',
      muscleGroup: 'Triceps',
      sets: [],
      currentPR: null,
      setStructure: 'normal',
      setStructureOverride: 'dropSet',
      performed: false,
    },
  ],
  ...over,
});

test('buildWorkoutLogDoc: the stored shape of an app save', () => {
  const { doc, clearFields } = buildWorkoutLogDoc(DATE, payload());
  assert.deepEqual(doc, {
    id: DATE,
    date: DATE,
    routineId: 'push-day',
    routineName: 'Push Day',
    notes: '',
    isDeload: false,
    deloadApplied: false,
    exerciseIds: ['bench-press_chest', 'dips_triceps'],
    exercises: [
      {
        id: 'row-1',
        exerciseId: 'bench-press_chest',
        name: 'Bench Press',
        muscleGroup: 'Chest',
        exerciseSetup: 'Flat',
        progressiveOverload: '6-8',
        notes: '',
        // An empty set is dropped; reps are a whole number to 99; weight is to 999 in 0.5 steps.
        sets: [
          { id: 's1', reps: 8, weight: 82.5 },
          { id: 's3', reps: 7, weight: 82.5 },
          { id: 's4', reps: 99, weight: 999 },
          { id: 's5', reps: 0, weight: 60 },
        ],
        warmupConfig: { template: 'HEAVY_BARBELL' },
        setStructure: 'superset',
        performed: true,
      },
      {
        id: 'row-2',
        exerciseId: 'dips_triceps',
        name: 'Dips',
        muscleGroup: 'Triceps',
        sets: [],
        setStructureOverride: 'dropSet',
        performed: false,
      },
    ],
  });
  // No deload: the stored deload parameters must be cleared.
  assert.deepEqual(clearFields, ['deloadParams']);
});

test('buildWorkoutLogDoc: an app save with no duration keeps a stored duration', () => {
  // The Training Log page never loads `duration`, so its payload has none.
  for (const duration of [undefined, null]) {
    const { doc, clearFields } = buildWorkoutLogDoc(DATE, payload({ duration: duration as undefined }));
    assert.equal('duration' in doc, false);
    assert.equal(clearFields.includes('duration' as never), false);
    // The save is a merge of `doc` plus a removal of every cleared field.
    const stored: Record<string, unknown> = { id: DATE, duration: 62, startedAt: 5, coachNotes: 'kept', deloadParams: { old: true } };
    const merged: Record<string, unknown> = { ...stored, ...doc };
    for (const field of clearFields) delete merged[field];
    assert.equal(merged.duration, 62);
    assert.equal(merged.startedAt, 5);
    assert.equal(merged.coachNotes, 'kept');
    assert.equal('deloadParams' in merged, false);
  }
});

test('buildWorkoutLogDoc: absent routine fields are cleared; a deload keeps its parameters', () => {
  const params = { volumeMultiplier: 0.5, intensityMultiplier: 0.9 };
  const { doc, clearFields } = buildWorkoutLogDoc(
    DATE,
    payload({ routineId: undefined, routineName: undefined, isDeload: true, deloadApplied: true, deloadParams: params, notes: undefined, duration: 45 }),
  );
  assert.equal('routineId' in doc, false);
  assert.equal('routineName' in doc, false);
  assert.equal(doc.isDeload, true);
  assert.deepEqual(doc.deloadParams, params);
  assert.equal(doc.notes, '');
  assert.equal(doc.duration, 45);
  assert.deepEqual(clearFields, ['routineId', 'routineName']);
});

test('buildWorkoutLogDoc: `performed` is always an explicit boolean; undefined counts as performed', () => {
  const base = payload();
  const { doc } = buildWorkoutLogDoc(DATE, { ...base, exercises: [{ ...base.exercises[0], performed: undefined }] });
  assert.equal((doc.exercises as Array<{ performed: unknown }>)[0].performed, true);
});

test('warmupConfigFor: the stored config, else the template inferred from the name', () => {
  assert.deepEqual(warmupConfigFor({ name: 'Bench Press', warmup: { template: 'NONE' } }), { template: 'NONE' });
  assert.deepEqual(warmupConfigFor({ name: 'Dips' }), { template: 'BODYWEIGHT', isWeightedBodyweight: false });
  assert.deepEqual(warmupConfigFor({ name: 'Cable Fly' }), { template: 'ISOLATION', isWeightedBodyweight: false });
});

test('plannedLogExercise: a routine exercise as the app puts it into a new log', () => {
  const planned = plannedLogExercise({
    date: DATE,
    index: 1,
    nowMs: 42,
    routineExercise: { id: 'bench-press_chest', name: 'Old Name', muscleGroup: 'Chest', setStructure: 'superset' },
    library: { name: 'Bench Press', muscleGroup: 'Chest', exerciseSetup: 'Flat', progressiveOverload: '6-8', warmup: { template: 'HEAVY_BARBELL' } },
    lastSets: [{ id: 'old', reps: 8, weight: 80 }, { reps: 7, weight: 80 }],
  });
  assert.deepEqual(planned, {
    id: `bench-press_chest-${DATE}-1-42`,
    exerciseId: 'bench-press_chest',
    name: 'Bench Press',
    muscleGroup: 'Chest',
    exerciseSetup: 'Flat',
    progressiveOverload: '6-8',
    sets: [
      { id: `set-${DATE}-bench-press_chest-0-42`, reps: 8, weight: 80 },
      { id: `set-${DATE}-bench-press_chest-1-42`, reps: 7, weight: 80 },
    ],
    notes: '',
    currentPR: null,
    warmupConfig: { template: 'HEAVY_BARBELL' },
    setStructure: 'superset',
    setStructureOverride: null,
    performed: false,
  });
});

test('plannedLogExercise: an exercise gone from the library keeps the routine copy and has no warm-up; no history means no set', () => {
  const planned = plannedLogExercise({
    date: DATE,
    index: 0,
    nowMs: 42,
    routineExercise: { id: 'gone', name: 'Gone Lift', muscleGroup: 'Back' },
    library: null,
    lastSets: null,
  });
  assert.equal(planned.name, 'Gone Lift');
  assert.equal(planned.muscleGroup, 'Back');
  assert.equal(planned.exerciseSetup, '');
  assert.equal(planned.warmupConfig, undefined);
  assert.equal(planned.setStructure, 'normal');
  assert.deepEqual(planned.sets, []);
});

const logs = [
  { date: '2027-01-12', isDeload: true, exercises: [{ exerciseId: 'bench', sets: [{ reps: 8, weight: 40 }] }] },
  { date: '2027-01-10', exercises: [{ exerciseId: 'bench', performed: false, sets: [{ reps: 8, weight: 80 }] }] },
  { date: '2027-01-08', exercises: [{ exerciseId: 'bench', sets: [{ reps: 8, weight: 80 }] }, { exerciseId: 'row', sets: [] }] },
];

test('prefillSetsFrom: the newest log that is not a deload, performed or not; null with no such log', () => {
  assert.deepEqual(prefillSetsFrom(logs, 'bench'), [{ reps: 8, weight: 80 }]);
  assert.deepEqual(prefillSetsFrom(logs, 'row'), []);
  assert.equal(prefillSetsFrom(logs, 'dips'), null);
});

test('lastPerformedSession: the newest log where the exercise was lifted and that is not a deload', () => {
  assert.deepEqual(lastPerformedSession(logs, 'bench'), { date: '2027-01-08', sets: [{ reps: 8, weight: 80 }] });
  assert.equal(lastPerformedSession(logs, 'dips'), null);
});

test('source: the app service saves through the shared builders', () => {
  const source = readFileSync(new URL('../services/trainingLogService.ts', import.meta.url), 'utf8');
  assert.match(source, /from '@\/lib\/workoutLogDoc'/);
  assert.match(source, /from '@\/lib\/performanceEntryPlan'/);
  assert.match(source, /buildWorkoutLogDoc\(/);
  assert.match(source, /planPerformanceEntry\(/);
  assert.match(source, /needsPRRescan\(/);
  assert.match(source, /bestPRFromLogs\(/);
});
