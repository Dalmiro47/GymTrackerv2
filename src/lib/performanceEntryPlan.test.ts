import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExercisePerformanceEntry, LoggedSet } from '@/types';
import { bestPRFromLogs, needsEntryRevert, needsPRRescan, planEntryRevert, planPerformanceEntry } from './performanceEntryPlan';

const DAY = '2027-01-15';
const AT = 1_000_000;
const sets = (...rows: Array<[number, number]>): LoggedSet[] => rows.map(([reps, weight], i) => ({ id: `s${i}`, reps, weight }));
const entry = (over: Partial<ExercisePerformanceEntry> = {}): ExercisePerformanceEntry => ({
  lastPerformedDate: AT - 500,
  lastPerformedSets: [{ reps: 8, weight: 80 }],
  personalRecord: { reps: 8, weight: 80, date: AT - 500, logId: '2027-01-08' },
  ...over,
});
const plan = (existing: ExercisePerformanceEntry | null, s: LoggedSet[], prFromOtherLogs: ExercisePerformanceEntry['personalRecord'] = null) =>
  planPerformanceEntry({ existing, sets: s, logDate: DAY, achievedAtMs: AT, prFromOtherLogs });

test('planPerformanceEntry: a first entry gets the last sets and the best set as PR', () => {
  assert.deepEqual(plan(null, sets([8, 80], [6, 85])), {
    fields: {
      lastPerformedSets: [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }],
      lastPerformedDate: AT,
      personalRecord: { reps: 6, weight: 85, date: AT, logId: DAY },
    },
    clearPR: false,
  });
});

test('planPerformanceEntry: a PR only goes up; reps break a tie at equal weight', () => {
  assert.equal('personalRecord' in plan(entry(), sets([12, 75])).fields, false);
  assert.equal('personalRecord' in plan(entry(), sets([8, 80])).fields, false);
  assert.deepEqual(plan(entry(), sets([9, 80])).fields.personalRecord, { reps: 9, weight: 80, date: AT, logId: DAY });
});

test('planPerformanceEntry: an older log does not replace the last performance', () => {
  const result = plan(entry({ lastPerformedDate: AT + 1 }), sets([8, 70]));
  assert.deepEqual(result, { fields: {}, clearPR: false });
});

test('planPerformanceEntry: only sets with reps and weight above 0 are kept as the last performance', () => {
  const result = plan(null, [{ id: 'a', reps: 10, weight: 0 }, { id: 'b', reps: null, weight: 50 }]);
  assert.deepEqual(result, { fields: { lastPerformedSets: [], lastPerformedDate: AT }, clearPR: false });
});

const fromThisLog = entry({ personalRecord: { reps: 8, weight: 82.5, date: AT, logId: DAY } });
const other = { reps: 8, weight: 80, date: AT - 500, logId: '2027-01-08' };

test('needsPRRescan: only when the PR came from this log and today is now lower or empty', () => {
  assert.equal(needsPRRescan(fromThisLog, sets([8, 70]), DAY), true);
  assert.equal(needsPRRescan(fromThisLog, [], DAY), true);
  assert.equal(needsPRRescan(fromThisLog, sets([8, 82.5]), DAY), false);
  assert.equal(needsPRRescan(fromThisLog, sets([8, 85]), DAY), false);
  assert.equal(needsPRRescan(entry(), sets([8, 70]), DAY), false);
  assert.equal(needsPRRescan(null, sets([8, 70]), DAY), false);
});

test('planPerformanceEntry: a lowered set in the PR log falls back to the best of the other logs', () => {
  assert.deepEqual(plan(fromThisLog, sets([8, 70]), other).fields.personalRecord, other);
  // No other log is better: the PR is the lowered set of today.
  assert.deepEqual(plan(fromThisLog, sets([8, 70]), null).fields.personalRecord, { reps: 8, weight: 70, date: AT, logId: DAY });
  assert.deepEqual(plan(fromThisLog, sets([8, 70]), { ...other, weight: 60 }).fields.personalRecord, { reps: 8, weight: 70, date: AT, logId: DAY });
});

test('planPerformanceEntry: no set left and no other log clears the PR', () => {
  const result = plan(fromThisLog, []);
  assert.equal(result.clearPR, true);
  assert.equal('personalRecord' in result.fields, false);
  assert.equal(plan(fromThisLog, [], other).clearPR, false);
});

const toMs = (logId: string) => Number(logId.slice(-2));
const logsOf = (...rows: Array<[string, Record<string, unknown>]>) => rows.map(([id, data]) => ({ id, data }));

test('bestPRFromLogs: the best set over every log, with the date of its log', () => {
  const logs = logsOf(
    ['2027-01-03', { exercises: [{ exerciseId: 'bench', sets: [{ reps: 8, weight: 80 }] }] }],
    ['2027-01-05', { exercises: [{ exerciseId: 'bench', sets: [{ reps: 5, weight: 90 }, { reps: 9, weight: 60 }] }] }],
    ['2027-01-07', { exercises: [{ exerciseId: 'row', sets: [{ reps: 5, weight: 200 }] }] }],
  );
  assert.deepEqual(bestPRFromLogs(logs, 'bench', '', {}, toMs), { reps: 5, weight: 90, date: 5, logId: '2027-01-05' });
  assert.deepEqual(bestPRFromLogs(logs, 'bench', '2027-01-05', {}, toMs), { reps: 8, weight: 80, date: 3, logId: '2027-01-03' });
  assert.equal(bestPRFromLogs(logs, 'dips', '', {}, toMs), null);
});

