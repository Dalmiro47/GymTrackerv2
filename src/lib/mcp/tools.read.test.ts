import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageFromDateOfBirth } from '@/lib/age';
import { defaultExercises } from '@/lib/defaultExercises';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import type { McpRepo, RawDoc } from './repo.server';
import type { ToolResult } from './results';
import { createReadTools, toolSchemas } from './tools.read';

// Fake values only. The repo is a stub, so no test here reaches Firestore.
const NOW = () => new Date('2026-03-15T23:30:00Z');

// A seeded default whose Spanish name differs from the stored English one.
const seeded = defaultExercises.find(ex => displayExerciseName(ex, 'es') !== ex.name)!;
const seededEs = displayExerciseName(seeded, 'es');

type Seed = {
  routines?: RawDoc[];
  routine?: RawDoc | null;
  exercises?: RawDoc[];
  logs?: RawDoc[];
  profile?: Record<string, unknown> | null;
  truncated?: boolean;
  fail?: boolean;
};

function fakeRepo(seed: Seed = {}) {
  const calls: unknown[][] = [];
  const guard = () => {
    if (seed.fail) throw new Error('secret internal detail users/fake-owner');
  };
  const list = (rows: RawDoc[] | undefined) => ({ rows: rows ?? [], truncated: seed.truncated ?? false });
  const repo: McpRepo = {
    async listRoutines() { calls.push(['listRoutines']); guard(); return list(seed.routines); },
    async getRoutine(id) { calls.push(['getRoutine', id]); guard(); return seed.routine ?? null; },
    async listExercises(muscleGroup) { calls.push(['listExercises', muscleGroup]); guard(); return list(seed.exercises); },
    async getLogsSince(from, max) { calls.push(['getLogsSince', from, max]); guard(); return list(seed.logs); },
    async getProfile() { calls.push(['getProfile']); guard(); return seed.profile ?? null; },
  };
  return { repo, calls, tools: createReadTools(repo, NOW) };
}

const body = (result: ToolResult) => {
  assert.notEqual(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text);
};

const routineDoc: RawDoc = {
  id: 'push-day',
  data: {
    name: 'Push Day',
    description: 'Chest and triceps',
    order: 0,
    createdAt: { _seconds: 1 },
    exercises: [
      { id: seeded.id, name: seeded.name, muscleGroup: seeded.muscleGroup, setStructure: 'superset', dataAiHint: 'x' },
      { id: 'my-lift', name: 'My Lift', muscleGroup: 'Back' },
    ],
  },
};

const log = (date: string, exercises: Record<string, unknown>[], extra: Record<string, unknown> = {}): RawDoc => ({
  id: date,
  data: { id: date, date, exercises, exerciseIds: exercises.map(e => e.exerciseId), ...extra },
});

// ─── Input validation ────────────────────────────────────────────────

test('schemas: exactly the six read tools, and none takes a uid', () => {
  assert.deepEqual(Object.keys(toolSchemas).sort(), [
    'get_exercise_history', 'get_profile', 'get_recent_logs', 'get_routine', 'list_exercises', 'list_routines',
  ]);
  for (const [name, schema] of Object.entries(toolSchemas)) {
    for (const key of Object.keys(schema.shape)) {
      assert.doesNotMatch(key, /uid|user|owner/i, `${name} must not take ${key}`);
    }
  }
});

test('schemas: get_recent_logs days is an integer from 1 to 90, default 14', () => {
  const s = toolSchemas.get_recent_logs;
  assert.deepEqual(s.parse({}), { days: 14 });
  assert.deepEqual(s.parse({ days: 90 }), { days: 90 });
  for (const days of [0, 91, 1.5, -1, '7', null]) {
    assert.equal(s.safeParse({ days }).success, false, `days ${String(days)} should be refused`);
  }
});

test('schemas: get_exercise_history bounds and defaults', () => {
  const s = toolSchemas.get_exercise_history;
  assert.deepEqual(s.parse({ exerciseId: 'bench-press' }), { exerciseId: 'bench-press', days: 120, limit: 10 });
  assert.equal(s.safeParse({ exerciseId: 'x', days: 365, limit: 30 }).success, true);
  assert.equal(s.safeParse({ exerciseId: 'x', days: 366 }).success, false);
  assert.equal(s.safeParse({ exerciseId: 'x', days: 0 }).success, false);
  assert.equal(s.safeParse({ exerciseId: 'x', limit: 31 }).success, false);
  assert.equal(s.safeParse({ exerciseId: 'x', limit: 0 }).success, false);
  assert.equal(s.safeParse({}).success, false);
});

test('schemas: ids refuse empty, a slash and more than 200 chars', () => {
  for (const parse of [
    (id: unknown) => toolSchemas.get_routine.safeParse({ id }),
    (id: unknown) => toolSchemas.get_exercise_history.safeParse({ exerciseId: id }),
  ]) {
    assert.equal(parse('push-day').success, true);
    for (const bad of ['', 'a/b', 'x'.repeat(201), 7, undefined]) {
      assert.equal(parse(bad).success, false);
    }
  }
});

