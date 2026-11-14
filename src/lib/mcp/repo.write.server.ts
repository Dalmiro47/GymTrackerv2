// server-only: src/lib/mcp/repo.write.server.ts
// Write access for the MCP endpoint. It can add a document (`create`, which fails
// when the id is taken), merge fields into a routine (`set` with merge) and change
// the editable fields of an exercise (`update`, which fails when the document is
// gone), and nothing else: the `WriteDb` type has no other write method to call.
// A schedule day is a merge that always writes its three fields.
// A workout log is added with `create` and changed with `update` (its exercises, or
// the end of its session); a performance entry is a merge in the batch of its log.
// Every path is rooted at users/{uid}; the route passes MCP_OWNER_UID, never a
// value from the request. This file has no read: the tools read through
// repo.server.ts and validate before they call anything here.
import type { DumbbellLoad, ExerciseData, ExercisePerformanceEntry, RoutineData, WarmupTemplate } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import type { RoutineExerciseEntry } from '@/lib/routineDoc';
import { isSafeDocId } from './repo.server';
import { MAX_SCHEDULE_ITEMS, type ScheduleItem } from './schedule';
import { isRealYmd } from './week';

export type WriteDocRef = { readonly path: string };

export type WriteBatch = {
  /** Fails the whole batch when the document already exists. */
  create(ref: WriteDocRef, data: Record<string, unknown>): unknown;
  set(ref: WriteDocRef, data: Record<string, unknown>, options: { merge: true }): unknown;
  /** Fails the whole batch when the document does not exist. A dotted key is a field path. */
  update(ref: WriteDocRef, data: Record<string, unknown>): unknown;
  commit(): Promise<unknown>;
};

/** The slice of the Admin SDK's Firestore the write tools may use. `adminDb()` satisfies it. */
export type WriteDb = {
  batch(): WriteBatch;
  doc(path: string): WriteDocRef;
};

const WRITE_COLLECTIONS = ['routines', 'exercises', 'routineHistory', 'schedule', 'workoutLogs', 'performanceEntries'] as const;
type WriteCollection = (typeof WRITE_COLLECTIONS)[number];

const EXERCISE_TEXT_FIELDS = ['targetNotes', 'exerciseSetup', 'progressiveOverload'] as const;
const EXERCISE_REMOVABLE_FIELDS = ['loadIncrementKg', 'dumbbellLoad'] as const;
const PERFORMANCE_ENTRY_FIELDS = ['lastPerformedSets', 'lastPerformedDate', 'personalRecord'] as const;
/** Same bound as the tool input; the repo checks it again because it is the last stop before the document. */
export const MAX_COACH_NOTES_LENGTH = 2000;
/** The longest session `duration` a log takes, in whole minutes. */
export const MAX_DURATION_MIN = 300;

/** A new log of one day, built by `buildWorkoutLogDoc`. Only the keys named here reach the document. */
export type NewWorkoutLog = {
  routineId: string;
  routineName: string;
  exercises: Record<string, unknown>[];
  exerciseIds: string[];
  /** The start instant in epoch milliseconds. */
  startedAt: number;
};

/** The merge of one performance entry: `planPerformanceEntry` decides it. */
export type PerformanceEntryWrite = {
  exerciseId: string;
  fields: Partial<Pick<ExercisePerformanceEntry, (typeof PERFORMANCE_ENTRY_FIELDS)[number]>>;
  /** True takes `personalRecord` off the entry. */
  clearPR: boolean;
};

/** The only fields of an exercise this repo can change. A key left out stays as stored. */
export type ExerciseFieldChange = {
  /** '' clears the text. */
  targetNotes?: string;
  exerciseSetup?: string;
  progressiveOverload?: string;
  /** Written as `warmup.template`; every other warm-up key stays. */
  warmupTemplate?: WarmupTemplate;
  /** null takes the field off the document. */
  loadIncrementKg?: number | null;
  dumbbellLoad?: DumbbellLoad | null;
};

/** One routine that holds the exercise: its new exercise list and the versions to append. */
export type RoutineCascade = { id: string; exercises: RoutineExerciseEntry[]; versions: RoutineVersion[] };

