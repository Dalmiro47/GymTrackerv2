import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultExercises } from '@/lib/defaultExercises';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import { createRepo, MAX_ROUTINE_HISTORY, MAX_ROUTINES, type ReadDb } from './repo.server';
import { createWriteRepo, type WriteDb } from './repo.write.server';
import type { ToolResult } from './results';
import { createWriteTools, MAX_ROUTINE_EXERCISES, writeToolSchemas } from './tools.write';

// Fake values only. The tools run on the real read repo and the real write repo,
// over an in-memory fake db that records every call. The fake throws on anything
// that is not a read, `batch.create`, `batch.set`, `batch.update` or
// `batch.commit` (delete, add...). Its `create` fails the whole batch when the
// document exists, and its `update` when the document is missing, like Firestore.
const OWNER = 'fake-owner';
const ROOT = `users/${OWNER}/`;
const NOW_MS = 1_800_000_000_000;
const NOW = () => new Date(NOW_MS);
const TS = { sentinel: 'serverTimestamp' };
const REMOVE = { sentinel: 'removeField' };

type Data = Record<string, any>;
type Op = { kind: 'create' | 'set' | 'update'; path: string; data: Data; options?: unknown };
type Batch = { ops: Op[]; commits: number };

/** Firestore `update`: a dotted key is a field path, and the remove sentinel drops the key. */
function applyUpdate(current: Data, data: Data): Data {
  const next: Data = { ...current };
  for (const [key, value] of Object.entries(data)) {
    const [head, child] = key.split('.');
    if (child === undefined) {
      if (value === REMOVE) delete next[head];
      else next[head] = value;
    } else {
      next[head] = { ...next[head], [child]: value };
    }
  }
  return next;
}

const strict = <T extends object>(target: T, label: string): T =>
  new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then' || prop in obj) return Reflect.get(obj, prop, receiver);
      throw new Error(`${label}.${String(prop)} must never be called`);
    },
  });

function fakeDb(
  seed: Record<string, Data> = {},
  hooks: {
    beforeCommit?: (store: Map<string, Data>) => void;
    failRead?: boolean;
    failCommit?: boolean;
    /** The `code` of the error an `update` on a missing document throws; default the gRPC number. */
    notFoundCode?: unknown;
  } = {},
) {
  const store = new Map<string, Data>(Object.entries(seed).map(([path, data]) => [ROOT + path, data]));
  const batches: Batch[] = [];
  const idOf = (path: string) => path.split('/').pop()!;
  const snap = (path: string) => {
    const data = store.get(path);
    return strict({ id: idOf(path), exists: data !== undefined, data: () => data }, 'snapshot');
  };
  const readGuard = () => {
    if (hooks.failRead) throw new Error(`secret internal detail ${ROOT}`);
  };

  const query = (path: string, ops: unknown[][]): ReturnType<ReadDb['collection']> =>
    strict(
      {
        where: (field: string, op: string, value: unknown) => query(path, [...ops, ['where', field, op, value]]),
        orderBy: (field: string, direction?: string) => query(path, [...ops, ['orderBy', field, direction ?? 'asc']]),
        limit: (n: number) => query(path, [...ops, ['limit', n]]),
        async get() {
          readGuard();
          let rows = [...store.entries()].filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
          for (const op of ops) {
            if (op[0] === 'where') rows = rows.filter(([, d]) => d[op[1] as string] === op[3]);
            if (op[0] === 'orderBy') {
              const field = op[1] as string;
              const sign = op[2] === 'desc' ? -1 : 1;
              rows = rows.filter(([, d]) => d[field] !== undefined).sort(([, a], [, b]) => (a[field] < b[field] ? -sign : a[field] > b[field] ? sign : 0));
            }
            if (op[0] === 'limit') rows = rows.slice(0, op[1] as number);
          }
          return strict({ docs: rows.map(([p]) => snap(p)) }, 'querySnapshot');
        },
      },
      'query',
    );

  const db: ReadDb & WriteDb = strict(
    {
      collection: (path: string) => query(path, []),
      doc: (path: string) =>
        strict(
          {
            path,
            async get() {
              readGuard();
              return snap(path);
            },
          },
          'docRef',
        ),
      batch() {
        const batch: Batch = { ops: [], commits: 0 };
        batches.push(batch);
        return strict(
          {
            create(ref: { path: string }, data: Data) {
              batch.ops.push({ kind: 'create', path: ref.path, data });
            },
            set(ref: { path: string }, data: Data, options: unknown) {
              batch.ops.push({ kind: 'set', path: ref.path, data, options });
            },
            update(ref: { path: string }, data: Data) {
              batch.ops.push({ kind: 'update', path: ref.path, data });
            },
            async commit() {
              batch.commits++;
              hooks.beforeCommit?.(store);
              if (hooks.failCommit) throw new Error(`secret internal detail ${ROOT}`);
              const taken = batch.ops.find(op => op.kind === 'create' && store.has(op.path));
              if (taken) throw Object.assign(new Error(`6 ALREADY_EXISTS: ${taken.path}`), { code: 6 });
              const gone = batch.ops.find(op => op.kind === 'update' && !store.has(op.path));
              if (gone) throw Object.assign(new Error(`5 NOT_FOUND: ${gone.path}`), { code: hooks.notFoundCode ?? 5 });
              for (const op of batch.ops) {
                if (op.kind === 'update') store.set(op.path, applyUpdate(store.get(op.path)!, op.data));
                else store.set(op.path, op.kind === 'set' ? { ...store.get(op.path), ...op.data } : op.data);
              }
            },
          },
          'batch',
        );
      },
    },
    'db',
  );

  const tools = createWriteTools({ repo: createRepo(db, OWNER), writes: createWriteRepo(db, OWNER, () => TS, () => REMOVE), now: NOW });
  const ops = () => batches.flatMap(b => b.ops);
  const get = (path: string) => store.get(ROOT + path);
  return { tools, batches, ops, get, store };
}

// A seeded default whose Spanish name differs from the stored English one.
const seeded = defaultExercises.find(ex => displayExerciseName(ex, 'es') !== ex.name)!;

const bench = { name: 'Bench Press', muscleGroup: 'Chest', targetNotes: 'Mid chest', exerciseSetup: 'Flat', progressiveOverload: '6-8', instructions: 'long text', dataAiHint: 'bench press', warmup: { template: 'HEAVY_BARBELL' } };
const dips = { name: 'Dips', muscleGroup: 'Triceps' };
const row = { name: 'Row', muscleGroup: 'Back', targetNotes: 'Lats' };

const entry = (id: string, ex: Data, setStructure = 'normal') => ({
  id,
  name: ex.name,
  muscleGroup: ex.muscleGroup,
  targetNotes: ex.targetNotes ?? '',
  exerciseSetup: ex.exerciseSetup ?? '',
  progressiveOverload: ex.progressiveOverload ?? '',
  dataAiHint: ex.dataAiHint ?? '',
  setStructure,
});

const CREATED_AT = { stored: 'createdAt' };
const pushDay = () => ({
  name: 'Push Day',
  description: 'Chest and triceps',
  order: 2,
  createdAt: CREATED_AT,
  updatedAt: { stored: 'updatedAt' },
  legacyField: 'keep me',
  exercises: [entry('bench-press_chest', bench, 'superset'), entry('dips_triceps', dips)],
});

const seed = (extra: Record<string, Data> = {}): Record<string, Data> => ({
  'exercises/bench-press_chest': bench,
  'exercises/dips_triceps': dips,
  'exercises/row_back': row,
  [`exercises/${seeded.id}`]: { name: seeded.name, muscleGroup: seeded.muscleGroup },
  'routines/push-day': pushDay(),
  ...extra,
});

const ok = (result: ToolResult) => {
  assert.notEqual(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text);
};

/** The call was refused with `code`, and no batch was opened. */
const refused = (result: ToolResult, code: string, db: ReturnType<typeof fakeDb>) => {
  assert.equal(result.isError, true, `expected ${code}, got a success`);
  assert.match(result.content[0].text, new RegExp(`^${code}: `));
  assert.equal(db.batches.length, 0, `${code} must open no batch`);
};

const WRITE_PATH = new RegExp(`^users/${OWNER}/(routines|exercises|routineHistory)/[^/]+$`);

