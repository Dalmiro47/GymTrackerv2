import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ExerciseData, RoutineData } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import type { RoutineExerciseEntry } from '@/lib/routineDoc';
import { createWriteRepo, type McpWriteRepo, type WriteBatch, type WriteDb, type WriteDocRef } from './repo.write.server';

// Fake values only. The fake db records every call, fails a batch whose `create`
// targets an existing document, and throws on any member that is not doc, batch,
// create, set, update or commit (delete, get, collection...). Its `update` fails
// the whole batch when the document is missing, like Firestore.
const OWNER = 'fake-owner';
const ROOT = `users/${OWNER}/`;
const TS = { sentinel: 'serverTimestamp' };
const REMOVE = { sentinel: 'removeField' };

type Data = Record<string, unknown>;
type Op = { kind: 'create' | 'set' | 'update'; path: string; data: Data; options?: unknown };

/** Firestore `update`: a dotted key is a field path, and the remove sentinel drops the key. */
function applyUpdate(current: Data, data: Data): Data {
  const next: Data = { ...current };
  for (const [key, value] of Object.entries(data)) {
    const [head, child] = key.split('.');
    if (child === undefined) {
      if (value === REMOVE) delete next[head];
      else next[head] = value;
    } else {
      next[head] = { ...(next[head] as Data | undefined), [child]: value };
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

function fakeDb(existing: Record<string, Data> = {}) {
  const store = new Map<string, Data>(Object.entries(existing));
  const docPaths: string[] = [];
  const batches: Array<{ ops: Op[]; commits: number }> = [];
  const db: WriteDb = strict(
    {
      doc(path: string) {
        docPaths.push(path);
        return strict({ path }, 'docRef');
      },
      batch() {
        const batch = { ops: [] as Op[], commits: 0 };
        batches.push(batch);
        return strict(
          {
            create(ref: WriteDocRef, data: Data) {
              batch.ops.push({ kind: 'create', path: ref.path, data });
            },
            set(ref: WriteDocRef, data: Data, options: unknown) {
              batch.ops.push({ kind: 'set', path: ref.path, data, options });
            },
            update(ref: WriteDocRef, data: Data) {
              batch.ops.push({ kind: 'update', path: ref.path, data });
            },
            async commit() {
              batch.commits++;
              const taken = batch.ops.find(op => op.kind === 'create' && store.has(op.path));
              if (taken) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
              const gone = batch.ops.find(op => op.kind === 'update' && !store.has(op.path));
              if (gone) throw Object.assign(new Error('5 NOT_FOUND'), { code: 5 });
              for (const op of batch.ops) {
                if (op.kind === 'update') store.set(op.path, applyUpdate(store.get(op.path)!, op.data));
                else if (op.kind === 'set') store.set(op.path, applyUpdate(store.get(op.path) ?? {}, op.data));
                else store.set(op.path, op.data);
              }
            },
          },
          'batch',
        );
      },
    },
    'db',
  );
  return { db, store, docPaths, batches, repo: createWriteRepo(db, OWNER, () => TS, () => REMOVE) };
}

const exercise: ExerciseData = { name: 'Cable Fly', muscleGroup: 'Chest', targetNotes: '', dataAiHint: 'cable fly' };

const entries: RoutineExerciseEntry[] = [
  { id: 'cable-fly_chest', name: 'Cable Fly', muscleGroup: 'Chest', targetNotes: '', exerciseSetup: '', progressiveOverload: '', dataAiHint: '', setStructure: 'normal' },
];

const routine: RoutineData = { name: 'Push Day', description: '', exercises: entries, order: 3 };

const version = (routineId: string, ms: number): RoutineVersion => ({
  id: `${routineId}_${ms}`,
  routineId,
  routineName: 'Push Day',
  changeType: 'updated',
  source: 'mcp',
  createdAtMs: ms,
  snapshot: { name: 'Push Day', description: '', exercises: [] },
  snapshotHash: 'abcd1234',
  prevHash: null,
});

// Compile-time: no key of the write surface is a delete, and the only update is
// the batch's. `npm run typecheck` fails here if one is ever added.
type WriteSurface = keyof WriteDb | keyof WriteDocRef | keyof McpWriteRepo;
type Forbidden =
  | Extract<WriteSurface, 'delete' | 'update' | 'recursiveDelete' | 'runTransaction' | 'bulkWriter'>
  | Extract<keyof WriteBatch, 'delete'>;
const noForbiddenKey: [Forbidden] extends [never] ? true : false = true;

test('the write surface has no delete, and three update calls: an exercise, the exercises of a log, the end of a session', () => {
  assert.equal(noForbiddenKey, true);
  const { db } = fakeDb();
  const batch = db.batch();
  assert.deepEqual(Object.keys(batch).sort(), ['commit', 'create', 'set', 'update']);
  const source = readFileSync(new URL('./repo.write.server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /delete/);
  assert.equal(source.match(/\.update\(/g)?.length, 3);
});

test('the fake refuses a delete or a document update, so a repo that used one would fail these tests', () => {
  const { db } = fakeDb();
  assert.throws(() => (db as unknown as { recursiveDelete(): void }).recursiveDelete());
  assert.throws(() => (db.batch() as unknown as { delete(ref: unknown): void }).delete({}));
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { delete(): void }).delete());
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { update(v: unknown): void }).update({}));
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { set(v: unknown): void }).set({}));
});

