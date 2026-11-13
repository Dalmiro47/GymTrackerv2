// server-only: src/lib/mcp/week.ts
// Pure week helpers for the MCP read tools. A workout log is keyed by a plain
// calendar day (YYYY-MM-DD) with no timezone, so only "today" needs a zone: the
// owner's, Europe/Berlin. Intl does the zone work (DST included); the ISO week
// math runs on plain dates in UTC, where every day has 24 hours.

export const WEEK_TIME_ZONE = 'Europe/Berlin';

const DAY_MS = 86_400_000;
const WEEK_ID = /^(\d{4})-W(\d{2})$/;

const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: WEEK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day in Berlin at `instant`, as YYYY-MM-DD. */
export function berlinYmd(instant: Date): string {
  const parts = berlinParts.formatToParts(instant);
  const pick = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

const toUtcMs = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtcMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday = 0 ... Sunday = 6. */
const isoWeekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

/** The ISO week of a calendar day, as "YYYY-Www". The year is the ISO year, not always the calendar year. */
export function isoWeekOf(ymd: string): string {
  const ms = toUtcMs(ymd);
  // The Thursday of a week decides its ISO year.
  const thursday = ms + (3 - isoWeekday(ms)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export type WeekRange = {
  week: string;
  monday: string;
  sunday: string;
  /** The seven days, Monday first. */
  days: string[];
};

/** Monday to Sunday of an ISO week id, or null when the id is not a real week (W00, W54, W53 of a 52-week year). */
export function weekRange(weekId: string): WeekRange | null {
  const match = WEEK_ID.exec(weekId);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Date.UTC maps years 0 to 99 to 1900+; no log is that old.
  if (year < 1000) return null;
  // January 4th is always in week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const monday = jan4 - isoWeekday(jan4) * DAY_MS + (week - 1) * 7 * DAY_MS;
  const days = Array.from({ length: 7 }, (_, i) => fromUtcMs(monday + i * DAY_MS));
  if (isoWeekOf(days[0]) !== weekId) return null;
  return { week: weekId, monday: days[0], sunday: days[6], days };
}