/** Exactly one batch with one commit; every path is the owner's, in an allowed collection. */
const oneBatch = (db: ReturnType<typeof fakeDb>) => {
  assert.equal(db.batches.length, 1, 'exactly one batch');
  assert.equal(db.batches[0].commits, 1, 'exactly one commit');
  for (const op of db.batches[0].ops) assert.match(op.path, WRITE_PATH);
  return db.batches[0].ops;
};

const versionsOf = (ops: Op[]) => ops.filter(op => op.path.startsWith(`${ROOT}routineHistory/`));

// ─── Input validation ────────────────────────────────────────────────

test('schemas: exactly the eight write tools, and none takes a uid', () => {
  assert.deepEqual(Object.keys(writeToolSchemas).sort(), [
    'add_exercise_to_routine', 'create_exercise', 'create_routine',
    'remove_exercise_from_routine', 'reorder_routine_exercises', 'replace_exercise_in_routine',
    'set_routine_set_structure', 'update_exercise',
  ]);
  for (const [name, schema] of Object.entries(writeToolSchemas)) {
    for (const key of Object.keys(schema.shape)) {
      assert.doesNotMatch(key, /uid|user|owner/i, `${name} must not take ${key}`);
    }
  }
});

test('schemas: create_exercise takes a stored muscle group key and bounded strings', () => {
  const s = writeToolSchemas.create_exercise;
  assert.deepEqual(s.parse({ name: '  Cable Fly ', muscleGroup: 'Chest' }), { name: 'Cable Fly', muscleGroup: 'Chest' });
  assert.equal(s.safeParse({ name: 'x'.repeat(80), muscleGroup: 'Chest', instructions: 'y'.repeat(2000) }).success, true);
  for (const bad of [
    { name: 'Cable Fly', muscleGroup: 'Pecho' },
    { name: 'Cable Fly', muscleGroup: 'chest' },
    { name: 'Cable Fly' },
    { name: 'x', muscleGroup: 'Chest' },
    { name: ' x ', muscleGroup: 'Chest' },
    { name: 'x'.repeat(81), muscleGroup: 'Chest' },
    { name: 'Cable Fly', muscleGroup: 'Chest', targetNotes: 'y'.repeat(2001) },
    { name: 'Cable Fly', muscleGroup: 'Chest', instructions: 'y'.repeat(2001) },
  ]) {
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test('schemas: create_routine name 3 to 80, description to 500, 1 to 30 safe ids', () => {
  const s = writeToolSchemas.create_routine;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `ex-${i}`);
  assert.equal(s.safeParse({ name: 'Leg', exerciseIds: ids(30), description: 'd'.repeat(500) }).success, true);
  for (const bad of [
    { name: 'Le', exerciseIds: ids(1) },
    { name: 'x'.repeat(81), exerciseIds: ids(1) },
    { name: 'Legs', exerciseIds: [] },
    { name: 'Legs', exerciseIds: ids(31) },
    { name: 'Legs', exerciseIds: ['a/b'] },
    { name: 'Legs', exerciseIds: ids(1), description: 'd'.repeat(501) },
    { name: 'Legs' },
  ]) {
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test('schemas: routine edit tools refuse unsafe ids and bad positions', () => {
  const add = writeToolSchemas.add_exercise_to_routine;
  assert.equal(add.safeParse({ routineId: 'push-day', exerciseId: 'row_back' }).success, true);
  assert.equal(add.safeParse({ routineId: 'a/b', exerciseId: 'row_back' }).success, false);
  assert.equal(add.safeParse({ routineId: 'push-day', exerciseId: '..' }).success, false);
  assert.equal(add.safeParse({ routineId: 'push-day', exerciseId: 'row_back', index: -1 }).success, false);
  assert.equal(add.safeParse({ routineId: 'push-day', exerciseId: 'row_back', index: 1.5 }).success, false);
  assert.equal('setStructure' in add.shape, false);

  const replace = writeToolSchemas.replace_exercise_in_routine;
  assert.equal(replace.safeParse({ routineId: 'push-day', index: 0, expectedExerciseId: 'a', newExerciseId: 'b' }).success, true);
  assert.equal(replace.safeParse({ routineId: 'push-day', index: 0, newExerciseId: 'b' }).success, false);
  assert.equal(replace.safeParse({ routineId: 'push-day', index: -1, expectedExerciseId: 'a', newExerciseId: 'b' }).success, false);

  assert.equal(writeToolSchemas.remove_exercise_from_routine.safeParse({ routineId: 'push-day', exerciseId: '' }).success, false);
  assert.equal(writeToolSchemas.reorder_routine_exercises.safeParse({ routineId: 'push-day', exerciseIds: [] }).success, false);
});

// ─── create_exercise ─────────────────────────────────────────────────

test('create_exercise: one batch, one create, the same doc shape as the app, no history', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.create_exercise({ name: 'Cable Fly', muscleGroup: 'Chest', targetNotes: ' Lower chest ', progressiveOverload: '10-12' }));
  const ops = oneBatch(db);
  assert.deepEqual(ops, [
    {
      kind: 'create',
      path: `${ROOT}exercises/cable-fly_chest`,
      data: {
        name: 'Cable Fly',
        muscleGroup: 'Chest',
        targetNotes: 'Lower chest',
        exerciseSetup: '',
        progressiveOverload: '10-12',
        instructions: '',
        dataAiHint: 'cable fly',
      },
    },
  ]);
  assert.deepEqual(out, {
    ok: true,
    exercise: { id: 'cable-fly_chest', name: 'Cable Fly', muscleGroup: 'Chest', targetNotes: 'Lower chest', progressiveOverload: '10-12' },
  });
});

test('create_exercise: a duplicate name + muscle group writes nothing (stored and Spanish display names)', async () => {
  const stored = fakeDb(seed());
  refused(await stored.tools.create_exercise({ name: ' bench press ', muscleGroup: 'Chest' }), 'duplicate_exercise', stored);

  const spanish = fakeDb(seed());
  refused(
    await spanish.tools.create_exercise({ name: displayExerciseName(seeded, 'es'), muscleGroup: seeded.muscleGroup }),
    'duplicate_exercise',
    spanish,
  );
});

test('create_exercise: the same name in another muscle group is a different exercise', async () => {
  const db = fakeDb(seed());
  ok(await db.tools.create_exercise({ name: 'Dips', muscleGroup: 'Chest' }));
  assert.equal(oneBatch(db)[0].path, `${ROOT}exercises/dips_chest`);
});

test('create_exercise: a taken id gets the app suffix, and the taken doc is not touched', async () => {
  // The id is held by an exercise that was renamed, so the names do not collide.
  const db = fakeDb(seed({ 'exercises/cable-fly_chest': { name: 'Renamed', muscleGroup: 'Chest' }, 'exercises/cable-fly_chest-2': { name: 'Other', muscleGroup: 'Chest' } }));
  ok(await db.tools.create_exercise({ name: 'Cable Fly', muscleGroup: 'Chest' }));
  assert.equal(oneBatch(db)[0].path, `${ROOT}exercises/cable-fly_chest-3`);
  assert.deepEqual(db.get('exercises/cable-fly_chest'), { name: 'Renamed', muscleGroup: 'Chest' });
});

test('create_exercise: a name that gives no id, or 20 taken ids, writes nothing', async () => {
  const noSlug = fakeDb(seed());
  refused(await noSlug.tools.create_exercise({ name: '!!!', muscleGroup: 'Chest' }), 'id_unavailable', noSlug);

  const taken: Record<string, Data> = { 'exercises/cable-fly_chest': { name: 'T1', muscleGroup: 'Chest' } };
  for (let n = 2; n <= 20; n++) taken[`exercises/cable-fly_chest-${n}`] = { name: `T${n}`, muscleGroup: 'Chest' };
  const full = fakeDb(seed(taken));
  refused(await full.tools.create_exercise({ name: 'Cable Fly', muscleGroup: 'Chest' }), 'id_unavailable', full);
});

test('create on an id that appears before the commit: conflict, and nothing is overwritten', async () => {
  const racer = { name: 'Written by the app', muscleGroup: 'Chest' };
  const db = fakeDb(seed(), { beforeCommit: store => store.set(`${ROOT}exercises/cable-fly_chest`, racer) });
  const result = await db.tools.create_exercise({ name: 'Cable Fly', muscleGroup: 'Chest' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^conflict: /);
  assert.deepEqual(db.get('exercises/cable-fly_chest'), racer);

  const routineRacer = { name: 'Leg Day', order: 9, exercises: [] };
  const routines = fakeDb(seed(), { beforeCommit: store => store.set(`${ROOT}routines/leg-day`, routineRacer) });
  const routineResult = await routines.tools.create_routine({ name: 'Leg Day', exerciseIds: ['row_back'] });
  assert.match(routineResult.content[0].text, /^conflict: /);
  assert.deepEqual(routines.get('routines/leg-day'), routineRacer);
  // The batch is atomic: its history version was not written either.
  assert.equal([...routines.store.keys()].some(p => p.includes('/routineHistory/')), false);
});

// ─── create_routine ──────────────────────────────────────────────────

test('create_routine: one batch with the routine and its created version, source mcp', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.create_routine({ name: 'Pull Day', description: ' Back work ', exerciseIds: ['row_back', 'bench-press_chest'] }));
  const ops = oneBatch(db);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], {
    kind: 'create',
    path: `${ROOT}routines/pull-day`,
    data: {
      name: 'Pull Day',
      description: 'Back work',
      exercises: [entry('row_back', row), entry('bench-press_chest', bench)],
      order: 3,
      createdAt: TS,
      updatedAt: TS,
    },
  });
  const version = ops[1];
  assert.equal(version.kind, 'create');
  assert.equal(version.path, `${ROOT}routineHistory/pull-day_${NOW_MS}`);
  assert.equal(version.data.id, `pull-day_${NOW_MS}`);
  assert.equal(version.data.routineId, 'pull-day');
  assert.equal(version.data.routineName, 'Pull Day');
  assert.equal(version.data.changeType, 'created');
  assert.equal(version.data.source, 'mcp');
  assert.equal(version.data.createdAtMs, NOW_MS);
  assert.equal(version.data.prevHash, null);
  assert.deepEqual(version.data.snapshot.exercises.map((e: Data) => e.id), ['row_back', 'bench-press_chest']);
  assert.deepEqual(out, {
    ok: true,
    routine: {
      id: 'pull-day',
      name: 'Pull Day',
      description: 'Back work',
      exercises: [
        { id: 'row_back', name: 'Row', muscleGroup: 'Back', setStructure: 'normal' },
        { id: 'bench-press_chest', name: 'Bench Press', muscleGroup: 'Chest', setStructure: 'normal' },
      ],
    },
    historyRecorded: true,
  });
});