test('createWriteRepo: refuses an empty uid or one that is not one path segment', () => {
  const { db } = fakeDb();
  for (const bad of ['', 'a/b', '..', '.', '__x__']) {
    assert.throws(() => createWriteRepo(db, bad, () => TS, () => REMOVE), `uid should be refused: ${bad}`);
  }
});

test('createExercise: one batch, one create at users/{owner}/exercises/{id}', async () => {
  const { repo, batches } = fakeDb();
  await repo.createExercise('cable-fly_chest', exercise);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [{ kind: 'create', path: `${ROOT}exercises/cable-fly_chest`, data: exercise }]);
});

test('createRoutine: one batch with the routine (timestamps added) and its versions, all creates', async () => {
  const { repo, batches } = fakeDb();
  await repo.createRoutine('push-day', routine, [version('push-day', 10), version('push-day', 11)]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    { kind: 'create', path: `${ROOT}routines/push-day`, data: { ...routine, createdAt: TS, updatedAt: TS } },
    { kind: 'create', path: `${ROOT}routineHistory/push-day_10`, data: version('push-day', 10) },
    { kind: 'create', path: `${ROOT}routineHistory/push-day_11`, data: version('push-day', 11) },
  ]);
});

test('setRoutineExercises: one batch; a merge of exercises + updatedAt only, versions as creates', async () => {
  const stored = { name: 'Push Day', order: 3, createdAt: 'kept', exercises: [] };
  const { repo, batches, store } = fakeDb({ [`${ROOT}routines/push-day`]: stored });
  // An extra key on the argument must not reach the document.
  const fields = { exercises: entries, name: 'Hacked', order: 99 } as { exercises: RoutineExerciseEntry[] };
  await repo.setRoutineExercises('push-day', fields, [version('push-day', 10)]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    { kind: 'set', path: `${ROOT}routines/push-day`, data: { exercises: entries, updatedAt: TS }, options: { merge: true } },
    { kind: 'create', path: `${ROOT}routineHistory/push-day_10`, data: version('push-day', 10) },
  ]);
  assert.deepEqual(store.get(`${ROOT}routines/push-day`), { name: 'Push Day', order: 3, createdAt: 'kept', exercises: entries, updatedAt: TS });
});

test('setScheduleDay: one batch; a merge of date, items and updatedAt at users/{owner}/schedule/{date}', async () => {
  const path = `${ROOT}schedule/2026-11-16`;
  const { repo, batches, store } = fakeDb({ [path]: { date: '2026-11-16', items: [{ kind: 'rest' }], note: 'kept' } });
  // An extra key on an item must not reach the document.
  const items = [
    { kind: 'routine', routineId: 'push-day', routineName: 'Push Day', order: 99 },
    { kind: 'activity', activity: 'boxing', routineId: 'hacked' },
  ] as unknown as Parameters<McpWriteRepo['setScheduleDay']>[1];
  await repo.setScheduleDay('2026-11-16', items);
  const stored = [
    { kind: 'routine', routineId: 'push-day', routineName: 'Push Day' },
    { kind: 'activity', activity: 'boxing' },
  ];
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    { kind: 'set', path, data: { date: '2026-11-16', items: stored, updatedAt: TS }, options: { merge: true } },
  ]);
  // The items are replaced whole; a field this repo does not know stays.
  assert.deepEqual(store.get(path), { date: '2026-11-16', items: stored, updatedAt: TS, note: 'kept' });

  await repo.setScheduleDay('2026-11-16', []);
  assert.deepEqual(store.get(path), { date: '2026-11-16', items: [], updatedAt: TS, note: 'kept' });
});

