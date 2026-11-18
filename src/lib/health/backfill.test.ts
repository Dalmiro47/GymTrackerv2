import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDay,
  checkDayFiles,
  checkGolden,
  checkImportRange,
  compareExerciseMin,
  exportDayOf,
  finishSleepStages,
  indexByBerlinDay,
  isInRange,
  parseActivitySummaryLine,
  parseRecordLine,
  planDay,
  planImportDays,
  rangeDates,
  readGoldenEntries,
  readOwnerUid,
  writeImportDays,
  type DayDoc,
  type DayFile,
  type HealthRecord,
  type ImportPlanDeps,
  type ImportRange,
  type ImportWriteDeps,
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
  exercise: 'HKQuantityTypeIdentifierAppleExerciseTime',
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

// ─── Range ───────────────────────────────────────────────────────────

const rangeErrors = (from: unknown, to: unknown, today: string, exportDay?: string) => {
  const result = checkImportRange(from, to, today, exportDay);
  return result.ok ? [] : result.errors;
};

test('range: from..to before Berlin today and before the export day passes', () => {
  assert.deepEqual(checkImportRange('2026-02-13', '2026-11-17', '2026-11-18', '2026-11-18'), {
    ok: true,
    range: { from: '2026-02-13', to: '2026-11-17' },
  });
  // Without an export day (verify, plan, write), only today bounds `to`.
  assert.equal(checkImportRange('2026-11-10', '2026-11-17', '2026-11-18').ok, true);
  // One day is a valid range.
  assert.equal(checkImportRange('2026-03-10', '2026-03-10', '2026-11-18').ok, true);
});

test('range: --to on or after Berlin today is refused (today belongs to the Shortcut)', () => {
  assert.match(rangeErrors('2026-11-01', '2026-11-18', '2026-11-18').join('|'), /before Berlin today/);
  assert.match(rangeErrors('2026-11-01', '2026-11-19', '2026-11-18').join('|'), /before Berlin today/);
});

test('range: --to on or after the export day is refused, and every failing rule is listed', () => {
  assert.match(rangeErrors('2026-11-01', '2026-11-15', '2026-11-18', '2026-11-15').join('|'), /before the export day/);
  const both = rangeErrors('2026-11-01', '2026-11-18', '2026-11-18', '2026-11-18');
  assert.equal(both.length, 2);
});

test('range: from after to, unreal days and a span over 366 days are refused; 366 days pass', () => {
  assert.match(rangeErrors('2026-03-11', '2026-03-10', '2026-11-18').join('|'), /after/);
  for (const bad of ['2026-02-30', '2026-3-10', '', null, 20260310]) {
    assert.ok(rangeErrors(bad, '2026-03-10', '2026-11-18').length > 0, `from ${String(bad)}`);
    assert.ok(rangeErrors('2026-03-01', bad, '2026-11-18').length > 0, `to ${String(bad)}`);
  }
  assert.match(rangeErrors('2025-01-01', '2026-01-02', '2026-11-18').join('|'), /367 days; the most is 366/);
  assert.equal(checkImportRange('2024-01-01', '2024-12-31', '2026-11-18').ok, true);
});