test('create_routine: the first routine gets order 0 and an empty description', async () => {
  const db = fakeDb({ 'exercises/row_back': row });
  ok(await db.tools.create_routine({ name: 'Pull Day', exerciseIds: ['row_back'] }));
  const routine = oneBatch(db)[0].data;
  assert.equal(routine.order, 0);
  assert.equal(routine.description, '');
});

test('create_routine: a taken id gets the app suffix and the existing routine is not touched', async () => {
  const db = fakeDb(seed());
  const before = JSON.stringify(db.get('routines/push-day'));
  ok(await db.tools.create_routine({ name: 'Push Day', exerciseIds: ['row_back'] }));
  assert.equal(oneBatch(db)[0].path, `${ROOT}routines/push-day-2`);
  assert.equal(JSON.stringify(db.get('routines/push-day')), before);
});

test('create_routine: an id with history of a removed routine chains to its last version', async () => {
  const old = { id: 'leg-day_5', routineId: 'leg-day', routineName: 'Leg Day', changeType: 'deleted', source: 'routine-editor', createdAtMs: NOW_MS + 50, snapshot: { name: 'Leg Day', description: '', exercises: [] }, snapshotHash: 'aaaaaaaa', prevHash: null };
  const db = fakeDb(seed({ 'routineHistory/leg-day_5': old }));
  ok(await db.tools.create_routine({ name: 'Leg Day', exerciseIds: ['row_back'] }));
  const [version] = versionsOf(oneBatch(db));
  assert.equal(version.data.prevHash, 'aaaaaaaa');
  assert.equal(version.data.createdAtMs, NOW_MS + 51, 'after the latest stored version');
});

test('create_routine: an unknown exercise id, a repeated id or a name with no id writes nothing', async () => {
  const unknown = fakeDb(seed());
  refused(await unknown.tools.create_routine({ name: 'Pull Day', exerciseIds: ['row_back', 'nope'] }), 'not_found', unknown);

  const repeated = fakeDb(seed());
  refused(await repeated.tools.create_routine({ name: 'Pull Day', exerciseIds: ['row_back', 'row_back'] }), 'already_in_routine', repeated);

  const noSlug = fakeDb(seed());
  refused(await noSlug.tools.create_routine({ name: '!!!', exerciseIds: ['row_back'] }), 'id_unavailable', noSlug);

  const reserved = fakeDb(seed());
  refused(await reserved.tools.create_routine({ name: '__x__', exerciseIds: ['row_back'] }), 'id_unavailable', reserved);
});

// ─── add_exercise_to_routine ─────────────────────────────────────────

test('add: one batch, a merge of exercises + updatedAt only, plus baseline and updated versions', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }));
  const ops = oneBatch(db);
  assert.equal(ops.length, 3);
  assert.deepEqual(ops[0], {
    kind: 'set',
    path: `${ROOT}routines/push-day`,
    data: {
      exercises: [entry('bench-press_chest', bench, 'superset'), entry('dips_triceps', dips), entry('row_back', row)],
      updatedAt: TS,
    },
    options: { merge: true },
  });

  // The routine had no history: the planner backfills its pre-edit state first.
  const [baseline, updated] = versionsOf(ops);
  assert.equal(baseline.kind, 'create');
  assert.equal(baseline.data.changeType, 'baseline');
  assert.equal(baseline.data.source, 'backfill');
  assert.equal(baseline.data.snapshot.exercises.length, 2);
  assert.equal(updated.kind, 'create');
  assert.equal(updated.data.changeType, 'updated');
  assert.equal(updated.data.source, 'mcp');
  assert.equal(updated.data.prevHash, baseline.data.snapshotHash);
  assert.ok(baseline.data.createdAtMs < updated.data.createdAtMs);
  assert.equal(updated.path, `${ROOT}routineHistory/${updated.data.id}`);

  // The merge keeps every other field of the stored routine.
  const stored = db.get('routines/push-day')!;
  assert.equal(stored.name, 'Push Day');
  assert.equal(stored.description, 'Chest and triceps');
  assert.equal(stored.order, 2);
  assert.equal(stored.createdAt, CREATED_AT);
  assert.equal(stored.legacyField, 'keep me');
  assert.equal(stored.updatedAt, TS);
  assert.equal(stored.exercises.length, 3);

  assert.equal(out.historyRecorded, true);
  assert.deepEqual(out.routine.exercises.map((e: Data) => e.id), ['bench-press_chest', 'dips_triceps', 'row_back']);
});

test('add: `index` inserts at that position, 0 and end included', async () => {
  for (const [index, expected] of [
    [0, ['row_back', 'bench-press_chest', 'dips_triceps']],
    [1, ['bench-press_chest', 'row_back', 'dips_triceps']],
    [2, ['bench-press_chest', 'dips_triceps', 'row_back']],
  ] as const) {
    const db = fakeDb(seed());
    ok(await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back', index }));
    assert.deepEqual(oneBatch(db)[0].data.exercises.map((e: Data) => e.id), expected);
  }
});

test('add: with stored history the new version chains to the latest one and no baseline is written', async () => {
  const v1 = { id: 'push-day_1', routineId: 'push-day', routineName: 'Push Day', changeType: 'created', source: 'routine-editor', createdAtMs: NOW_MS - 2000, snapshot: {}, snapshotHash: '11111111', prevHash: null };
  const v2 = { ...v1, id: 'push-day_2', changeType: 'updated', createdAtMs: NOW_MS - 1000, snapshotHash: '22222222', prevHash: '11111111' };
  const other = { ...v1, id: 'other_9', routineId: 'other', createdAtMs: NOW_MS + 999, snapshotHash: '99999999' };
  const db = fakeDb(seed({ 'routineHistory/push-day_2': v2, 'routineHistory/push-day_1': v1, 'routineHistory/other_9': other }));
  ok(await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }));
  const versions = versionsOf(oneBatch(db));
  assert.equal(versions.length, 1);
  assert.equal(versions[0].data.changeType, 'updated');
  assert.equal(versions[0].data.source, 'mcp');
  assert.equal(versions[0].data.prevHash, '22222222');
  assert.equal(versions[0].data.createdAtMs, NOW_MS);
});

