// ─── Context Builders for AI Coach Chat ─────────────────────────────
// Serialize page data into compact context for LLM system prompts.

import type { WorkoutLog, LoggedExercise, Exercise } from '@/types';
import type { SetStructure } from '@/types/setStructure';
import type { ProgressionResult } from '@/lib/progression';
import { parseISO, startOfISOWeek, formatISO } from 'date-fns';
import { buildCoachFactsCompact, type CoachFactCompact } from '@/lib/analysis';
import { buildRoutineChangeLog, type RoutineChangeLog } from '@/lib/routineHistory';
import type { RoutineVersion } from '@/types/routineHistory';
// Exercise names go to the coach as the user SEES them (seeded defaults in the
// UI language), so the reply can quote the same names the app shows.
import { displayExerciseFields, displayExerciseName } from '@/lib/exerciseDisplay';
import { dedupeExercisesByNameAndMuscle } from '@/lib/routineEditing';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';

// ─── Shared: coach profile + exercise library ───────────────────────

/** Profile fields every coach mode may use. All optional: the coach works without them. */
export type CoachProfile = {
  goal?: string;
  daysPerWeekTarget?: number;
  constraints?: string[];
  trainingAge?: string;
  sessionTimeTargetMin?: number;
};

/** Picks the coach fields out of a raw `users/{uid}/profile/profile` doc. */
export function toCoachProfile(data: Record<string, unknown> | undefined | null): CoachProfile {
  if (!data) return {};
  return {
    goal: typeof data.goal === 'string' ? data.goal : undefined,
    daysPerWeekTarget: typeof data.daysPerWeekTarget === 'number' ? data.daysPerWeekTarget : undefined,
    constraints: Array.isArray(data.constraints) ? data.constraints.filter((c): c is string => typeof c === 'string') : undefined,
    trainingAge: typeof data.trainingAge === 'string' ? data.trainingAge : undefined,
    sessionTimeTargetMin: typeof data.sessionTimeTargetMin === 'number' ? data.sessionTimeTargetMin : undefined,
  };
}

/**
 * The user's exercise library grouped by muscle group — the ONLY pool the coach
 * may suggest a swap or an addition from. `focus` is the exercise's target area
 * (e.g. "Upper Chest"), `target` its rep range.
 */
export type LibraryContext = Array<{
  muscleGroup: string;
  exercises: Array<{ name: string; focus?: string; target?: string }>;
}>;

/**
 * `excludeIds` are LIBRARY ids (`Exercise.id` / `LoggedExercise.exerciseId`),
 * never composite log-row ids, which would never match.
 */
export function serializeLibrary(
  available: Exercise[],
  excludeIds: Set<string> = new Set(),
): LibraryContext {
  const byMuscle = new Map<string, LibraryContext[number]['exercises']>();
  for (const ex of dedupeExercisesByNameAndMuscle(available)) {
    if (excludeIds.has(ex.id)) continue;
    const shown = displayExerciseFields(ex);
    const mg = ex.muscleGroup || 'Unknown';
    if (!byMuscle.has(mg)) byMuscle.set(mg, []);
    byMuscle.get(mg)!.push({
      name: shown.name,
      focus: shown.targetNotes?.trim() || undefined,
      target: shown.progressiveOverload?.trim() || undefined,
    });
  }
  return Array.from(byMuscle, ([muscleGroup, exercises]) => ({ muscleGroup, exercises }));
}

// ─── Log-Day Context (current workout) ──────────────────────────────

export type LogDayContext = {
  date: string;
  routineName?: string;
  isDeload?: boolean;
  notes?: string;
  profile?: CoachProfile;
  exercises: Array<{
    name: string;
    muscleGroup: string;
    /** Target area, e.g. "Upper Chest" — what a replacement should match. */
    focus?: string;
    /** 'done' = user logged/changed sets today; 'planned' = still the auto-filled last-session values, not performed yet */
    status: 'done' | 'planned';
    sets: Array<{ reps: number | null; weight: number | null }>;
    personalRecord?: { reps: number; weight: number } | null;
    progressiveOverload?: string;
    setStructure?: string;
    /** The last few sessions it was actually PERFORMED before this day, newest first. */
    history?: ExerciseSession[];
  }>;
  /** The library minus what is already in today's workout. */
  library?: LibraryContext;
};

export type ExerciseSession = {
  date: string;
  isDeload?: boolean;
  sets: Array<{ reps: number | null; weight: number | null }>;
};

const HISTORY_SESSIONS = 3;

/**
 * Last sessions of `exerciseId` strictly before `beforeDate`, newest first.
 * An entry saved as a plan (`performed === false`) is a copy of the previous
 * session, not a lift, so it is skipped; `undefined` predates the flag and counts.
 */
