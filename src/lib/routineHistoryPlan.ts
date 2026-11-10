import type { Routine, RoutineData } from '@/types';
import type { RoutineChangeSource, RoutineChangeType, RoutineVersion } from '@/types/routineHistory';
import { hashRoutineSnapshot, toRoutineSnapshot } from '@/lib/routineHistory';

/**
 * Pure planner for routine history: decides which versions a change must append.
 * Shared by the app's routineHistoryService and the MCP write tools, so both
 * record history by the same rules. It reads and writes nothing; the caller
 * loads `existing` and stores the result.
 */

export type RoutineLike = Pick<Routine, 'name' | 'exercises'> & Partial<Pick<RoutineData, 'description'>>;

export type RoutineVersionPlanInput = {
  routineId: string;
  /** Every stored version of this routine, in any order. */
  existing: RoutineVersion[];
  /** State before the change, or null when there is none (create) or it is unknown. */
  before: RoutineLike | null;
  /** State the version records: after the change, or the last state for a delete. */
  after: RoutineLike;
  changeType: RoutineChangeType;
  source: RoutineChangeSource;
  /** Epoch millis of the change. */
  now: number;
};

/**
 * Returns the versions to append, oldest first:
 *  - 0: nothing history cares about changed (the snapshot hash equals the latest
 *    version's). A delete is never a no-op: the event itself is the value.
 *  - 1: the new version.
 *  - 2: a 'baseline' and then the new version, when the routine has no history
 *    yet and `before` is known. The baseline is also returned alone when the
 *    change is a no-op against it.
 *
 * `createdAtMs` is always later than the latest existing version and differs
 * between the two planned versions, because the document id is built from it:
 * an equal value would make one write replace another.
 */
export function planRoutineVersions(input: RoutineVersionPlanInput): RoutineVersion[] {
  const { routineId, existing, before, after, changeType, source, now } = input;
  const planned: RoutineVersion[] = [];

  let latest: RoutineVersion | null = null;
  for (const version of existing) {
    if (!latest || version.createdAtMs > latest.createdAtMs) latest = version;
  }

  let nextMs = latest ? Math.max(now, latest.createdAtMs + 1) : now;

  const makeVersion = (
    routine: RoutineLike,
    type: RoutineChangeType,
    versionSource: RoutineChangeSource,
    prevHash: string | null,
  ): RoutineVersion => {
    const snapshot = toRoutineSnapshot(routine);
    const createdAtMs = nextMs++;
    return {
      id: `${routineId}_${createdAtMs}`,
      routineId,
      routineName: snapshot.name,
      changeType: type,
      source: versionSource,
      createdAtMs,
      snapshot,
      snapshotHash: hashRoutineSnapshot(snapshot),
      prevHash,
    };
  };

  // Backfill: a routine that predates history has no recorded past. The pre-edit
  // state becomes a synthetic baseline so the first real change has something to
  // diff against.
  if (existing.length === 0 && before) {
    latest = makeVersion(before, 'baseline', 'backfill', null);
    planned.push(latest);
  }

  const afterHash = hashRoutineSnapshot(toRoutineSnapshot(after));
  if (changeType !== 'deleted' && latest && latest.snapshotHash === afterHash) {
    return planned;
  }

  planned.push(makeVersion(after, changeType, source, latest ? latest.snapshotHash : null));
  return planned;
}
