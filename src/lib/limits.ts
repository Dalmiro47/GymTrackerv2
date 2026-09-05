// Single source of truth for daily free-tier limits.
// Imported by both the API route (authoritative enforcement) and client
// components (display only). Do not raise without explicit instruction.

/** AI Coach requests per user per UTC day. One sent message = one call. */
export const DAILY_LIMIT_COACH_CALLS = 3;