function recentSessionsFor(logs: WorkoutLog[], exerciseId: string, beforeDate: string): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  const sorted = [...logs].filter((l) => l.date < beforeDate).sort((a, b) => b.date.localeCompare(a.date));
  for (const log of sorted) {
    const ex = log.exercises?.find((e) => e.exerciseId === exerciseId);
    if (!ex || ex.performed === false) continue;
    const sets = (ex.sets ?? [])
      .filter((s) => s.reps != null || s.weight != null)
      .map((s) => ({ reps: s.reps, weight: s.weight }));
    if (!sets.length) continue;
    out.push({ date: log.date, ...(log.isDeload ? { isDeload: true } : {}), sets });
    if (out.length >= HISTORY_SESSIONS) break;
  }
  return out;
}

export function serializeLogDayContext(
  log: WorkoutLog | null,
  profile?: CoachProfile,
  availableExercises: Exercise[] = [],
  /** Logs before this day (any window); used for each exercise's recent history. */
  recentLogs: WorkoutLog[] = [],
): LogDayContext | null {
  if (!log || !log.exercises?.length) return null;

  return {
    date: log.date,
    routineName: log.routineName,
    isDeload: log.isDeload,
    notes: log.notes,
    profile,
    library: serializeLibrary(availableExercises, new Set(log.exercises.map((ex) => ex.exerciseId))),
    exercises: log.exercises.map((ex: LoggedExercise) => {
      const shown = displayExerciseFields(ex);
      // A log row doesn't carry `targetNotes`; read it off the library entry.
      const def = availableExercises.find((e) => e.id === ex.exerciseId);
      return {
        name: shown.name,
        muscleGroup: ex.muscleGroup,
        focus: (def ? displayExerciseFields(def).targetNotes?.trim() : undefined) || undefined,
        status: ex.isProvisional ? 'planned' : 'done',
        sets: ex.sets
          .filter((s) => s.reps !== null || s.weight !== null)
          .map((s) => ({ reps: s.reps, weight: s.weight })),
        personalRecord: ex.currentPR,
        progressiveOverload: shown.progressiveOverload,
        setStructure: (ex.setStructureOverride ?? ex.setStructure) as string | undefined,
        history: recentSessionsFor(recentLogs, ex.exerciseId, log.date),
      };
    }),
  };
}

// ─── Dashboard Context (weekly progression picture) ─────────────────
// Reuses the progression results the Dashboard already computes — no new
// analytics are introduced here. Profile and library are optional extras.

export type DashboardProgressionItem = {
  name: string;
  muscleGroup: string;
  /** Target area from the library entry, e.g. "Upper Chest". */
  focus?: string;
  /** false = not trained recently; don't coach it as a current lift. */
  isActive: boolean;
  status: ProgressionResult['status'];
  isKey: boolean;
  currentBest: number;
  metricKind: ProgressionResult['metricKind'];
  weeksSincePr: number | null;
};

export type DashboardDeloadSummary = {
  weeksSinceLast: number | null;
  countInWindow: number;
  windowWeeks: number;
};

export type DashboardContext = {
  exercises: DashboardProgressionItem[];
  deload?: DashboardDeloadSummary;
  profile?: CoachProfile;
  /** The whole library: a long plateau can call for a variation swap. */
  library?: LibraryContext;
};

export function serializeDashboardContext(
  results: ProgressionResult[],
  deload?: DashboardDeloadSummary,
  profile?: CoachProfile,
  availableExercises: Exercise[] = [],
): DashboardContext {
  const defById = new Map(availableExercises.map((e) => [e.id, e]));
  return {
    exercises: results.map((r) => {
      const def = defById.get(r.exerciseId);
      return {
      name: displayExerciseName(r),
      muscleGroup: r.muscleGroup,
      focus: (def ? displayExerciseFields(def).targetNotes?.trim() : undefined) || undefined,
      isActive: r.isActive,
      status: r.status,
      isKey: r.isKey,
      currentBest: r.currentBest,
      metricKind: r.metricKind,
      weeksSincePr: r.weeksSincePr,
      };
    }),
    deload,
    ...(profile ? { profile } : {}),
    ...(availableExercises.length ? { library: serializeLibrary(availableExercises) } : {}),
  };
}

// ─── Routine-Review Context (2-3 months of training) ────────────────

export type WeeklySummary = {
  weekOf: string;
  totalSessions: number;
  volumeByMuscle: Record<string, number>;
  topLifts?: Array<{ name: string; best: string }>;
};

export type RoutineReviewContext = {
  routines: Array<{
    name: string;
    exercises: Array<{ name: string; muscleGroup: string; setStructure: string; focus?: string; target?: string }>;
  }>;
  weeklySummaries: WeeklySummary[];
  profile: CoachProfile;
  facts: CoachFactCompact[];
  /** Recorded routine changes, newest first. Optional — absent until history exists. */
  changeLog?: RoutineChangeLog;
  /** The whole library (a swap may come from another routine's exercise). */
  library?: LibraryContext;
};