test('schemas: list_exercises takes only a stored muscle group key', () => {
  const s = toolSchemas.list_exercises;
  assert.deepEqual(s.parse({}), {});
  assert.deepEqual(s.parse({ muscleGroup: 'Chest' }), { muscleGroup: 'Chest' });
  assert.equal(s.safeParse({ muscleGroup: 'Pecho' }).success, false);
  assert.equal(s.safeParse({ muscleGroup: 'chest' }).success, false);
});

// ─── Routines ────────────────────────────────────────────────────────

test('list_routines: compact shape, set structure defaults to normal', async () => {
  const { tools } = fakeRepo({ routines: [routineDoc], profile: { language: 'en' } });
  assert.deepEqual(body(await tools.list_routines({})), {
    returned: 1,
    truncated: false,
    routines: [
      {
        id: 'push-day',
        name: 'Push Day',
        description: 'Chest and triceps',
        order: 0,
        exercises: [
          { id: seeded.id, name: seeded.name, muscleGroup: seeded.muscleGroup, setStructure: 'superset' },
          { id: 'my-lift', name: 'My Lift', muscleGroup: 'Back', setStructure: 'normal' },
        ],
      },
    ],
  });
});

test('names: displayName only for an untouched seeded exercise on a Spanish profile', async () => {
  const es = body(await fakeRepo({ routines: [routineDoc], profile: { language: 'es' } }).tools.list_routines({}));
  assert.equal(es.routines[0].exercises[0].name, seeded.name);
  assert.equal(es.routines[0].exercises[0].displayName, seededEs);
  assert.equal('displayName' in es.routines[0].exercises[1], false);

  // No profile doc, or an unknown language, means English: stored names only.
  for (const profile of [null, { language: 'fr' }]) {
    const en = body(await fakeRepo({ routines: [routineDoc], profile }).tools.list_routines({}));
    assert.equal('displayName' in en.routines[0].exercises[0], false);
  }
});

test('names: a renamed seeded exercise keeps the user name', async () => {
  const renamed: RawDoc = { id: seeded.id, data: { name: 'My Rename', muscleGroup: seeded.muscleGroup } };
  const out = body(await fakeRepo({ exercises: [renamed], profile: { language: 'es' } }).tools.list_exercises({}));
  assert.equal(out.exercises[0].name, 'My Rename');
  assert.equal('displayName' in out.exercises[0], false);
});

test('list_routines: passes the truncated flag through', async () => {
  const out = body(await fakeRepo({ routines: [routineDoc], truncated: true }).tools.list_routines({}));
  assert.equal(out.truncated, true);
});

test('get_routine: one routine, or an error result when missing', async () => {
  const found = fakeRepo({ routine: routineDoc });
  const out = body(await found.tools.get_routine({ id: 'push-day' }));
  assert.equal(out.id, 'push-day');
  assert.equal(out.exercises.length, 2);
  assert.deepEqual(found.calls.find(c => c[0] === 'getRoutine'), ['getRoutine', 'push-day']);

  const missing = await fakeRepo().tools.get_routine({ id: 'nope' });
  assert.equal(missing.isError, true);
});

// ─── Exercises ───────────────────────────────────────────────────────

test('list_exercises: passes the filter, sorts by stored name, drops heavy fields', async () => {
  const { tools, calls } = fakeRepo({
    exercises: [
      { id: 'b', data: { name: 'Bravo', muscleGroup: 'Chest', targetNotes: 'Upper', instructions: 'long', warmup: {} } },
      { id: 'a', data: { name: 'alpha', muscleGroup: 'Chest', progressiveOverload: '8-12', exerciseSetup: 'Seat 4' } },
    ],
  });
  const out = body(await tools.list_exercises({ muscleGroup: 'Chest' }));
  assert.deepEqual(calls.find(c => c[0] === 'listExercises'), ['listExercises', 'Chest']);
  assert.deepEqual(out, {
    returned: 2,
    truncated: false,
    exercises: [
      { id: 'a', name: 'alpha', muscleGroup: 'Chest', progressiveOverload: '8-12', exerciseSetup: 'Seat 4' },
      { id: 'b', name: 'Bravo', muscleGroup: 'Chest', targetNotes: 'Upper' },
    ],
  });
});

// ─── Logs ────────────────────────────────────────────────────────────

const benchSets = [{ id: 's1', reps: 8, weight: 80 }, { id: 's2', reps: null, weight: null }];

