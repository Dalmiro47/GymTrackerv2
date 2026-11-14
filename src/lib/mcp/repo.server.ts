// server-only: src/lib/mcp/repo.server.ts
// Read-only Firestore access for the MCP endpoint. Every path is rooted at
// users/{uid}; the route passes MCP_OWNER_UID, never a value from the request.
// Every collection read carries a limit. There is no write in this file, and the
// `ReadDb` type has no write method to call.

export type ReadSnapshot = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };

export type ReadQuery = {
  where(field: string, op: '==' | '>=' | '<=' | 'array-contains', value: string): ReadQuery;
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
/** Upper bound for one schedule read (one doc per day; the schedule window is at most 35 days). */
export const MAX_SCHEDULE_DAYS = 35;
/** Upper bound for one routine's history read. Past it the write tools refuse instead of guessing the latest version. */
export const MAX_ROUTINE_HISTORY = 500;
/** How many ids (`base`, `base-2`, ...) a create tool tries before it gives up. */
export const MAX_ID_CANDIDATES = 20;

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
  /** Logs with `fromYmd <= date <= toYmd`, oldest first, at most `max`. */
  getLogsBetween(fromYmd: string, toYmd: string, max: number): Promise<RawList>;
  /** Schedule days with `fromYmd <= date <= toYmd`, oldest first, at most `max`. */
  getScheduleBetween(fromYmd: string, toYmd: string, max: number): Promise<RawList>;
  getProfile(): Promise<Record<string, unknown> | null>;
};

/** Reads only the write tools need. Still reads: this file has no write. */
export type McpWriteReads = {
  getExercise(id: string): Promise<RawDoc | null>;
  /** `order` of the last routine (0 when it has none), or null when there is no routine. */
  getLastRoutineOrder(): Promise<number | null>;
  /**
   * The first id among `baseId`, `baseId-2`, ... that no document uses, like the
   * app's suffix loop. Null when a candidate is not a safe id or all are taken.
   */
  findFreeDocId(collection: 'routines' | 'exercises', baseId: string): Promise<string | null>;
  /** Every stored version of one routine, in no order; the caller sorts. */
  listRoutineHistory(routineId: string): Promise<RawList>;
  /** The performance entry of one exercise (last performed sets and PR), or null. */
  getPerformanceEntry(exerciseId: string): Promise<Record<string, unknown> | null>;
  /**
   * Every log that holds the exercise, in no order, at most MAX_LOGS: the same read
   * as the app's PR rescan. Past the bound the caller refuses instead of guessing a PR.
   */
  listLogsWithExercise(exerciseId: string): Promise<RawList>;
};

export type McpRepoWithWriteReads = McpRepo & McpWriteReads;

export function createRepo(db: ReadDb, uid: string): McpRepoWithWriteReads {
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

    async getLogsBetween(fromYmd, toYmd, max) {
      if (!YMD.test(fromYmd) || !YMD.test(toYmd) || fromYmd > toYmd) throw new Error('bad_date');
      if (!Number.isInteger(max) || max < 1 || max > MAX_LOGS) throw new Error('bad_bound');
      // Both bounds and the orderBy are on `date`, so no composite index is needed.
      return list(
        db.collection(`${root}/workoutLogs`).where('date', '>=', fromYmd).where('date', '<=', toYmd).orderBy('date', 'asc'),
        max,
      );
    },

    async getScheduleBetween(fromYmd, toYmd, max) {
      if (!YMD.test(fromYmd) || !YMD.test(toYmd) || fromYmd > toYmd) throw new Error('bad_date');
      if (!Number.isInteger(max) || max < 1 || max > MAX_SCHEDULE_DAYS) throw new Error('bad_bound');
      // Same shape as getLogsBetween: one field, so no composite index is needed.
      return list(
        db.collection(`${root}/schedule`).where('date', '>=', fromYmd).where('date', '<=', toYmd).orderBy('date', 'asc'),
        max,
      );
    },

    async getProfile() {
      const snap = await db.doc(`${root}/profile/profile`).get();
      return (snap.exists ? snap.data() : undefined) ?? null;
    },

    async getExercise(id) {
      if (!isSafeDocId(id)) throw new Error('bad_id');
      const snap = await db.doc(`${root}/exercises/${id}`).get();
      const data = snap.exists ? snap.data() : undefined;
      return data ? { id: snap.id, data } : null;
    },

    async getLastRoutineOrder() {
      const last = await list(db.collection(`${root}/routines`).orderBy('order', 'desc'), 1);
      if (last.rows.length === 0) return null;
      const order = last.rows[0].data.order;
      return typeof order === 'number' && Number.isFinite(order) ? order : 0;
    },

    async findFreeDocId(collection, baseId) {
      if (collection !== 'routines' && collection !== 'exercises') throw new Error('bad_collection');
      for (let n = 1; n <= MAX_ID_CANDIDATES; n++) {
        const candidate = n === 1 ? baseId : `${baseId}-${n}`;
        if (!isSafeDocId(candidate)) return null;
        const snap = await db.doc(`${root}/${collection}/${candidate}`).get();
        if (!snap.exists) return candidate;
      }
      return null;
    },

    async listRoutineHistory(routineId) {
      if (!isSafeDocId(routineId)) throw new Error('bad_id');
      return list(db.collection(`${root}/routineHistory`).where('routineId', '==', routineId), MAX_ROUTINE_HISTORY);
    },

    async getPerformanceEntry(exerciseId) {
      if (!isSafeDocId(exerciseId)) throw new Error('bad_id');
      const snap = await db.doc(`${root}/performanceEntries/${exerciseId}`).get();
      return (snap.exists ? snap.data() : undefined) ?? null;
    },

    // One field and no orderBy on purpose: array-contains plus an orderBy would need a composite index.
    async listLogsWithExercise(exerciseId) {
      if (!isSafeDocId(exerciseId)) throw new Error('bad_id');
      return list(db.collection(`${root}/workoutLogs`).where('exerciseIds', 'array-contains', exerciseId), MAX_LOGS);
    },
  };
}