type RoutineLike = {
  name: string;
  exercises: Array<{
    id?: string;
    name: string;
    muscleGroup: string;
    setStructure?: SetStructure;
  }>;
};

export function buildRoutineReviewContext(
  routines: RoutineLike[],
  logs: WorkoutLog[],
  profile: CoachProfile,
  /** Recorded routine versions. Omit (or pass []) to leave the change log out. */
  routineVersions: RoutineVersion[] = [],
  availableExercises: Exercise[] = [],
): RoutineReviewContext {
  const defById = new Map(availableExercises.map((e) => [e.id, e]));
  // 1. Compact routine summaries
  const routineSummaries = routines.map((r) => ({
    name: r.name,
    exercises: r.exercises.map((ex) => {
      // Focus and rep range come from the LIVE library entry: the copy on the
      // routine is denormalized at insert time and can be stale.
      const def = ex.id ? defById.get(ex.id) : undefined;
      const shown = def ? displayExerciseFields(def) : undefined;
      return {
        name: displayExerciseName(ex),
        muscleGroup: ex.muscleGroup,
        setStructure: ex.setStructure ?? 'normal',
        focus: shown?.targetNotes?.trim() || undefined,
        target: shown?.progressiveOverload?.trim() || undefined,
      };
    }),
  }));

  // 2. Build weekly summaries with recency decay
  const weekMap = new Map<
    string,
    { sessions: Set<string>; volumeByMuscle: Record<string, number>; topLifts: Map<string, { weight: number; reps: number }> }
  >();

  for (const log of logs) {
    // A planned-but-not-performed entry (`performed === false`) is a copy of the
    // previous session: counting it would inflate volume and sessions.
    const performed = (log.exercises ?? []).filter((ex) => ex.performed !== false);
    if (!performed.length) continue;
    const weekKey = formatISO(startOfISOWeek(parseISO(log.date)), { representation: 'date' });
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, { sessions: new Set(), volumeByMuscle: {}, topLifts: new Map() });
    }
    const week = weekMap.get(weekKey)!;
    week.sessions.add(log.date);

    for (const ex of performed) {
      const mg = ex.muscleGroup || 'Unknown';
      const hardSets = (ex.sets || []).filter((s) => (s.reps ?? 0) >= 5 && (s.reps ?? 0) <= 30).length;
      week.volumeByMuscle[mg] = (week.volumeByMuscle[mg] || 0) + hardSets;

      // Track top lift per exercise
      const shownName = displayExerciseName(ex);
      for (const s of ex.sets || []) {
        const score = (s.weight ?? 0) * (s.reps ?? 0);
        const current = week.topLifts.get(shownName);
        if (!current || score > current.weight * current.reps) {
          week.topLifts.set(shownName, { weight: s.weight ?? 0, reps: s.reps ?? 0 });
        }
      }
    }
  }

  // Sort weeks descending (most recent first)
  const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const weeklySummaries: WeeklySummary[] = [];

  for (let i = 0; i < sortedWeeks.length; i++) {
    const [weekOf, data] = sortedWeeks[i];

    // Recency decay: last 2 weeks = full detail, weeks 3-6 = volume only, 7+ = skip (bi-weekly handled by merging)
    if (i < 2) {
      // Full detail
      const topLifts = Array.from(data.topLifts.entries())
        .sort((a, b) => b[1].weight * b[1].reps - a[1].weight * a[1].reps)
        .slice(0, 5)
        .map(([name, v]) => ({ name, best: `${v.weight}kg x ${v.reps}` }));

      weeklySummaries.push({
        weekOf,
        totalSessions: data.sessions.size,
        volumeByMuscle: data.volumeByMuscle,
        topLifts,
      });
    } else if (i < 6) {
      // Volume only
      weeklySummaries.push({
        weekOf,
        totalSessions: data.sessions.size,
        volumeByMuscle: data.volumeByMuscle,
      });
    } else if (i % 2 === 0 && i < 12) {
      // Bi-weekly aggregate
      const nextWeek = sortedWeeks[i + 1];
      const merged: Record<string, number> = { ...data.volumeByMuscle };
      let totalSessions = data.sessions.size;

      if (nextWeek) {
        totalSessions += nextWeek[1].sessions.size;
        for (const [mg, sets] of Object.entries(nextWeek[1].volumeByMuscle)) {
          merged[mg] = (merged[mg] || 0) + sets;
        }
      }

      weeklySummaries.push({
        weekOf: `${weekOf} (2-week avg)`,
        totalSessions,
        volumeByMuscle: merged,
      });
    }
  }

  // 3. Build facts using existing analysis
  const { facts } = buildCoachFactsCompact(
    profile,
    null,
    { weekly: buildWeeklyVolumeFlat(logs) },
  );

  // 4. Compact routine change log (capped; see buildRoutineChangeLog)
  const changeLog = routineVersions.length > 0
    ? buildRoutineChangeLog(routineVersions)
    : undefined;

  return {
    routines: routineSummaries,
    weeklySummaries,
    profile,
    facts,
    ...(changeLog && changeLog.entries.length > 0 ? { changeLog } : {}),
    ...(availableExercises.length ? { library: serializeLibrary(availableExercises) } : {}),
  };
}