export type McpWriteRepo = {
  /** One batch: the new exercise. */
  createExercise(id: string, exercise: ExerciseData): Promise<void>;
  /** One batch: the new routine plus its history versions. */
  createRoutine(id: string, routine: RoutineData, versions: RoutineVersion[]): Promise<void>;
  /**
   * One batch: `exercises` and `updatedAt` merged into an existing routine, plus
   * its history versions. Every other field of the routine stays as stored.
   */
  setRoutineExercises(
    id: string,
    fields: { exercises: RoutineExerciseEntry[] },
    versions: RoutineVersion[],
  ): Promise<void>;
  /**
   * One batch: the given fields of an existing exercise, plus `userEdited` and
   * `updatedAt` as the app writes them, plus each routine's exercise list and its
   * history versions. The batch fails, and writes nothing, when the exercise is gone.
   */
  updateExerciseFields(id: string, change: ExerciseFieldChange, routines: RoutineCascade[]): Promise<void>;
  /**
   * One batch: `date`, `items` and `updatedAt` merged into the schedule document of
   * that day. `items` is replaced whole; an empty list clears the day.
   */
  setScheduleDay(date: string, items: ScheduleItem[]): Promise<void>;
  /**
   * One batch: a new log of that day, open (`sessionOpen: true`) and never a deload.
   * The batch fails, and writes nothing, when that day already has a log.
   */
  createWorkoutLog(date: string, log: NewWorkoutLog): Promise<void>;
  /**
   * One batch: `exercises` and `exerciseIds` of an existing log, plus the merge of
   * each performance entry. Every other field of the log stays as stored. The batch
   * fails, and writes nothing, when the log is gone.
   */
  setWorkoutLogExercises(
    date: string,
    fields: { exercises: Record<string, unknown>[]; exerciseIds: string[] },
    entries: PerformanceEntryWrite[],
  ): Promise<void>;
  /**
   * One batch: `coachNotes`, `duration` (whole minutes) and `sessionOpen: false` on an
   * existing log. It fails when the log is gone.
   */
  finishWorkoutLog(date: string, coachNotes: string, durationMin: number): Promise<void>;
};

/**
 * `serverTimestamp` and `removeField` are the Admin SDK's `FieldValue` sentinels
 * (the server time, and "take this field off the document"), passed in by the
 * route so this module and its tests never load firebase-admin.
 */
