// server-only: src/lib/mcp/repo.server.ts
// Read-only Firestore access for the MCP endpoint. Every path is rooted at
// users/{uid}; the route passes MCP_OWNER_UID, never a value from the request.
// Every collection read carries a limit. There is no write in this file, and the
// `ReadDb` type has no write method to call.

export type ReadSnapshot = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };

export type ReadQuery = {
  where(field: string, op: '==' | '>=', value: string): ReadQuery;
  orderBy(field: string, direction?: 'asc' | 'desc'): ReadQuery;
  limit(n: number): ReadQuery;
  get(): Promise<{ docs: ReadSnapshot[] }>;
};

/** The slice of the Admin SDK's Firestore this endpoint may use. `adminDb()` satisfies it. */
export type ReadDb = {
  collection(path: string): ReadQuery;
  doc(path: string): { get(): Promise<ReadSnapshot> };
};

/** A stored document, untouched: the tools pick the fields they return. */
export type RawDoc = { id: string; data: Record<string, unknown> };
export type RawList = { rows: RawDoc[]; truncated: boolean };

export const MAX_ROUTINES = 50;
export const MAX_EXERCISES = 300;
/** Upper bound for one workoutLogs read (one doc per day; the widest tool window is 365 days). */
export const MAX_LOGS = 366;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A Firestore document id that stays one path segment. */
export function isSafeDocId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 200 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  );
}

export type McpRepo = {
  /** Ordered by `order`, like the app. Routines without that field are not returned, as in the app. */
  listRoutines(): Promise<RawList>;
  getRoutine(id: string): Promise<RawDoc | null>;
  listExercises(muscleGroup?: string): Promise<RawList>;
  /** Logs with `date >= fromYmd`, newest first, at most `max`. */
  getLogsSince(fromYmd: string, max: number): Promise<RawList>;
  getProfile(): Promise<Record<string, unknown> | null>;
};

export function createRepo(db: ReadDb, uid: string): McpRepo {
  if (!isSafeDocId(uid)) throw new Error('bad_owner');
  const root = `users/${uid}`;

  // One extra row is requested so a cut-off list can say so instead of looking complete.
  const list = async (query: ReadQuery, max: number): Promise<RawList> => {
    const snap = await query.limit(max + 1).get();
    const rows = snap.docs.map(d => ({ id: d.id, data: d.data() ?? {} }));
    return { rows: rows.slice(0, max), truncated: rows.length > max };
  };

  return {
    listRoutines: () => list(db.collection(`${root}/routines`).orderBy('order', 'asc'), MAX_ROUTINES),

    async getRoutine(id) {
      if (!isSafeDocId(id)) throw new Error('bad_id');
      const snap = await db.doc(`${root}/routines/${id}`).get();
      const data = snap.exists ? snap.data() : undefined;
      return data ? { id: snap.id, data } : null;
    },

    // The filtered query has no orderBy on purpose: equality plus orderBy on another
    // field would need a composite index. The tool sorts in code.
    listExercises: muscleGroup =>
      list(
        muscleGroup
          ? db.collection(`${root}/exercises`).where('muscleGroup', '==', muscleGroup)
          : db.collection(`${root}/exercises`).orderBy('name', 'asc'),
        MAX_EXERCISES,
      ),

    async getLogsSince(fromYmd, max) {
      if (!YMD.test(fromYmd)) throw new Error('bad_date');
      if (!Number.isInteger(max) || max < 1 || max > MAX_LOGS) throw new Error('bad_bound');
      return list(db.collection(`${root}/workoutLogs`).where('date', '>=', fromYmd).orderBy('date', 'desc'), max);
    },

    async getProfile() {
      const snap = await db.doc(`${root}/profile/profile`).get();
      return (snap.exists ? snap.data() : undefined) ?? null;
    },
  };
}
