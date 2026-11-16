import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthIngestHandler, type HealthIngestDeps, type HealthWriteDb } from './handler';

// Fake values only: nothing here is a real key or uid.
const KEY = 'h'.repeat(40);
const MCP_KEY = 'm'.repeat(40);
const OWNER = 'fake-owner';
const TS = { sentinel: 'serverTimestamp' };
const NOW = new Date('2026-11-15T12:30:00+01:00');
const URL = 'http://localhost/api/health/ingest';

type SetOp = { path: string; data: Record<string, unknown>; options: unknown };

function fakeDb(failCommit = false) {
  const batches: Array<{ ops: SetOp[]; commits: number }> = [];
  let calls = 0;
  const db: HealthWriteDb = {
    doc(path: string) {
      return { path };
    },
    batch() {
      const batch = { ops: [] as SetOp[], commits: 0 };
      batches.push(batch);
      return {
        set(ref, data, options) {
          batch.ops.push({ path: ref.path, data, options });
        },
        async commit() {
          batch.commits++;
          if (failCommit) throw new Error('commit failed');
        },
      };
    },
  };
  return {
    batches,
    get dbCalls() {
      return calls;
    },
    db: () => {
      calls++;
      return db;
    },
  };
}

function setup(env: Record<string, string | undefined> = {}, opts: { admin?: boolean; failCommit?: boolean } = {}) {
  const fake = fakeDb(opts.failCommit);
  const deps: HealthIngestDeps = {
    env: { HEALTH_INGEST_KEY: KEY, MCP_ACCESS_KEY: MCP_KEY, MCP_OWNER_UID: OWNER, ...env },
    isAdminConfigured: () => opts.admin ?? true,
    db: fake.db,
    serverTimestamp: () => TS,
    now: () => NOW,
  };
  return { fake, handler: createHealthIngestHandler(deps) };
}

const post = (body: string, headers: Record<string, string> = { 'x-ingest-key': KEY }) =>
  new Request(URL, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

const SHORTCUT_BODY = JSON.stringify({
  v: 1,
  sentAt: '2026-11-15T12:28:03+01:00',
  today: {
    date: '2026-11-15',
    steps: '558',
    restingHr: '48',
    hrvMs: '35.20404606393311',
    activeKcal: '48.88800000000001',
    respRate: '14.72222222222222',
  },
  weighIn: { weightKg: '81.95', bodyFatPct: '16.3', at: '2026-11-15T08:50:13+01:00' },
  yesterday: {
    date: '2026-11-14',
    steps: '7903',
    restingHr: '50',
    hrvMs: '50.77541666721584',
    activeKcal: '534.1300000000002',
    respRate: '14.38372093023256',
  },
});

test('the Shortcut payload: 200, both days in one batch with one commit, merge writes under the owner', async () => {
  const { fake, handler } = setup();
  const res = await handler(post(SHORTCUT_BODY));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: true, written: ['2026-11-14', '2026-11-15'], dropped: [] });

  assert.equal(fake.batches.length, 1);
  assert.equal(fake.batches[0].commits, 1);
  const ops = fake.batches[0].ops;
  assert.deepEqual(
    ops.map(op => op.path),
    [`users/${OWNER}/health/2026-11-14`, `users/${OWNER}/health/2026-11-15`],
  );
  for (const op of ops) {
    assert.ok(op.path.startsWith(`users/${OWNER}/health/`));
    assert.deepEqual(op.options, { merge: true });
  }
  assert.deepEqual(ops[1].data, {
    date: '2026-11-15',
    steps: 558,
    restingHr: 48,
    hrvMs: 35.2,
    activeKcal: 48.9,
    respRate: 14.7,
    weightKg: 81.95,
    bodyFatPct: 16.3,
    weighInAt: Date.parse('2026-11-15T08:50:13+01:00'),
    updatedAt: TS,
  });
  assert.deepEqual(ops[0].data, {
    date: '2026-11-14',
    steps: 7903,
    restingHr: 50,
    hrvMs: 50.8,
    activeKcal: 534.1,
    respRate: 14.4,
    updatedAt: TS,
  });
});

test('"" fields are absent from the merge data: no null, no delete sentinel', async () => {
  const { fake, handler } = setup();
  const res = await handler(
    post(JSON.stringify({ v: 1, today: { date: '2026-11-15', steps: '', restingHr: '', respRate: '15' } })),
  );
  assert.equal(res.status, 200);
  const data = fake.batches[0].ops[0].data;
  assert.deepEqual(data, { date: '2026-11-15', respRate: 15, updatedAt: TS });
  assert.ok(Object.values(data).every(v => v !== null && v !== undefined));
});

test('dropped fields are reported with a 200', async () => {
  const { handler } = setup();
  const res = await handler(
    post(
      JSON.stringify({
        v: 1,
        today: { date: '2026-11-15', steps: 'abc', hrvMs: '40' },
        yesterday: { date: '2026-11-12', steps: '9000' },
      }),
    ),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    written: ['2026-11-15'],
    dropped: [
      { field: 'today.steps', reason: 'not_a_number' },
      { field: 'yesterday.date', reason: 'date_out_of_window' },
    ],
  });
});

