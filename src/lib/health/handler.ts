// server-only: src/lib/health/handler.ts
import { isValidAccessKey, readKeyConfig, unauthorized, type AuthDeps } from '../mcp/auth';
import { createRequestLimiter, type RequestLimits } from '../mcp/limits';
import { isRealYmd } from '../mcp/week';
import { parseHealthPayload } from './ingest';

/** The largest body the route reads, in bytes. The Shortcut sends well under 1 KB. */
export const MAX_BODY_BYTES = 4096;
/** The header that carries HEALTH_INGEST_KEY. The key is never read from the URL. */
export const INGEST_KEY_HEADER = 'x-ingest-key';

export type HealthWriteDocRef = { readonly path: string };

/** The only write the route makes: a merge. No create, update or delete exists here. */
export type HealthWriteBatch = {
  set(ref: HealthWriteDocRef, data: Record<string, unknown>, options: { merge: true }): unknown;
  commit(): Promise<unknown>;
};

/** The slice of the Admin SDK's Firestore the route may use. `adminDb()` satisfies it. */
export type HealthWriteDb = {
  batch(): HealthWriteBatch;
  doc(path: string): HealthWriteDocRef;
};

/**
 * What the route needs from outside. The route file passes the real env and Admin
 * SDK; tests pass fakes, so they never load an env file or reach Firestore.
 */
export type HealthIngestDeps = AuthDeps & {
  /** Called only after auth passed. */
  db: () => HealthWriteDb;
  /** The Admin SDK's `FieldValue.serverTimestamp()`; stamps `updatedAt`. */
  serverTimestamp: () => unknown;
  now?: () => Date;
  limits?: RequestLimits;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const badRequest = (error: 'too_large' | 'bad_json' | 'bad_version') => json(400, { error });

/**
 * Builds the handler for POST /api/health/ingest. The key in `x-ingest-key` is
 * checked in constant time before the body is read, and the owner uid always comes
 * from env (MCP_OWNER_UID), never from the request. Every refusal of auth is the
 * same 401. All days of one request are written in one batch.
 */
export function createHealthIngestHandler(deps: HealthIngestDeps) {
  const limiter = createRequestLimiter(deps.limits ?? { perMinute: 10, perHour: 60 });

  return async function handler(req: Request): Promise<Response> {
    const config = readKeyConfig(deps, { keyVar: 'HEALTH_INGEST_KEY', tag: 'health' });
    if (!config || !isValidAccessKey(req.headers.get(INGEST_KEY_HEADER), config.accessKey)) {
      return unauthorized();
    }

    const limited = limiter.check();
    if (limited) return limited;

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return badRequest('too_large');

    try {
      const text = await req.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return badRequest('too_large');

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return badRequest('bad_json');
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return badRequest('bad_json');
      const body = payload as Record<string, unknown>;
      if (body.v !== 1 && body.v !== '1') return badRequest('bad_version');

      const { days, dropped } = parseHealthPayload(body, deps.now?.() ?? new Date());
      const written = Object.keys(days)
        .filter(date => isRealYmd(date))
        .sort();

      if (written.length > 0) {
        const db = deps.db();
        const batch = db.batch();
        for (const date of written) {
          batch.set(
            db.doc(`users/${config.ownerUid}/health/${date}`),
            { date, ...days[date], updatedAt: deps.serverTimestamp() },
            { merge: true },
          );
        }
        await batch.commit();
      }

      return json(200, { ok: true, written, dropped });
    } catch {
      console.error('[health] request_failed');
      return json(500, { error: 'server_error' });
    }
  };
}