test('range: isInRange and rangeDates follow from..to, both included', () => {
  const range: ImportRange = { from: '2026-02-27', to: '2026-03-02' };
  assert.deepEqual(rangeDates(range), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(isInRange('2026-02-27', range), true);
  assert.equal(isInRange('2026-03-02', range), true);
  for (const bad of ['2026-02-26', '2026-03-03', '2026-02-30', '', null]) assert.equal(isInRange(bad, range), false, String(bad));
});

test('range: exportDayOf gives the Berlin day of the ExportDate value', () => {
  assert.equal(exportDayOf('2026-11-18 18:42:00 +0100'), '2026-11-18');
  assert.equal(exportDayOf('2026-11-17 23:30:00 +0000'), '2026-11-18');
  assert.equal(exportDayOf('2026-11-18T18:42:00+01:00'), null);
  assert.equal(exportDayOf(''), null);
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

// ─── Sleep stages ────────────────────────────────────────────────────

const stagesOf = (fields: Record<string, unknown>) => ({
  core: fields.sleepCoreMin,
  deep: fields.sleepDeepMin,
  rem: fields.sleepRemMin,
  awake: fields.sleepAwakeMin,
});

test('stages: minutes per stage; Awake counts only between the first asleep start and the last asleep end', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 22:50:00 +0100', AWAKE, { end: '2026-03-09 22:55:00 +0100' }),
      line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 01:00:00 +0100' }),
      line('sleep', '2026-03-10 01:00:00 +0100', asleep('Deep'), { end: '2026-03-10 01:45:00 +0100' }),
      line('sleep', '2026-03-10 01:45:00 +0100', AWAKE, { end: '2026-03-10 01:55:00 +0100' }),
      line('sleep', '2026-03-10 01:55:00 +0100', asleep('REM'), { end: '2026-03-10 02:25:00 +0100' }),
      line('sleep', '2026-03-10 02:25:00 +0100', asleep('Unspecified'), { end: '2026-03-10 02:35:00 +0100' }),
      line('sleep', '2026-03-10 02:35:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100' }),
      line('sleep', '2026-03-10 06:00:00 +0100', AWAKE, { end: '2026-03-10 06:20:00 +0100' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, 410, 'Unspecified counts in sleepMin');
  assert.deepEqual(stagesOf(day.fields), { core: 325, deep: 45, rem: 30, awake: 10 });
});

test('stages: Awake from another source never counts', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100' }),
      line('sleep', '2026-03-10 01:00:00 +0100', AWAKE, { end: '2026-03-10 01:30:00 +0100', source: 'Other Source' }),
    ],
    '2026-03-10',
  );
  assert.deepEqual(stagesOf(day.fields), { core: 420, deep: 0, rem: 0, awake: 0 });
});

test('stages: the same 18:00 and 12:00 bounds as sleepMin', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 17:59:00 +0100', asleep('Core'), { end: '2026-03-09 18:20:00 +0100' }),
      line('sleep', '2026-03-09 18:00:00 +0100', asleep('Deep'), { end: '2026-03-09 18:30:00 +0100' }),
      line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100' }),
      line('sleep', '2026-03-10 11:59:00 +0100', asleep('REM'), { end: '2026-03-10 12:20:00 +0100' }),
      line('sleep', '2026-03-10 12:00:00 +0100', asleep('Core'), { end: '2026-03-10 12:40:00 +0100' }),
    ],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, 471);
  assert.deepEqual(stagesOf(day.fields), { core: 420, deep: 30, rem: 21, awake: 0 });
});

test('stages: the bounds hold on the day the clocks go forward (23 h)', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-28 17:59:00 +0100', asleep('REM'), { end: '2026-03-28 18:10:00 +0100' }),
      line('sleep', '2026-03-28 23:00:00 +0100', asleep('Core'), { end: '2026-03-29 07:00:00 +0200' }),
      line('sleep', '2026-03-29 11:59:00 +0200', asleep('Deep'), { end: '2026-03-29 12:09:00 +0200' }),
      line('sleep', '2026-03-29 12:00:00 +0200', asleep('REM'), { end: '2026-03-29 12:30:00 +0200' }),
    ],
    '2026-03-29',
  );
  assert.deepEqual(stagesOf(day.fields), { core: 420, deep: 10, rem: 0, awake: 0 });
});

test('stages: the bounds hold on the day the clocks go back (25 h)', () => {
  const day = dayOf(
    [
      line('sleep', '2026-10-24 17:59:59 +0200', asleep('REM'), { end: '2026-10-24 18:05:00 +0200' }),
      line('sleep', '2026-10-24 18:00:00 +0200', asleep('Core'), { end: '2026-10-24 18:30:00 +0200' }),
      line('sleep', '2026-10-25 01:00:00 +0200', asleep('Deep'), { end: '2026-10-25 06:00:00 +0100' }),
    ],
    '2026-10-25',
  );
  assert.deepEqual(stagesOf(day.fields), { core: 30, deep: 360, rem: 0, awake: 0 });
});

test('stages: asleep segments from two sources give no stage fields', () => {
  const day = dayOf(
    [
      line('sleep', '2026-03-09 23:00:00 +0100', asleep('Core'), { end: '2026-03-10 06:00:00 +0100', source: 'Source A' }),
      line('sleep', '2026-03-09 23:30:00 +0100', asleep('Deep'), { end: '2026-03-10 00:30:00 +0100', source: 'Source B' }),
    ],
    '2026-03-10',
  );
  assert.deepEqual(stagesOf(day.fields), { core: undefined, deep: undefined, rem: undefined, awake: undefined });
});