export function createWriteRepo(
  db: WriteDb,
  uid: string,
  serverTimestamp: () => unknown,
  removeField: () => unknown,
): McpWriteRepo {
  if (!isSafeDocId(uid)) throw new Error('bad_owner');
  const root = `users/${uid}`;

  // The only place a write path is built.
  const ref = (collection: WriteCollection, id: string): WriteDocRef => {
    if (!WRITE_COLLECTIONS.includes(collection)) throw new Error('bad_collection');
    if (!isSafeDocId(id)) throw new Error('bad_id');
    // A schedule document and a workout log are one calendar day: the id is a real YYYY-MM-DD and nothing else.
    if ((collection === 'schedule' || collection === 'workoutLogs') && !isRealYmd(id)) throw new Error('bad_date');
    return db.doc(`${root}/${collection}/${id}`);
  };

  // Refs are resolved before the batch is opened, so a bad id opens no batch.
  const versionRefs = (routineId: string, versions: RoutineVersion[]) =>
    versions.map(version => {
      if (version.routineId !== routineId) throw new Error('bad_version');
      return { ref: ref('routineHistory', version.id), data: { ...version } };
    });

  return {
    async createExercise(id, exercise) {
      const target = ref('exercises', id);
      const batch = db.batch();
      batch.create(target, { ...exercise });
      await batch.commit();
    },

    async createRoutine(id, routine, versions) {
      const target = ref('routines', id);
      const history = versionRefs(id, versions);
      const batch = db.batch();
      batch.create(target, { ...routine, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      for (const version of history) batch.create(version.ref, version.data);
      await batch.commit();
    },

    async setRoutineExercises(id, fields, versions) {
      const target = ref('routines', id);
      const history = versionRefs(id, versions);
      const batch = db.batch();
      batch.set(target, { exercises: fields.exercises, updatedAt: serverTimestamp() }, { merge: true });
      for (const version of history) batch.create(version.ref, version.data);
      await batch.commit();
    },

    async updateExerciseFields(id, change, routines) {
      const target = ref('exercises', id);
      // Only the keys named here reach the document, whatever the argument holds.
      const fields: Record<string, unknown> = {};
      for (const key of EXERCISE_TEXT_FIELDS) {
        if (typeof change[key] === 'string') fields[key] = change[key];
      }
      if (change.warmupTemplate !== undefined) fields['warmup.template'] = change.warmupTemplate;
      for (const key of EXERCISE_REMOVABLE_FIELDS) {
        const value = change[key];
        if (value !== undefined) fields[key] = value === null ? removeField() : value;
      }
      if (Object.keys(fields).length === 0) throw new Error('empty_change');

      const cascades = routines.map(routine => ({
        target: ref('routines', routine.id),
        exercises: routine.exercises,
        history: versionRefs(routine.id, routine.versions),
      }));

      const batch = db.batch();
      batch.update(target, { ...fields, userEdited: true, updatedAt: serverTimestamp() });
      for (const cascade of cascades) {
        batch.set(cascade.target, { exercises: cascade.exercises, updatedAt: serverTimestamp() }, { merge: true });
        for (const version of cascade.history) batch.create(version.ref, version.data);
      }
      await batch.commit();
    },

    async setScheduleDay(date, items) {
      const target = ref('schedule', date);
      if (!Array.isArray(items) || items.length > MAX_SCHEDULE_ITEMS) throw new Error('bad_items');
      // Only the keys named here reach the document, whatever the argument holds.
      const stored = items.map((item): ScheduleItem => {
        if (item.kind === 'routine') {
          if (!isSafeDocId(item.routineId)) throw new Error('bad_id');
          return { kind: 'routine', routineId: item.routineId, routineName: String(item.routineName ?? '') };
        }
        if (item.kind === 'activity') return { kind: 'activity', activity: String(item.activity) };
        if (item.kind === 'rest') return { kind: 'rest' };
        throw new Error('bad_items');
      });
      const batch = db.batch();
      batch.set(target, { date, items: stored, updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
    },

    async createWorkoutLog(date, log) {
      const target = ref('workoutLogs', date);
      if (!isSafeDocId(log.routineId)) throw new Error('bad_id');
      if (!Array.isArray(log.exercises) || log.exercises.length === 0 || !Array.isArray(log.exerciseIds)) throw new Error('bad_log');
      if (typeof log.startedAt !== 'number' || !Number.isFinite(log.startedAt) || log.startedAt <= 0) throw new Error('bad_start');
      const batch = db.batch();
      // The fields of an app save with no deload, plus the open marker and the start instant.
      batch.create(target, {
        id: date,
        date,
        routineId: log.routineId,
        routineName: String(log.routineName ?? ''),
        exercises: log.exercises,
        exerciseIds: log.exerciseIds,
        notes: '',
        isDeload: false,
        deloadApplied: false,
        sessionOpen: true,
        startedAt: log.startedAt,
      });
      await batch.commit();
    },

    async setWorkoutLogExercises(date, fields, entries) {
      const target = ref('workoutLogs', date);
      if (!Array.isArray(fields.exercises) || fields.exercises.length === 0 || !Array.isArray(fields.exerciseIds)) throw new Error('bad_log');
      const merges = entries.flatMap(entry => {
        const entryRef = ref('performanceEntries', entry.exerciseId);
        // Only the keys named here reach the document, whatever the argument holds.
        const data: Record<string, unknown> = {};
        for (const key of PERFORMANCE_ENTRY_FIELDS) {
          if (entry.fields[key] !== undefined) data[key] = entry.fields[key];
        }
        if (entry.clearPR) data.personalRecord = removeField();
        return Object.keys(data).length > 0 ? [{ ref: entryRef, data }] : [];
      });
      const batch = db.batch();
      batch.update(target, { exercises: fields.exercises, exerciseIds: fields.exerciseIds });
      for (const merge of merges) batch.set(merge.ref, merge.data, { merge: true });
      await batch.commit();
    },

    async finishWorkoutLog(date, coachNotes, durationMin) {
      const target = ref('workoutLogs', date);
      if (typeof coachNotes !== 'string' || coachNotes.length === 0 || coachNotes.length > MAX_COACH_NOTES_LENGTH) throw new Error('bad_notes');
      if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > MAX_DURATION_MIN) throw new Error('bad_duration');
      const batch = db.batch();
      batch.update(target, { coachNotes, sessionOpen: false, duration: durationMin });
      await batch.commit();
    },
  };
}
