// server-only: src/lib/mcp/limits.ts
// Best-effort guards for the MCP endpoint. State is in memory, so on Vercel each
// warm instance counts separately and a cold start resets it; good enough to stop
// a runaway client loop from burning the Firestore read quota, not a security
// boundary (the access key is).
import { errorResult, type ToolResult } from './results';

/** Sliding-window limiter: at most `limit` hits in any `windowMs`. */
export function createLimiter(limit: number, windowMs: number) {
  const hits: number[] = [];
  return {
    take(now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
      while (hits.length && hits[0] <= now - windowMs) hits.shift();
      if (hits.length >= limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
      }
      hits.push(now);
      return { ok: true };
    },
  };
}

export type RequestLimits = { perMinute?: number; perHour?: number };

/**
 * Limiter for authenticated HTTP requests (one Claude turn is a handful:
 * initialize, list, calls). `check` returns null when allowed, otherwise a 429.
 * It runs after auth, so only the owner's requests count.
 */
export function createRequestLimiter({ perMinute = 60, perHour = 600 }: RequestLimits = {}) {
  const minuteLimiter = createLimiter(perMinute, 60_000);
  const hourLimiter = createLimiter(perHour, 3_600_000);
  return {
    check(now = Date.now()): Response | null {
      const minute = minuteLimiter.take(now);
      const hour = minute.ok ? hourLimiter.take(now) : minute;
      if (hour.ok) return null;
      return new Response(JSON.stringify({ error: 'rate_limited', retryAfterSec: hour.retryAfterSec }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'retry-after': String(hour.retryAfterSec),
        },
      });
    },
  };
}

// Firestore keeps retrying when it cannot be reached; the route's maxDuration is 30s.
export const TOOL_TIMEOUT_MS = 20_000;

const TIMEOUT_MESSAGE = {
  read: (seconds: number) => `Reading the data took longer than ${seconds}s. Try again later.`,
  // The deadline does not cancel a commit that is already on its way.
  write: (seconds: number) =>
    `The change took longer than ${seconds}s and its outcome is unknown: it may have been written. ` +
    'Read the data again before any retry, and do not repeat the call if the change is there.',
};

/** Runs a tool body with a deadline. `kind` picks the message: a write may have committed. */
export function withTimeout<A>(
  fn: (args: A) => Promise<ToolResult>,
  timeoutMs = TOOL_TIMEOUT_MS,
  kind: 'read' | 'write' = 'read',
) {
  return async (args: A): Promise<ToolResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ToolResult>(resolve => {
      timer = setTimeout(() => {
        console.error('[mcp] tool_timeout');
        resolve(errorResult(TIMEOUT_MESSAGE[kind](timeoutMs / 1000)));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fn(args), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
