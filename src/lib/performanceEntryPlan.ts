/**
 * Pure rules for a performance entry (users/{uid}/performanceEntries/{exerciseId}):
 * the last performed sets and the personal record of one exercise.
 *
 * Shared by the app's save (trainingLogService.saveExercisePerformanceEntries) and
 * the MCP workout tools, so both writers decide the same way. No Firestore import:
 * the caller reads the stored entry and, when asked, the other logs.
 */
import type { ExercisePerformanceEntry, LoggedSet, PersonalRecord } from '@/types';
import { isBetterPR, pickBestSet, validWorkingSets } from '@/lib/pr';

type StoredEntry = Partial<ExercisePerformanceEntry> | null;

/**
 * True when the PR came from this same log and the log no longer backs it: today's
 * best set is lower, or there is none. The caller must then scan the other logs
 * (`bestPRFromLogs`), because one of them may now hold the best set.
 */
export function needsPRRescan(existing: StoredEntry, sets: LoggedSet[], logDate: string): boolean {
  const existingPR = existing?.personalRecord ?? null;
  if (!existingPR || existingPR.logId !== logDate) return false;
  const bestToday = pickBestSet(sets);
  return !bestToday || isBetterPR(existingPR, bestToday);
}

export type PerformanceEntryPlan = {
  /** The fields to merge into the entry; a key left out stays as stored. */
  fields: Partial<Pick<ExercisePerformanceEntry, 'lastPerformedSets' | 'lastPerformedDate' | 'personalRecord'>>;
  /** True when the PR must be taken off the entry: no log backs one any more. */
  clearPR: boolean;
};

export type PerformanceEntryPlanInput = {
  /** The stored entry, or null when there is none. */
  existing: StoredEntry;
  /** The sets of the exercise in the log being saved. */
  sets: LoggedSet[];
  /** The log's id, "YYYY-MM-DD". */
  logDate: string;
  /** Midnight of the log's day, in ms. */
  achievedAtMs: number;
  /** The best set of every other log; read only when `needsPRRescan` is true. */
  prFromOtherLogs: PersonalRecord | null;
};

export function planPerformanceEntry({ existing, sets, logDate, achievedAtMs, prFromOtherLogs }: PerformanceEntryPlanInput): PerformanceEntryPlan {
  const bestToday = pickBestSet(sets);
  const fields: PerformanceEntryPlan['fields'] = {};

  // Only refresh "last performed" when this log is at least as recent as
  // the stored one — back-filling an older day must not overwrite it.
  const existingLastDate = existing?.lastPerformedDate ?? null;
  if (existingLastDate === null || achievedAtMs >= existingLastDate) {
    fields.lastPerformedSets = validWorkingSets(sets);
    fields.lastPerformedDate = achievedAtMs;
  }

  const existingPR = existing?.personalRecord ?? null;
  let clearPR = false;
  if (existingPR && existingPR.logId === logDate) {
    // The PR's source log is being edited: recompute it. If today's best
    // still matches/beats the old PR no other log can top it; otherwise
    // the other logs count, since one of them may now hold the best set.
    let recomputed: PersonalRecord | null = bestToday
      ? { reps: bestToday.reps, weight: bestToday.weight, date: achievedAtMs, logId: logDate }
      : null;
    if (needsPRRescan(existing, sets, logDate) && isBetterPR(prFromOtherLogs, recomputed)) {
      recomputed = prFromOtherLogs;
    }
    if (recomputed) fields.personalRecord = recomputed;
    else clearPR = true;
  } else if (isBetterPR(bestToday, existingPR)) {
    fields.personalRecord = {
      reps: bestToday!.reps,
      weight: bestToday!.weight,
      date: achievedAtMs,
      logId: logDate,
    };
  }
  return { fields, clearPR };
}

type StoredLogDoc = { id: string; data: Record<string, unknown> };

/**
 * The best set of `exerciseId` over `logs` (except `excludeLogId`) as a PR, or null
 * when nothing remains. `logDateToMs` turns a log id into the PR's date.
 */
export function bestPRFromLogs(
  logs: StoredLogDoc[],
  exerciseId: string,
  excludeLogId: string,
  opts: { skipDeload?: boolean },
  logDateToMs: (logId: string) => number,
): PersonalRecord | null {
  let best: PersonalRecord | null = null;
  for (const log of logs) {
    if (log.id === excludeLogId) continue;
    if (opts.skipDeload && log.data?.isDeload === true) continue;
    const exercises: unknown[] = Array.isArray(log.data?.exercises) ? (log.data.exercises as unknown[]) : [];
    const exerciseInLog = exercises.find(
      (e): e is { exerciseId: string; performed?: boolean; sets?: LoggedSet[] } =>
        typeof e === 'object' && e !== null && (e as { exerciseId?: unknown }).exerciseId === exerciseId,
    );
    if (!exerciseInLog) continue;
    // A planned exercise persists the last session's sets, so counting it would
    // credit a PR to a day the lift never happened. `undefined` means the log
    // predates the flag — treat it as performed, or every historical PR would
    // vanish on the first rescan.
    if (exerciseInLog.performed === false) continue;
    const candidate = pickBestSet(exerciseInLog.sets ?? []);
    if (isBetterPR(candidate, best)) {
      best = { reps: candidate!.reps, weight: candidate!.weight, date: logDateToMs(log.id), logId: log.id };
    }
  }
  return best;
}