test('setScheduleDay: a date that is not a real day, or a bad item list, is refused before any batch is opened', async () => {
  const { repo, batches, docPaths } = fakeDb();
  for (const bad of ['', 'a/b', '..', 'today', 'push-day', '2026-1-1', '2026-02-30', '2026-11-16x', '2026-11-16/x']) {
    await assert.rejects(repo.setScheduleDay(bad, [{ kind: 'rest' }]), `date should be refused: ${bad}`);
  }
  const rest = { kind: 'rest' } as const;
  await assert.rejects(repo.setScheduleDay('2026-11-16', [rest, rest, rest, rest]));
  await assert.rejects(repo.setScheduleDay('2026-11-16', [{ kind: 'routine', routineId: 'a/b', routineName: 'x' }]));
  await assert.rejects(repo.setScheduleDay('2026-11-16', [{ kind: 'gym' }] as unknown as Parameters<McpWriteRepo['setScheduleDay']>[1]));
  assert.equal(batches.length, 0);
  assert.equal(docPaths.some(p => !/^users\/fake-owner\/schedule\/\d{4}-\d{2}-\d{2}$/.test(p)), false);
});

test('every write path is users/{owner}/ + one of the four collections + one id; a schedule id is a date', async () => {
  const { repo, batches, docPaths } = fakeDb();
  await repo.createExercise('cable-fly_chest', exercise);
  await repo.createRoutine('push-day', routine, [version('push-day', 10)]);
  await repo.setRoutineExercises('push-day', { exercises: entries }, [version('push-day', 11)]);
  await repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'Lower chest' }, [
    { id: 'push-day', exercises: entries, versions: [version('push-day', 12)] },
  ]);
  await repo.setScheduleDay('2026-11-16', [{ kind: 'rest' }]);
  const allowed = new RegExp(`^users/${OWNER}/((routines|exercises|routineHistory)/[^/]+|schedule/\\d{4}-\\d{2}-\\d{2})$`);
  const paths = [...docPaths, ...batches.flatMap(b => b.ops.map(op => op.path))];
  assert.equal(paths.length, 18);
  for (const path of paths) assert.match(path, allowed);
});

test('an id that could leave the collection is refused before any batch is opened', async () => {
  const { repo, batches, docPaths } = fakeDb();
  for (const bad of ['', 'a/b', '.', '..', '__name__', 'x'.repeat(201)]) {
    await assert.rejects(repo.createExercise(bad, exercise), `id should be refused: ${bad.slice(0, 12)}`);
    await assert.rejects(repo.createRoutine(bad, routine, []));
    await assert.rejects(repo.setRoutineExercises(bad, { exercises: entries }, []));
    await assert.rejects(repo.updateExerciseFields(bad, { targetNotes: 'x' }, []));
    await assert.rejects(repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'x' }, [{ id: bad, exercises: entries, versions: [] }]));
  }
  await assert.rejects(repo.createRoutine('push-day', routine, [{ ...version('push-day', 10), id: 'a/b' }]));
  await assert.rejects(repo.setRoutineExercises('push-day', { exercises: entries }, [{ ...version('push-day', 10), id: '..' }]));
  assert.equal(batches.length, 0);
  assert.equal(docPaths.some(p => p.includes('//') || p.includes('..')), false);
});

test('a version of another routine is refused before any batch is opened', async () => {
  const { repo, batches } = fakeDb();
  await assert.rejects(repo.createRoutine('push-day', routine, [version('pull-day', 10)]));
  await assert.rejects(repo.setRoutineExercises('push-day', { exercises: entries }, [version('pull-day', 10)]));
  await assert.rejects(
    repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'x' }, [{ id: 'push-day', exercises: entries, versions: [version('pull-day', 10)] }]),
  );
  assert.equal(batches.length, 0);
});

