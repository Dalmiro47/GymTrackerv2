import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHealthPayload } from './ingest';

// Fixed clock: 2026-11-15 12:30 in Berlin, so T = 2026-11-15 and T-1 = 2026-11-14.
const NOW = new Date('2026-11-15T12:30:00+01:00');

/** The payload the Shortcut sends today, verbatim. */
const SHORTCUT_PAYLOAD = {
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
};

test('the exact Shortcut payload writes both days with rounded values and drops nothing', () => {
  const { days, dropped } = parseHealthPayload(SHORTCUT_PAYLOAD, NOW);
  assert.deepEqual(dropped, []);
  assert.deepEqual(Object.keys(days).sort(), ['2026-11-14', '2026-11-15']);
  assert.deepEqual(days['2026-11-15'], {
    steps: 558,
    restingHr: 48,
    hrvMs: 35.2,
    activeKcal: 48.9,
    respRate: 14.7,
    weightKg: 81.95,
    bodyFatPct: 16.3,
    weighInAt: Date.parse('2026-11-15T08:50:13+01:00'),
  });
  assert.deepEqual(days['2026-11-14'], {
    steps: 7903,
    restingHr: 50,
    hrvMs: 50.8,
    activeKcal: 534.1,
    respRate: 14.4,
  });
});

test('the weigh-in lands on the doc of today with weighInAt as epoch ms', () => {
  const { days } = parseHealthPayload(SHORTCUT_PAYLOAD, NOW);
  assert.equal(days['2026-11-15'].weighInAt, 1794729013000);
  assert.equal(days['2026-11-14'].weightKg, undefined);
});

test('sleepMin is rounded to an integer on both days', () => {
  const { days, dropped } = parseHealthPayload(
    {
      v: 1,
      today: { date: '2026-11-15', sleepMin: '452.6' },
      yesterday: { date: '2026-11-14', sleepMin: '452.6' },
    },
    NOW,
  );
  assert.deepEqual(dropped, []);
  assert.deepEqual(days, { '2026-11-15': { sleepMin: 453 }, '2026-11-14': { sleepMin: 453 } });
});

test('sleepMin "0" is not written and not reported', () => {
  const { days, dropped } = parseHealthPayload(
    { v: 1, today: { date: '2026-11-15', sleepMin: '0', steps: '10' } },
    NOW,
  );
  assert.deepEqual(dropped, []);
  assert.deepEqual(days, { '2026-11-15': { steps: 10 } });
});

test('an empty string or missing field is not written and not reported', () => {
  const { days, dropped } = parseHealthPayload(
    { v: 1, today: { date: '2026-11-15', steps: '', restingHr: '   ', hrvMs: null, respRate: '15' } },
    NOW,
  );
  assert.deepEqual(dropped, []);
  assert.deepEqual(days, { '2026-11-15': { respRate: 15 } });
  assert.equal('steps' in days['2026-11-15'], false);
  assert.equal('restingHr' in days['2026-11-15'], false);
  assert.equal('hrvMs' in days['2026-11-15'], false);
});

test('a day with no valid metric is not written', () => {
  const { days, dropped } = parseHealthPayload({ v: 1, today: { date: '2026-11-15', steps: '' } }, NOW);
  assert.deepEqual(days, {});
  assert.deepEqual(dropped, []);
});

test('a weigh-in from yesterday lands on the doc of yesterday', () => {
  const { days } = parseHealthPayload(
    { v: 1, weighIn: { weightKg: '82.1', bodyFatPct: '', at: '2026-11-14T07:10:00+01:00' } },
    NOW,
  );
  assert.deepEqual(days, {
    '2026-11-14': { weightKg: 82.1, weighInAt: Date.parse('2026-11-14T07:10:00+01:00') },
  });
});

test('a weigh-in late in the evening UTC lands on the Berlin day', () => {
  // 23:30 UTC on Nov 13 is 00:30 on Nov 14 in Berlin.
  const { days } = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-11-13T23:30:00Z' } }, NOW);
  assert.deepEqual(Object.keys(days), ['2026-11-14']);
});

test('a weigh-in 30 days old is written, 31 days old is dropped', () => {
  const ok = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-10-16T08:00:00+02:00' } }, NOW);
  assert.deepEqual(Object.keys(ok.days), ['2026-10-16']);
  assert.deepEqual(ok.dropped, []);

  const old = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-10-15T08:00:00+02:00' } }, NOW);
  assert.deepEqual(old.days, {});
  assert.deepEqual(old.dropped, [{ field: 'weighIn.at', reason: 'at_out_of_window' }]);
});