test('add: refusals write nothing', async () => {
  const dup = fakeDb(seed());
  refused(await dup.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }), 'already_in_routine', dup);

  const noExercise = fakeDb(seed());
  refused(await noExercise.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'nope' }), 'not_found', noExercise);

  const noRoutine = fakeDb(seed());
  refused(await noRoutine.tools.add_exercise_to_routine({ routineId: 'nope', exerciseId: 'row_back' }), 'not_found', noRoutine);

  const pastEnd = fakeDb(seed());
  refused(await pastEnd.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back', index: 3 }), 'slot_mismatch', pastEnd);

  const many = Array.from({ length: MAX_ROUTINE_EXERCISES }, (_, i) => entry(`ex-${i}`, { name: `Ex ${i}`, muscleGroup: 'Chest' }));
  const full = fakeDb(seed({ 'routines/push-day': { ...pushDay(), exercises: many } }));
  refused(await full.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }), 'routine_full', full);
});

// ─── replace_exercise_in_routine ─────────────────────────────────────

test('replace: the slot keeps its position and set structure; one batch, source mcp', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 0, expectedExerciseId: 'bench-press_chest', newExerciseId: 'row_back' }));
  const ops = oneBatch(db);
  assert.deepEqual(ops[0].data, { exercises: [entry('row_back', row, 'superset'), entry('dips_triceps', dips)], updatedAt: TS });
  assert.deepEqual(ops[0].options, { merge: true });
  const versions = versionsOf(ops);
  assert.deepEqual(versions.map(v => [v.data.changeType, v.data.source]), [['baseline', 'backfill'], ['updated', 'mcp']]);
  assert.deepEqual(out.routine.exercises[0], { id: 'row_back', name: 'Row', muscleGroup: 'Back', setStructure: 'superset' });
});

test('replace: a wrong expected id writes nothing (slot_mismatch)', async () => {
  const wrongId = fakeDb(seed());
  refused(
    await wrongId.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 0, expectedExerciseId: 'dips_triceps', newExerciseId: 'row_back' }),
    'slot_mismatch',
    wrongId,
  );
  const pastEnd = fakeDb(seed());
  refused(
    await pastEnd.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 5, expectedExerciseId: 'bench-press_chest', newExerciseId: 'row_back' }),
    'slot_mismatch',
    pastEnd,
  );
});

test('replace: an exercise already in the routine, or an unknown one, writes nothing', async () => {
  const dup = fakeDb(seed());
  refused(
    await dup.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 0, expectedExerciseId: 'bench-press_chest', newExerciseId: 'dips_triceps' }),
    'already_in_routine',
    dup,
  );
  const unknown = fakeDb(seed());
  refused(
    await unknown.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 0, expectedExerciseId: 'bench-press_chest', newExerciseId: 'nope' }),
    'not_found',
    unknown,
  );
});

// ─── remove_exercise_from_routine ────────────────────────────────────

test('remove: one batch, the rest keep their order; the library exercise stays', async () => {
  const db = fakeDb(seed());
  ok(await db.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'bench-press_chest' }));
  const ops = oneBatch(db);
  assert.deepEqual(ops[0].data, { exercises: [entry('dips_triceps', dips)], updatedAt: TS });
  assert.deepEqual(versionsOf(ops).map(v => v.data.source), ['backfill', 'mcp']);
  assert.deepEqual(db.get('exercises/bench-press_chest'), bench);
});

test('remove: the last exercise, or one that is not in the routine, writes nothing', async () => {
  const last = fakeDb(seed({ 'routines/push-day': { ...pushDay(), exercises: [entry('dips_triceps', dips)] } }));
  refused(await last.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }), 'last_exercise', last);

  const absent = fakeDb(seed());
  refused(await absent.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'row_back' }), 'not_in_routine', absent);
});

// ─── reorder_routine_exercises ───────────────────────────────────────

test('reorder: one batch with the new order; entries keep their fields', async () => {
  const db = fakeDb(seed());
  ok(await db.tools.reorder_routine_exercises({ routineId: 'push-day', exerciseIds: ['dips_triceps', 'bench-press_chest'] }));
  const ops = oneBatch(db);
  assert.deepEqual(ops[0].data, { exercises: [entry('dips_triceps', dips), entry('bench-press_chest', bench, 'superset')], updatedAt: TS });
  assert.deepEqual(versionsOf(ops).map(v => [v.data.changeType, v.data.source]), [['baseline', 'backfill'], ['updated', 'mcp']]);
});

test('reorder: a different id set writes nothing (order_mismatch)', async () => {
  for (const exerciseIds of [
    ['dips_triceps'],
    ['dips_triceps', 'bench-press_chest', 'row_back'],
    ['dips_triceps', 'row_back'],
    ['dips_triceps', 'dips_triceps'],
  ]) {
    const db = fakeDb(seed());
    refused(await db.tools.reorder_routine_exercises({ routineId: 'push-day', exerciseIds }), 'order_mismatch', db);
  }
});

test('reorder: the same order records no new version', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.reorder_routine_exercises({ routineId: 'push-day', exerciseIds: ['bench-press_chest', 'dips_triceps'] }));
  assert.deepEqual(versionsOf(oneBatch(db)).map(v => v.data.changeType), ['baseline']);
  assert.equal(out.historyRecorded, false);
});

// ─── set_routine_set_structure ───────────────────────────────────────

/** A routine entry for the group tests; only the id and the structure matter. */
const g = (id: string, setStructure = 'normal') => entry(id, { name: id.toUpperCase(), muscleGroup: 'Chest' }, setStructure);
const armsDb = (exercises: Data[], extra: Record<string, Data> = {}) =>
  fakeDb(seed({ 'routines/arms': { name: 'Arms', description: '', order: 5, exercises }, ...extra }));
const structuresOf = (db: ReturnType<typeof fakeDb>) =>
  (db.get('routines/arms')!.exercises as Data[]).map(e => `${e.id}:${e.setStructure}`);

test('schemas: set_routine_set_structure takes a routine id, one of the five structures and 1 to 100 safe ids', () => {
  const s = writeToolSchemas.set_routine_set_structure;
  assert.deepEqual(Object.keys(s.shape).sort(), ['exerciseIds', 'routineId', 'setStructure']);
  for (const setStructure of ['normal', 'superset', 'triset', 'dropSet', 'restPause']) {
    assert.equal(s.safeParse({ routineId: 'arms', setStructure, exerciseIds: ['a', 'b'] }).success, true, setStructure);
  }
  for (const bad of [
    { routineId: 'arms', setStructure: 'giant set', exerciseIds: ['a'] },
    { routineId: 'arms', setStructure: 'Superset', exerciseIds: ['a', 'b'] },
    { routineId: 'arms', setStructure: 'superset', exerciseIds: [] },
    { routineId: 'arms', setStructure: 'superset', exerciseIds: ['a/b', 'c'] },
    { routineId: 'a/b', setStructure: 'superset', exerciseIds: ['a', 'b'] },
    { routineId: 'arms', setStructure: 'normal', exerciseIds: Array.from({ length: 101 }, (_, i) => `ex-${i}`) },
    { routineId: 'arms', exerciseIds: ['a', 'b'] },
    { routineId: 'arms', setStructure: 'superset' },
  ]) {
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
});

test('set structure: a superset on 2 consecutive ids is one batch with a baseline and an updated version, source mcp', async () => {
  const db = armsDb([g('a'), g('b'), g('c')]);
  const out = ok(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'b'] }));
  const ops = oneBatch(db);
  assert.equal(ops.length, 3);
  assert.deepEqual(ops[0], {
    kind: 'set',
    path: `${ROOT}routines/arms`,
    data: { exercises: [g('a', 'superset'), g('b', 'superset'), g('c')], updatedAt: TS },
    options: { merge: true },
  });
  const [baseline, updated] = versionsOf(ops);
  assert.deepEqual([baseline.data.changeType, baseline.data.source], ['baseline', 'backfill']);
  assert.deepEqual(baseline.data.snapshot.exercises.map((e: Data) => e.setStructure), ['normal', 'normal', 'normal']);
  assert.deepEqual([updated.data.changeType, updated.data.source], ['updated', 'mcp']);
  assert.deepEqual(updated.data.snapshot.exercises.map((e: Data) => e.setStructure), ['superset', 'superset', 'normal']);
  assert.equal(updated.data.prevHash, baseline.data.snapshotHash);
  assert.notEqual(updated.data.snapshotHash, baseline.data.snapshotHash);
  assert.equal(out.historyRecorded, true);
  assert.deepEqual(out.routine.exercises.map((e: Data) => e.setStructure), ['superset', 'superset', 'normal']);
  // The merge keeps the other fields of the routine.
  assert.equal(db.get('routines/arms')!.name, 'Arms');
  assert.equal(db.get('routines/arms')!.order, 5);
});