test('stages: a night with only Unspecified segments gets sleepMin and no stage group', () => {
  const day = dayOf(
    [line('sleep', '2026-03-09 23:00:00 +0100', asleep('Unspecified'), { end: '2026-03-10 06:00:00 +0100' })],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, 420);
  assert.deepEqual(stagesOf(day.fields), { core: undefined, deep: undefined, rem: undefined, awake: undefined });
});

test('stages: finishSleepStages rounds, checks 0..1440 and the sum against sleepMin', () => {
  assert.deepEqual(finishSleepStages({ core: 300.4, deep: 59.6, rem: 0, awake: 12.5 }, 361), {
    fields: { sleepCoreMin: 300, sleepDeepMin: 60, sleepRemMin: 0, sleepAwakeMin: 13 },
    dropped: [],
  });
  // Core + Deep + REM may exceed sleepMin by 2 at most.
  assert.ok(finishSleepStages({ core: 300, deep: 60, rem: 2, awake: 0 }, 360).fields);
  assert.deepEqual(finishSleepStages({ core: 300, deep: 60, rem: 3, awake: 0 }, 360), {
    dropped: [{ field: 'import.sleepStages', reason: 'stage_sum_mismatch' }],
  });
  assert.deepEqual(finishSleepStages({ core: 1500, deep: 0, rem: 0, awake: 0 }, 1440), {
    dropped: [{ field: 'import.sleepCoreMin', reason: 'out_of_range' }],
  });
  assert.deepEqual(finishSleepStages({ core: 300, deep: 60, rem: 0, awake: 0 }, undefined), {
    dropped: [{ field: 'import.sleepStages', reason: 'no_sleep_min' }],
  });
});

test('stages: a night over 1440 minutes drops sleepMin, so the stage group is dropped too', () => {
  const day = dayOf(
    [line('sleep', '2026-03-09 18:00:00 +0100', asleep('Core'), { end: '2026-03-11 18:00:00 +0100' })],
    '2026-03-10',
  );
  assert.equal(day.fields.sleepMin, undefined);
  assert.equal(day.fields.sleepCoreMin, undefined);
  assert.ok(day.dropped.some(d => d.field === 'import.sleepStages' && d.reason === 'no_sleep_min'));
});

// ─── Exercise minutes ────────────────────────────────────────────────

test('exerciseMin: the sum of Watch samples on the Berlin day of their start; other devices never count', () => {
  const index = indexByBerlinDay(
    records([
      line('exercise', '2026-03-10 09:00:00 +0100', 1, { device: 'watch' }),
      line('exercise', '2026-03-10 09:01:00 +0100', 1, { device: 'watch' }),
      line('exercise', '2026-03-10 22:59:00 +0000', 1, { device: 'watch' }), // 23:59 Berlin, 03-10
      line('exercise', '2026-03-10 23:00:00 +0000', 1, { device: 'watch' }), // 00:00 Berlin, 03-11
      line('exercise', '2026-03-10 10:00:00 +0100', 30, { device: 'phone' }),
      line('exercise', '2026-03-10 11:00:00 +0100', 30, { device: 'other' }),
    ]),
  );
  const day = buildDay(index, '2026-03-10');
  assert.equal(day.fields.exerciseMin, 3);
  assert.equal(day.excluded.exerciseMin, 2);
  assert.equal(buildDay(index, '2026-03-11').fields.exerciseMin, 1);
});

test('exerciseMin: a day with no Watch sample has no exerciseMin; over 1440 is dropped', () => {
  assert.equal(dayOf([line('exercise', '2026-03-10 09:00:00 +0100', 5, { device: 'phone' })], '2026-03-10').fields.exerciseMin, undefined);
  const over = dayOf([line('exercise', '2026-03-10 09:00:00 +0100', 1441, { device: 'watch' })], '2026-03-10');
  assert.equal(over.fields.exerciseMin, undefined);
  assert.deepEqual(over.dropped, [{ field: 'import.exerciseMin', reason: 'out_of_range' }]);
});

