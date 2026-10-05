// Age from the profile's date of birth. The coach gets only the computed age,
// never the birth date itself (PII it doesn't need).

/** Earliest date of birth the profile inputs accept. */
export const DOB_MIN = '1900-01-01';

/** Today as local `YYYY-MM-DD` — the latest date of birth the inputs accept. */
export function todayISODate(today: Date = new Date()): string {
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${m}-${d}`;
}

/**
 * Whole years between a `YYYY-MM-DD` date of birth and `today` (local date),
 * one less while this year's birthday hasn't arrived yet. Returns undefined for
 * a malformed, non-existent (e.g. 2001-02-30) or future date.
 */
export function ageFromDateOfBirth(dob: string, today: Date = new Date()): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return undefined;

  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return age >= 0 ? age : undefined;
}
