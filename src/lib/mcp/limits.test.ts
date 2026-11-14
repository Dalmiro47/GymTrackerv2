import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, createRequestLimiter, withTimeout } from './limits';
import { jsonResult } from './results';

test('createLimiter: allows up to the limit, blocks, then recovers', () => {
  const limiter = createLimiter(2, 1000);
  assert.deepEqual(limiter.take(0), { ok: true });
  assert.deepEqual(limiter.take(10), { ok: true });
  assert.deepEqual(limiter.take(20), { ok: false, retryAfterSec: 1 });
  assert.deepEqual(limiter.take(1000), { ok: true }); // the hit at t=0 left the window
});

test('createRequestLimiter: 429 with retry-after once the minute limit is hit', async () => {
  const limiter = createRequestLimiter({ perMinute: 2, perHour: 100 });
  assert.equal(limiter.check(0), null);
  assert.equal(limiter.check(1), null);
  const blocked = limiter.check(2);
  assert.ok(blocked);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.deepEqual(await blocked.json(), { error: 'rate_limited', retryAfterSec: 60 });
});

test('createRequestLimiter: the hour limit also blocks', () => {
  const limiter = createRequestLimiter({ perMinute: 100, perHour: 1 });
  assert.equal(limiter.check(0), null);
  assert.equal(limiter.check(1)?.status, 429);
});

test('createRequestLimiter: defaults are 60 per minute', () => {
  const limiter = createRequestLimiter();
  for (let i = 0; i < 60; i++) assert.equal(limiter.check(i), null);
  assert.equal(limiter.check(60)?.status, 429);
});

test('withTimeout: a fast tool returns its own result', async () => {
  const run = withTimeout(async (n: number) => jsonResult({ n }), 50);
  assert.deepEqual(await run(3), jsonResult({ n: 3 }));
});

test('withTimeout: a slow tool returns an error result', async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = () => new Promise<ReturnType<typeof jsonResult>>(resolve => {
    timer = setTimeout(() => resolve(jsonResult('late')), 500);
  });
  const result = await withTimeout(slow, 10)(undefined);
  clearTimeout(timer);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Try again later/);
});

test('withTimeout: a slow write tool says the change may be written and to read before a retry', async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = () => new Promise<ReturnType<typeof jsonResult>>(resolve => {
    timer = setTimeout(() => resolve(jsonResult('late')), 500);
  });
  const result = await withTimeout(slow, 10, 'write')(undefined);
  clearTimeout(timer);
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /may have been written/);
  assert.match(text, /Read the data again before any retry/);
  assert.doesNotMatch(text, /routine|exercise/);
  assert.doesNotMatch(text, /Try again later/);
});