test('parse: an AppleExerciseTime line is the exerciseMin kind', () => {
  const record = parseRecordLine(line('exercise', '2026-03-10 09:00:00 +0100', 1, { device: 'watch' }));
  assert.equal(record !== null && record !== 'unreadable' && record.kind, 'exerciseMin');
});

test('activity summary: dateComponents and appleExerciseTime are read; anything else is null', () => {
  const summary =
    '  <ActivitySummary dateComponents="2026-03-10" activeEnergyBurned="1" activeEnergyBurnedGoal="2" ' +
    'activeEnergyBurnedUnit="kcal" appleMoveTime="0" appleMoveTimeGoal="0" appleExerciseTime="45" appleExerciseTimeGoal="30" ' +
    'appleStandHours="1" appleStandHoursGoal="12"/>';
  assert.deepEqual(parseActivitySummaryLine(summary), { date: '2026-03-10', exerciseMin: 45 });
  assert.equal(parseActivitySummaryLine(summary.replace('2026-03-10', '2026-02-30')), null);
  assert.equal(parseActivitySummaryLine(summary.replace(' appleExerciseTime="45"', '')), null);
  assert.equal(parseActivitySummaryLine(line('exercise', '2026-03-10 09:00:00 +0100', 1)), null);
});

test('activity summary: compareExerciseMin counts match and differ over the range; no sample counts as 0', () => {
  const built = new Map<string, Record<string, number>>([
    ['2026-03-10', { exerciseMin: 45 }],
    ['2026-03-11', { exerciseMin: 20 }],
    ['2026-03-12', {}],
    ['2026-03-13', { exerciseMin: 5 }],
    ['2026-04-01', { exerciseMin: 9 }],
  ]);
  const summaries = new Map([
    ['2026-03-10', 45],
    ['2026-03-11', 21],
    ['2026-03-12', 0],
    ['2026-04-01', 9],
  ]);
  assert.deepEqual(compareExerciseMin(built, summaries, ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']), {
    match: 2,
    differ: 1,
    noSummary: 1,
  });
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

const RANGE: ImportRange = { from: '2026-03-01', to: '2026-03-31' };

const dayFile = (date: string, body: Record<string, unknown> = { date, steps: 4321 }): DayFile => ({
  name: `${date}.json`,
  text: JSON.stringify(body),
});

function refused(files: DayFile[], expectDays: number, pattern: RegExp) {
  const result = checkDayFiles(files, expectDays, RANGE);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some(e => pattern.test(e)), JSON.stringify(result));
}

const STAGE_FIELDS = { sleepMin: 400, sleepCoreMin: 250, sleepDeepMin: 60, sleepRemMin: 90, sleepAwakeMin: 15 };

test('day files: a valid folder passes and the days come back in date order', () => {
  const result = checkDayFiles(
    [dayFile('2026-03-11'), dayFile('2026-03-10', { date: '2026-03-10', steps: 100, hrvMs: 41.5, sleepStartAt: 1773100800000 })],
    2,
    RANGE,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.days, [
    { date: '2026-03-10', fields: { steps: 100, hrvMs: 41.5, sleepStartAt: 1773100800000 } },
    { date: '2026-03-11', fields: { steps: 4321 } },
  ]);
});

test('day files: the new fields are accepted', () => {
  const result = checkDayFiles([dayFile('2026-03-10', { date: '2026-03-10', ...STAGE_FIELDS, exerciseMin: 35 })], 1, RANGE);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.days[0].fields, { ...STAGE_FIELDS, exerciseMin: 35 });
});

