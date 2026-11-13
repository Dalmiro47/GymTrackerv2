import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageFromDateOfBirth } from '@/lib/age';
import { defaultExercises } from '@/lib/defaultExercises';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import type { RawDoc } from './repo.server';
import type { ToolResult } from './results';
import { createReadTools, toolSchemas, type ReadToolsRepo } from './tools.read';

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
  /** Exercise documents by id, for getExercise. */
  library?: Record<string, Record<string, unknown>>;
  /** Routine history rows by routine id. */
  history?: Record<string, RawDoc[]>;
  historyTruncated?: boolean;
  profile?: Record<string, unknown> | null;
  truncated?: boolean;
  fail?: boolean;
};

function fakeRepo(seed: Seed = {}, now: () => Date = NOW) {
  const calls: unknown[][] = [];
  const guard = () => {
    if (seed.fail) throw new Error('secret internal detail users/fake-owner');
  };
  const list = (rows: RawDoc[] | undefined) => ({ rows: rows ?? [], truncated: seed.truncated ?? false });
  const repo: ReadToolsRepo = {
    async listRoutines() { calls.push(['listRoutines']); guard(); return list(seed.routines); },
    async getRoutine(id) { calls.push(['getRoutine', id]); guard(); return seed.routine ?? null; },
    async listExercises(muscleGroup) { calls.push(['listExercises', muscleGroup]); guard(); return list(seed.exercises); },
    async getLogsSince(from, max) { calls.push(['getLogsSince', from, max]); guard(); return list(seed.logs); },
    async getLogsBetween(from, to, max) {
      calls.push(['getLogsBetween', from, to, max]);
      guard();
      return list((seed.logs ?? []).filter(doc => doc.id >= from && doc.id <= to));
    },
    async getProfile() { calls.push(['getProfile']); guard(); return seed.profile ?? null; },
    async getExercise(id) {
      calls.push(['getExercise', id]);
      guard();
      const data = seed.library?.[id];
      return data ? { id, data } : null;
    },
    async listRoutineHistory(routineId) {
      calls.push(['listRoutineHistory', routineId]);
      guard();
      return { rows: seed.history?.[routineId] ?? [], truncated: seed.historyTruncated ?? false };
    },
  };
  return { repo, calls, tools: createReadTools(repo, now) };
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

test('schemas: exactly the seven read tools, and none takes a uid', () => {
  assert.deepEqual(Object.keys(toolSchemas).sort(), [
    'get_exercise_history', 'get_profile', 'get_recent_logs', 'get_routine', 'get_week_status', 'list_exercises',
    'list_routines',
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

test('schemas: get_week_status takes an optional ISO week id only', () => {
  const s = toolSchemas.get_week_status;
  assert.deepEqual(s.parse({}), {});
  assert.deepEqual(s.parse({ week: '2026-W46' }), { week: '2026-W46' });
  for (const week of ['2026-46', '2026-W1', '2026-w46', '2026-W46-1', '', 46, null]) {
    assert.equal(s.safeParse({ week }).success, false, `week ${String(week)} should be refused`);
  }
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

test('get_routine: rep range joined from the exercise library, old fields untouched', async () => {
  const { tools, calls } = fakeRepo({
    routine: {
      id: 'push-day',
      data: {
        name: 'Push Day',
        order: 0,
        exercises: [
          { id: 'bench', name: 'Bench', muscleGroup: 'Chest', setStructure: 'superset', progressiveOverload: '5-8 reps' },
          { id: 'plank', name: 'Plank', muscleGroup: 'Abs', progressiveOverload: '10-12 reps' },
          { id: 'dips', name: 'Dips', muscleGroup: 'Triceps', progressiveOverload: '6-10 reps' },
          { id: 'bench', name: 'Bench', muscleGroup: 'Chest' },
        ],
      },
    },
    library: {
      // The library wins over the routine's stored copy, even when the library has no numeric range.
      bench: { name: 'Bench', progressiveOverload: '8-12 reps' },
      plank: { name: 'Plank', progressiveOverload: 'As long as possible' },
      dips: { name: 'Dips' },
    },
  });
  const out = body(await tools.get_routine({ id: 'push-day' }));
  assert.deepEqual(out.exercises, [
    { id: 'bench', name: 'Bench', muscleGroup: 'Chest', setStructure: 'superset', progressiveOverload: '8-12 reps', repRange: { min: 8, max: 12 } },
    { id: 'plank', name: 'Plank', muscleGroup: 'Abs', setStructure: 'normal', progressiveOverload: 'As long as possible', repRange: null },
    { id: 'dips', name: 'Dips', muscleGroup: 'Triceps', setStructure: 'normal', repRange: null },
    { id: 'bench', name: 'Bench', muscleGroup: 'Chest', setStructure: 'normal', progressiveOverload: '8-12 reps', repRange: { min: 8, max: 12 } },
  ]);
  // One read per distinct exercise.
  assert.deepEqual(calls.filter(c => c[0] === 'getExercise').map(c => c[1]).sort(), ['bench', 'dips', 'plank']);
});

test('get_routine: an exercise missing from the library keeps the stored range and says so', async () => {
  const { tools, calls } = fakeRepo({
    routine: {
      id: 'push-day',
      data: {
        name: 'Push Day',
        exercises: [
          { id: 'gone', name: 'Gone', muscleGroup: 'Back', progressiveOverload: '10-15 reps' },
          { id: 'gone-bare', name: 'Gone Bare', muscleGroup: 'Back', progressiveOverload: '' },
          { id: 'bad/id', name: 'Bad Id', muscleGroup: 'Back' },
        ],
      },
    },
  });
  const out = body(await tools.get_routine({ id: 'push-day' }));
  assert.deepEqual(out.exercises, [
    { id: 'gone', name: 'Gone', muscleGroup: 'Back', setStructure: 'normal', progressiveOverload: '10-15 reps', repRange: { min: 10, max: 15 }, inLibrary: false },
    { id: 'gone-bare', name: 'Gone Bare', muscleGroup: 'Back', setStructure: 'normal', repRange: null, inLibrary: false },
    { id: 'bad/id', name: 'Bad Id', muscleGroup: 'Back', setStructure: 'normal', repRange: null, inLibrary: false },
  ]);
  // An id that is not one path segment is never read.
  assert.deepEqual(calls.filter(c => c[0] === 'getExercise').map(c => c[1]).sort(), ['gone', 'gone-bare']);
});

test('list_routines: no library join (the rep range is in get_routine only)', async () => {
  const { tools, calls } = fakeRepo({ routines: [routineDoc] });
  const out = body(await tools.list_routines({}));
  assert.equal('repRange' in out.routines[0].exercises[0], false);
  assert.equal(calls.some(c => c[0] === 'getExercise'), false);
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

// ─── Week status ─────────────────────────────────────────────────────

const ms = (iso: string) => new Date(iso).getTime();
const version = (routineId: string, iso: string, changeType: string, exerciseIds: string[]): RawDoc => ({
  id: `${routineId}_${ms(iso)}`,
  data: {
    routineId,
    changeType,
    createdAtMs: ms(iso),
    snapshot: { name: 'x', description: '', exercises: exerciseIds.map(id => ({ id, name: `Name ${id}`, muscleGroup: 'Chest' })) },
  },
});
const routine = (id: string, name: string, exerciseIds: string[]): RawDoc => ({
  id,
  data: { name, order: 0, exercises: exerciseIds.map(exId => ({ id: exId, name: `Name ${exId}`, muscleGroup: 'Chest' })) },
});
const lifted = (exerciseId: string, performed?: boolean) => ({
  id: `row-${exerciseId}`, exerciseId, name: `Name ${exerciseId}`, muscleGroup: 'Chest', sets: benchSets,
  ...(performed === undefined ? {} : { performed }),
});
// Friday 2026-11-13, 10:00 in Berlin.
const FRIDAY = () => new Date('2026-11-13T09:00:00Z');

test('get_week_status: the default week follows the Berlin date, not UTC', async () => {
  // Sunday 23:30 Berlin.
  const sunday = fakeRepo({}, () => new Date('2026-03-15T22:30:00Z'));
  const a = body(await sunday.tools.get_week_status({}));
  assert.deepEqual([a.week, a.monday, a.sunday, a.today], ['2026-W11', '2026-03-09', '2026-03-15', '2026-03-15']);
  assert.deepEqual(sunday.calls.find(c => c[0] === 'getLogsBetween'), ['getLogsBetween', '2026-03-09', '2026-03-15', 7]);

  // Monday 00:30 Berlin, still Sunday in UTC.
  const b = body(await fakeRepo().tools.get_week_status({}));
  assert.deepEqual([b.week, b.monday, b.sunday, b.today], ['2026-W12', '2026-03-16', '2026-03-22', '2026-03-16']);
  assert.equal(b.timeZone, 'Europe/Berlin');

  // The last Sunday of October at 23:30 CET: a fixed summer offset would say Monday.
  const c = body(await fakeRepo({}, () => new Date('2026-10-25T22:30:00Z')).tools.get_week_status({}));
  assert.deepEqual([c.week, c.today], ['2026-W43', '2026-10-25']);
  const d = body(await fakeRepo({}, () => new Date('2026-10-25T23:30:00Z')).tools.get_week_status({}));
  assert.deepEqual([d.week, d.today], ['2026-W44', '2026-10-26']);
});

test('get_week_status: an explicit week, and an error result for a week that does not exist', async () => {
  const { tools, calls } = fakeRepo({ logs: [log('2026-11-01', [lifted('a')]), log('2026-11-02', [lifted('a')]), log('2026-11-09', [lifted('a')])] }, FRIDAY);
  const out = body(await tools.get_week_status({ week: '2026-W45' }));
  assert.deepEqual([out.week, out.monday, out.sunday, out.today], ['2026-W45', '2026-11-02', '2026-11-08', '2026-11-13']);
  assert.equal(out.days.length, 7);
  assert.deepEqual(out.days.filter((d: { session: unknown }) => d.session).map((d: { date: string }) => d.date), ['2026-11-02']);

  const before = calls.length;
  for (const week of ['2025-W53', '2026-W54', '2026-W00']) {
    const bad = await tools.get_week_status({ week });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /2026-W46/);
  }
  assert.equal(calls.length, before, 'a bad week must not read anything');
});

test('get_week_status: performed, planned, skipped and extra exercises; sets only when performed', async () => {
  const { tools } = fakeRepo({
    routines: [routine('push-day', 'Push Day', ['a', 'b', 'c']), routine('legs', 'Legs', ['x'])],
    logs: [
      log('2026-11-09', [lifted('a', true), lifted('b', false), lifted('z')], { routineId: 'push-day', routineName: 'Push Day', notes: 'ok' }),
    ],
    profile: { daysPerWeekTarget: 4 },
  }, FRIDAY);
  const out = body(await tools.get_week_status({}));
  assert.deepEqual(out.days[0], {
    date: '2026-11-09',
    session: {
      routineId: 'push-day',
      routineName: 'Push Day',
      isDeload: false,
      status: 'performed',
      routineBasis: 'current',
      notes: 'ok',
      exercises: [
        { exerciseId: 'a', name: 'Name a', status: 'performed', sets: [{ reps: 8, weight: 80 }] },
        { exerciseId: 'b', name: 'Name b', status: 'planned' },
        { exerciseId: 'z', name: 'Name z', status: 'performed', sets: [{ reps: 8, weight: 80 }], inRoutine: false },
        { exerciseId: 'c', name: 'Name c', status: 'skipped' },
      ],
    },
  });
  assert.deepEqual(out.days.slice(1), ['10', '11', '12', '13', '14', '15'].map(d => ({ date: `2026-11-${d}`, session: null })));
  assert.equal(out.daysPerWeekTarget, 4);
  assert.equal(out.sessionsDone, 1);
  assert.equal(out.sessionsRemaining, 3);
  assert.deepEqual(out.routinesNotDone, [{ id: 'legs', name: 'Legs' }]);
  assert.equal(out.truncated, false);
});

test('get_week_status: an all-planned session is not done; a deload session is', async () => {
  const { tools } = fakeRepo({
    routines: [routine('push-day', 'Push Day', ['a']), routine('legs', 'Legs', ['x'])],
    logs: [
      log('2026-11-10', [lifted('a', false)], { routineId: 'push-day', routineName: 'Push Day' }),
      log('2026-11-11', [lifted('x')], { routineId: 'legs', routineName: 'Legs', isDeload: true }),
      log('2026-11-12', [lifted('q', true)]),
      log('2026-11-13', [], { notes: 'rest' }),
    ],
  }, FRIDAY);
  const out = body(await tools.get_week_status({}));
  const session = (date: string) => out.days.find((d: { date: string }) => d.date === date).session;

  assert.equal(session('2026-11-10').status, 'planned');
  assert.equal('sets' in session('2026-11-10').exercises[0], false);
  assert.equal(session('2026-11-11').status, 'performed');
  assert.equal(session('2026-11-11').isDeload, true);
  // A log with no routine: no basis, nothing skipped, nothing marked as outside a routine.
  assert.deepEqual(session('2026-11-12'), {
    isDeload: false,
    status: 'performed',
    exercises: [{ exerciseId: 'q', name: 'Name q', status: 'performed', sets: [{ reps: 8, weight: 80 }] }],
  });
  assert.deepEqual(session('2026-11-13'), { isDeload: false, status: 'planned', notes: 'rest', exercises: [] });

  assert.equal(out.sessionsDone, 2);
  // No target in the profile: no remaining count, never a guess.
  assert.equal(out.daysPerWeekTarget, null);
  assert.equal(out.sessionsRemaining, null);
  assert.deepEqual(out.routinesNotDone, [{ id: 'push-day', name: 'Push Day' }]);
});

test('get_week_status: sessionsRemaining never goes below zero', async () => {
  const { tools } = fakeRepo({
    logs: [log('2026-11-09', [lifted('a')]), log('2026-11-10', [lifted('a')]), log('2026-11-11', [lifted('a')])],
    profile: { daysPerWeekTarget: 2 },
  }, FRIDAY);
  const out = body(await tools.get_week_status({}));
  assert.equal(out.sessionsDone, 3);
  assert.equal(out.sessionsRemaining, 0);
});

test('get_week_status: the routine version of the day comes from history', async () => {
  const basisOf = async (seed: Seed) => {
    const out = body(await fakeRepo({
      routines: [routine('push-day', 'Push Day', ['now'])],
      logs: [log('2026-11-10', [lifted('a')], { routineId: 'push-day' })],
      ...seed,
    }, FRIDAY).tools.get_week_status({}));
    const s = out.days[1].session;
    return [s.routineBasis, s.exercises.filter((e: { status: string }) => e.status === 'skipped').map((e: { exerciseId: string }) => e.exerciseId)];
  };

  // history: the newest version on or before the day. 22:30Z on the 10th is 23:30 in Berlin, the
  // same day; 23:30Z is already the 11th in Berlin and must not count.
  assert.deepEqual(await basisOf({ history: { 'push-day': [
    version('push-day', '2026-11-10T23:30:00Z', 'updated', ['late']),
    version('push-day', '2026-11-01T10:00:00Z', 'created', ['old']),
    version('push-day', '2026-11-10T22:30:00Z', 'updated', ['same-day']),
  ] } }), ['history', ['same-day']]);

  // baseline: every version is newer than the day, and the oldest one is the pre-history state.
  assert.deepEqual(await basisOf({ history: { 'push-day': [
    version('push-day', '2026-11-12T10:00:01Z', 'updated', ['after']),
    version('push-day', '2026-11-12T10:00:00Z', 'baseline', ['before']),
  ] } }), ['baseline', ['before']]);

  // current: no history, so the routine document is the version.
  assert.deepEqual(await basisOf({}), ['current', ['now']]);

  // unknown: the routine was created after the day, the history is cut off, or nothing is left.
  assert.deepEqual(await basisOf({ history: { 'push-day': [version('push-day', '2026-11-12T10:00:00Z', 'created', ['x'])] } }), ['unknown', []]);
  assert.deepEqual(await basisOf({ historyTruncated: true, history: { 'push-day': [version('push-day', '2026-11-01T10:00:00Z', 'created', ['x'])] } }), ['unknown', []]);
  assert.deepEqual(await basisOf({ routines: [] }), ['unknown', []]);
});

test('get_week_status: a deleted routine still has its last version; an unlisted one is read by id', async () => {
  const deleted = body(await fakeRepo({
    logs: [log('2026-11-10', [lifted('a')], { routineId: 'old-day', routineName: 'Old Day' })],
    history: { 'old-day': [
      version('old-day', '2026-11-01T10:00:00Z', 'created', ['a', 'b']),
      version('old-day', '2026-11-12T10:00:00Z', 'deleted', ['a', 'b']),
    ] },
  }, FRIDAY).tools.get_week_status({}));
  assert.equal(deleted.days[1].session.routineBasis, 'history');
  assert.deepEqual(deleted.days[1].session.exercises.map((e: { exerciseId: string; status: string }) => [e.exerciseId, e.status]), [['a', 'performed'], ['b', 'skipped']]);
  assert.deepEqual(deleted.routinesNotDone, []);

  // list_routines leaves out a routine with no `order`; the tool then reads it by id.
  const unlisted = fakeRepo({
    routine: routine('push-day', 'Push Day', ['a', 'c']),
    logs: [log('2026-11-10', [lifted('a')], { routineId: 'push-day' })],
  }, FRIDAY);
  const out = body(await unlisted.tools.get_week_status({}));
  assert.deepEqual(unlisted.calls.find(c => c[0] === 'getRoutine'), ['getRoutine', 'push-day']);
  assert.equal(out.days[1].session.routineBasis, 'current');
  assert.equal(out.days[1].session.exercises[1].status, 'skipped');
});

test('get_week_status: displayName for a seeded exercise on a Spanish profile, skipped ones included', async () => {
  const out = body(await fakeRepo({
    routines: [{ id: 'push-day', data: { name: 'Push Day', order: 0, exercises: [{ id: seeded.id, name: seeded.name, muscleGroup: seeded.muscleGroup }] } }],
    logs: [log('2026-11-10', [], { routineId: 'push-day' })],
    profile: { language: 'es' },
  }, FRIDAY).tools.get_week_status({}));
  assert.deepEqual(out.days[1].session.exercises, [
    { exerciseId: seeded.id, name: seeded.name, displayName: seededEs, status: 'skipped' },
  ]);
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
    await tools.get_week_status({}),
  ];
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /secret|fake-owner|users\//);
  }
});
