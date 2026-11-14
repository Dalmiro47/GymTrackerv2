import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, berlinYmd, isRealYmd, isoWeekOf, weekRange } from './week';

const weekAt = (iso: string) => isoWeekOf(berlinYmd(new Date(iso)));

test('berlinYmd: Sunday 23:30 and Monday 00:30 Berlin fall on different days and weeks', () => {
  // Winter (CET, UTC+1).
  assert.equal(berlinYmd(new Date('2026-03-15T22:30:00Z')), '2026-03-15'); // Sunday 23:30
  assert.equal(berlinYmd(new Date('2026-03-15T23:30:00Z')), '2026-03-16'); // Monday 00:30
  assert.equal(weekAt('2026-03-15T22:30:00Z'), '2026-W11');
  assert.equal(weekAt('2026-03-15T23:30:00Z'), '2026-W12');
  // Summer (CEST, UTC+2).
  assert.equal(berlinYmd(new Date('2026-07-05T21:30:00Z')), '2026-07-05'); // Sunday 23:30
  assert.equal(berlinYmd(new Date('2026-07-05T22:30:00Z')), '2026-07-06'); // Monday 00:30
  assert.equal(weekAt('2026-07-05T21:30:00Z'), '2026-W27');
  assert.equal(weekAt('2026-07-05T22:30:00Z'), '2026-W28');
});

test('berlinYmd: the last Sunday of October (clocks go back) stays one day', () => {
  assert.equal(berlinYmd(new Date('2026-10-24T22:30:00Z')), '2026-10-25'); // 00:30 CEST
  assert.equal(berlinYmd(new Date('2026-10-25T00:30:00Z')), '2026-10-25'); // 02:30 CEST, before the change
  assert.equal(berlinYmd(new Date('2026-10-25T01:30:00Z')), '2026-10-25'); // 02:30 CET, after the change
  // 23:30 CET: a fixed UTC+2 offset would already say Monday here.
  assert.equal(berlinYmd(new Date('2026-10-25T22:30:00Z')), '2026-10-25');
  assert.equal(weekAt('2026-10-25T22:30:00Z'), '2026-W43');
  assert.equal(berlinYmd(new Date('2026-10-25T23:30:00Z')), '2026-10-26'); // Monday 00:30 CET
  assert.equal(weekAt('2026-10-25T23:30:00Z'), '2026-W44');
});

test('berlinYmd: the last Sunday of March (clocks go forward)', () => {
  assert.equal(berlinYmd(new Date('2026-03-29T00:59:00Z')), '2026-03-29'); // 01:59 CET
  assert.equal(berlinYmd(new Date('2026-03-29T21:59:00Z')), '2026-03-29'); // 23:59 CEST
  assert.equal(berlinYmd(new Date('2026-03-29T22:00:00Z')), '2026-03-30'); // Monday 00:00 CEST
});

test('isoWeekOf: year boundaries use the ISO year', () => {
  assert.equal(isoWeekOf('2025-12-28'), '2025-W52'); // Sunday
  assert.equal(isoWeekOf('2025-12-29'), '2026-W01'); // Monday
  assert.equal(isoWeekOf('2026-01-01'), '2026-W01');
  assert.equal(isoWeekOf('2026-12-31'), '2026-W53');
  assert.equal(isoWeekOf('2027-01-03'), '2026-W53'); // Sunday
  assert.equal(isoWeekOf('2027-01-04'), '2027-W01');
  assert.equal(isoWeekOf('2026-11-13'), '2026-W46');
});

test('weekRange: Monday to Sunday, seven days', () => {
  assert.deepEqual(weekRange('2026-W46'), {
    week: '2026-W46',
    monday: '2026-11-09',
    sunday: '2026-11-15',
    days: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'],
  });
  assert.equal(weekRange('2026-W01')?.monday, '2025-12-29');
  assert.equal(weekRange('2026-W53')?.sunday, '2027-01-03');
  // The week of the October clock change is still seven calendar days.
  assert.deepEqual([weekRange('2026-W43')?.monday, weekRange('2026-W43')?.sunday], ['2026-10-19', '2026-10-25']);
});

test('weekRange: refuses ids that are not a real ISO week', () => {
  for (const bad of ['2025-W53', '2026-W54', '2026-W00', '2026-W1', '2026-46', '2026-w46', '0026-W10', 'W46', '']) {
    assert.equal(weekRange(bad), null, `should be refused: "${bad}"`);
  }
});

test('addDays: across a month, a year, a leap day and the October clock change', () => {
  assert.equal(addDays('2026-11-14', 28), '2026-12-12');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-14', 0), '2026-11-14');
});

test('isRealYmd: a real calendar day only', () => {
  for (const good of ['2026-11-16', '2028-02-29', '2026-12-31']) {
    assert.equal(isRealYmd(good), true, good);
  }
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026-11-16T00:00', '0026-11-16', 'today', '', '..', 'a/b', 20261116, null, undefined]) {
    assert.equal(isRealYmd(bad), false, `should be refused: ${String(bad)}`);
  }
});
