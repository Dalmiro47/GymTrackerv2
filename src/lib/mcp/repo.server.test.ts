import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, MAX_EXERCISES, MAX_ROUTINES, MAX_SCHEDULE_DAYS, type ReadDb } from './repo.server';

// Fake values only. The fake db records every path and query step, serves canned
// documents, and throws on anything that is not a read (set, add, update, delete...).
const OWNER = 'fake-owner';
const ROOT = `users/${OWNER}/`;

type Row = { id: string; data: Record<string, unknown> };
type Call = { kind: 'collection' | 'doc'; path: string; ops: unknown[][] };

const strict = <T extends object>(target: T, label: string): T =>
  new Proxy(target, {
    get(obj, prop, receiver) {
      // `then` is probed by promise resolution when a fake is returned from an async function.
      if (typeof prop === 'symbol' || prop === 'then' || prop in obj) return Reflect.get(obj, prop, receiver);
      throw new Error(`${label}.${String(prop)} is not a read and must never be called`);
    },
  });

function fakeDb(seed: { collections?: Record<string, Row[]>; docs?: Record<string, Record<string, unknown>> } = {}) {
  const calls: Call[] = [];
  const snap = (row: Row | undefined, id: string) =>
    strict({ id, exists: row !== undefined, data: () => row?.data }, 'snapshot');

  const query = (call: Call): ReturnType<ReadDb['collection']> =>
    strict(
      {
        where(field: string, op: string, value: unknown) {
          call.ops.push(['where', field, op, value]);
          return query(call);
        },
        orderBy(field: string, direction?: string) {
          call.ops.push(['orderBy', field, direction ?? 'asc']);
          return query(call);
        },
        limit(n: number) {
          call.ops.push(['limit', n]);
          return query(call);
        },
        async get() {
          const limitOp = call.ops.find(op => op[0] === 'limit');
          const rows = seed.collections?.[call.path] ?? [];
          const capped = limitOp ? rows.slice(0, limitOp[1] as number) : rows;
          return strict({ docs: capped.map(r => snap(r, r.id)) }, 'querySnapshot');
        },
      },
      'query',
    );

  const db: ReadDb = strict(
    {
      collection(path: string) {
        const call: Call = { kind: 'collection', path, ops: [] };
        calls.push(call);
        return query(call);
      },
      doc(path: string) {
        calls.push({ kind: 'doc', path, ops: [] });
        return strict(
          {
            async get() {
              const data = seed.docs?.[path];
              return snap(data ? { id: path.split('/').pop()!, data } : undefined, path.split('/').pop()!);
            },
          },
          'docRef',
        );
      },
    },
    'db',
  );
  return { db, calls };
}

const rows = (n: number, data: (i: number) => Record<string, unknown> = () => ({})): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `doc-${i}`, data: data(i) }));

const limitOf = (call: Call) => call.ops.find(op => op[0] === 'limit')?.[1];

test('createRepo: refuses an empty uid or one with a slash', () => {
  const { db } = fakeDb();
  assert.throws(() => createRepo(db, ''));
  assert.throws(() => createRepo(db, 'a/b'));
  assert.throws(() => createRepo(db, '..'));
});

test('every read path starts at users/{owner} and every collection query has a limit', async () => {
  const { db, calls } = fakeDb();
  const repo = createRepo(db, OWNER);
  await repo.listRoutines();
  await repo.getRoutine('push-day');
  await repo.listExercises();
  await repo.listExercises('Chest');
  await repo.getLogsSince('2026-01-01', 15);
  await repo.getProfile();

  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.ok(call.path.startsWith(ROOT), `path outside the owner: ${call.path}`);
    if (call.kind === 'collection') {
      assert.equal(typeof limitOf(call), 'number', `unbounded query on ${call.path}`);
    }
  }
  assert.deepEqual(
    calls.map(c => c.path),
    [
      `${ROOT}routines`,
      `${ROOT}routines/push-day`,
      `${ROOT}exercises`,
      `${ROOT}exercises`,
      `${ROOT}workoutLogs`,
      `${ROOT}profile/profile`,
    ],
  );
});

test('listRoutines: ordered by `order`, capped at MAX_ROUTINES, flags truncation', async () => {
  const { db, calls } = fakeDb({ collections: { [`${ROOT}routines`]: rows(MAX_ROUTINES + 5, i => ({ order: i })) } });
  const result = await createRepo(db, OWNER).listRoutines();
  assert.deepEqual(calls[0].ops, [['orderBy', 'order', 'asc'], ['limit', MAX_ROUTINES + 1]]);
  assert.equal(result.rows.length, MAX_ROUTINES);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.rows[0], { id: 'doc-0', data: { order: 0 } });
});

test('listRoutines: not truncated when everything fits', async () => {
  const { db } = fakeDb({ collections: { [`${ROOT}routines`]: rows(3) } });
  const result = await createRepo(db, OWNER).listRoutines();
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, false);
});

test('listExercises: bounded; the muscle filter is an equality where with no orderBy', async () => {
  const { db, calls } = fakeDb({ collections: { [`${ROOT}exercises`]: rows(MAX_EXERCISES + 1) } });
  const repo = createRepo(db, OWNER);
  const all = await repo.listExercises();
  await repo.listExercises('Chest');
  assert.deepEqual(calls[0].ops, [['orderBy', 'name', 'asc'], ['limit', MAX_EXERCISES + 1]]);
  assert.deepEqual(calls[1].ops, [['where', 'muscleGroup', '==', 'Chest'], ['limit', MAX_EXERCISES + 1]]);
  assert.equal(all.rows.length, MAX_EXERCISES);
  assert.equal(all.truncated, true);
});