test('a weigh-in more than 5 minutes in the future is dropped', () => {
  const r = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-11-15T12:36:00+01:00' } }, NOW);
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, [{ field: 'weighIn.at', reason: 'at_out_of_window' }]);
  const skew = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-11-15T12:34:00+01:00' } }, NOW);
  assert.deepEqual(Object.keys(skew.days), ['2026-11-15']);
});

test('a weigh-in with a missing or unreadable at is dropped', () => {
  const missing = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '' } }, NOW);
  assert.deepEqual(missing.days, {});
  assert.deepEqual(missing.dropped, [{ field: 'weighIn.at', reason: 'missing_at' }]);

  const noZone = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: '2026-11-15T08:00:00' } }, NOW);
  assert.deepEqual(noZone.dropped, [{ field: 'weighIn.at', reason: 'invalid_at' }]);

  const junk = parseHealthPayload({ v: 1, weighIn: { weightKg: '82', at: 'yesterday' } }, NOW);
  assert.deepEqual(junk.dropped, [{ field: 'weighIn.at', reason: 'invalid_at' }]);
});

test('a weigh-in with no values writes nothing and reports nothing', () => {
  const r = parseHealthPayload({ v: 1, weighIn: { weightKg: '', bodyFatPct: '', at: '' } }, NOW);
  assert.deepEqual(r, { days: {}, dropped: [] });
});

test('a weigh-in with only invalid values writes no weighInAt', () => {
  const r = parseHealthPayload({ v: 1, weighIn: { weightKg: '500', at: '2026-11-15T08:00:00+01:00' } }, NOW);
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, [{ field: 'weighIn.weightKg', reason: 'out_of_range' }]);
});

test('a day block dated 3 days ago is dropped with its reason', () => {
  const r = parseHealthPayload(
    { v: 1, today: { date: '2026-11-15', steps: '10' }, yesterday: { date: '2026-11-12', steps: '9000' } },
    NOW,
  );
  assert.deepEqual(Object.keys(r.days), ['2026-11-15']);
  assert.deepEqual(r.dropped, [{ field: 'yesterday.date', reason: 'date_out_of_window' }]);
});

test('a future day block is dropped', () => {
  const r = parseHealthPayload({ v: 1, today: { date: '2026-11-16', steps: '10' } }, NOW);
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, [{ field: 'today.date', reason: 'date_out_of_window' }]);
});

test('a missing or unreal block date is invalid_date', () => {
  const r = parseHealthPayload(
    { v: 1, today: { steps: '10' }, yesterday: { date: '2026-02-30', steps: '10' } },
    NOW,
  );
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, [
    { field: 'today.date', reason: 'invalid_date' },
    { field: 'yesterday.date', reason: 'invalid_date' },
  ]);
});

test('a block that is not an object is invalid_block', () => {
  const r = parseHealthPayload({ v: 1, today: 'x', yesterday: [], weighIn: 5 }, NOW);
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, [
    { field: 'today', reason: 'invalid_block' },
    { field: 'yesterday', reason: 'invalid_block' },
    { field: 'weighIn', reason: 'invalid_block' },
  ]);
});

test('two blocks with the same date: today wins', () => {
  const r = parseHealthPayload(
    { v: 1, today: { date: '2026-11-15', steps: '10' }, yesterday: { date: '2026-11-15', steps: '20' } },
    NOW,
  );
  assert.deepEqual(r.days, { '2026-11-15': { steps: 10 } });
  assert.deepEqual(r.dropped, [{ field: 'yesterday.date', reason: 'duplicate_date' }]);
});

test('a value that does not parse or is out of range drops only that field', () => {
  const r = parseHealthPayload(
    { v: 1, today: { date: '2026-11-15', steps: 'abc', restingHr: '400', hrvMs: '40', activeKcal: '-5' } },
    NOW,
  );
  assert.deepEqual(r.days, { '2026-11-15': { hrvMs: 40 } });
  assert.deepEqual(r.dropped, [
    { field: 'today.steps', reason: 'not_a_number' },
    { field: 'today.activeKcal', reason: 'out_of_range' },
    { field: 'today.restingHr', reason: 'out_of_range' },
  ]);
});