test('bestPRFromLogs: a planned exercise never counts; a deload log is skipped on request; no flag means performed', () => {
  const logs = logsOf(
    ['2027-01-03', { exercises: [{ exerciseId: 'bench', sets: [{ reps: 8, weight: 80 }] }] }],
    ['2027-01-05', { exercises: [{ exerciseId: 'bench', performed: false, sets: [{ reps: 5, weight: 100 }] }] }],
    ['2027-01-07', { isDeload: true, exercises: [{ exerciseId: 'bench', performed: true, sets: [{ reps: 5, weight: 95 }] }] }],
  );
  assert.deepEqual(bestPRFromLogs(logs, 'bench', '', {}, toMs), { reps: 5, weight: 95, date: 7, logId: '2027-01-07' });
  assert.deepEqual(bestPRFromLogs(logs, 'bench', '', { skipDeload: true }, toMs), { reps: 8, weight: 80, date: 3, logId: '2027-01-03' });
});

// toMs(DAY) is 15: an entry stamped with 15 was written by the log of DAY.
const benchLog = (id: string, setRows: Array<[number, number]>, over: Record<string, unknown> = {}, exercise: Record<string, unknown> = {}): [string, Record<string, unknown>] => [
  id,
  { date: id, isDeload: false, exercises: [{ exerciseId: 'bench', performed: true, sets: setRows.map(([reps, weight]) => ({ reps, weight })), ...exercise }], ...over },
];
const revert = (existing: Partial<ExercisePerformanceEntry> | null, logs: ReturnType<typeof logsOf>) =>
  planEntryRevert({ existing, logs, exerciseId: 'bench', logDate: DAY, logDateToMs: toMs });

test('planEntryRevert: an entry stamped by the log day goes back to the newest other lifted session; planned and deload logs are skipped', () => {
  const existing = { lastPerformedDate: 15, lastPerformedSets: [{ reps: 5, weight: 90 }], personalRecord: { reps: 8, weight: 80, date: 1, logId: '2027-01-01' } };
  const logs = logsOf(
    benchLog('2027-01-01', [[8, 80]]),
    benchLog(DAY, [[5, 90]]),
    benchLog('2027-01-12', [[8, 100]], { isDeload: true }),
    benchLog('2027-01-10', [[8, 95]], {}, { performed: false }),
    benchLog('2027-01-08', [[8, 80], [0, 80], [7, 80]]),
  );
  assert.equal(needsEntryRevert(existing, DAY, 15), true);
  // The PR came from another log: it stays.
  assert.deepEqual(revert(existing, logs), {
    fields: { lastPerformedSets: [{ reps: 8, weight: 80 }, { reps: 7, weight: 80 }], lastPerformedDate: 8 },
    clearPR: false,
  });
});

test('planEntryRevert: an entry another day stamped, or no entry, is left alone', () => {
  const existing = entry({ lastPerformedDate: 8 });
  const logs = logsOf(benchLog(DAY, [[5, 90]]), benchLog('2027-01-08', [[8, 80]]));
  assert.equal(needsEntryRevert(existing, DAY, 15), false);
  assert.deepEqual(revert(existing, logs), { fields: {}, clearPR: false });
  assert.equal(needsEntryRevert(null, DAY, 15), false);
  assert.deepEqual(revert(null, logs), { fields: {}, clearPR: false });
});

test('planEntryRevert: a PR from the log day is rescanned over the other logs, or cleared when none backs one', () => {
  const existing = { lastPerformedDate: 15, lastPerformedSets: [{ reps: 5, weight: 90 }], personalRecord: { reps: 5, weight: 90, date: 15, logId: DAY } };
  assert.deepEqual(revert(existing, logsOf(benchLog(DAY, [[5, 90]]), benchLog('2027-01-08', [[8, 80]]), benchLog('2027-01-03', [[6, 82.5]]))), {
    fields: {
      lastPerformedSets: [{ reps: 8, weight: 80 }],
      lastPerformedDate: 8,
      personalRecord: { reps: 6, weight: 82.5, date: 3, logId: '2027-01-03' },
    },
    clearPR: false,
  });
  // No other log: the last performance is empty and the PR goes.
  assert.deepEqual(revert(existing, logsOf(benchLog(DAY, [[5, 90]]))), {
    fields: { lastPerformedSets: [], lastPerformedDate: null },
    clearPR: true,
  });
  // Only the PR came from the log day: the last performance stays.
  const prOnly = { ...existing, lastPerformedDate: 16 };
  assert.equal(needsEntryRevert(prOnly, DAY, 15), true);
  assert.deepEqual(revert(prOnly, logsOf(benchLog(DAY, [[5, 90]]), benchLog('2027-01-08', [[8, 80]]))), {
    fields: { personalRecord: { reps: 8, weight: 80, date: 8, logId: '2027-01-08' } },
    clearPR: false,
  });
});
