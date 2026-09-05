import { addWeeks, endOfWeek, format, isAfter, isBefore, isValid, parseISO, startOfWeek } from 'date-fns';

export type DeloadSummary = {
  /** Days explicitly logged with `isDeload: true`. */
  deloadDays: number;
  /** Complete Mon–Sun weeks inside the window with no log at all (implicit rest). */
  restWeeks: number;
  /** deloadDays + restWeeks — what the dashboard tile shows. */
  total: number;
};

/**
 * A full calendar week (Mon–Sun) with zero entries counts as a deload even if
 * it was not logged as one. Only weeks that both start after `start` and end
 * on/before `today` are considered, so the current partial week never counts.
 *
 * Rest weeks are counted only from the user's FIRST logged day onward. A week
 * before anyone ever trained is not recovery, it is prehistory — counting it
 * showed "12 deloads in the last 3 months" on a brand-new account with zero
 * sessions (fixed 2026-09).
 */
export function summarizeDeloads(
  logs: Array<{ date: string; isDeload?: boolean }>,
  start: Date,
  today: Date
): DeloadSummary {
  const deloadDays = logs.filter(l => l.isDeload === true).length;

  const loggedDates = new Set(logs.map(l => l.date));
  if (loggedDates.size === 0) return { deloadDays, restWeeks: 0, total: deloadDays };

  // ISO date strings sort lexicographically, so the first entry is the earliest.
  const firstLogged = parseISO([...loggedDates].sort()[0]);
  const scanFrom = isValid(firstLogged) && isAfter(firstLogged, start) ? firstLogged : start;

  let restWeeks = 0;
  // First complete week that starts on/after `scanFrom`.
  let weekStart = startOfWeek(scanFrom, { weekStartsOn: 1 });
  if (isBefore(weekStart, scanFrom)) weekStart = addWeeks(weekStart, 1);

  while (true) {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    if (isAfter(weekEnd, today)) break;
    let hasLog = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      if (loggedDates.has(format(d, 'yyyy-MM-dd'))) { hasLog = true; break; }
    }
    if (!hasLog) restWeeks++;
    weekStart = addWeeks(weekStart, 1);
  }

  return { deloadDays, restWeeks, total: deloadDays + restWeeks };
}

/** Distinct log dates within [weekStart, today] (inclusive). */
export function countSessionsInWeek(
  logs: Array<{ date: string }>,
  today: Date
): number {
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const seen = new Set<string>();
  for (const l of logs) {
    const d = parseISO(l.date);
    if (isNaN(d.getTime())) continue;
    if (!isBefore(d, weekStart) && !isAfter(d, today)) seen.add(l.date);
  }
  return seen.size;
}