test('set structure: with stored history a pure structure change adds one updated version, source mcp', async () => {
  const v1 = { id: 'arms_1', routineId: 'arms', routineName: 'Arms', changeType: 'created', source: 'routine-editor', createdAtMs: NOW_MS - 1000, snapshot: {}, snapshotHash: '11111111', prevHash: null };
  const db = armsDb([g('a'), g('b'), g('c')], { 'routineHistory/arms_1': v1 });
  ok(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'dropSet', exerciseIds: ['c'] }));
  const versions = versionsOf(oneBatch(db));
  assert.deepEqual(versions.map(v => [v.data.changeType, v.data.source, v.data.prevHash]), [['updated', 'mcp', '11111111']]);
});

test('set structure: the order of the ids does not matter, their positions do', async () => {
  const reversed = armsDb([g('a'), g('b'), g('c'), g('d')]);
  ok(await reversed.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['c', 'b'] }));
  assert.deepEqual(structuresOf(reversed), ['a:normal', 'b:superset', 'c:superset', 'd:normal']);

  const triset = armsDb([g('a'), g('b'), g('c'), g('d')]);
  ok(await triset.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'triset', exerciseIds: ['d', 'b', 'c'] }));
  assert.deepEqual(structuresOf(triset), ['a:normal', 'b:triset', 'c:triset', 'd:triset']);

  const apart = armsDb([g('a'), g('b'), g('c'), g('d')]);
  refused(await apart.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'c'] }), 'not_consecutive', apart);

  const apartTriset = armsDb([g('a'), g('b'), g('c'), g('d')]);
  refused(await apartTriset.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'triset', exerciseIds: ['a', 'b', 'd'] }), 'not_consecutive', apartTriset);
});

test('set structure: a superset takes exactly 2 different ids and a triset exactly 3 (group_size)', async () => {
  for (const [setStructure, exerciseIds] of [
    ['superset', ['a']],
    ['superset', ['a', 'b', 'c']],
    ['superset', ['a', 'a']],
    ['triset', ['a', 'b']],
    ['triset', ['a', 'b', 'c', 'd']],
  ] as const) {
    const db = armsDb([g('a'), g('b'), g('c'), g('d')]);
    refused(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure, exerciseIds: [...exerciseIds] }), 'group_size', db);
  }
});

test('set structure: an unknown routine, an id outside the routine or a stored duplicate writes nothing', async () => {
  const noRoutine = armsDb([g('a'), g('b')]);
  refused(await noRoutine.tools.set_routine_set_structure({ routineId: 'nope', setStructure: 'superset', exerciseIds: ['a', 'b'] }), 'not_found', noRoutine);

  const absent = armsDb([g('a'), g('b')]);
  refused(await absent.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'row_back'] }), 'not_in_routine', absent);

  const twice = armsDb([g('a'), g('b'), g('a')]);
  refused(await twice.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'dropSet', exerciseIds: ['a'] }), 'conflict', twice);
});

test('set structure: a call that leaves an incomplete group writes nothing (incomplete_group)', async () => {
  // A third superset next to a pair.
  const third = armsDb([g('a', 'superset'), g('b', 'superset'), g('c'), g('d')]);
  const result = await third.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['b', 'c'] });
  refused(result, 'incomplete_group', third);
  assert.match(result.content[0].text, /incomplete superset.*"a", "b", "c"/);
  assert.match(result.content[0].text, /Nothing was written\./);

  for (const [setStructure, exerciseIds] of [
    ['normal', ['a']],
    ['dropSet', ['b']],
    ['triset', ['b', 'c', 'd']],
  ] as const) {
    const db = armsDb([g('a', 'superset'), g('b', 'superset'), g('c'), g('d', 'superset'), g('e', 'superset')]);
    refused(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure, exerciseIds: [...exerciseIds] }), 'incomplete_group', db);
  }

  // Two members of a triset to a superset leave the third one alone.
  const triset = armsDb([g('a', 'triset'), g('b', 'triset'), g('c', 'triset')]);
  refused(await triset.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'b'] }), 'incomplete_group', triset);
});

test('set structure: whole groups can be undone, added next to each other, or changed without a position rule', async () => {
  const undo = armsDb([g('a', 'superset'), g('b', 'superset'), g('c')]);
  ok(await undo.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'normal', exerciseIds: ['b', 'a'] }));
  assert.deepEqual(structuresOf(undo), ['a:normal', 'b:normal', 'c:normal']);

  const secondPair = armsDb([g('a', 'superset'), g('b', 'superset'), g('c'), g('d')]);
  ok(await secondPair.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['c', 'd'] }));
  assert.deepEqual(structuresOf(secondPair), ['a:superset', 'b:superset', 'c:superset', 'd:superset']);

  const dropSets = armsDb([g('a'), g('b'), g('c')]);
  ok(await dropSets.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'dropSet', exerciseIds: ['c', 'a'] }));
  assert.deepEqual(structuresOf(dropSets), ['a:dropSet', 'b:normal', 'c:dropSet']);

  const trisetToNormal = armsDb([g('a', 'triset'), g('b', 'triset'), g('c', 'triset')]);
  ok(await trisetToNormal.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'restPause', exerciseIds: ['a', 'b', 'c'] }));
  assert.deepEqual(structuresOf(trisetToNormal), ['a:restPause', 'b:restPause', 'c:restPause']);
});

test('set structure: an incomplete group that is already stored and untouched does not block a valid change', async () => {
  const lone = () => [g('a', 'superset'), g('x'), g('b'), g('c'), g('d', 'triset')];

  const unrelated = armsDb(lone());
  ok(await unrelated.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['b', 'c'] }));
  assert.deepEqual(structuresOf(unrelated), ['a:superset', 'x:normal', 'b:superset', 'c:superset', 'd:triset']);

  // One broken group is repaired while the other one stays.
  const repair = armsDb(lone());
  ok(await repair.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'normal', exerciseIds: ['a'] }));
  assert.deepEqual(structuresOf(repair), ['a:normal', 'x:normal', 'b:normal', 'c:normal', 'd:triset']);

  // The lone member gets its partner.
  const complete = armsDb([g('a', 'superset'), g('b'), g('c')]);
  ok(await complete.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'b'] }));
  assert.deepEqual(structuresOf(complete), ['a:superset', 'b:superset', 'c:normal']);

  // A change to the broken group that leaves it broken is still refused.
  const changed = armsDb([g('a', 'superset'), g('b', 'superset'), g('c', 'superset'), g('d')]);
  refused(await changed.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'dropSet', exerciseIds: ['b'] }), 'incomplete_group', changed);
});

test('set structure: a call that changes nothing answers ok and opens no batch', async () => {
  const db = armsDb([g('a', 'superset'), g('b', 'superset'), { ...g('c'), setStructure: undefined }]);
  const before = JSON.stringify(db.get('routines/arms'));
  const out = ok(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'superset', exerciseIds: ['a', 'b'] }));
  assert.equal(db.batches.length, 0);
  assert.equal(JSON.stringify(db.get('routines/arms')), before);
  assert.deepEqual(out, {
    ok: true,
    changed: false,
    routine: {
      id: 'arms',
      name: 'Arms',
      exercises: [
        { id: 'a', name: 'A', muscleGroup: 'Chest', setStructure: 'superset' },
        { id: 'b', name: 'B', muscleGroup: 'Chest', setStructure: 'superset' },
        { id: 'c', name: 'C', muscleGroup: 'Chest', setStructure: 'normal' },
      ],
    },
    historyRecorded: false,
  });

  // A stored entry without the field is normal already.
  const normal = ok(await db.tools.set_routine_set_structure({ routineId: 'arms', setStructure: 'normal', exerciseIds: ['c'] }));
  assert.equal(normal.changed, false);
  assert.equal(db.batches.length, 0);
});

