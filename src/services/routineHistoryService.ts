import { db } from '@/lib/firebaseConfig';
import type { Routine, RoutineData } from '@/types';
import type {
  RoutineChangeSource,
  RoutineChangeType,
  RoutineVersion,
  RoutineVersionWithDiff,
} from '@/types/routineHistory';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { changesForVersion } from '@/lib/routineHistory';
import { planRoutineVersions } from '@/lib/routineHistoryPlan';

/**
 * Routine change history — read/write.
 *
 * Stored as a FLAT collection (`users/{userId}/routineHistory/{versionId}`), not a
 * subcollection of the routine, for two reasons:
 *  1. `firestore.rules` matches exactly `/users/{userId}/{collection}/{docId}`; a
 *     4-segment subcollection path falls through to the deny-all default, so it
 *     would require a rules deploy. This needs none.
 *  2. Firestore doesn't cascade-delete subcollections, and history is *supposed*
 *     to outlive its routine — "what was I doing back then" includes deleted plans.
 *
 * Every write is best-effort and never blocks the routine write itself (see
 * `recordRoutineVersion`).
 */

const getHistoryCollectionPath = (userId: string) => `users/${userId}/routineHistory`;

type RoutineLike = Pick<Routine, 'name' | 'exercises'> & Partial<Pick<RoutineData, 'description'>>;

/** Newest first. Sorted in memory so no composite index is required. */
export const getRoutineHistory = async (
  userId: string,
  routineId: string,
): Promise<RoutineVersion[]> => {
  if (!userId) throw new Error('User ID is required to read routine history.');
  if (!routineId) throw new Error('Routine ID is required to read routine history.');

  const colRef = collection(db, getHistoryCollectionPath(userId));
  const snap = await getDocs(query(colRef, where('routineId', '==', routineId)));
  return snap.docs
    .map((d) => ({ ...(d.data() as RoutineVersion), id: d.id }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
};

/**
 * Pair each version with the changes it introduced relative to the version
 * before it. Returned newest first, ready to render as a timeline.
 */
export const buildVersionTimeline = (
  versions: RoutineVersion[],
): RoutineVersionWithDiff[] => {
  const oldestFirst = versions.slice().reverse();

  const withDiffs = oldestFirst.map((version, i) => {
    const previous = i > 0 ? oldestFirst[i - 1] : null;
    return {
      version,
      changes: changesForVersion(previous, version),
      hasGapBefore: previous !== null && version.prevHash !== previous.snapshotHash,
    };
  });

  return withDiffs.reverse();
};

/**
 * Append a version — unless nothing that history cares about actually changed.
 *
 * The hash guard is load-bearing: `updateRoutine` rewrites all eight exercise
 * fields on every save, and an exercise-library edit cascades a rewrite to every
 * routine containing it. Without this, the timeline fills with empty entries.
 *
 * Returns the version written, or null if it was a no-op or the write failed.
 * NEVER throws: a missing audit row is an annoyance, a failed routine save is a
 * bug the user feels immediately. Callers must not depend on the result.
 */
export const recordRoutineVersion = async (
  userId: string,
  routineId: string,
  routine: RoutineLike,
  changeType: RoutineChangeType,
  source: RoutineChangeSource = 'routine-editor',
  options?: { previousState?: RoutineLike | null },
): Promise<RoutineVersion | null> => {
  if (!userId || !routineId) return null;

  try {
    const existing = await getRoutineHistory(userId, routineId);
    const previousState = options?.previousState ?? null;

    // Which versions to append is decided by the pure planner (shared with the
    // MCP write tools): a 'baseline' backfill for a routine that predates this
    // feature, the hash no-op guard, and the prevHash chain.
    const planned = planRoutineVersions({
      routineId,
      existing,
      before: previousState,
      after: routine,
      changeType,
      source,
      now: Date.now(),
    });

    for (const version of planned) {
      await setDoc(doc(db, getHistoryCollectionPath(userId), version.id), version);
    }

    // The planner puts the baseline first, and only for a routine with no history.
    const hasBaseline = existing.length === 0 && previousState !== null;
    return planned[hasBaseline ? 1 : 0] ?? null;
  } catch (error: any) {
    // No PII in logs — routine ID only.
    console.warn(`Could not record routine history for "${routineId}":`, error?.message);
    return null;
  }
};

/**
 * All versions across all routines, newest first — for the AI Coach context.
 * Cheap at this scale (1-5 users); no pagination by design.
 */
export const getAllRoutineHistory = async (userId: string): Promise<RoutineVersion[]> => {
  if (!userId) throw new Error('User ID is required to read routine history.');
  const snap = await getDocs(collection(db, getHistoryCollectionPath(userId)));
  return snap.docs
    .map((d) => ({ ...(d.data() as RoutineVersion), id: d.id }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
};
