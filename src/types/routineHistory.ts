import type { MuscleGroup } from '@/lib/constants';
import type { SetStructure } from './setStructure';

/**
 * Routine change history.
 *
 * We persist a *snapshot* per change, never a stored diff. Snapshots are ground
 * truth: they survive changes to the diff algorithm, and at this scale (1-5 users,
 * a few dozen versions per routine) they cost nothing. Diffs are derived on read
 * by `src/lib/routineHistory.ts`.
 *
 * Prose fields (exerciseSetup, progressiveOverload, instructions, warmup) are
 * deliberately stripped — they belong to the Exercise library, not to the
 * routine's identity, and they would dominate the document size.
 */

export interface RoutineSnapshotExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  /** Normalized — never undefined, so hashing and diffing are stable. */
  setStructure: SetStructure;
  /** Normalized to '' when absent. */
  targetNotes: string;
}

export interface RoutineSnapshot {
  name: string;
  description: string;
  exercises: RoutineSnapshotExercise[];
}

export type RoutineChangeType = 'created' | 'updated' | 'deleted' | 'baseline';

export type RoutineChangeSource =
  /** Saved from the routine editor dialog. */
  | 'routine-editor'
  /** Rewritten because the underlying exercise was edited in the library. */
  | 'exercise-cascade'
  /** Synthesized pre-state for a routine that existed before history was added. */
  | 'backfill';

export interface RoutineVersion {
  /** `${routineId}_${epochMillis}` */
  id: string;
  routineId: string;
  /**
   * Denormalized: routine doc IDs are slugs of the original name and can be
   * reused after a delete, so the version carries the name it was saved under.
   */
  routineName: string;
  changeType: RoutineChangeType;
  source: RoutineChangeSource;
  /**
   * Client epoch millis. Deliberately not a serverTimestamp: it must be present
   * and sortable the instant the doc is written (serverTimestamp reads back as
   * null locally), and it is the same clock that already stamps workout dates.
   */
  createdAtMs: number;
  snapshot: RoutineSnapshot;
  /** Stable hash of `snapshot`; used to skip no-op writes. */
  snapshotHash: string;
  /** Hash of the preceding version, or null. Lets the UI detect gaps. */
  prevHash: string | null;
}

// ─── Derived diff types (computed on read, never persisted) ──────────────

export type RoutineChange =
  | { kind: 'created'; exerciseCount: number }
  /** Oldest recorded state of a routine that predates history tracking. */
  | { kind: 'baseline'; exerciseCount: number }
  | { kind: 'deleted' }
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'description-changed' }
  | { kind: 'exercise-added'; name: string; muscleGroup: MuscleGroup }
  | { kind: 'exercise-removed'; name: string; muscleGroup: MuscleGroup }
  | { kind: 'exercise-replaced'; from: string; to: string; muscleGroup: MuscleGroup }
  | { kind: 'set-structure-changed'; name: string; from: SetStructure; to: SetStructure }
  | { kind: 'target-notes-changed'; name: string }
  | { kind: 'exercises-reordered'; count: number };

/** A version paired with the changes it introduced relative to the one before it. */
export interface RoutineVersionWithDiff {
  version: RoutineVersion;
  changes: RoutineChange[];
  /** True when this version's prevHash doesn't match the preceding version. */
  hasGapBefore: boolean;
}