test('steps "-5" is out of range', () => {
  const r = parseHealthPayload({ v: 1, today: { date: '2026-11-15', steps: '-5' } }, NOW);
  assert.deepEqual(r.dropped, [{ field: 'today.steps', reason: 'out_of_range' }]);
});

test('a lone comma is the decimal point; comma and dot together is not a number', () => {
  const ok = parseHealthPayload(
    { v: 1, weighIn: { weightKg: '81,95', bodyFatPct: '16,3', at: '2026-11-15T08:00:00+01:00' } },
    NOW,
  );
  assert.equal(ok.days['2026-11-15'].weightKg, 81.95);
  assert.equal(ok.days['2026-11-15'].bodyFatPct, 16.3);

  const both = parseHealthPayload(
    { v: 1, weighIn: { weightKg: '1.081,95', bodyFatPct: '16,3', at: '2026-11-15T08:00:00+01:00' } },
    NOW,
  );
  assert.deepEqual(both.dropped, [{ field: 'weighIn.weightKg', reason: 'not_a_number' }]);
  assert.equal(both.days['2026-11-15'].weightKg, undefined);
  assert.equal(both.days['2026-11-15'].bodyFatPct, 16.3);
});

test('numbers are accepted; other types, Infinity and hex are not a number', () => {
  const r = parseHealthPayload(
    {
      v: 1,
      today: { date: '2026-11-15', steps: 1200, restingHr: true, hrvMs: 'Infinity', respRate: '0x10', activeKcal: {} },
    },
    NOW,
  );
  assert.deepEqual(r.days, { '2026-11-15': { steps: 1200 } });
  assert.deepEqual(
    r.dropped.map(d => d.field).sort(),
    ['today.activeKcal', 'today.hrvMs', 'today.respRate', 'today.restingHr'],
  );
  assert.ok(r.dropped.every(d => d.reason === 'not_a_number'));
});

test('ranges: the bounds are inclusive', () => {
  const low = parseHealthPayload(
    {
      v: 1,
      today: { date: '2026-11-15', steps: '0', activeKcal: '0', restingHr: '25', hrvMs: '1', respRate: '4', sleepMin: '1' },
      weighIn: { weightKg: '30', bodyFatPct: '3', at: '2026-11-15T08:00:00+01:00' },
    },
    NOW,
  );
  assert.deepEqual(low.dropped, []);
  const high = parseHealthPayload(
    {
      v: 1,
      today: {
        date: '2026-11-15',
        steps: '100000',
        activeKcal: '10000',
        restingHr: '150',
        hrvMs: '300',
        respRate: '40',
        sleepMin: '1440',
      },
      weighIn: { weightKg: '250', bodyFatPct: '60', at: '2026-11-15T08:00:00+01:00' },
    },
    NOW,
  );
  assert.deepEqual(high.dropped, []);
  const out = parseHealthPayload(
    {
      v: 1,
      today: {
        date: '2026-11-15',
        steps: '100001',
        activeKcal: '10000.1',
        restingHr: '24',
        hrvMs: '0.9',
        respRate: '40.1',
        sleepMin: '1441',
      },
      weighIn: { weightKg: '29.99', bodyFatPct: '60.1', at: '2026-11-15T08:00:00+01:00' },
    },
    NOW,
  );
  assert.equal(out.dropped.length, 8);
  assert.ok(out.dropped.every(d => d.reason === 'out_of_range'));
  assert.deepEqual(out.days, {});
});

test('unknown keys are ignored', () => {
  const r = parseHealthPayload(
    { v: 1, extra: 'x', today: { date: '2026-11-15', steps: '10', heartRate: '90', date2: 'x' } },
    NOW,
  );
  assert.deepEqual(r, { days: { '2026-11-15': { steps: 10 } }, dropped: [] });
});

test('just after midnight in Berlin, today is the new day', () => {
  // 23:10 UTC on Nov 15 is 00:10 on Nov 16 in Berlin.
  const late = new Date('2026-11-15T23:10:00Z');
  const r = parseHealthPayload(
    { v: 1, today: { date: '2026-11-16', steps: '5' }, yesterday: { date: '2026-11-15', steps: '9000' } },
    late,
  );
  assert.deepEqual(Object.keys(r.days).sort(), ['2026-11-15', '2026-11-16']);
  assert.deepEqual(r.dropped, []);
});

// ─── Sleep window ────────────────────────────────────────────────────

