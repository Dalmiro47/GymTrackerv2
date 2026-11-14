// server-only: src/lib/mcp/schedule.ts
// Pure helpers for the training schedule: what the owner intends to do on a
// calendar day, stored at users/{uid}/schedule/{YYYY-MM-DD}. It is not a workout
// log: a log's "planned" status means exercises saved but not lifted, and the
// schedule never uses that word.
import { addDays, isoWeekOf, weekRange } from './week';

export const MAX_SCHEDULE_ITEMS = 3;
/** The last day that can be scheduled, counted from today. */
export const SCHEDULE_DAYS_AHEAD = 28;
export const MAX_ACTIVITY_LENGTH = 40;

export type ScheduleItem =
  /** `routineName` is the routine's name when the day was scheduled; a later rename does not reach it. */
  | { kind: 'routine'; routineId: string; routineName: string }
  | { kind: 'activity'; activity: string }
  | { kind: 'rest' };

/** The days that can be scheduled: Monday of the ISO week of `today` to `today` + 28, both included. */
export function scheduleWindow(today: string): { from: string; to: string } {
  const monday = weekRange(isoWeekOf(today))?.monday ?? today;
  return { from: monday, to: addDays(today, SCHEDULE_DAYS_AHEAD) };
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The items of a stored schedule document. An item this code cannot read is left out. */
export function readScheduleItems(value: unknown): ScheduleItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ScheduleItem[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const item = raw as Record<string, unknown>;
    if (item.kind === 'rest') return [{ kind: 'rest' }];
    if (item.kind === 'activity') {
      const activity = text(item.activity);
      return activity ? [{ kind: 'activity', activity }] : [];
    }
    if (item.kind === 'routine') {
      const routineId = text(item.routineId);
      return routineId ? [{ kind: 'routine', routineId, routineName: text(item.routineName) ?? '' }] : [];
    }
    return [];
  });
}