test('day files: the stage fields come all four or none, and only with sleepMin', () => {
  refused([dayFile('2026-03-10', { date: '2026-03-10', sleepMin: 400, sleepCoreMin: 250 })], 1, /sleep stage fields/);
  const { sleepMin, ...noSleepMin } = STAGE_FIELDS;
  assert.equal(sleepMin, 400);
  refused([dayFile('2026-03-10', { date: '2026-03-10', ...noSleepMin })], 1, /sleep stage fields/);
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

test('day files: a date outside --from..--to or not a real day refuses', () => {
  for (const date of ['2026-02-28', '2026-04-01', '2026-02-30']) refused([dayFile(date)], 1, /outside/);
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

// ─── Fill-only planner ───────────────────────────────────────────────

const BUILT: DayDoc = {
  date: '2026-03-10',
  fields: {
    steps: 9000,
    sleepMin: 410,
    sleepStartAt: 1,
    sleepEndAt: 2,
    weightKg: 80,
    weighInAt: 3,
    ...{ sleepCoreMin: 280, sleepDeepMin: 60, sleepRemMin: 70, sleepAwakeMin: 12 },
    exerciseMin: 30,
  },
};

test('plan: a missing doc is created with every built field', () => {
  assert.deepEqual(planDay(null, BUILT), { date: '2026-03-10', outcome: 'create', fields: BUILT.fields, skipped: [] });
});

test('plan: an existing doc gets only the groups it lacks; a present field is never written', () => {
  const plan = planDay({ date: '2026-03-10', steps: 7000, sleepMin: 410, sleepStartAt: 5, sleepEndAt: 6, weightKg: 81, weighInAt: 7 }, BUILT);
  assert.deepEqual(plan, {
    date: '2026-03-10',
    outcome: 'fill',
    fields: { sleepCoreMin: 280, sleepDeepMin: 60, sleepRemMin: 70, sleepAwakeMin: 12, exerciseMin: 30 },
    skipped: [],
  });
});

test('plan: a key that is present with null or a string counts as present', () => {
  const plan = planDay({ steps: null, exerciseMin: 'x' }, { date: '2026-03-10', fields: { steps: 1, exerciseMin: 2 } });
  assert.deepEqual(plan, { date: '2026-03-10', outcome: 'unchanged', fields: {}, skipped: [] });
});

test('plan: a group that is partly present is skipped whole and reported', () => {
  const plan = planDay({ weightKg: 81, sleepStartAt: 5 }, { date: '2026-03-10', fields: { weightKg: 80, weighInAt: 3, sleepStartAt: 1, sleepEndAt: 2, steps: 1 } });
  assert.deepEqual(plan, {
    date: '2026-03-10',
    outcome: 'fill',
    fields: { steps: 1 },
    skipped: [
      { group: 'sleepWindow', reason: 'partly_present' },
      { group: 'weighIn', reason: 'partly_present' },
    ],
  });
});

test('plan: a group whose built fields are all present is neither filled nor reported', () => {
  // A weigh-in without body fat: the doc has the same two fields the export gives.
  const plan = planDay({ weightKg: 81, weighInAt: 7 }, { date: '2026-03-10', fields: { weightKg: 80, weighInAt: 3 } });
  assert.deepEqual(plan, { date: '2026-03-10', outcome: 'unchanged', fields: {}, skipped: [] });
});

test('plan: sleep_mismatch skips only the stage group when the stored sleepMin differs by more than 2', () => {
  const plan = planDay({ sleepMin: 407, steps: 1 }, BUILT);
  assert.deepEqual(plan.skipped, [{ group: 'sleepStages', reason: 'sleep_mismatch' }]);
  assert.equal(plan.outcome, 'fill');
  assert.deepEqual(Object.keys(plan.fields).sort(), ['exerciseMin', 'sleepEndAt', 'sleepStartAt', 'weighInAt', 'weightKg']);
});

test('plan: a stored sleepMin within 2 minutes fills the stages; no stored sleepMin fills sleepMin and the stages', () => {
  for (const stored of [408, 412]) {
    const plan = planDay({ sleepMin: stored }, BUILT);
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.fields.sleepDeepMin, 60);
    assert.equal(plan.fields.sleepMin, undefined);
  }
  const plan = planDay({ steps: 1 }, BUILT);
  assert.equal(plan.fields.sleepMin, 410);
  assert.equal(plan.fields.sleepCoreMin, 280);
});

test('plan: a stored sleepMin that is not a number is a sleep_mismatch', () => {
  const plan = planDay({ sleepMin: 'x' }, BUILT);
  assert.deepEqual(plan.skipped, [{ group: 'sleepStages', reason: 'sleep_mismatch' }]);
  assert.equal(plan.fields.sleepCoreMin, undefined);
});

test('plan: a doc that has every built field is unchanged', () => {
  const plan = planDay({ ...BUILT.fields, date: '2026-03-10', bodyFatPct: 17 }, BUILT);
  assert.deepEqual(plan, { date: '2026-03-10', outcome: 'unchanged', fields: {}, skipped: [] });
});

// ─── Plan and write ──────────────────────────────────────────────────

const STAMP = { serverTimestamp: true };
const NOW = () => new Date('2026-04-02T10:00:00Z');
const IMPORT_DAYS: DayDoc[] = [
  { date: '2026-03-11', fields: { steps: 200, exerciseMin: 20 } },
  { date: '2026-03-10', fields: { steps: 100, hrvMs: 41.5 } },
  { date: '2026-03-12', fields: { steps: 300 } },
];

/** Stored docs by date; every other call than the allowed ones is counted as forbidden. */
function fakeStore(stored: Record<string, Record<string, unknown>> = {}, errors: Record<string, unknown> = {}) {
  const writes: { op: 'create' | 'update'; path: string; data: Record<string, unknown> }[] = [];
  let forbidden = 0;
  let opened = 0;
  const no = () => {
    forbidden++;
  };
  const dateOf = (path: string) => path.split('/').pop() ?? '';
  const snapshot = (path: string) => {
    const date = dateOf(path);
    if (date in errors) throw errors[date];
    const data = stored[date];
    return { exists: data !== undefined, data: () => data };
  };
  const writeDb = {
    batch: no,
    doc: (path: string) => ({ path, set: no, update: no, delete: no, create: no, get: no }),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        get: async (ref: { path: string }) => snapshot(ref.path),
        create: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ op: 'create', path: ref.path, data }),
        update: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ op: 'update', path: ref.path, data }),
        set: no,
        delete: no,
      }),
  };
  const planDb = {
    batch: no,
    runTransaction: no,
    doc: (path: string) => ({ get: async () => snapshot(path), set: no, update: no, delete: no, create: no }),
  };
  return {
    writes,
    forbidden: () => forbidden,
    opened: () => opened,
    writeDb: () => {
      opened++;
      return writeDb as unknown as ReturnType<ImportWriteDeps['db']>;
    },
    planDb: () => {
      opened++;
      return planDb;
    },
  };
}