/** 23:45 in Berlin on 2026-11-15: late enough that the 14:00 end bound is not in the future. */
const EVENING = new Date('2026-11-15T23:45:00+01:00');

const sleep = (sleepStart: unknown, sleepEnd: unknown, now: Date = NOW) =>
  parseHealthPayload({ v: 1, today: { date: '2026-11-15', sleepStart, sleepEnd } }, now);

const BOTH = (reason: string) => [
  { field: 'today.sleepStart', reason },
  { field: 'today.sleepEnd', reason },
];

test('sleep: a valid window is stored on the doc of today as epoch ms', () => {
  const r = parseHealthPayload(
    {
      v: 1,
      today: {
        date: '2026-11-15',
        sleepMin: '431',
        sleepStart: '2026-11-14T23:12:45+01:00',
        sleepEnd: ' 2026-11-15T07:03:10+01:00 ',
      },
    },
    NOW,
  );
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.days, {
    '2026-11-15': {
      sleepMin: 431,
      sleepStartAt: Date.parse('2026-11-14T23:12:45+01:00'),
      sleepEndAt: Date.parse('2026-11-15T07:03:10+01:00'),
    },
  });
});

test('sleep: both empty writes nothing and reports nothing', () => {
  assert.deepEqual(sleep('', null), { days: {}, dropped: [] });
  assert.deepEqual(sleep(undefined, '  '), { days: {}, dropped: [] });
});

test('sleep: only one time drops both as missing_pair', () => {
  const onlyStart = sleep('2026-11-14T23:00:00+01:00', '');
  assert.deepEqual(onlyStart.days, {});
  assert.deepEqual(onlyStart.dropped, BOTH('missing_pair'));

  const onlyEnd = sleep(null, '2026-11-15T07:00:00+01:00');
  assert.deepEqual(onlyEnd.days, {});
  assert.deepEqual(onlyEnd.dropped, BOTH('missing_pair'));
});

test('sleep: an unreadable time drops both as invalid_at', () => {
  assert.deepEqual(sleep('last night', '2026-11-15T07:00:00+01:00').dropped, BOTH('invalid_at'));
  assert.deepEqual(sleep('2026-11-14T23:00:00', '2026-11-15T07:00:00+01:00').dropped, BOTH('invalid_at'));
  assert.deepEqual(sleep('2026-11-14T23:00:00+01:00', 1794729013000).dropped, BOTH('invalid_at'));
});

test('sleep: a start before 18:00 Berlin of the previous day is dropped, 18:00 is kept', () => {
  const early = sleep('2026-11-14T17:59:59+01:00', '2026-11-15T07:00:00+01:00');
  assert.deepEqual(early.days, {});
  assert.deepEqual(early.dropped, BOTH('at_out_of_window'));

  const edge = sleep('2026-11-14T18:00:00+01:00', '2026-11-15T07:00:00+01:00');
  assert.deepEqual(edge.dropped, []);
  assert.equal(edge.days['2026-11-15'].sleepStartAt, Date.parse('2026-11-14T18:00:00+01:00'));
});

test('sleep: an end more than 10 minutes after now is dropped, +10 minutes is kept', () => {
  const future = sleep('2026-11-15T01:00:00+01:00', '2026-11-15T12:40:01+01:00');
  assert.deepEqual(future.days, {});
  assert.deepEqual(future.dropped, BOTH('at_out_of_window'));

  const edge = sleep('2026-11-15T01:00:00+01:00', '2026-11-15T12:40:00+01:00');
  assert.deepEqual(edge.dropped, []);
});

test('sleep: an end equal to or before the start is bad_sleep_window', () => {
  assert.deepEqual(sleep('2026-11-15T01:00:00+01:00', '2026-11-15T01:00:00+01:00').dropped, BOTH('bad_sleep_window'));
  assert.deepEqual(sleep('2026-11-15T01:00:00+01:00', '2026-11-15T00:30:00+01:00').dropped, BOTH('bad_sleep_window'));
});

test('sleep: a window over 16 hours is dropped, 16 hours exactly is kept', () => {
  const long = sleep('2026-11-14T18:00:00+01:00', '2026-11-15T10:00:01+01:00');
  assert.deepEqual(long.days, {});
  assert.deepEqual(long.dropped, BOTH('bad_sleep_window'));

  assert.deepEqual(sleep('2026-11-14T18:00:00+01:00', '2026-11-15T10:00:00+01:00').dropped, []);
});