test('get_recent_logs: UTC cutoff, bounded read, planned vs performed', async () => {
  const { tools, calls } = fakeRepo({
    logs: [
      log('2026-03-14', [
        { id: 'row-1', exerciseId: 'bench', name: 'Bench', muscleGroup: 'Chest', sets: benchSets, performed: false, notes: 'easy' },
        { id: 'row-2', exerciseId: 'row', name: 'Row', muscleGroup: 'Back', sets: [], setStructure: 'superset', setStructureOverride: 'dropSet' },
        { id: 'row-3', exerciseId: 'curl', name: 'Curl', muscleGroup: 'Biceps', sets: [], performed: true, setStructure: 'triset' },
      ], { routineId: 'push-day', routineName: 'Push Day', isDeload: true, notes: 'tired', deloadParams: {} }),
    ],
  });
  const out = body(await tools.get_recent_logs({ days: 14 }));
  assert.deepEqual(calls.find(c => c[0] === 'getLogsSince'), ['getLogsSince', '2026-03-01', 15]);
  assert.deepEqual(out, {
    days: 14,
    from: '2026-03-01',
    returned: 1,
    truncated: false,
    logs: [
      {
        date: '2026-03-14',
        routineId: 'push-day',
        routineName: 'Push Day',
        isDeload: true,
        notes: 'tired',
        exercises: [
          { exerciseId: 'bench', name: 'Bench', muscleGroup: 'Chest', setStructure: 'normal', status: 'planned', sets: [{ reps: 8, weight: 80 }], notes: 'easy' },
          { exerciseId: 'row', name: 'Row', muscleGroup: 'Back', setStructure: 'dropSet', status: 'performed', sets: [] },
          { exerciseId: 'curl', name: 'Curl', muscleGroup: 'Biceps', setStructure: 'triset', status: 'performed', sets: [] },
        ],
      },
    ],
  });
});

test('get_recent_logs: a log with no exercises array still maps', async () => {
  const out = body(await fakeRepo({ logs: [{ id: '2026-03-10', data: { date: '2026-03-10' } }] }).tools.get_recent_logs({ days: 14 }));
  assert.deepEqual(out.logs, [{ date: '2026-03-10', isDeload: false, exercises: [] }]);
});

test('get_exercise_history: filters by exerciseId in code, newest first, capped by limit', async () => {
  const bench = (performed?: boolean) => ({ id: 'row', exerciseId: 'bench', name: 'Bench', muscleGroup: 'Chest', sets: benchSets, ...(performed === undefined ? {} : { performed }) });
  const other = { id: 'row', exerciseId: 'squat', name: 'Squat', muscleGroup: 'Legs', sets: [] };
  const { tools, calls } = fakeRepo({
    logs: [
      log('2026-03-14', [bench(false), other]),
      log('2026-03-10', [other]),
      log('2026-03-07', [bench()], { isDeload: true }),
      log('2026-03-01', [bench(true)]),
    ],
  });
  const out = body(await tools.get_exercise_history({ exerciseId: 'bench', days: 120, limit: 2 }));
  assert.deepEqual(calls.find(c => c[0] === 'getLogsSince'), ['getLogsSince', '2025-11-15', 121]);
  assert.deepEqual(out, {
    exerciseId: 'bench',
    name: 'Bench',
    days: 120,
    from: '2025-11-15',
    returned: 2,
    truncated: true,
    sessions: [
      { date: '2026-03-14', isDeload: false, status: 'planned', sets: [{ reps: 8, weight: 80 }] },
      { date: '2026-03-07', isDeload: true, status: 'performed', sets: [{ reps: 8, weight: 80 }] },
    ],
  });
});

test('get_exercise_history: no session in the window is an empty list, not an error', async () => {
  const out = body(await fakeRepo({ logs: [] }).tools.get_exercise_history({ exerciseId: 'bench', days: 120, limit: 10 }));
  assert.equal(out.returned, 0);
  assert.equal(out.name, null);
  assert.deepEqual(out.sessions, []);
});

// ─── Profile ─────────────────────────────────────────────────────────

test('get_profile: coach fields and language only, never identity fields', async () => {
  const { tools } = fakeRepo({
    profile: {
      goal: 'Strength',
      daysPerWeekTarget: 4,
      constraints: ['left knee'],
      trainingAge: 'Intermediate',
      sessionTimeTargetMin: 60,
      language: 'es',
      dateOfBirth: '1990-01-01',
      email: 'someone@example.test',
      name: 'Someone',
      heightCm: 180,
      weightKg: 80,
      gender: 'Man',
      seedVersion: 2,
      deletedDefaultIds: ['x'],
    },
  });
  const out = body(await tools.get_profile({}));
  assert.deepEqual(Object.keys(out).sort(), [
    'age', 'constraints', 'daysPerWeekTarget', 'goal', 'language', 'sessionTimeTargetMin', 'trainingAge',
  ]);
  assert.equal(out.language, 'es');
  assert.equal(out.age, ageFromDateOfBirth('1990-01-01'));
  assert.doesNotMatch(JSON.stringify(out), /example\.test|1990-01-01|Someone/);
});

test('get_profile: no profile doc gives the default language only', async () => {
  assert.deepEqual(body(await fakeRepo().tools.get_profile({})), { language: 'en' });
});

// ─── Failures ────────────────────────────────────────────────────────

test('a repo failure is a generic error result with no internal detail', async () => {
  const { tools } = fakeRepo({ fail: true });
  const results = [
    await tools.list_routines({}),
    await tools.get_routine({ id: 'push-day' }),
    await tools.list_exercises({}),
    await tools.get_recent_logs({ days: 14 }),
    await tools.get_exercise_history({ exerciseId: 'bench', days: 120, limit: 10 }),
    await tools.get_profile({}),
  ];
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /secret|fake-owner|users\//);
  }
});
