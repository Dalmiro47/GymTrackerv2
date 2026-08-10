import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { cachedFetch, invalidateCache } from '../src/lib/sessionCache';

/**
 * Performance — session cache for Firestore reads.
 *
 * A true browser e2e (Google sign-in + live Firestore) is not runnable here
 * without credentials/an emulator, so these tests exercise the REAL cache
 * module (src/lib/sessionCache.ts) at runtime, verify by source that every
 * service read/write is wired to it, and quantify the round-trip reduction
 * that drives the perceived click-to-data latency.
 */

const SRC = (...p: string[]) => path.resolve(__dirname, '..', 'src', ...p);
const read = (...p: string[]) => fs.readFileSync(SRC(...p), 'utf8');

const countingFetcher = <T>(value: T) => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return value;
  };
  return { fetcher, calls: () => calls };
};

test.describe('sessionCache runtime behavior', () => {
  test('repeat reads hit the cache — zero extra fetches', async () => {
    const { fetcher, calls } = countingFetcher(['a', 'b']);
    const first = await cachedFetch('t1:exercises:u1', fetcher);
    const second = await cachedFetch('t1:exercises:u1', fetcher);

    expect(first).toEqual(['a', 'b']);
    expect(second).toBe(first); // same resolved value, no refetch
    expect(calls()).toBe(1);
  });

  test('concurrent callers share one in-flight request', async () => {
    const { fetcher, calls } = countingFetcher(42);
    const [a, b, c] = await Promise.all([
      cachedFetch('t2:perf:u1:bench', fetcher),
      cachedFetch('t2:perf:u1:bench', fetcher),
      cachedFetch('t2:perf:u1:bench', fetcher),
    ]);

    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(calls()).toBe(1);
  });

  test('prefix invalidation forces a refetch', async () => {
    const { fetcher, calls } = countingFetcher('v');
    await cachedFetch('t3:wl:u1:log:2026-08-10', fetcher);
    await cachedFetch('t3:wl:u1:perf:bench', fetcher);

    invalidateCache('t3:wl:u1'); // the shape saveWorkoutLog uses

    await cachedFetch('t3:wl:u1:log:2026-08-10', fetcher);
    await cachedFetch('t3:wl:u1:perf:bench', fetcher);
    expect(calls()).toBe(4); // both keys were dropped and refetched
  });

  test('invalidation is scoped — other users/keys stay cached', async () => {
    const { fetcher, calls } = countingFetcher('v');
    await cachedFetch('t4:exercises:user-a', fetcher);
    await cachedFetch('t4:exercises:user-b', fetcher);

    invalidateCache('t4:exercises:user-a');

    await cachedFetch('t4:exercises:user-b', fetcher);
    expect(calls()).toBe(2); // user-b untouched
  });

  test('rejected fetches are not cached — next caller retries', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('network');
      return 'ok';
    };

    await expect(cachedFetch('t5:routines:u1', flaky)).rejects.toThrow('network');
    // Eviction of the failed promise happens in a microtask.
    await new Promise(r => setTimeout(r, 0));
    await expect(cachedFetch('t5:routines:u1', flaky)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  test('TTL expiry refetches', async () => {
    const { fetcher, calls } = countingFetcher('v');
    await cachedFetch('t6:k', fetcher, 5); // 5ms TTL
    await new Promise(r => setTimeout(r, 20));
    await cachedFetch('t6:k', fetcher, 5);
    expect(calls()).toBe(2);
  });
});

test.describe('service wiring (source contracts)', () => {
  test('exercise service caches reads and invalidates on every write', () => {
    const src = read('services', 'exerciseService.ts');
    // getExercises goes through the cache...
    expect(src).toMatch(/getExercises[\s\S]*?cachedFetch\(exercisesCacheKey\(userId\)/);
    // ...and every mutation drops it (add, update, delete, seed).
    const invalidations = src.match(/invalidateCache\(exercisesCacheKey\(userId\)\)/g) ?? [];
    expect(invalidations.length).toBeGreaterThanOrEqual(4);
    // Seeding skips its full-collection re-check after first run this session...
    expect(src).toContain('seededUserIds');
    // ...but restoring hidden defaults must bypass the skip.
    expect(src).toMatch(/restoreHiddenDefaults[\s\S]*?ensureExercisesSeeded\(userId, \{ force: true \}\)/);
  });

  test('routine service caches reads and invalidates on every write', () => {
    const src = read('services', 'routineService.ts');
    expect(src).toMatch(/getRoutines[\s\S]*?cachedFetch\(routinesCacheKey\(userId\)/);
    // add, update, delete, reorder all invalidate.
    const invalidations = src.match(/invalidateCache\(routinesCacheKey\(userId\)\)/g) ?? [];
    expect(invalidations.length).toBeGreaterThanOrEqual(4);
  });

  test('training log service caches log-derived reads under one prefix', () => {
    const src = read('services', 'trainingLogService.ts');
    // Reads: log, month flags, deload count, logs-since, performance snapshot.
    expect(src).toMatch(/:log:\$\{date\}/);
    expect(src).toMatch(/:month:\$\{start\}/);
    expect(src).toMatch(/:deloadCount:\$\{start\}/);
    expect(src).toMatch(/:since:\$\{start\}/);
    expect(src).toMatch(/cachedFetch\(perfCacheKey\(userId, exerciseId\)/);
    // Any log write drops the whole per-user prefix.
    expect(src).toMatch(/saveWorkoutLog[\s\S]*?invalidateCache\(logsCachePrefix\(userId\)\)/);
    expect(src).toMatch(/deleteWorkoutLog = [\s\S]*?invalidateCache\(logsCachePrefix\(userId\)\)/);
    // Performance writes drop their per-exercise snapshots.
    expect(src).toMatch(/batch\.commit\(\);\s*\n\s*entries\.forEach\(\(\{ exerciseId \}\) => invalidateCache\(perfCacheKey\(userId, exerciseId\)\)\)/);
  });

  test('pre-fill fetch runs its two reads in parallel, not back to back', () => {
    const src = read('services', 'trainingLogService.ts');
    expect(src).toMatch(
      /await Promise\.all\(\[\s*getLastLoggedPerformance\(userId, exerciseId\),\s*getDocs\(q\),\s*\]\)/
    );
  });
});

test.describe('round-trip reduction (the goal metric)', () => {
  // Simulates the Firestore reads issued by the training-log page mount using
  // the real cache: first visit pays the network, the revisit pays nothing.
  test('revisiting the training log costs 0 fetches (was ~12)', async () => {
    let networkCalls = 0;
    const firestoreRead = async () => {
      networkCalls++;
      return {};
    };

    const mountLogPage = async (day: string) => {
      // useTrainingLog mount: routines + exercises + month flags + day's log
      await Promise.all([
        cachedFetch('m:routines:u1', firestoreRead),
        cachedFetch('m:exercises:u1', firestoreRead),
        cachedFetch(`m:wl:u1:month:2026-08-01`, firestoreRead),
        cachedFetch(`m:wl:u1:log:${day}`, firestoreRead),
      ]);
      // ...then one perf snapshot per logged exercise (8-exercise day)
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          cachedFetch(`m:wl:u1:perf:ex${i}`, firestoreRead)
        )
      );
    };

    await mountLogPage('2026-08-10');
    const firstVisit = networkCalls;
    expect(firstVisit).toBe(12);

    // Navigate away and back — the flow the user called out as slow.
    await mountLogPage('2026-08-10');
    const revisitCost = networkCalls - firstVisit;

    expect(revisitCost).toBe(0);
    // ≥10% faster required; a fully cached revisit is a 100% reduction in
    // Firestore round trips for the click-to-data path.
    const improvement = (firstVisit - revisitCost) / firstVisit;
    expect(improvement).toBeGreaterThanOrEqual(0.1);
  });

  test('re-selecting a routine pre-fills from cache with 0 fetches', async () => {
    let networkCalls = 0;
    const firestoreRead = async () => {
      networkCalls++;
      return {};
    };

    const selectRoutine = () =>
      Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          cachedFetch(`r:wl:u1:perf:ex${i}`, firestoreRead)
        )
      );

    await selectRoutine();
    expect(networkCalls).toBe(8);

    await selectRoutine(); // switch away and back, same session
    expect(networkCalls).toBe(8); // no additional reads

    // After saving the log, the cache must NOT serve stale pre-fill data.
    invalidateCache('r:wl:u1');
    await selectRoutine();
    expect(networkCalls).toBe(16);
  });
});