test('a create on an existing id fails the whole batch and overwrites nothing', async () => {
  const existingExercise = { name: 'Already here' };
  const existingRoutine = { name: 'Already here', order: 0 };
  const existingVersion = { id: 'push-day_10', note: 'already here' };
  const { repo, store } = fakeDb({
    [`${ROOT}exercises/cable-fly_chest`]: existingExercise,
    [`${ROOT}routines/push-day`]: existingRoutine,
    [`${ROOT}routineHistory/pull-day_10`]: existingVersion,
  });
  await assert.rejects(repo.createExercise('cable-fly_chest', exercise));
  await assert.rejects(repo.createRoutine('push-day', routine, [version('push-day', 10)]));
  // The routine id is free, but its version id is taken: the routine is not written either.
  await assert.rejects(repo.createRoutine('pull-day', routine, [version('pull-day', 10)]));

  assert.equal(store.get(`${ROOT}exercises/cable-fly_chest`), existingExercise);
  assert.equal(store.get(`${ROOT}routines/push-day`), existingRoutine);
  assert.equal(store.get(`${ROOT}routineHistory/pull-day_10`), existingVersion);
  assert.equal(store.has(`${ROOT}routines/pull-day`), false);
  assert.equal(store.has(`${ROOT}routineHistory/push-day_10`), false);
  assert.equal(store.size, 3);
});

// ─── updateExerciseFields ────────────────────────────────────────────

const storedExercise = {
  name: 'Cable Fly',
  muscleGroup: 'Chest',
  targetNotes: 'Mid chest',
  instructions: 'kept',
  warmup: { template: 'ISOLATION', roundingIncrementKg: 2.5 },
  loadIncrementKg: 5,
  dumbbellLoad: 'total',
};

test('updateExerciseFields: one batch, one update with only the given fields plus userEdited and updatedAt', async () => {
  const { repo, batches, store } = fakeDb({ [`${ROOT}exercises/cable-fly_chest`]: storedExercise });
  await repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'Lower chest', loadIncrementKg: 2.5 }, []);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    {
      kind: 'update',
      path: `${ROOT}exercises/cable-fly_chest`,
      data: { targetNotes: 'Lower chest', loadIncrementKg: 2.5, userEdited: true, updatedAt: TS },
    },
  ]);
  assert.deepEqual(store.get(`${ROOT}exercises/cable-fly_chest`), {
    ...storedExercise,
    targetNotes: 'Lower chest',
    loadIncrementKg: 2.5,
    userEdited: true,
    updatedAt: TS,
  });
});

test('updateExerciseFields: a key that is not editable never reaches the document', async () => {
  const { repo, batches } = fakeDb({ [`${ROOT}exercises/cable-fly_chest`]: storedExercise });
  const change = { exerciseSetup: 'Seat 4', name: 'Hacked', muscleGroup: 'Back', trackProgression: true, warmup: {} } as { exerciseSetup: string };
  await repo.updateExerciseFields('cable-fly_chest', change, []);
  assert.deepEqual(batches[0].ops[0].data, { exerciseSetup: 'Seat 4', userEdited: true, updatedAt: TS });
});

test('updateExerciseFields: the warm-up template is a field path, so the other warm-up keys stay', async () => {
  const { repo, batches, store } = fakeDb({ [`${ROOT}exercises/cable-fly_chest`]: storedExercise });
  await repo.updateExerciseFields('cable-fly_chest', { warmupTemplate: 'MACHINE_COMPOUND' }, []);
  assert.deepEqual(batches[0].ops[0].data, { 'warmup.template': 'MACHINE_COMPOUND', userEdited: true, updatedAt: TS });
  assert.deepEqual(store.get(`${ROOT}exercises/cable-fly_chest`)!.warmup, { template: 'MACHINE_COMPOUND', roundingIncrementKg: 2.5 });
});

test('updateExerciseFields: null removes loadIncrementKg and dumbbellLoad', async () => {
  const { repo, batches, store } = fakeDb({ [`${ROOT}exercises/cable-fly_chest`]: storedExercise });
  await repo.updateExerciseFields('cable-fly_chest', { loadIncrementKg: null, dumbbellLoad: null }, []);
  assert.deepEqual(batches[0].ops[0].data, { loadIncrementKg: REMOVE, dumbbellLoad: REMOVE, userEdited: true, updatedAt: TS });
  const after = store.get(`${ROOT}exercises/cable-fly_chest`)!;
  assert.equal('loadIncrementKg' in after, false);
  assert.equal('dumbbellLoad' in after, false);
  assert.equal(after.name, 'Cable Fly');
});