// ─── Group guard on the other routine tools ──────────────────────────

test('add: a position inside a group writes nothing; before, after and between groups are fine', async () => {
  const pairs = () => [g('a', 'superset'), g('b', 'superset'), g('c', 'superset'), g('d', 'superset')];
  for (const index of [1, 3]) {
    const db = armsDb(pairs());
    const result = await db.tools.add_exercise_to_routine({ routineId: 'arms', exerciseId: 'row_back', index });
    refused(result, 'incomplete_group', db);
    assert.match(result.content[0].text, /Use a position before or after the group\./);
  }
  for (const index of [0, 2, 4, undefined]) {
    const db = armsDb(pairs());
    ok(await db.tools.add_exercise_to_routine({ routineId: 'arms', exerciseId: 'row_back', index }));
    assert.equal(structuresOf(db).length, 5);
  }
});

test('remove: a member of a group writes nothing; an exercise outside a group is removed', async () => {
  const list = () => [g('a', 'superset'), g('b', 'superset'), g('x'), g('c', 'triset'), g('d', 'triset'), g('e', 'triset')];
  for (const exerciseId of ['a', 'b', 'd']) {
    const db = armsDb(list());
    const result = await db.tools.remove_exercise_from_routine({ routineId: 'arms', exerciseId });
    refused(result, 'incomplete_group', db);
    assert.match(result.content[0].text, /set_routine_set_structure first\./);
  }
  const db = armsDb(list());
  ok(await db.tools.remove_exercise_from_routine({ routineId: 'arms', exerciseId: 'x' }));
  assert.deepEqual(structuresOf(db), ['a:superset', 'b:superset', 'c:triset', 'd:triset', 'e:triset']);

  // Removing the extra member of an incomplete run repairs it.
  const repair = armsDb([g('a', 'superset'), g('b', 'superset'), g('c', 'superset')]);
  ok(await repair.tools.remove_exercise_from_routine({ routineId: 'arms', exerciseId: 'c' }));
  assert.deepEqual(structuresOf(repair), ['a:superset', 'b:superset']);
});

test('reorder: an order that splits a group writes nothing; a group moved as a whole is stored', async () => {
  const list = () => [g('a', 'superset'), g('b', 'superset'), g('x'), g('y')];
  const split = armsDb(list());
  const result = await split.tools.reorder_routine_exercises({ routineId: 'arms', exerciseIds: ['a', 'x', 'b', 'y'] });
  refused(result, 'incomplete_group', split);
  assert.match(result.content[0].text, /Keep the exercises of a group next to each other/);

  const moved = armsDb(list());
  ok(await moved.tools.reorder_routine_exercises({ routineId: 'arms', exerciseIds: ['x', 'b', 'a', 'y'] }));
  assert.deepEqual(structuresOf(moved), ['x:normal', 'b:superset', 'a:superset', 'y:normal']);

  // Two pairs moved next to each other are still two pairs.
  const merged = armsDb([g('a', 'superset'), g('b', 'superset'), g('x'), g('c', 'superset'), g('d', 'superset')]);
  ok(await merged.tools.reorder_routine_exercises({ routineId: 'arms', exerciseIds: ['x', 'a', 'b', 'c', 'd'] }));
  assert.equal(merged.batches.length, 1);
});

test('replace: a swap inside a group is never refused and keeps the structure', async () => {
  const pair = armsDb([g('a', 'superset'), g('b', 'superset'), g('c')]);
  ok(await pair.tools.replace_exercise_in_routine({ routineId: 'arms', index: 1, expectedExerciseId: 'b', newExerciseId: 'row_back' }));
  assert.deepEqual(structuresOf(pair), ['a:superset', 'row_back:superset', 'c:normal']);

  // Also inside a group that is already incomplete: the swap does not change it.
  const broken = armsDb([g('a', 'superset'), g('b', 'superset'), g('c', 'superset')]);
  ok(await broken.tools.replace_exercise_in_routine({ routineId: 'arms', index: 2, expectedExerciseId: 'c', newExerciseId: 'row_back' }));
  assert.deepEqual(structuresOf(broken), ['a:superset', 'b:superset', 'row_back:superset']);
});

// ─── update_exercise ─────────────────────────────────────────────────

test('schemas: update_exercise takes the id and six optional fields, and refuses every other key', () => {
  const s = writeToolSchemas.update_exercise;
  assert.deepEqual(Object.keys(s.shape).sort(), [
    'dumbbellLoad', 'exerciseId', 'exerciseSetup', 'loadIncrementKg', 'progressiveOverload', 'targetNotes', 'warmupTemplate',
  ]);
  assert.deepEqual(s.parse({ exerciseId: 'row_back', targetNotes: '  Lats ' }), { exerciseId: 'row_back', targetNotes: 'Lats' });
  for (const good of [
    { exerciseId: 'row_back', targetNotes: '', exerciseSetup: 'y'.repeat(2000), progressiveOverload: '8-12 reps' },
    { exerciseId: 'row_back', warmupTemplate: 'MACHINE_COMPOUND' },
    { exerciseId: 'row_back', loadIncrementKg: 0.25, dumbbellLoad: 'perHand' },
    { exerciseId: 'row_back', loadIncrementKg: 1.25, dumbbellLoad: 'total' },
    { exerciseId: 'row_back', loadIncrementKg: 25 },
    { exerciseId: 'row_back', loadIncrementKg: null, dumbbellLoad: null },
  ]) {
    assert.equal(s.safeParse(good).success, true, JSON.stringify(good).slice(0, 80));
  }
  for (const bad of [
    { targetNotes: 'Lats' },
    { exerciseId: 'a/b', targetNotes: 'Lats' },
    { exerciseId: 'row_back', name: 'Renamed' },
    { exerciseId: 'row_back', muscleGroup: 'Chest' },
    { exerciseId: 'row_back', trackProgression: true },
    { exerciseId: 'row_back', setStructure: 'superset' },
    { exerciseId: 'row_back', instructions: 'x' },
    { exerciseId: 'row_back', targetNotes: 'y'.repeat(2001) },
    { exerciseId: 'row_back', targetNotes: null },
    { exerciseId: 'row_back', warmupTemplate: 'machine' },
    { exerciseId: 'row_back', warmupTemplate: null },
    { exerciseId: 'row_back', loadIncrementKg: 0 },
    { exerciseId: 'row_back', loadIncrementKg: -2.5 },
    { exerciseId: 'row_back', loadIncrementKg: 25.25 },
    { exerciseId: 'row_back', loadIncrementKg: 0.1 },
    { exerciseId: 'row_back', loadIncrementKg: '2.5' },
    { exerciseId: 'row_back', dumbbellLoad: 'each' },
  ]) {
    assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
});

test('update_exercise: no field, or an unknown id, writes nothing', async () => {
  const empty = fakeDb(seed());
  refused(await empty.tools.update_exercise({ exerciseId: 'bench-press_chest' }), 'no_fields', empty);

  const unknown = fakeDb(seed());
  refused(await unknown.tools.update_exercise({ exerciseId: 'nope', targetNotes: 'x' }), 'not_found', unknown);
});

test('update_exercise: loadIncrementKg and dumbbellLoad are one update on the exercise and touch no routine', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', loadIncrementKg: 2.5, dumbbellLoad: 'perHand' }));
  assert.deepEqual(oneBatch(db), [
    {
      kind: 'update',
      path: `${ROOT}exercises/bench-press_chest`,
      data: { loadIncrementKg: 2.5, dumbbellLoad: 'perHand', userEdited: true, updatedAt: TS },
    },
  ]);
  // Every other stored field stays.
  assert.deepEqual(db.get('exercises/bench-press_chest'), { ...bench, loadIncrementKg: 2.5, dumbbellLoad: 'perHand', userEdited: true, updatedAt: TS });
  assert.deepEqual(out, {
    ok: true,
    changed: ['loadIncrementKg', 'dumbbellLoad'],
    exercise: {
      id: 'bench-press_chest',
      name: 'Bench Press',
      muscleGroup: 'Chest',
      targetNotes: 'Mid chest',
      exerciseSetup: 'Flat',
      progressiveOverload: '6-8',
      repRange: { min: 6, max: 8 },
      warmupTemplate: 'HEAVY_BARBELL',
      loadIncrementKg: 2.5,
      dumbbellLoad: 'perHand',
    },
    routinesUpdated: [],
  });
});