test('sleep: a start at 05:59 on the day is kept, 06:00 is dropped', () => {
  assert.deepEqual(sleep('2026-11-15T05:59:00+01:00', '2026-11-15T09:00:00+01:00').dropped, []);
  const late = sleep('2026-11-15T06:00:00+01:00', '2026-11-15T09:00:00+01:00');
  assert.deepEqual(late.days, {});
  assert.deepEqual(late.dropped, BOTH('bad_sleep_window'));
});

test('sleep: an end at 13:59 on the day is kept, 14:00 is dropped', () => {
  assert.deepEqual(sleep('2026-11-15T02:00:00+01:00', '2026-11-15T13:59:00+01:00', EVENING).dropped, []);
  const late = sleep('2026-11-15T02:00:00+01:00', '2026-11-15T14:00:00+01:00', EVENING);
  assert.deepEqual(late.days, {});
  assert.deepEqual(late.dropped, BOTH('bad_sleep_window'));
});

test('sleep: a late send that catches tonight is dropped', () => {
  const r = sleep('2026-11-14T23:00:00+01:00', '2026-11-15T23:30:00+01:00', EVENING);
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.dropped, BOTH('bad_sleep_window'));

  const tonight = sleep('2026-11-15T23:00:00+01:00', '2026-11-15T23:30:00+01:00', EVENING);
  assert.deepEqual(tonight.dropped, BOTH('bad_sleep_window'));
});

test('sleep: the Berlin bounds hold on the days the clocks change', () => {
  // 2026-03-29: clocks go from 02:00 +01:00 to 03:00 +02:00.
  const spring = new Date('2026-03-29T13:00:00+02:00');
  const springDay = (s: string, e: string) =>
    parseHealthPayload({ v: 1, today: { date: '2026-03-29', sleepStart: s, sleepEnd: e } }, spring).dropped;
  assert.deepEqual(springDay('2026-03-28T18:00:00+01:00', '2026-03-29T07:00:00+02:00'), []);
  assert.deepEqual(springDay('2026-03-28T17:59:00+01:00', '2026-03-29T07:00:00+02:00'), BOTH('at_out_of_window'));
  assert.deepEqual(springDay('2026-03-29T05:59:00+02:00', '2026-03-29T08:00:00+02:00'), []);
  assert.deepEqual(springDay('2026-03-29T06:00:00+02:00', '2026-03-29T08:00:00+02:00'), BOTH('bad_sleep_window'));
  assert.deepEqual(springDay('2026-03-29T01:00:00+01:00', '2026-03-29T12:59:00+02:00'), []);

  // 2026-10-25: clocks go from 03:00 +02:00 back to 02:00 +01:00.
  const autumn = new Date('2026-10-25T15:00:00+01:00');
  const autumnDay = (s: string, e: string) =>
    parseHealthPayload({ v: 1, today: { date: '2026-10-25', sleepStart: s, sleepEnd: e } }, autumn).dropped;
  assert.deepEqual(autumnDay('2026-10-24T18:00:00+02:00', '2026-10-25T07:00:00+01:00'), []);
  assert.deepEqual(autumnDay('2026-10-24T17:59:00+02:00', '2026-10-25T07:00:00+01:00'), BOTH('at_out_of_window'));
  assert.deepEqual(autumnDay('2026-10-25T05:59:00+01:00', '2026-10-25T08:00:00+01:00'), []);
  assert.deepEqual(autumnDay('2026-10-25T06:00:00+01:00', '2026-10-25T08:00:00+01:00'), BOTH('bad_sleep_window'));
  assert.deepEqual(autumnDay('2026-10-25T01:00:00+02:00', '2026-10-25T13:59:00+01:00'), []);
  assert.deepEqual(autumnDay('2026-10-25T01:00:00+02:00', '2026-10-25T14:00:00+01:00'), BOTH('bad_sleep_window'));
});

test('sleep: times in the yesterday block are ignored', () => {
  const r = parseHealthPayload(
    {
      v: 1,
      yesterday: {
        date: '2026-11-14',
        steps: '10',
        sleepStart: '2026-11-13T23:00:00+01:00',
        sleepEnd: '2026-11-14T07:00:00+01:00',
      },
    },
    NOW,
  );
  assert.deepEqual(r, { days: { '2026-11-14': { steps: 10 } }, dropped: [] });
});

// ─── VO2 max ─────────────────────────────────────────────────────────