test('updateExerciseFields: an empty string clears a text field; a change with no editable field opens no batch', async () => {
  const { repo, batches } = fakeDb({ [`${ROOT}exercises/cable-fly_chest`]: storedExercise });
  await repo.updateExerciseFields('cable-fly_chest', { targetNotes: '' }, []);
  assert.deepEqual(batches[0].ops[0].data, { targetNotes: '', userEdited: true, updatedAt: TS });
  await assert.rejects(repo.updateExerciseFields('cable-fly_chest', {}, []));
  await assert.rejects(repo.updateExerciseFields('cable-fly_chest', { name: 'Hacked' } as object, []));
  assert.equal(batches.length, 1);
});

test('updateExerciseFields: routine merges and their versions go in the same batch', async () => {
  const { repo, batches, store } = fakeDb({
    [`${ROOT}exercises/cable-fly_chest`]: storedExercise,
    [`${ROOT}routines/push-day`]: { name: 'Push Day', order: 3, exercises: [] },
    [`${ROOT}routines/pull-day`]: { name: 'Pull Day', order: 4, exercises: [] },
  });
  await repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'Lower chest' }, [
    { id: 'push-day', exercises: entries, versions: [version('push-day', 10), version('push-day', 11)] },
    { id: 'pull-day', exercises: entries, versions: [] },
  ]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    { kind: 'update', path: `${ROOT}exercises/cable-fly_chest`, data: { targetNotes: 'Lower chest', userEdited: true, updatedAt: TS } },
    { kind: 'set', path: `${ROOT}routines/push-day`, data: { exercises: entries, updatedAt: TS }, options: { merge: true } },
    { kind: 'create', path: `${ROOT}routineHistory/push-day_10`, data: version('push-day', 10) },
    { kind: 'create', path: `${ROOT}routineHistory/push-day_11`, data: version('push-day', 11) },
    { kind: 'set', path: `${ROOT}routines/pull-day`, data: { exercises: entries, updatedAt: TS }, options: { merge: true } },
  ]);
  assert.deepEqual(store.get(`${ROOT}routines/push-day`), { name: 'Push Day', order: 3, exercises: entries, updatedAt: TS });
});

test('updateExerciseFields: a missing exercise fails the whole batch; no document appears and no routine changes', async () => {
  const routineBefore = { name: 'Push Day', order: 3, exercises: [] };
  const { repo, store } = fakeDb({ [`${ROOT}routines/push-day`]: routineBefore });
  await assert.rejects(
    repo.updateExerciseFields('cable-fly_chest', { targetNotes: 'Lower chest' }, [
      { id: 'push-day', exercises: entries, versions: [version('push-day', 10)] },
    ]),
  );
  assert.equal(store.has(`${ROOT}exercises/cable-fly_chest`), false);
  assert.equal(store.get(`${ROOT}routines/push-day`), routineBefore);
  assert.equal(store.size, 1);
});

// ─── Workout logs ────────────────────────────────────────────────────

const LOG_DAY = '2027-01-15';
const LOG_PATH = `${ROOT}workoutLogs/${LOG_DAY}`;
const logExercises = [{ id: 'row-1', exerciseId: 'cable-fly_chest', name: 'Cable Fly', sets: [], performed: false }];
const STARTED_AT = 1_800_000_000_000;
const newLog = { routineId: 'push-day', routineName: 'Push Day', exercises: logExercises, exerciseIds: ['cable-fly_chest'], startedAt: STARTED_AT };

test('createWorkoutLog: one batch, one create at users/{owner}/workoutLogs/{date}, open and never a deload', async () => {
  const { repo, batches } = fakeDb();
  // An extra key on the argument must not reach the document.
  const log = { ...newLog, isDeload: true, sessionOpen: false, coachNotes: 'hacked', duration: 5, id: 'x', date: 'y' } as typeof newLog;
  await repo.createWorkoutLog(LOG_DAY, log);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    {
      kind: 'create',
      path: LOG_PATH,
      data: {
        id: LOG_DAY,
        date: LOG_DAY,
        routineId: 'push-day',
        routineName: 'Push Day',
        exercises: logExercises,
        exerciseIds: ['cable-fly_chest'],
        notes: '',
        isDeload: false,
        deloadApplied: false,
        sessionOpen: true,
        startedAt: STARTED_AT,
      },
    },
  ]);
});

