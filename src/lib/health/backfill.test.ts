import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKFILL_FIRST_DAY,
  BACKFILL_LAST_DAY,
  backfillDates,
  buildDay,
  checkDayFiles,
  checkGolden,
  indexByBerlinDay,
  isBackfillDate,
  parseRecordLine,
  readGoldenEntries,
  readOwnerUid,
  writeBackfillDays,
  type BackfillWriteDeps,
  type DayDoc,
  type DayFile,
  type HealthRecord,
} from './backfill';

// Every value below is invented. Export lines follow the Apple Health export.xml format.

const TYPES = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  kcal: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  rhr: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  resp: 'HKQuantityTypeIdentifierRespiratoryRate',
  mass: 'HKQuantityTypeIdentifierBodyMass',
  fat: 'HKQuantityTypeIdentifierBodyFatPercentage',
  vo2: 'HKQuantityTypeIdentifierVO2Max',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
} as const;

const WATCH_DEVICE =
  ' device="&lt;&lt;HKDevice: 0x1&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch0,0, software:1.0&gt;"';
const PHONE_DEVICE =
  ' device="&lt;&lt;HKDevice: 0x2&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone0,0, software:1.0&gt;"';
const OTHER_DEVICE = ' device="&lt;&lt;HKDevice: 0x3&gt;, name:Band, manufacturer:Acme, model:Band 1&gt;"';

type Opts = { end?: string; device?: 'watch' | 'phone' | 'other'; source?: string };

/** One export line. Times use the export format: "2026-03-10 08:00:00 +0100". */
function line(kind: keyof typeof TYPES, start: string, value: string | number, opts: Opts = {}): string {
  const device =
    opts.device === 'watch' ? WATCH_DEVICE : opts.device === 'phone' ? PHONE_DEVICE : opts.device === 'other' ? OTHER_DEVICE : '';
  return (
    `  <Record type="${TYPES[kind]}" sourceName="${opts.source ?? 'Test Source'}" sourceVersion="1"${device} unit="u" ` +
    `creationDate="${start}" startDate="${start}" endDate="${opts.end ?? start}" value="${value}"/>`
  );
}

const asleep = (stage: string) => `HKCategoryValueSleepAnalysisAsleep${stage}`;
const AWAKE = 'HKCategoryValueSleepAnalysisAwake';

function records(lines: string[]): HealthRecord[] {
  return lines.map(text => {
    const record = parseRecordLine(text);
    assert.ok(record !== null && record !== 'unreadable', text);
    return record;
  });
}

const dayOf = (lines: string[], ymd: string) => buildDay(indexByBerlinDay(records(lines)), ymd);
const ms = (iso: string) => Date.parse(iso);

// ─── Date guard ──────────────────────────────────────────────────────

test('guard: the backfill range is 2025-11-16 to 2026-11-13, both included', () => {
  assert.equal(BACKFILL_FIRST_DAY, '2025-11-16');
  assert.equal(BACKFILL_LAST_DAY, '2026-11-13');
  assert.equal(isBackfillDate('2025-11-16'), true);
  assert.equal(isBackfillDate('2026-11-13'), true);
  assert.equal(isBackfillDate('2026-03-29'), true);
});

test('guard: days outside the range, Shortcut days and unreal days are refused', () => {
  for (const bad of ['2025-11-15', '2026-11-14', '2026-11-16', '2027-01-01', '2026-02-29', '2026-02-30', '', 20260101, null]) {
    assert.equal(isBackfillDate(bad), false, String(bad));
  }
});

test('guard: backfillDates lists the 363 days in order', () => {
  const dates = backfillDates();
  assert.equal(dates.length, 363);
  assert.equal(dates[0], '2025-11-16');
  assert.equal(dates[dates.length - 1], '2026-11-13');
  assert.ok(dates.every(isBackfillDate));
});

// ─── Line parsing ────────────────────────────────────────────────────

test('parse: a step line gives kind, instants with the offset, value, device and decoded source', () => {
  const record = parseRecordLine(line('steps', '2026-03-10 09:00:00 +0100', 321, { end: '2026-03-10 09:05:00 +0100', device: 'watch', source: 'A &amp; B' }));
  assert.deepEqual(record, {
    kind: 'steps',
    startMs: ms('2026-03-10T09:00:00+01:00'),
    endMs: ms('2026-03-10T09:05:00+01:00'),
    value: '321',
    device: 'watch',
    source: 'A & B',
  });
});