test('vo2max: goes to the Berlin day of its at, 1 decimal, comma decimal accepted', () => {
  const r = parseHealthPayload({ v: 1, vo2max: { value: '44,87', at: '2026-11-13T10:21:00+01:00' } }, NOW);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.days, {
    '2026-11-13': { vo2max: 44.9, vo2maxAt: Date.parse('2026-11-13T10:21:00+01:00') },
  });

  // 23:30 UTC on Nov 13 is 00:30 on Nov 14 in Berlin; a number is accepted.
  const utc = parseHealthPayload({ v: 1, vo2max: { value: 45, at: '2026-11-13T23:30:00Z' } }, NOW);
  assert.deepEqual(utc.days, { '2026-11-14': { vo2max: 45, vo2maxAt: Date.parse('2026-11-13T23:30:00Z') } });
});

test('vo2max: 30 days old is written; 31 days old or more than 5 minutes ahead is dropped', () => {
  const ok = parseHealthPayload({ v: 1, vo2max: { value: '44', at: '2026-10-16T08:00:00+02:00' } }, NOW);
  assert.deepEqual(Object.keys(ok.days), ['2026-10-16']);

  const old = parseHealthPayload({ v: 1, vo2max: { value: '44', at: '2026-10-15T08:00:00+02:00' } }, NOW);
  assert.deepEqual(old, { days: {}, dropped: [{ field: 'vo2max.at', reason: 'at_out_of_window' }] });

  const future = parseHealthPayload({ v: 1, vo2max: { value: '44', at: '2026-11-15T12:36:00+01:00' } }, NOW);
  assert.deepEqual(future, { days: {}, dropped: [{ field: 'vo2max.at', reason: 'at_out_of_window' }] });
});

test('vo2max: "" or null writes nothing and reports nothing', () => {
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: { value: '', at: '' } }, NOW), { days: {}, dropped: [] });
  assert.deepEqual(
    parseHealthPayload({ v: 1, vo2max: { value: null, at: '2026-11-15T08:00:00+01:00' } }, NOW),
    { days: {}, dropped: [] },
  );
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: null }, NOW), { days: {}, dropped: [] });
});

test('vo2max: 10 and 90 are kept; 9.9, 90.1 and text are dropped', () => {
  const at = '2026-11-15T08:00:00+01:00';
  assert.equal(parseHealthPayload({ v: 1, vo2max: { value: '10', at } }, NOW).days['2026-11-15'].vo2max, 10);
  assert.equal(parseHealthPayload({ v: 1, vo2max: { value: '90', at } }, NOW).days['2026-11-15'].vo2max, 90);
  for (const value of ['9.9', '90.1']) {
    assert.deepEqual(parseHealthPayload({ v: 1, vo2max: { value, at } }, NOW), {
      days: {},
      dropped: [{ field: 'vo2max.value', reason: 'out_of_range' }],
    });
  }
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: { value: 'high', at } }, NOW).dropped, [
    { field: 'vo2max.value', reason: 'not_a_number' },
  ]);
});

test('vo2max: a missing or unreadable at is dropped; a block that is not an object is invalid_block', () => {
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: { value: '44', at: '' } }, NOW), {
    days: {},
    dropped: [{ field: 'vo2max.at', reason: 'missing_at' }],
  });
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: { value: '44', at: '2026-11-15T08:00:00' } }, NOW), {
    days: {},
    dropped: [{ field: 'vo2max.at', reason: 'invalid_at' }],
  });
  assert.deepEqual(parseHealthPayload({ v: 1, vo2max: '44' }, NOW), {
    days: {},
    dropped: [{ field: 'vo2max', reason: 'invalid_block' }],
  });
});

test('vo2max and a weigh-in on the same day merge into one doc with today\'s values', () => {
  const r = parseHealthPayload(
    {
      v: 1,
      today: { date: '2026-11-15', steps: '558' },
      weighIn: { weightKg: '81.95', at: '2026-11-15T08:50:13+01:00' },
      vo2max: { value: '44.8', at: '2026-11-15T10:21:33+01:00' },
    },
    NOW,
  );
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.days, {
    '2026-11-15': {
      steps: 558,
      weightKg: 81.95,
      weighInAt: Date.parse('2026-11-15T08:50:13+01:00'),
      vo2max: 44.8,
      vo2maxAt: Date.parse('2026-11-15T10:21:33+01:00'),
    },
  });
});