test('nothing valid: 200 with no batch', async () => {
  const { fake, handler } = setup();
  const res = await handler(post(JSON.stringify({ v: 1, today: { date: '2026-11-15', steps: '' } })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, written: [], dropped: [] });
  assert.equal(fake.batches.length, 0);
});

const UNAUTHORIZED = { error: 'unauthorized' };

async function assert401(res: Response, fake: ReturnType<typeof fakeDb>) {
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), UNAUTHORIZED);
  assert.equal(fake.dbCalls, 0);
  assert.equal(fake.batches.length, 0);
}

test('auth: wrong key, missing header and the MCP key all give the same 401 with no db call', async () => {
  const variants: Array<Record<string, string>> = [{ 'x-ingest-key': 'x'.repeat(40) }, {}, { 'x-ingest-key': MCP_KEY }];
  for (const headers of variants) {
    const { fake, handler } = setup();
    await assert401(await handler(post(SHORTCUT_BODY, headers)), fake);
  }
});

test('auth: the key in the query string is not accepted', async () => {
  const { fake, handler } = setup();
  const req = new Request(`${URL}?key=${KEY}`, { method: 'POST', body: SHORTCUT_BODY });
  await assert401(await handler(req), fake);
});

test('auth: missing env, a 31-char key, a missing owner and no Admin SDK all give 401', async () => {
  const cases: Array<[Record<string, string | undefined>, boolean]> = [
    [{ HEALTH_INGEST_KEY: undefined }, true],
    [{ HEALTH_INGEST_KEY: 'h'.repeat(31) }, true],
    [{ MCP_OWNER_UID: undefined }, true],
    [{}, false],
  ];
  for (const [env, admin] of cases) {
    const key = env.HEALTH_INGEST_KEY ?? KEY;
    const { fake, handler } = setup(env, { admin });
    await assert401(await handler(post(SHORTCUT_BODY, { 'x-ingest-key': key })), fake);
  }
});

test('auth runs before the body: a wrong key with bad JSON is 401', async () => {
  const { fake, handler } = setup();
  await assert401(await handler(post('{not json', { 'x-ingest-key': 'x'.repeat(40) })), fake);
});

test('400: too large by content-length, too large by body, bad JSON, not an object, wrong v; no write', async () => {
  const big = JSON.stringify({ v: 1, pad: 'x'.repeat(5000) });
  const cases: Array<[Request, string]> = [
    [post('{}', { 'x-ingest-key': KEY, 'content-length': '5000' }), 'too_large'],
    [post(big), 'too_large'],
    [post('{not json'), 'bad_json'],
    [post('[1,2]'), 'bad_json'],
    [post('null'), 'bad_json'],
    [post(JSON.stringify({ v: 2, today: { date: '2026-11-15', steps: '1' } })), 'bad_version'],
    [post(JSON.stringify({ today: { date: '2026-11-15', steps: '1' } })), 'bad_version'],
  ];
  for (const [req, error] of cases) {
    const { fake, handler } = setup();
    const res = await handler(req);
    assert.equal(res.status, 400, error);
    assert.deepEqual(await res.json(), { error });
    assert.equal(fake.batches.length, 0);
  }
});

test('v may be the string "1"', async () => {
  const { handler } = setup();
  const res = await handler(post(JSON.stringify({ v: '1', today: { date: '2026-11-15', steps: '1' } })));
  assert.equal(res.status, 200);
});

test('a failed commit is a 500 with no detail', async () => {
  const { handler } = setup({}, { failCommit: true });
  const res = await handler(post(SHORTCUT_BODY));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'server_error' });
});

test('rate limit: the 11th request in a minute is a 429', async () => {
  const { handler } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await handler(post(SHORTCUT_BODY))).status, 200);
  assert.equal((await handler(post(SHORTCUT_BODY))).status, 429);
});

test('the sleep window and VO2 max reach the merge data as ms, with no null', async () => {
  const { fake, handler } = setup();
  const res = await handler(
    post(
      JSON.stringify({
        v: 1,
        today: {
          date: '2026-11-15',
          sleepStart: '2026-11-14T23:12:45+01:00',
          sleepEnd: '2026-11-15T07:03:10+01:00',
        },
        vo2max: { value: '44,87', at: '2026-11-13T10:21:00+01:00' },
      }),
    ),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, written: ['2026-11-13', '2026-11-15'], dropped: [] });
  const ops = fake.batches[0].ops;
  assert.deepEqual(ops[0].data, {
    date: '2026-11-13',
    vo2max: 44.9,
    vo2maxAt: Date.parse('2026-11-13T10:21:00+01:00'),
    updatedAt: TS,
  });
  assert.deepEqual(ops[1].data, {
    date: '2026-11-15',
    sleepStartAt: Date.parse('2026-11-14T23:12:45+01:00'),
    sleepEndAt: Date.parse('2026-11-15T07:03:10+01:00'),
    updatedAt: TS,
  });
});