test('parse: device model iPhone is phone; another model or no device is other', () => {
  const phone = parseRecordLine(line('steps', '2026-03-10 09:00:00 +0100', 1, { device: 'phone' }));
  const other = parseRecordLine(line('steps', '2026-03-10 09:00:00 +0100', 1, { device: 'other' }));
  const none = parseRecordLine(line('hrv', '2026-03-10 09:00:00 +0100', 1));
  assert.equal(phone !== null && phone !== 'unreadable' && phone.device, 'phone');
  assert.equal(other !== null && other !== 'unreadable' && other.device, 'other');
  assert.equal(none !== null && none !== 'unreadable' && none.device, 'other');
});

test('parse: other record types and other elements are ignored', () => {
  assert.equal(parseRecordLine('  <Record type="HKQuantityTypeIdentifierHeartRate" startDate="2026-03-10 09:00:00 +0100" endDate="2026-03-10 09:00:00 +0100" value="70"/>'), null);
  assert.equal(parseRecordLine('  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="10">'), null);
  assert.equal(parseRecordLine('   <MetadataEntry key="HKTimeZone" value="Europe/Berlin"/>'), null);
  assert.equal(parseRecordLine('  <Record type="constructor" value="1"/>'), null);
});

test('parse: a known type with an unreadable date or no value is unreadable', () => {
  assert.equal(parseRecordLine(line('steps', '2026-03-10T09:00:00+01:00', 5)), 'unreadable');
  assert.equal(parseRecordLine(line('steps', '2026-02-30 09:00:00 +0100', 5)), 'unreadable');
  assert.equal(
    parseRecordLine('  <Record type="HKQuantityTypeIdentifierStepCount" startDate="2026-03-10 09:00:00 +0100" endDate="2026-03-10 09:00:00 +0100"/>'),
    'unreadable',
  );
});

// ─── Berlin day ──────────────────────────────────────────────────────

test('day: a sample belongs to the Berlin day of its start, in winter and in summer', () => {
  const index = indexByBerlinDay(
    records([
      line('hrv', '2026-03-10 22:59:59 +0000', 10), // 23:59:59 Berlin, 03-10
      line('hrv', '2026-03-10 23:00:00 +0000', 20), // 00:00 Berlin, 03-11
      line('hrv', '2026-07-01 21:59:59 +0000', 30), // 23:59:59 Berlin, 07-01
      line('hrv', '2026-07-01 22:00:00 +0000', 40), // 00:00 Berlin, 07-02
    ]),
  );
  assert.deepEqual([...index.keys()].sort(), ['2026-03-10', '2026-03-11', '2026-07-01', '2026-07-02']);
  assert.equal(buildDay(index, '2026-03-11').fields.hrvMs, 20);
  assert.equal(buildDay(index, '2026-07-01').fields.hrvMs, 30);
});

test('day: a day with no record has no fields', () => {
  const day = dayOf([line('hrv', '2026-03-10 09:00:00 +0100', 30)], '2026-03-12');
  assert.deepEqual(day.fields, {});
  assert.equal(day.stepsFrom, undefined);
  assert.deepEqual(day.dropped, []);
});

// ─── Steps and active kcal ───────────────────────────────────────────