const writeDeps = (fake: ReturnType<typeof fakeStore>, over: Partial<ImportWriteDeps> = {}): ImportWriteDeps => ({
  env: { MCP_OWNER_UID: ' owner-1 ' },
  isAdminConfigured: () => true,
  db: fake.writeDb,
  serverTimestamp: () => STAMP,
  now: NOW,
  ...over,
});

const planDeps = (fake: ReturnType<typeof fakeStore>, over: Partial<ImportPlanDeps> = {}): ImportPlanDeps => ({
  env: { MCP_OWNER_UID: ' owner-1 ' },
  isAdminConfigured: () => true,
  db: fake.planDb,
  now: NOW,
  ...over,
});

const grpcError = (code: number) => Object.assign(new Error(`${code} SOMETHING: users/owner-1/health/x`), { code });

test('owner uid: the same checks as the ingest handler (trimmed, not empty, one path segment)', () => {
  assert.equal(readOwnerUid({ MCP_OWNER_UID: ' owner-1 ' }), 'owner-1');
  for (const bad of [undefined, '', '   ', 'a/b']) assert.equal(readOwnerUid({ MCP_OWNER_UID: bad }), null, String(bad));
});

test('write: in date order, a missing day is created, a day with gaps is filled, a full day gets no write', async () => {
  const fake = fakeStore({
    '2026-03-11': { date: '2026-03-11', steps: 250 },
    '2026-03-12': { date: '2026-03-12', steps: 333 },
  });
  const result = await writeImportDays(writeDeps(fake), RANGE, IMPORT_DAYS);
  assert.deepEqual(result, {
    status: 'done',
    plans: [
      { date: '2026-03-10', outcome: 'create', fields: { steps: 100, hrvMs: 41.5 }, skipped: [] },
      { date: '2026-03-11', outcome: 'fill', fields: { exerciseMin: 20 }, skipped: [] },
      { date: '2026-03-12', outcome: 'unchanged', fields: {}, skipped: [] },
    ],
  });
  assert.deepEqual(fake.writes, [
    { op: 'create', path: 'users/owner-1/health/2026-03-10', data: { date: '2026-03-10', steps: 100, hrvMs: 41.5, updatedAt: STAMP } },
    { op: 'update', path: 'users/owner-1/health/2026-03-11', data: { exerciseMin: 20, updatedAt: STAMP } },
  ]);
  assert.equal(fake.forbidden(), 0);
});