test('update_exercise: a text change goes to every routine that holds the exercise, in the same batch, source mcp', async () => {
  const pullDay = { name: 'Pull Day', order: 3, exercises: [entry('row_back', row)] };
  const legDay = { name: 'Leg Day', order: 4, exercises: [entry('row_back', row), entry('bench-press_chest', bench)] };
  const db = fakeDb(seed({ 'routines/pull-day': pullDay, 'routines/leg-day': legDay }));
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: ' Upper chest ' }));
  const ops = oneBatch(db);
  const edited = { ...bench, targetNotes: 'Upper chest' };

  assert.deepEqual(ops[0], {
    kind: 'update',
    path: `${ROOT}exercises/bench-press_chest`,
    data: { targetNotes: 'Upper chest', userEdited: true, updatedAt: TS },
  });
  const routineOps = ops.filter(op => op.path.startsWith(`${ROOT}routines/`));
  assert.deepEqual(routineOps, [
    {
      kind: 'set',
      path: `${ROOT}routines/push-day`,
      // The slot keeps its position and set structure.
      data: { exercises: [entry('bench-press_chest', edited, 'superset'), entry('dips_triceps', dips)], updatedAt: TS },
      options: { merge: true },
    },
    {
      kind: 'set',
      path: `${ROOT}routines/leg-day`,
      data: { exercises: [entry('row_back', row), entry('bench-press_chest', edited)], updatedAt: TS },
      options: { merge: true },
    },
  ]);
  // A routine without the exercise is not written.
  assert.equal(db.get('routines/pull-day'), pullDay);
  assert.equal(db.get('routines/push-day')!.legacyField, 'keep me');

  // One baseline (the state before) and one mcp version per routine.
  const versions = versionsOf(ops);
  assert.equal(routineOps.length + versions.length + 1, ops.length);
  for (const routineId of ['push-day', 'leg-day']) {
    const own = versions.filter(v => v.data.routineId === routineId);
    assert.deepEqual(own.map(v => [v.kind, v.data.changeType, v.data.source]), [
      ['create', 'baseline', 'backfill'],
      ['create', 'updated', 'mcp'],
    ]);
    assert.equal(own[1].data.prevHash, own[0].data.snapshotHash);
    const snapshotEntry = own[1].data.snapshot.exercises.find((e: Data) => e.id === 'bench-press_chest');
    assert.equal(snapshotEntry.targetNotes, 'Upper chest');
  }
  assert.deepEqual(out.changed, ['targetNotes']);
  assert.equal(out.exercise.targetNotes, 'Upper chest');
  assert.deepEqual(out.routinesUpdated, [
    { id: 'push-day', name: 'Push Day', historyRecorded: true },
    { id: 'leg-day', name: 'Leg Day', historyRecorded: true },
  ]);
});

test('update_exercise: a rep range change rewrites the routine copy but records no new version, like the app', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', progressiveOverload: '8-12 reps' }));
  const ops = oneBatch(db);
  assert.deepEqual(ops[0].data, { progressiveOverload: '8-12 reps', userEdited: true, updatedAt: TS });
  assert.deepEqual(ops[1].data.exercises[0], entry('bench-press_chest', { ...bench, progressiveOverload: '8-12 reps' }, 'superset'));
  // The history hash does not hold the rep range: only the backfilled baseline is written.
  assert.deepEqual(versionsOf(ops).map(v => v.data.changeType), ['baseline']);
  assert.deepEqual(out.exercise.repRange, { min: 8, max: 12 });
  assert.deepEqual(out.routinesUpdated, [{ id: 'push-day', name: 'Push Day', historyRecorded: false }]);
});

test('update_exercise: the routine copy gets the three text fields as the library holds them after the change', async () => {
  const stale = { ...pushDay(), exercises: [{ ...entry('bench-press_chest', bench, 'superset'), exerciseSetup: 'Old setup' }, entry('dips_triceps', dips)] };
  const db = fakeDb(seed({ 'routines/push-day': stale }));
  ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', progressiveOverload: '5-8 reps' }));
  assert.deepEqual(oneBatch(db)[1].data.exercises[0], entry('bench-press_chest', { ...bench, progressiveOverload: '5-8 reps' }, 'superset'));
});

test('update_exercise: an empty string clears a text field', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', exerciseSetup: '' }));
  const ops = oneBatch(db);
  assert.deepEqual(ops[0].data, { exerciseSetup: '', userEdited: true, updatedAt: TS });
  assert.equal(ops[1].data.exercises[0].exerciseSetup, '');
  assert.equal('exerciseSetup' in out.exercise, false);
});

test('update_exercise: warmupTemplate writes the field path only, keeps the other warm-up keys and touches no routine', async () => {
  const withRounding = { ...bench, warmup: { template: 'HEAVY_BARBELL', roundingIncrementKg: 2.5, overrideSteps: [{ type: 'LABEL', reps: '10', rest: '60s' }] } };
  const db = fakeDb(seed({ 'exercises/bench-press_chest': withRounding }));
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', warmupTemplate: 'MACHINE_COMPOUND' }));
  assert.deepEqual(oneBatch(db), [
    {
      kind: 'update',
      path: `${ROOT}exercises/bench-press_chest`,
      data: { 'warmup.template': 'MACHINE_COMPOUND', userEdited: true, updatedAt: TS },
    },
  ]);
  assert.deepEqual(db.get('exercises/bench-press_chest')!.warmup, { ...withRounding.warmup, template: 'MACHINE_COMPOUND' });
  assert.deepEqual(out.changed, ['warmupTemplate']);
  assert.equal(out.exercise.warmupTemplate, 'MACHINE_COMPOUND');

  // An exercise with no stored warm-up gets a warm-up that holds the template.
  const bare = fakeDb(seed());
  ok(await bare.tools.update_exercise({ exerciseId: 'row_back', warmupTemplate: 'ISOLATION' }));
  assert.deepEqual(bare.get('exercises/row_back')!.warmup, { template: 'ISOLATION' });
});

test('update_exercise: null removes loadIncrementKg and dumbbellLoad', async () => {
  const stored = { ...bench, loadIncrementKg: 5, dumbbellLoad: 'total' };
  const db = fakeDb(seed({ 'exercises/bench-press_chest': stored }));
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', loadIncrementKg: null, dumbbellLoad: null }));
  assert.deepEqual(oneBatch(db), [
    {
      kind: 'update',
      path: `${ROOT}exercises/bench-press_chest`,
      data: { loadIncrementKg: REMOVE, dumbbellLoad: REMOVE, userEdited: true, updatedAt: TS },
    },
  ]);
  const after = db.get('exercises/bench-press_chest')!;
  assert.equal('loadIncrementKg' in after, false);
  assert.equal('dumbbellLoad' in after, false);
  assert.deepEqual(out.changed, ['loadIncrementKg', 'dumbbellLoad']);
  assert.equal('loadIncrementKg' in out.exercise, false);
  assert.equal('dumbbellLoad' in out.exercise, false);

  // One of the two: the other stays.
  const one = fakeDb(seed({ 'exercises/bench-press_chest': stored }));
  ok(await one.tools.update_exercise({ exerciseId: 'bench-press_chest', dumbbellLoad: null }));
  assert.equal(one.get('exercises/bench-press_chest')!.loadIncrementKg, 5);
  assert.equal('dumbbellLoad' in one.get('exercises/bench-press_chest')!, false);
});

test('update_exercise: values equal to the stored ones open no batch', async () => {
  const stored = { ...bench, loadIncrementKg: 5 };
  const db = fakeDb(seed({ 'exercises/bench-press_chest': stored }));
  const out = ok(
    await db.tools.update_exercise({
      exerciseId: 'bench-press_chest',
      targetNotes: 'Mid chest',
      warmupTemplate: 'HEAVY_BARBELL',
      loadIncrementKg: 5,
      // Not stored, so there is nothing to remove.
      dumbbellLoad: null,
    }),
  );
  assert.equal(db.batches.length, 0);
  assert.deepEqual(out.changed, []);
  assert.deepEqual(out.routinesUpdated, []);
  assert.equal(out.exercise.loadIncrementKg, 5);
  assert.equal(db.get('exercises/bench-press_chest'), stored);
});