test('createWorkoutLog: a log that exists is never overwritten', async () => {
  const existing = { id: LOG_DAY, notes: 'mine' };
  const { repo, store } = fakeDb({ [LOG_PATH]: existing });
  await assert.rejects(repo.createWorkoutLog(LOG_DAY, newLog));
  assert.equal(store.get(LOG_PATH), existing);
});

test('setWorkoutLogExercises: one batch; an update of exercises and exerciseIds, plus a merge per performance entry', async () => {
  const stored = { id: LOG_DAY, date: LOG_DAY, notes: 'kept', sessionOpen: true, exercises: [], exerciseIds: [] };
  const perfPath = `${ROOT}performanceEntries/cable-fly_chest`;
  const { repo, batches, store } = fakeDb({
    [LOG_PATH]: stored,
    [perfPath]: { lastPerformedDate: 1, lastPerformedSets: [], personalRecord: { reps: 1, weight: 1, date: 1, logId: 'old' }, other: 'kept' },
  });
  const pr = { reps: 8, weight: 80, date: 5, logId: LOG_DAY };
  // Extra keys on the arguments must not reach a document.
  const fields = { exercises: logExercises, exerciseIds: ['cable-fly_chest'], notes: 'hacked', sessionOpen: false } as {
    exercises: typeof logExercises;
    exerciseIds: string[];
  };
  await repo.setWorkoutLogExercises(LOG_DAY, fields, [
    {
      exerciseId: 'cable-fly_chest',
      fields: { lastPerformedSets: [{ reps: 8, weight: 80 }], lastPerformedDate: 5, personalRecord: pr, hacked: true } as object,
      clearPR: false,
    },
  ]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].commits, 1);
  assert.deepEqual(batches[0].ops, [
    { kind: 'update', path: LOG_PATH, data: { exercises: logExercises, exerciseIds: ['cable-fly_chest'] } },
    {
      kind: 'set',
      path: perfPath,
      data: { lastPerformedSets: [{ reps: 8, weight: 80 }], lastPerformedDate: 5, personalRecord: pr },
      options: { merge: true },
    },
  ]);
  assert.deepEqual(store.get(LOG_PATH), { ...stored, exercises: logExercises, exerciseIds: ['cable-fly_chest'] });
  assert.equal(store.get(perfPath)!.other, 'kept');
});

test('setWorkoutLogExercises: clearPR takes the PR off the entry; an entry with nothing to write is left out', async () => {
  const perfPath = `${ROOT}performanceEntries/cable-fly_chest`;
  const { repo, batches, store } = fakeDb({
    [LOG_PATH]: { id: LOG_DAY, exercises: [] },
    [perfPath]: { lastPerformedDate: 1, personalRecord: { reps: 1, weight: 1, date: 1, logId: LOG_DAY } },
  });
  await repo.setWorkoutLogExercises(LOG_DAY, { exercises: logExercises, exerciseIds: ['cable-fly_chest'] }, [
    { exerciseId: 'cable-fly_chest', fields: { lastPerformedSets: [], lastPerformedDate: 5 }, clearPR: true },
    { exerciseId: 'row_back', fields: {}, clearPR: false },
  ]);
  assert.equal(batches[0].ops.length, 2);
  assert.deepEqual(batches[0].ops[1].data, { lastPerformedSets: [], lastPerformedDate: 5, personalRecord: REMOVE });
  assert.deepEqual(store.get(perfPath), { lastPerformedDate: 5, lastPerformedSets: [] });
  assert.equal(store.has(`${ROOT}performanceEntries/row_back`), false);
});

test('setWorkoutLogExercises and finishWorkoutLog: a log that is gone fails the whole batch; no document appears', async () => {
  const { repo, store } = fakeDb();
  await assert.rejects(
    repo.setWorkoutLogExercises(LOG_DAY, { exercises: logExercises, exerciseIds: ['cable-fly_chest'] }, [
      { exerciseId: 'cable-fly_chest', fields: { lastPerformedDate: 5 }, clearPR: false },
    ]),
  );
  await assert.rejects(repo.finishWorkoutLog(LOG_DAY, 'Good session', 60));
  assert.equal(store.size, 0);
});