test('steps: the larger of the Watch and iPhone sums wins; a sample crossing midnight counts on its start day', () => {
  const day = dayOf(
    [
      line('steps', '2026-03-10 09:00:00 +0100', 1000, { device: 'watch' }),
      line('steps', '2026-03-10 23:50:00 +0100', 500, { device: 'watch', end: '2026-03-11 00:10:00 +0100' }),
      line('steps', '2026-03-10 10:00:00 +0100', 1200, { device: 'phone' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.steps, 1500);
  assert.equal(day.stepsFrom, 'watch');
});

test('steps: the iPhone sum wins when it is larger', () => {
  const day = dayOf(
    [
      line('steps', '2026-03-10 09:00:00 +0100', 100, { device: 'watch' }),
      line('steps', '2026-03-10 10:00:00 +0100', 1800, { device: 'phone' }),
      line('steps', '2026-03-10 11:00:00 +0100', 200, { device: 'phone' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.steps, 2000);
  assert.equal(day.stepsFrom, 'phone');
});

test('steps: only one device gives that sum; a tie keeps the Watch', () => {
  const phoneOnly = dayOf([line('steps', '2026-03-10 09:00:00 +0100', 700, { device: 'phone' })], '2026-03-10');
  assert.deepEqual([phoneOnly.fields.steps, phoneOnly.stepsFrom], [700, 'phone']);
  const watchOnly = dayOf([line('steps', '2026-03-10 09:00:00 +0100', 600, { device: 'watch' })], '2026-03-10');
  assert.deepEqual([watchOnly.fields.steps, watchOnly.stepsFrom], [600, 'watch']);
  const tie = dayOf(
    [
      line('steps', '2026-03-10 09:00:00 +0100', 500, { device: 'watch' }),
      line('steps', '2026-03-10 09:00:00 +0100', 500, { device: 'phone' }),
    ],
    '2026-03-10',
  );
  assert.deepEqual([tie.fields.steps, tie.stepsFrom], [500, 'watch']);
});

test('steps: other devices never count and are reported; exact duplicates both count', () => {
  const day = dayOf(
    [
      line('steps', '2026-03-10 09:00:00 +0100', 300, { device: 'watch' }),
      line('steps', '2026-03-10 09:00:00 +0100', 300, { device: 'watch' }),
      line('steps', '2026-03-10 09:00:00 +0100', 9000, { device: 'other' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.steps, 600);
  assert.equal(day.excluded.steps, 1);
});

test('steps: a value that is not a number is skipped and noted', () => {
  const day = dayOf(
    [
      line('steps', '2026-03-10 09:00:00 +0100', 'abc', { device: 'watch' }),
      line('steps', '2026-03-10 10:00:00 +0100', 40, { device: 'watch' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.steps, 40);
  assert.equal(day.notes.length, 1);
});

test('activeKcal: Watch samples only, rounded to 1 decimal', () => {
  const day = dayOf(
    [
      line('kcal', '2026-03-10 09:00:00 +0100', 120.25, { device: 'watch' }),
      line('kcal', '2026-03-10 10:00:00 +0100', 30.5, { device: 'watch' }),
      line('kcal', '2026-03-10 11:00:00 +0100', 999, { device: 'phone' }),
      line('kcal', '2026-03-10 12:00:00 +0100', 888, { device: 'other' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.activeKcal, 150.8);
  assert.equal(day.excluded.activeKcal, 2);
});

test('activeKcal: a day with only iPhone kcal gets no activeKcal', () => {
  const day = dayOf([line('kcal', '2026-03-10 09:00:00 +0100', 210, { device: 'phone' })], '2026-03-10');
  assert.equal(day.fields.activeKcal, undefined);
  assert.equal(day.excluded.activeKcal, 1);
});

// ─── Heart and breathing ─────────────────────────────────────────────

test('hrvMs and respRate are the mean of the day; restingHr is the last sample', () => {
  const day = dayOf(
    [
      line('hrv', '2026-03-10 02:00:00 +0100', 30),
      line('hrv', '2026-03-10 03:00:00 +0100', 40),
      line('hrv', '2026-03-10 04:00:00 +0100', 53),
      line('resp', '2026-03-10 02:00:00 +0100', 12),
      line('resp', '2026-03-10 03:00:00 +0100', 13),
      line('rhr', '2026-03-10 08:00:00 +0100', 52),
      line('rhr', '2026-03-10 00:05:00 +0100', 55),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.hrvMs, 41);
  assert.equal(day.fields.respRate, 12.5);
  assert.equal(day.fields.restingHr, 52);
  assert.equal(day.notes.length, 1, 'two resting HR samples are noted');
});

test('an out-of-range value is dropped by the ingest rules and reported', () => {
  const day = dayOf(
    [line('rhr', '2026-03-10 08:00:00 +0100', 200), line('hrv', '2026-03-10 02:00:00 +0100', 0.4)],
    '2026-03-10',
  );
  assert.equal(day.fields.restingHr, undefined);
  assert.equal(day.fields.hrvMs, undefined);
  assert.deepEqual(day.dropped, [
    { field: 'today.restingHr', reason: 'out_of_range' },
    { field: 'today.hrvMs', reason: 'out_of_range' },
  ]);
});

// ─── Sleep ───────────────────────────────────────────────────────────

test('sleep: a segment starting at 18:00 of the day before counts, 17:59 does not; Awake never counts', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 17:59:00 +0100', asleep('Core'), { end: '2026-03-09 18:20:00 +0100' }),
      line('sleep', '2026-03-09 18:00:00 +0100', asleep('Core'), { end: '2026-03-09 18:30:00 +0100' }),
      line('sleep', '2026-03-09 23:00:00 +0100', AWAKE, { end: '2026-03-09 23:10:00 +0100' }),
      line('sleep', '2026-03-09 23:10:00 +0100', asleep('Deep'), { end: '2026-03-10 01:10:00 +0100' }),
      line('sleep', '2026-03-10 01:10:00 +0100', asleep('REM'), { end: '2026-03-10 02:00:00 +0100' }),
      line('sleep', '2026-03-10 02:00:00 +0100', AWAKE, { end: '2026-03-10 02:30:00 +0100' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, 30 + 120 + 50);
  assert.equal(day.fields.sleepStartAt, ms('2026-03-09T18:00:00+01:00'));
  assert.equal(day.fields.sleepEndAt, ms('2026-03-10T02:00:00+01:00'));
});

test('sleep: a segment starting at 11:59 of the day counts, 12:00 does not (a nap counts on no day)', () => {
  const lines = [
    line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100' }),
    line('sleep', '2026-03-10 11:59:00 +0100', asleep('Unspecified'), { end: '2026-03-10 12:20:00 +0100' }),
    line('sleep', '2026-03-10 12:00:00 +0100', asleep('Core'), { end: '2026-03-10 12:40:00 +0100' }),
    line('sleep', '2026-03-10 15:00:00 +0100', asleep('Core'), { end: '2026-03-10 15:30:00 +0100' }),
  ];
  const day = dayOf(lines, '2026-03-10');
  assert.equal(day.fields.sleepMin, 7 * 60 + 21);
  assert.equal(day.fields.sleepStartAt, ms('2026-03-09T23:00:00+01:00'));
  assert.equal(day.fields.sleepEndAt, ms('2026-03-10T12:20:00+01:00'));
  assert.equal(dayOf(lines, '2026-03-11').fields.sleepMin, undefined);
});

test('sleep: the window runs through the ingest checks (over 16 hours drops both times, sleepMin stays)', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 18:00:00 +0100', asleep('Core'), { end: '2026-03-09 19:00:00 +0100' }),
      line('sleep', '2026-03-10 11:00:00 +0100', asleep('Core'), { end: '2026-03-10 11:30:00 +0100' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, 90);
  assert.equal(day.fields.sleepStartAt, undefined);
  assert.equal(day.fields.sleepEndAt, undefined);
  assert.deepEqual(day.dropped, [
    { field: 'today.sleepStart', reason: 'bad_sleep_window' },
    { field: 'today.sleepEnd', reason: 'bad_sleep_window' },
  ]);
});

test('sleep: the Berlin bounds hold on the day the clocks go forward (23 h)', () => {
  const lines = [
    line('sleep', '2026-03-28 17:59:00 +0100', asleep('Core'), { end: '2026-03-28 18:10:00 +0100' }),
    line('sleep', '2026-03-28 23:00:00 +0100', asleep('Core'), { end: '2026-03-29 07:00:00 +0200' }),
    line('sleep', '2026-03-29 11:59:00 +0200', asleep('Core'), { end: '2026-03-29 12:09:00 +0200' }),
    line('sleep', '2026-03-29 12:00:00 +0200', asleep('Core'), { end: '2026-03-29 12:30:00 +0200' }),
  ];
  const day = dayOf(lines, '2026-03-29');
  assert.equal(day.fields.sleepMin, 7 * 60 + 10);
  assert.equal(day.fields.sleepStartAt, ms('2026-03-28T23:00:00+01:00'));
  assert.equal(day.fields.sleepEndAt, ms('2026-03-29T12:09:00+02:00'));
});

test('sleep: the Berlin bounds hold on the day the clocks go back (25 h)', () => {
  const lines = [
    line('sleep', '2026-10-24 17:59:59 +0200', asleep('Core'), { end: '2026-10-24 18:05:00 +0200' }),
    line('sleep', '2026-10-24 18:00:00 +0200', asleep('Core'), { end: '2026-10-24 18:30:00 +0200' }),
    line('sleep', '2026-10-25 01:00:00 +0200', asleep('Deep'), { end: '2026-10-25 06:00:00 +0100' }),
  ];
  const day = dayOf(lines, '2026-10-25');
  assert.equal(day.fields.sleepMin, 30 + 6 * 60);
  assert.equal(day.fields.sleepStartAt, ms('2026-10-24T18:00:00+02:00'));
});

test('sleep: asleep segments from two sources in one window give no sleep and a note', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100', source: 'Source A' }),
      line('sleep', '2026-03-09 23:30:00 +0100', asleep('Core'), { end: '2026-03-10 06:30:00 +0100', source: 'Source B' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, undefined);
  assert.equal(day.fields.sleepStartAt, undefined);
  assert.equal(day.notes.length, 1);
});

// ─── Weigh-in and VO2 max ────────────────────────────────────────────

test('weigh-in: the last one of the day wins; body fat goes from a fraction to a percentage', () => {
  const day = dayOf(
    [
      line('mass', '2026-03-10 07:00:00 +0100', 80.5),
      line('fat', '2026-03-10 07:00:00 +0100', 0.17),
      line('mass', '2026-03-10 21:00:00 +0100', 80.25),
      line('fat', '2026-03-10 21:00:00 +0100', 0.168),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.weightKg, 80.25);
  assert.equal(day.fields.bodyFatPct, 16.8);
  assert.equal(day.fields.weighInAt, ms('2026-03-10T21:00:00+01:00'));
});

test('weigh-in: one late in the evening UTC lands on the Berlin day; mass alone writes no body fat', () => {
  const index = indexByBerlinDay(records([line('mass', '2026-03-10 23:30:00 +0000', 79.4)]));
  assert.deepEqual(buildDay(index, '2026-03-10').fields, {});
  assert.deepEqual(buildDay(index, '2026-03-11').fields, {
    weightKg: 79.4,
    weighInAt: ms('2026-03-11T00:30:00+01:00'),
  });
});

test('vo2max: the last sample of the day, rounded to 1 decimal', () => {
  const day = dayOf(
    [line('vo2', '2026-03-10 18:00:00 +0100', 46.78), line('vo2', '2026-03-10 08:00:00 +0100', 45.12)],
    '2026-03-10',
  );
  assert.equal(day.fields.vo2max, 46.8);
  assert.equal(day.fields.vo2maxAt, ms('2026-03-10T18:00:00+01:00'));
});

// ─── Golden check ────────────────────────────────────────────────────

test('golden: entries are validated', () => {
  assert.throws(() => readGoldenEntries({}), /array/);
  assert.throws(() => readGoldenEntries([{ date: '2026-02-30', field: 'steps', expected: 1, tolerance: 0 }]), /entry 0/);
  assert.throws(() => readGoldenEntries([{ date: '2026-03-10', field: 'mood', expected: 1, tolerance: 0 }]), /entry 0/);
  assert.throws(() => readGoldenEntries([{ date: '2026-03-10', field: 'steps', expected: '1', tolerance: 0 }]), /entry 0/);
  assert.throws(() => readGoldenEntries([{ date: '2026-03-10', field: 'steps', expected: 1, tolerance: -1 }]), /entry 0/);
  assert.throws(() => readGoldenEntries([{ date: '2026-03-10', field: 'weighInAt', expected: '2026-03-10T08:00', tolerance: 0 }]), /entry 0/);
});

test('golden: a value within its tolerance passes, outside fails, missing fails', () => {
  const entries = readGoldenEntries([
    { date: '2026-03-10', field: 'steps', expected: 1000, tolerance: 0 },
    { date: '2026-03-10', field: 'hrvMs', expected: 41.2, tolerance: 0.5 },
    { date: '2026-03-10', field: 'respRate', expected: 13, tolerance: 0.2 },
    { date: '2026-03-10', field: 'weightKg', expected: 80, tolerance: 0 },
    { date: '2026-03-11', field: 'steps', expected: 1, tolerance: 0 },
  ]);
  const days = new Map([['2026-03-10', { steps: 1000, hrvMs: 41, respRate: 12.5 }]]);
  assert.deepEqual(
    checkGolden(entries, days).map(r => r.pass),
    [true, true, false, false, false],
  );
});

test('golden: a time field takes an ISO time with an offset and a tolerance in seconds', () => {
  const entries = readGoldenEntries([
    { date: '2026-03-10', field: 'weighInAt', expected: '2026-03-10T08:00:00+01:00', tolerance: 0 },
    { date: '2026-03-10', field: 'sleepEndAt', expected: '2026-03-10T07:00:00+01:00', tolerance: 60 },
    { date: '2026-03-10', field: 'sleepStartAt', expected: '2026-03-09T23:00:00+01:00', tolerance: 60 },
  ]);
  const days = new Map([
    [
      '2026-03-10',
      {
        weighInAt: ms('2026-03-10T07:00:00Z'),
        sleepEndAt: ms('2026-03-10T07:01:00+01:00'),
        sleepStartAt: ms('2026-03-09T23:01:01+01:00'),
      },
    ],
  ]);
  assert.deepEqual(
    checkGolden(entries, days).map(r => r.pass),
    [true, true, false],
  );
});

// ─── Reviewed day files ──────────────────────────────────────────────

const dayFile = (date: string, body: Record<string, unknown> = { date, steps: 4321 }): DayFile => ({
  name: `${date}.json`,
  text: JSON.stringify(body),
});

function refused(files: DayFile[], expectDays: number, pattern: RegExp) {
  const result = checkDayFiles(files, expectDays);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some(e => pattern.test(e)), JSON.stringify(result));
}

test('day files: a valid folder passes and the days come back in date order', () => {
  const result = checkDayFiles(
    [dayFile('2026-03-11'), dayFile('2026-03-10', { date: '2026-03-10', steps: 100, hrvMs: 41.5, sleepStartAt: 1773100800000 })],
    2,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.days, [
    { date: '2026-03-10', fields: { steps: 100, hrvMs: 41.5, sleepStartAt: 1773100800000 } },
    { date: '2026-03-11', fields: { steps: 4321 } },
  ]);
});

test('day files: a count other than --expect-days refuses', () => {
  refused([dayFile('2026-03-10'), dayFile('2026-03-11')], 3, /expected 3/);
  refused([dayFile('2026-03-10')], 0, /expect-days/);
});

test('day files: a file name that is not its date refuses', () => {
  refused([{ name: '2026-03-10.json', text: JSON.stringify({ date: '2026-03-11', steps: 1 }) }], 1, /not its date/);
  refused([{ name: '2026-03-10.json', text: JSON.stringify({ steps: 1 }) }], 1, /not its date/);
  refused([{ name: 'notes.txt', text: 'x' }], 1, /YYYY-MM-DD\.json/);
});

test('day files: a date outside the backfill range or not a real day refuses', () => {
  for (const date of ['2025-11-15', '2026-11-14', '2026-11-16', '2026-02-30']) refused([dayFile(date)], 1, /outside/);
});

test('day files: an unknown field refuses', () => {
  refused([dayFile('2026-03-10', { date: '2026-03-10', steps: 1, mood: 3 })], 1, /unknown field mood/);
  refused([dayFile('2026-03-10', { date: '2026-03-10', steps: 1, updatedAt: 5 })], 1, /unknown field updatedAt/);
});

test('day files: a value that is not a finite number refuses', () => {
  refused([dayFile('2026-03-10', { date: '2026-03-10', steps: '12' })], 1, /steps is not a finite number/);
  refused([dayFile('2026-03-10', { date: '2026-03-10', hrvMs: null })], 1, /hrvMs is not a finite number/);
  refused([dayFile('2026-03-10', { date: '2026-03-10', sleepEndAt: '2026-03-10T07:00:00+01:00' })], 1, /sleepEndAt/);
});

test('day files: invalid JSON, a JSON array or a folder entry refuses', () => {
  refused([{ name: '2026-03-10.json', text: '{ "date": ' }], 1, /not valid JSON/);
  refused([{ name: '2026-03-10.json', text: '[]' }], 1, /not a JSON object/);
  refused([{ name: '2026-03-10.json', text: null }], 1, /not a file/);
});

// ─── Write ───────────────────────────────────────────────────────────

const STAMP = { serverTimestamp: true };
const WRITE_DAYS: DayDoc[] = [
  { date: '2026-03-11', fields: { steps: 200 } },
  { date: '2026-03-10', fields: { steps: 100, hrvMs: 41.5 } },
  { date: '2026-03-12', fields: { steps: 300 } },
];

/** A db whose refs can only be created; any set, update, delete or batch call is counted as forbidden. */
function fakeDb(errors: Record<string, unknown> = {}) {
  const calls: { path: string; data: Record<string, unknown> }[] = [];
  let forbidden = 0;
  let opened = 0;
  const no = () => {
    forbidden++;
  };
  const db = {
    batch: no,
    doc: (path: string) => ({
      set: no,
      update: no,
      delete: no,
      create: async (data: Record<string, unknown>) => {
        calls.push({ path, data });
        const date = path.split('/').pop() ?? '';
        if (date in errors) throw errors[date];
      },
    }),
  };
  return {
    calls,
    forbidden: () => forbidden,
    opened: () => opened,
    db: () => {
      opened++;
      return db;
    },
  };
}

const writeDeps = (fake: ReturnType<typeof fakeDb>, over: Partial<BackfillWriteDeps> = {}): BackfillWriteDeps => ({
  env: { MCP_OWNER_UID: ' owner-1 ' },
  isAdminConfigured: () => true,
  db: fake.db,
  serverTimestamp: () => STAMP,
  ...over,
});

const grpcError = (code: number) => Object.assign(new Error(`${code} SOMETHING: users/owner-1/health/x`), { code });

test('owner uid: the same checks as the ingest handler (trimmed, not empty, one path segment)', () => {
  assert.equal(readOwnerUid({ MCP_OWNER_UID: ' owner-1 ' }), 'owner-1');
  for (const bad of [undefined, '', '   ', 'a/b']) assert.equal(readOwnerUid({ MCP_OWNER_UID: bad }), null, String(bad));
});

test('write: one create per day in date order with date, fields and updatedAt; nothing else is called', async () => {
  const fake = fakeDb();
  const result = await writeBackfillDays(writeDeps(fake), WRITE_DAYS);
  assert.deepEqual(result, { status: 'done', written: ['2026-03-10', '2026-03-11', '2026-03-12'], skipped: [] });
  assert.deepEqual(fake.calls, [
    { path: 'users/owner-1/health/2026-03-10', data: { date: '2026-03-10', steps: 100, hrvMs: 41.5, updatedAt: STAMP } },
    { path: 'users/owner-1/health/2026-03-11', data: { date: '2026-03-11', steps: 200, updatedAt: STAMP } },
    { path: 'users/owner-1/health/2026-03-12', data: { date: '2026-03-12', steps: 300, updatedAt: STAMP } },
  ]);
  assert.equal(fake.forbidden(), 0);
});

test('write: an existing doc is skipped and listed, and the run goes on', async () => {
  const fake = fakeDb({ '2026-03-11': grpcError(6) });
  const result = await writeBackfillDays(writeDeps(fake), WRITE_DAYS);
  assert.deepEqual(result, { status: 'done', written: ['2026-03-10', '2026-03-12'], skipped: ['2026-03-11'] });
  assert.equal(fake.forbidden(), 0);
});

test('write: any other error stops the run with the days written so far and only the error code', async () => {
  const fake = fakeDb({ '2026-03-11': grpcError(7) });
  const result = await writeBackfillDays(writeDeps(fake), WRITE_DAYS);
  assert.deepEqual(result, { status: 'stopped', written: ['2026-03-10'], skipped: [], failed: { date: '2026-03-11', code: '7' } });
  assert.equal(fake.calls.length, 2, 'the day after the error is never tried');
  assert.ok(!JSON.stringify(result).includes('owner-1'), 'the error message (with the doc path) is never returned');
});

test('write: a missing or bad uid refuses before the db is opened', async () => {
  for (const uid of [undefined, '', 'a/b']) {
    const fake = fakeDb();
    const result = await writeBackfillDays(writeDeps(fake, { env: { MCP_OWNER_UID: uid } }), WRITE_DAYS);
    assert.deepEqual(result, { status: 'refused', reason: 'owner_config' });
    assert.equal(fake.opened(), 0);
  }
});

test('write: an unconfigured Admin SDK refuses before the db is opened', async () => {
  const fake = fakeDb();
  const result = await writeBackfillDays(writeDeps(fake, { isAdminConfigured: () => false }), WRITE_DAYS);
  assert.deepEqual(result, { status: 'refused', reason: 'admin_config' });
  assert.equal(fake.opened(), 0);
});

test('write: a day outside the range, an unknown field or a non-number refuses before any create', async () => {
  const bad: DayDoc[][] = [
    [...WRITE_DAYS, { date: '2026-11-14', fields: { steps: 1 } }],
    [{ date: '2026-03-10', fields: { mood: 1 } }],
    [{ date: '2026-03-10', fields: { steps: Number.NaN } }],
  ];
  for (const days of bad) {
    const fake = fakeDb();
    const result = await writeBackfillDays(writeDeps(fake), days);
    assert.deepEqual(result, { status: 'refused', reason: 'bad_day' });
    assert.equal(fake.opened(), 0);
  }
});
