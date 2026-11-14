import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCHEDULE_ITEMS, SCHEDULE_DAYS_AHEAD, readScheduleItems, scheduleWindow } from './schedule';

test('scheduleWindow: Monday of the ISO week of today to today + 28', () => {
  assert.equal(SCHEDULE_DAYS_AHEAD, 28);
  assert.equal(MAX_SCHEDULE_ITEMS, 3);
  // A Saturday.
  assert.deepEqual(scheduleWindow('2026-11-14'), { from: '2026-11-09', to: '2026-12-12' });
  // A Monday: the window starts on that day.
  assert.deepEqual(scheduleWindow('2026-11-09'), { from: '2026-11-09', to: '2026-12-07' });
  // A Sunday: the window still starts six days back.
  assert.deepEqual(scheduleWindow('2026-11-15'), { from: '2026-11-09', to: '2026-12-13' });
  // The ISO week that spans the new year.
  assert.deepEqual(scheduleWindow('2027-01-01'), { from: '2026-12-28', to: '2027-01-29' });
});

test('readScheduleItems: known items with their own keys only; anything unreadable is left out', () => {
  assert.deepEqual(
    readScheduleItems([
      { kind: 'routine', routineId: 'push-day', routineName: 'Push Day', extra: 'dropped' },
      { kind: 'activity', activity: ' boxing ', routineId: 'dropped' },
      { kind: 'rest', activity: 'dropped' },
      { kind: 'routine', routineId: 'legs' },
    ]),
    [
      { kind: 'routine', routineId: 'push-day', routineName: 'Push Day' },
      { kind: 'activity', activity: 'boxing' },
      { kind: 'rest' },
      { kind: 'routine', routineId: 'legs', routineName: '' },
    ],
  );
  assert.deepEqual(
    readScheduleItems([
      null,
      'rest',
      7,
      {},
      { kind: 'gym' },
      { kind: 'routine' },
      { kind: 'routine', routineId: 9 },
      { kind: 'activity' },
      { kind: 'activity', activity: '   ' },
    ]),
    [],
  );
  for (const notAList of [undefined, null, 'rest', { kind: 'rest' }, 3]) {
    assert.deepEqual(readScheduleItems(notAList), []);
  }
});
