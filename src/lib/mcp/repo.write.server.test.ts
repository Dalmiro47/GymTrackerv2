import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ExerciseData, RoutineData } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import type { RoutineExerciseEntry } from '@/lib/routineDoc';
import { createWriteRepo, type McpWriteRepo, type WriteBatch, type WriteDb, type WriteDocRef } from './repo.write.server';

// Fake values only. The fake db records every call, fails a batch whose `create`
// targets an existing document, and throws on any member that is not doc, batch,
// create, set or commit (delete, update, get, collection...).
const OWNER = 'fake-owner';
const ROOT = `users/${OWNER}/`;
const TS = { sentinel: 'serverTimestamp' };

type Data = Record<string, unknown>;
type Op = { kind: 'create' | 'set'; path: string; data: Data; options?: unknown };

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
            async commit() {
              batch.commits++;
              const taken = batch.ops.find(op => op.kind === 'create' && store.has(op.path));
              if (taken) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
              for (const op of batch.ops) {
                store.set(op.path, op.kind === 'set' ? { ...store.get(op.path), ...op.data } : op.data);
              }
            },
          },
          'batch',
        );
      },
    },
    'db',
  );
  return { db, store, docPaths, batches, repo: createWriteRepo(db, OWNER, () => TS) };
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

// Compile-time: no key of the write surface is a delete or an update. `npm run
// typecheck` fails here if one is ever added.
type WriteSurface = keyof WriteDb | keyof WriteBatch | keyof WriteDocRef | keyof McpWriteRepo;
type Forbidden = Extract<WriteSurface, 'delete' | 'update' | 'recursiveDelete' | 'runTransaction' | 'bulkWriter'>;
const noForbiddenKey: [Forbidden] extends [never] ? true : false = true;

test('the write surface has no delete and no update', () => {
  assert.equal(noForbiddenKey, true);
  const { db } = fakeDb();
  const batch = db.batch();
  assert.deepEqual(Object.keys(batch).sort(), ['commit', 'create', 'set']);
  const source = readFileSync(new URL('./repo.write.server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /delete|\.update\(/);
});

test('the fake refuses a delete or an update, so a repo that used one would fail these tests', () => {
  const { db } = fakeDb();
  assert.throws(() => (db as unknown as { recursiveDelete(): void }).recursiveDelete());
  assert.throws(() => (db.batch() as unknown as { delete(ref: unknown): void }).delete({}));
  assert.throws(() => (db.batch() as unknown as { update(ref: unknown): void }).update({}));
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { delete(): void }).delete());
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { update(v: unknown): void }).update({}));
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { set(v: unknown): void }).set({}));
});

test('createWriteRepo: refuses an empty uid or one that is not one path segment', () => {
  const { db } = fakeDb();
  for (const bad of ['', 'a/b', '..', '.', '__x__']) {
    assert.throws(() => createWriteRepo(db, bad, () => TS), `uid should be refused: ${bad}`);
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

test('every write path is users/{owner}/ + one of the three collections + one id', async () => {
  const { repo, batches, docPaths } = fakeDb();
  await repo.createExercise('cable-fly_chest', exercise);
  await repo.createRoutine('push-day', routine, [version('push-day', 10)]);
  await repo.setRoutineExercises('push-day', { exercises: entries }, [version('push-day', 11)]);
  const allowed = new RegExp(`^users/${OWNER}/(routines|exercises|routineHistory)/[^/]+$`);
  const paths = [...docPaths, ...batches.flatMap(b => b.ops.map(op => op.path))];
  assert.equal(paths.length, 10);
  for (const path of paths) assert.match(path, allowed);
});

test('an id that could leave the collection is refused before any batch is opened', async () => {
  const { repo, batches, docPaths } = fakeDb();
  for (const bad of ['', 'a/b', '.', '..', '__name__', 'x'.repeat(201)]) {
    await assert.rejects(repo.createExercise(bad, exercise), `id should be refused: ${bad.slice(0, 12)}`);
    await assert.rejects(repo.createRoutine(bad, routine, []));
    await assert.rejects(repo.setRoutineExercises(bad, { exercises: entries }, []));
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