test('finishWorkoutLog: one batch, one update of coachNotes, sessionOpen and duration; every other field stays', async () => {
  const stored = { id: LOG_DAY, date: LOG_DAY, notes: 'kept', sessionOpen: true, startedAt: STARTED_AT, exercises: logExercises };
  const { repo, batches, store } = fakeDb({ [LOG_PATH]: stored });
  await repo.finishWorkoutLog(LOG_DAY, 'Good session', 62);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].ops, [{ kind: 'update', path: LOG_PATH, data: { coachNotes: 'Good session', sessionOpen: false, duration: 62 } }]);
  assert.deepEqual(store.get(LOG_PATH), { ...stored, coachNotes: 'Good session', sessionOpen: false, duration: 62 });
});

test('workout log writes: a date that is not a real day, a bad id or bad content opens no batch', async () => {
  const { repo, batches, docPaths } = fakeDb();
  const fields = { exercises: logExercises, exerciseIds: ['cable-fly_chest'] };
  for (const bad of ['', 'a/b', '..', 'today', 'push-day', '2027-1-15', '2027-02-30', '2027-01-15x', '2027-01-15/x']) {
    await assert.rejects(repo.createWorkoutLog(bad, newLog), `date should be refused: ${bad}`);
    await assert.rejects(repo.setWorkoutLogExercises(bad, fields, []));
    await assert.rejects(repo.finishWorkoutLog(bad, 'x', 60));
  }
  for (const bad of ['', 'a/b', '.', '..', '__name__', 'x'.repeat(201)]) {
    await assert.rejects(repo.setWorkoutLogExercises(LOG_DAY, fields, [{ exerciseId: bad, fields: { lastPerformedDate: 1 }, clearPR: false }]));
    await assert.rejects(repo.createWorkoutLog(LOG_DAY, { ...newLog, routineId: bad }));
  }
  await assert.rejects(repo.createWorkoutLog(LOG_DAY, { ...newLog, exercises: [] }));
  await assert.rejects(repo.createWorkoutLog(LOG_DAY, { ...newLog, exercises: 'x' as unknown as typeof logExercises }));
  await assert.rejects(repo.setWorkoutLogExercises(LOG_DAY, { exercises: [], exerciseIds: [] }, []));
  await assert.rejects(repo.finishWorkoutLog(LOG_DAY, '', 60));
  await assert.rejects(repo.finishWorkoutLog(LOG_DAY, 'x'.repeat(2001), 60));
  await assert.rejects(repo.finishWorkoutLog(LOG_DAY, 7 as unknown as string, 60));
  // The duration is whole minutes from 1 to 300; the start is a finite number of milliseconds.
  for (const bad of [0, 301, 45.5, -1, NaN, '60', undefined]) {
    await assert.rejects(repo.finishWorkoutLog(LOG_DAY, 'x', bad as number), `duration should be refused: ${String(bad)}`);
  }
  for (const bad of [NaN, Infinity, -1, 0, '1800000000000', undefined]) {
    await assert.rejects(repo.createWorkoutLog(LOG_DAY, { ...newLog, startedAt: bad as number }), `startedAt should be refused: ${String(bad)}`);
  }
  assert.equal(batches.length, 0);
  const allowed = new RegExp(`^users/${OWNER}/(workoutLogs/\\d{4}-\\d{2}-\\d{2}|performanceEntries/[^/]+)$`);
  for (const path of docPaths) assert.match(path, allowed);
});

test('every workout write path is the owner\'s log of one real day or one performance entry', async () => {
  const { repo, batches, docPaths } = fakeDb({ [LOG_PATH]: { id: LOG_DAY } });
  await repo.setWorkoutLogExercises(LOG_DAY, { exercises: logExercises, exerciseIds: ['cable-fly_chest'] }, [
    { exerciseId: 'cable-fly_chest', fields: { lastPerformedDate: 1 }, clearPR: false },
  ]);
  await repo.finishWorkoutLog(LOG_DAY, 'x', 60);
  await repo.createWorkoutLog('2027-01-16', newLog);
  const allowed = new RegExp(`^users/${OWNER}/(workoutLogs/\\d{4}-\\d{2}-\\d{2}|performanceEntries/[^/]+)$`);
  const paths = [...docPaths, ...batches.flatMap(b => b.ops.map(op => op.path))];
  assert.equal(paths.length, 8);
  for (const path of paths) assert.match(path, allowed);
});