test('update_exercise: only the changed fields are written', async () => {
  const db = fakeDb(seed());
  const out = ok(await db.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Mid chest', loadIncrementKg: 2.5 }));
  assert.deepEqual(oneBatch(db), [
    { kind: 'update', path: `${ROOT}exercises/bench-press_chest`, data: { loadIncrementKg: 2.5, userEdited: true, updatedAt: TS } },
  ]);
  assert.deepEqual(out.changed, ['loadIncrementKg']);
});

test('update_exercise: an exercise removed before the commit fails the batch; no document appears and no routine changes', async () => {
  const db = fakeDb(seed(), { beforeCommit: store => store.delete(`${ROOT}exercises/bench-press_chest`) });
  const routineBefore = JSON.stringify(db.get('routines/push-day'));
  const result = await db.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest', loadIncrementKg: 2.5 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^conflict: /);
  assert.doesNotMatch(result.content[0].text, /fake-owner|users\//);
  assert.equal(db.store.has(`${ROOT}exercises/bench-press_chest`), false);
  assert.equal(JSON.stringify(db.get('routines/push-day')), routineBefore);
  assert.equal([...db.store.keys()].some(p => p.includes('/routineHistory/')), false);
});

test('update_exercise: a missing document is a conflict for the numeric gRPC code and for the string form', async () => {
  for (const notFoundCode of [5, 'not-found']) {
    const db = fakeDb(seed(), { notFoundCode, beforeCommit: store => store.delete(`${ROOT}exercises/bench-press_chest`) });
    const result = await db.tools.update_exercise({ exerciseId: 'bench-press_chest', loadIncrementKg: 2.5 });
    assert.equal(result.isError, true, `code ${String(notFoundCode)}`);
    assert.match(result.content[0].text, /^conflict: .*Nothing was written\./, `code ${String(notFoundCode)}`);
    assert.equal(db.store.has(`${ROOT}exercises/bench-press_chest`), false);
  }
  // Any other failure of the commit stays write_failed.
  const other = fakeDb(seed(), { notFoundCode: 13, beforeCommit: store => store.delete(`${ROOT}exercises/bench-press_chest`) });
  const result = await other.tools.update_exercise({ exerciseId: 'bench-press_chest', loadIncrementKg: 2.5 });
  assert.match(result.content[0].text, /^write_failed: /);
});

test('update_exercise: a routine list or a routine the tool cannot read in full refuses a text change', async () => {
  const many: Record<string, Data> = {};
  for (let i = 0; i <= MAX_ROUTINES; i++) many[`routines/r-${i}`] = { name: `R ${i}`, order: 10 + i, exercises: [entry('row_back', row)] };
  const truncated = fakeDb(seed(many));
  refused(await truncated.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest' }), 'conflict', truncated);

  const unreadable = { ...pushDay(), exercises: [{ name: 'No id', muscleGroup: 'Chest' }, entry('bench-press_chest', bench)] };
  const badEntry = fakeDb(seed({ 'routines/push-day': unreadable }));
  refused(await badEntry.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest' }), 'conflict', badEntry);

  const badVersion = fakeDb(seed({ 'routineHistory/push-day_1': { routineId: 'push-day', snapshotHash: 'x' } }));
  refused(await badVersion.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest' }), 'conflict', badVersion);

  // A library-only field reads no routine, so the same data does not stop it.
  const libraryOnly = fakeDb(seed(many));
  ok(await libraryOnly.tools.update_exercise({ exerciseId: 'bench-press_chest', loadIncrementKg: 2.5 }));
  assert.equal(oneBatch(libraryOnly).length, 1);
});

test('update_exercise: a failed commit is write_failed, and nothing changed', async () => {
  const db = fakeDb(seed(), { failCommit: true });
  const before = JSON.stringify([...db.store.entries()]);
  const result = await db.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^write_failed: /);
  assert.doesNotMatch(result.content[0].text, /secret|fake-owner|users\//);
  assert.equal(JSON.stringify([...db.store.entries()]), before);
});

// ─── History and stored data the tools cannot trust ──────────────────

test('a truncated history read refuses with conflict and writes nothing', async () => {
  const history: Record<string, Data> = {};
  for (let i = 0; i <= MAX_ROUTINE_HISTORY; i++) {
    history[`routineHistory/push-day_${i}`] = { routineId: 'push-day', createdAtMs: i, snapshotHash: 'x' };
  }
  const db = fakeDb(seed(history));
  refused(await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }), 'conflict', db);
});

test('a stored version or routine entry the tool cannot read refuses with conflict', async () => {
  const badVersion = fakeDb(seed({ 'routineHistory/push-day_1': { routineId: 'push-day', snapshotHash: 'x' } }));
  refused(await badVersion.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }), 'conflict', badVersion);

  const badEntry = fakeDb(seed({ 'routines/push-day': { ...pushDay(), exercises: [{ name: 'No id', muscleGroup: 'Chest' }, entry('dips_triceps', dips)] } }));
  refused(await badEntry.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }), 'conflict', badEntry);

  const twice = fakeDb(seed({ 'routines/push-day': { ...pushDay(), exercises: [entry('dips_triceps', dips), entry('dips_triceps', dips), entry('row_back', row)] } }));
  refused(await twice.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }), 'conflict', twice);
});

// ─── All tools together ──────────────────────────────────────────────

test('every routine tool: exactly one batch and one commit, owner paths only, new versions with source mcp', async () => {
  const calls: Array<(t: ReturnType<typeof fakeDb>['tools']) => Promise<ToolResult>> = [
    t => t.create_routine({ name: 'Pull Day', exerciseIds: ['row_back'] }),
    t => t.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back', index: 0 }),
    t => t.replace_exercise_in_routine({ routineId: 'push-day', index: 1, expectedExerciseId: 'dips_triceps', newExerciseId: 'row_back' }),
    t => t.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }),
    t => t.reorder_routine_exercises({ routineId: 'push-day', exerciseIds: ['dips_triceps', 'bench-press_chest'] }),
  ];
  for (const call of calls) {
    const db = fakeDb(seed());
    ok(await call(db.tools));
    const ops = oneBatch(db);
    const routineOps = ops.filter(op => op.path.startsWith(`${ROOT}routines/`));
    const versions = versionsOf(ops);
    assert.equal(routineOps.length, 1, 'one routine write');
    assert.equal(routineOps.length + versions.length, ops.length, 'only the routine and its versions');
    assert.ok(versions.length >= 1);
    for (const version of versions) {
      assert.equal(version.kind, 'create');
      // The only version that is not from this tool is the planner's backfilled baseline.
      assert.equal(version.data.source, version.data.changeType === 'baseline' ? 'backfill' : 'mcp');
    }
    assert.equal(versions.filter(v => v.data.source === 'mcp').length, 1);
  }
});

// ─── Failures ────────────────────────────────────────────────────────

test('a failed read is write_failed with no internal detail, and opens no batch', async () => {
  const db = fakeDb(seed(), { failRead: true });
  const results = [
    await db.tools.create_exercise({ name: 'Cable Fly', muscleGroup: 'Chest' }),
    await db.tools.create_routine({ name: 'Pull Day', exerciseIds: ['row_back'] }),
    await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' }),
    await db.tools.replace_exercise_in_routine({ routineId: 'push-day', index: 0, expectedExerciseId: 'bench-press_chest', newExerciseId: 'row_back' }),
    await db.tools.remove_exercise_from_routine({ routineId: 'push-day', exerciseId: 'dips_triceps' }),
    await db.tools.reorder_routine_exercises({ routineId: 'push-day', exerciseIds: ['dips_triceps', 'bench-press_chest'] }),
    await db.tools.update_exercise({ exerciseId: 'bench-press_chest', targetNotes: 'Upper chest' }),
  ];
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^write_failed: /);
    assert.doesNotMatch(result.content[0].text, /secret|fake-owner|users\//);
  }
  assert.equal(db.batches.length, 0);
});

test('a failed commit is write_failed with no internal detail, and the stored routine is unchanged', async () => {
  const db = fakeDb(seed(), { failCommit: true });
  const before = JSON.stringify(db.get('routines/push-day'));
  const result = await db.tools.add_exercise_to_routine({ routineId: 'push-day', exerciseId: 'row_back' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^write_failed: /);
  assert.doesNotMatch(result.content[0].text, /secret|fake-owner|users\//);
  assert.equal(JSON.stringify(db.get('routines/push-day')), before);
});