test('write: an error stops the run with the plans so far and only the error code', async () => {
  const fake = fakeStore({}, { '2026-03-11': grpcError(7) });
  const result = await writeImportDays(writeDeps(fake), RANGE, IMPORT_DAYS);
  assert.equal(result.status, 'stopped');
  assert.ok(result.status === 'stopped');
  assert.deepEqual(result.plans.map(p => p.date), ['2026-03-10']);
  assert.deepEqual(result.failed, { date: '2026-03-11', code: '7' });
  assert.equal(fake.writes.length, 1, 'the day after the error is never tried');
  assert.ok(!JSON.stringify(result).includes('owner-1'), 'the error message (with the doc path) is never returned');
});

test('write and plan: a missing or bad uid, or an unconfigured Admin SDK, refuses before the db is opened', async () => {
  for (const uid of [undefined, '', 'a/b']) {
    const fake = fakeStore();
    assert.deepEqual(await writeImportDays(writeDeps(fake, { env: { MCP_OWNER_UID: uid } }), RANGE, IMPORT_DAYS), {
      status: 'refused',
      reason: 'owner_config',
    });
    assert.deepEqual(await planImportDays(planDeps(fake, { env: { MCP_OWNER_UID: uid } }), RANGE, IMPORT_DAYS), {
      status: 'refused',
      reason: 'owner_config',
    });
    assert.equal(fake.opened(), 0);
  }
  const fake = fakeStore();
  assert.deepEqual(await writeImportDays(writeDeps(fake, { isAdminConfigured: () => false }), RANGE, IMPORT_DAYS), {
    status: 'refused',
    reason: 'admin_config',
  });
  assert.equal(fake.opened(), 0);
});

test('write and plan: a range that reaches Berlin today refuses before the db is opened', async () => {
  const fake = fakeStore();
  const today = () => new Date('2026-03-31T10:00:00Z');
  assert.deepEqual(await writeImportDays(writeDeps(fake, { now: today }), RANGE, IMPORT_DAYS), { status: 'refused', reason: 'bad_range' });
  assert.deepEqual(await planImportDays(planDeps(fake, { now: today }), RANGE, IMPORT_DAYS), { status: 'refused', reason: 'bad_range' });
  assert.equal(fake.opened(), 0);
});

test('write: a day outside the range, an unknown field or a non-number refuses before the db is opened', async () => {
  const bad: DayDoc[][] = [
    [...IMPORT_DAYS, { date: '2026-04-01', fields: { steps: 1 } }],
    [{ date: '2026-03-10', fields: { mood: 1 } }],
    [{ date: '2026-03-10', fields: { steps: Number.NaN } }],
  ];
  for (const days of bad) {
    const fake = fakeStore();
    assert.deepEqual(await writeImportDays(writeDeps(fake), RANGE, days), { status: 'refused', reason: 'bad_day' });
    assert.equal(fake.opened(), 0);
  }
});

test('plan: reads each doc with get only, gives the same outcomes as write and writes nothing', async () => {
  const stored = { '2026-03-11': { date: '2026-03-11', steps: 250 }, '2026-03-12': { date: '2026-03-12', steps: 333 } };
  const planFake = fakeStore(stored);
  const planned = await planImportDays(planDeps(planFake), RANGE, IMPORT_DAYS);
  const writeFake = fakeStore(stored);
  const written = await writeImportDays(writeDeps(writeFake), RANGE, IMPORT_DAYS);
  assert.deepEqual(planned, written);
  assert.deepEqual(planFake.writes, []);
  assert.equal(planFake.forbidden(), 0, 'only doc().get() is called');
});

test('plan: an error stops the run with only the error code', async () => {
  const fake = fakeStore({}, { '2026-03-11': grpcError(14) });
  const result = await planImportDays(planDeps(fake), RANGE, IMPORT_DAYS);
  assert.ok(result.status === 'stopped');
  assert.deepEqual(result.failed, { date: '2026-03-11', code: '14' });
  assert.ok(!JSON.stringify(result).includes('owner-1'));
});