// Helper: flatten logs into WeeklyVolume-like array for buildCoachFactsCompact
function buildWeeklyVolumeFlat(logs: WorkoutLog[]) {
  const result: Array<{ week: string; muscleGroup: string; hardSets: number }> = [];
  const byWeek: Record<string, Record<string, number>> = {};

  for (const log of logs) {
    const wk = formatISO(startOfISOWeek(parseISO(log.date)), { representation: 'date' });
    byWeek[wk] = byWeek[wk] || {};
    for (const ex of log.exercises ?? []) {
      if (ex.performed === false) continue; // planned copy, not volume
      const mg = ex.muscleGroup || 'Unknown';
      const hardSets = (ex.sets || []).filter((s) => (s.reps ?? 0) >= 5 && (s.reps ?? 0) <= 30).length;
      byWeek[wk][mg] = (byWeek[wk][mg] || 0) + hardSets;
    }
  }

  for (const [week, groups] of Object.entries(byWeek)) {
    for (const [muscleGroup, hardSets] of Object.entries(groups)) {
      result.push({ week, muscleGroup, hardSets });
    }
  }

  return result;
}

// ─── Exercise-Library Context (the Exercises page) ──────────────────

export type ExerciseLibraryContext = {
  profile: CoachProfile;
  /** Every exercise, grouped by muscle, with how it is used right now. */
  muscles: Array<{
    muscleGroup: string;
    /** Average weekly hard sets over the window (performed work only). */
    avgWeeklySets: number;
    exercises: Array<{
      name: string;
      focus?: string;
      target?: string;
      /** Names of the routines that include it. */
      inRoutines: string[];
      /** Last date it was actually performed in the window, if any. */
      lastDone?: string;
    }>;
  }>;
  windowWeeks: number;
};

/**
 * `logs` should cover the last `windowWeeks` weeks. Planned-but-not-performed
 * entries (`performed === false`) are copies of a previous session, so they
 * count neither as volume nor as "last done".
 */
export function buildExerciseLibraryContext(
  exercises: Exercise[],
  routines: RoutineLike[],
  logs: WorkoutLog[],
  profile: CoachProfile,
  windowWeeks: number,
): ExerciseLibraryContext {
  const lastDone = new Map<string, string>();
  const setsByMuscle: Record<string, number> = {};
  for (const log of logs) {
    for (const ex of log.exercises ?? []) {
      if (ex.performed === false) continue;
      if ((lastDone.get(ex.exerciseId) ?? '') < log.date) lastDone.set(ex.exerciseId, log.date);
      if (log.isDeload) continue;
      const mg = ex.muscleGroup || 'Unknown';
      setsByMuscle[mg] = (setsByMuscle[mg] ?? 0) +
        (ex.sets ?? []).filter((s) => (s.reps ?? 0) >= 5 && (s.reps ?? 0) <= 30).length;
    }
  }

  const routinesById = new Map<string, string[]>();
  for (const r of routines) {
    for (const ex of r.exercises) {
      if (!ex.id) continue;
      routinesById.set(ex.id, [...(routinesById.get(ex.id) ?? []), r.name]);
    }
  }

  // Seeded with every muscle group so an empty one still shows up as a gap.
  const byMuscle = new Map<string, ExerciseLibraryContext['muscles'][number]['exercises']>(
    MUSCLE_GROUPS_LIST.map((mg) => [mg, []]),
  );
  for (const ex of dedupeExercisesByNameAndMuscle(exercises)) {
    const shown = displayExerciseFields(ex);
    const mg = ex.muscleGroup || 'Unknown';
    if (!byMuscle.has(mg)) byMuscle.set(mg, []);
    byMuscle.get(mg)!.push({
      name: shown.name,
      focus: shown.targetNotes?.trim() || undefined,
      target: shown.progressiveOverload?.trim() || undefined,
      inRoutines: routinesById.get(ex.id) ?? [],
      lastDone: lastDone.get(ex.id),
    });
  }

  return {
    profile,
    windowWeeks,
    muscles: Array.from(byMuscle, ([muscleGroup, list]) => ({
      muscleGroup,
      avgWeeklySets: Math.round(((setsByMuscle[muscleGroup] ?? 0) / Math.max(1, windowWeeks)) * 10) / 10,
      exercises: list,
    })),
  };
}
