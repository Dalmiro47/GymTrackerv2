// server-only: src/lib/mcp/repo.write.server.ts
// Write access for the MCP endpoint. It can add a document (`create`, which fails
// when the id is taken) and merge fields into a routine (`set` with merge), and
// nothing else: the `WriteDb` type has no other write method to call.
// Every path is rooted at users/{uid}; the route passes MCP_OWNER_UID, never a
// value from the request. This file has no read: the tools read through
// repo.server.ts and validate before they call anything here.
import type { ExerciseData, RoutineData } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import type { RoutineExerciseEntry } from '@/lib/routineDoc';
import { isSafeDocId } from './repo.server';

export type WriteDocRef = { readonly path: string };

export type WriteBatch = {
  /** Fails the whole batch when the document already exists. */
  create(ref: WriteDocRef, data: Record<string, unknown>): unknown;
  set(ref: WriteDocRef, data: Record<string, unknown>, options: { merge: true }): unknown;
  commit(): Promise<unknown>;
};

/** The slice of the Admin SDK's Firestore the write tools may use. `adminDb()` satisfies it. */
export type WriteDb = {
  batch(): WriteBatch;
  doc(path: string): WriteDocRef;
};

const WRITE_COLLECTIONS = ['routines', 'exercises', 'routineHistory'] as const;
type WriteCollection = (typeof WRITE_COLLECTIONS)[number];

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
};

/**
 * `serverTimestamp` is the Admin SDK's `FieldValue.serverTimestamp()`, passed in
 * by the route so this module and its tests never load firebase-admin.
 */
export function createWriteRepo(db: WriteDb, uid: string, serverTimestamp: () => unknown): McpWriteRepo {
  if (!isSafeDocId(uid)) throw new Error('bad_owner');
  const root = `users/${uid}`;

  // The only place a write path is built.
  const ref = (collection: WriteCollection, id: string): WriteDocRef => {
    if (!WRITE_COLLECTIONS.includes(collection)) throw new Error('bad_collection');
    if (!isSafeDocId(id)) throw new Error('bad_id');
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
  };
}