test('getLogsSince: date range, newest first, bounded', async () => {
  const { db, calls } = fakeDb({ collections: { [`${ROOT}workoutLogs`]: rows(4) } });
  const result = await createRepo(db, OWNER).getLogsSince('2026-01-01', 3);
  assert.deepEqual(calls[0].ops, [['where', 'date', '>=', '2026-01-01'], ['orderBy', 'date', 'desc'], ['limit', 4]]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, true);
});

test('getLogsSince: refuses a malformed date or a bad bound without touching the db', async () => {
  const { db, calls } = fakeDb();
  const repo = createRepo(db, OWNER);
  await assert.rejects(repo.getLogsSince('yesterday', 3));
  await assert.rejects(repo.getLogsSince('2026-01-01', 0));
  await assert.rejects(repo.getLogsSince('2026-01-01', 1000));
  assert.equal(calls.length, 0);
});

test('getLogsBetween: both bounds on date, oldest first, bounded', async () => {
  const { db, calls } = fakeDb({ collections: { [`${ROOT}workoutLogs`]: rows(9) } });
  const result = await createRepo(db, OWNER).getLogsBetween('2026-11-09', '2026-11-15', 7);
  assert.equal(calls[0].path, `${ROOT}workoutLogs`);
  assert.deepEqual(calls[0].ops, [
    ['where', 'date', '>=', '2026-11-09'],
    ['where', 'date', '<=', '2026-11-15'],
    ['orderBy', 'date', 'asc'],
    ['limit', 8],
  ]);
  assert.equal(result.rows.length, 7);
  assert.equal(result.truncated, true);
});

test('getLogsBetween: refuses a malformed or reversed range or a bad bound without touching the db', async () => {
  const { db, calls } = fakeDb();
  const repo = createRepo(db, OWNER);
  await assert.rejects(repo.getLogsBetween('monday', '2026-11-15', 7));
  await assert.rejects(repo.getLogsBetween('2026-11-09', '2026-W46', 7));
  await assert.rejects(repo.getLogsBetween('2026-11-15', '2026-11-09', 7));
  await assert.rejects(repo.getLogsBetween('2026-11-09', '2026-11-15', 0));
  await assert.rejects(repo.getLogsBetween('2026-11-09', '2026-11-15', 1000));
  assert.equal(calls.length, 0);
});

test('getScheduleBetween: the schedule collection, both bounds on date, bounded; a bad range or bound reads nothing', async () => {
  const { db, calls } = fakeDb({ collections: { [`${ROOT}schedule`]: rows(9) } });
  const repo = createRepo(db, OWNER);
  const result = await repo.getScheduleBetween('2026-11-09', '2026-11-15', 7);
  assert.equal(calls[0].path, `${ROOT}schedule`);
  assert.deepEqual(calls[0].ops, [
    ['where', 'date', '>=', '2026-11-09'],
    ['where', 'date', '<=', '2026-11-15'],
    ['orderBy', 'date', 'asc'],
    ['limit', 8],
  ]);
  assert.equal(result.rows.length, 7);
  assert.equal(result.truncated, true);

  const before = calls.length;
  await assert.rejects(repo.getScheduleBetween('monday', '2026-11-15', 7));
  await assert.rejects(repo.getScheduleBetween('2026-11-15', '2026-11-09', 7));
  await assert.rejects(repo.getScheduleBetween('2026-11-09', '2026-11-15', 0));
  await assert.rejects(repo.getScheduleBetween('2026-11-09', '2026-11-15', MAX_SCHEDULE_DAYS + 1));
  assert.equal(calls.length, before);
});

test('getRoutine: found, missing, and ids that could leave the collection', async () => {
  const path = `${ROOT}routines/push-day`;
  const { db, calls } = fakeDb({ docs: { [path]: { name: 'Push Day' } } });
  const repo = createRepo(db, OWNER);
  assert.deepEqual(await repo.getRoutine('push-day'), { id: 'push-day', data: { name: 'Push Day' } });
  assert.equal(await repo.getRoutine('nope'), null);
  const before = calls.length;
  for (const bad of ['', 'a/b', '.', '..', '__name__', 'x'.repeat(201)]) {
    await assert.rejects(repo.getRoutine(bad), `id should be refused: ${bad.slice(0, 12)}`);
  }
  assert.equal(calls.length, before);
});

test('getProfile: the profile doc or null', async () => {
  const { db } = fakeDb({ docs: { [`${ROOT}profile/profile`]: { goal: 'Strength' } } });
  assert.deepEqual(await createRepo(db, OWNER).getProfile(), { goal: 'Strength' });
  assert.equal(await createRepo(fakeDb().db, OWNER).getProfile(), null);
});

test('the fake refuses writes, so a repo that wrote would fail these tests', () => {
  const { db } = fakeDb();
  assert.throws(() => (db as unknown as { batch(): void }).batch());
  assert.throws(() => (db.doc(`${ROOT}routines/x`) as unknown as { set(v: unknown): void }).set({}));
});
