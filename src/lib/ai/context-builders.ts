// ─── Context Builders for AI Coach Chat ─────────────────────────────
// Serialize page data into compact context for LLM system prompts.

import type { WorkoutLog, LoggedExercise } from '@/types';
import type { SetStructure } from '@/types/setStructure';
import { parseISO, startOfISOWeek, formatISO } from 'date-fns';
import { buildCoachFactsCompact, type CoachFactCompact } from '@/lib/analysis';

// ─── Log-Day Context (current workout) ──────────────────────────────

export type LogDayContext = {
  date: string;
  routineName?: string;
  isDeload?: boolean;
  notes?: string;
  profile?: { goal?: string; daysPerWeekTarget?: number; constraints?: string[] };
  exercises: Array<{
    name: string;
    muscleGroup: string;
    sets: Array<{ reps: number | null; weight: number | null }>;
    personalRecord?: { reps: number; weight: number } | null;
    progressiveOverload?: string;
    setStructure?: string;
  }>;
};

export function serializeLogDayContext(
  log: WorkoutLog | null,
  profile?: { goal?: string; daysPerWeekTarget?: number; constraints?: string[] },
): LogDayContext | null {
  if (!log || !log.exercises?.length) return null;

  return {
    date: log.date,
    routineName: log.routineName,
    isDeload: log.isDeload,
    notes: log.notes,
    profile,
    exercises: log.exercises.map((ex: LoggedExercise) => ({
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      sets: ex.sets
        .filter((s) => s.reps !== null || s.weight !== null)
        .map((s) => ({ reps: s.reps, weight: s.weight })),
      personalRecord: ex.currentPR,
      progressiveOverload: ex.progressiveOverload,
      setStructure: (ex.setStructureOverride ?? ex.setStructure) as string | undefined,
    })),
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
    exercises: Array<{ name: string; muscleGroup: string; setStructure: string }>;
  }>;
  weeklySummaries: WeeklySummary[];
  profile: { goal?: string; daysPerWeekTarget?: number };
  facts: CoachFactCompact[];
};

type RoutineLike = {
  name: string;
  exercises: Array<{
    name: string;
    muscleGroup: string;
    setStructure?: SetStructure;
  }>;
};

type ProfileLike = {
  goal?: string;
  daysPerWeekTarget?: number;
};

export function buildRoutineReviewContext(
  routines: RoutineLike[],
  logs: WorkoutLog[],
  profile: ProfileLike,
): RoutineReviewContext {
  // 1. Compact routine summaries
  const routineSummaries = routines.map((r) => ({
    name: r.name,
    exercises: r.exercises.map((ex) => ({
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      setStructure: ex.setStructure ?? 'normal',
    })),
  }));

  // 2. Build weekly summaries with recency decay
  const weekMap = new Map<
    string,
    { sessions: Set<string>; volumeByMuscle: Record<string, number>; topLifts: Map<string, { weight: number; reps: number }> }
  >();

  for (const log of logs) {
    const weekKey = formatISO(startOfISOWeek(parseISO(log.date)), { representation: 'date' });
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, { sessions: new Set(), volumeByMuscle: {}, topLifts: new Map() });
    }
    const week = weekMap.get(weekKey)!;
    week.sessions.add(log.date);

    for (const ex of log.exercises ?? []) {
      const mg = ex.muscleGroup || 'Unknown';
      const hardSets = (ex.sets || []).filter((s) => (s.reps ?? 0) >= 5 && (s.reps ?? 0) <= 30).length;
      week.volumeByMuscle[mg] = (week.volumeByMuscle[mg] || 0) + hardSets;

      // Track top lift per exercise
      for (const s of ex.sets || []) {
        const score = (s.weight ?? 0) * (s.reps ?? 0);
        const current = week.topLifts.get(ex.name);
        if (!current || score > current.weight * current.reps) {
          week.topLifts.set(ex.name, { weight: s.weight ?? 0, reps: s.reps ?? 0 });
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

  return {
    routines: routineSummaries,
    weeklySummaries,
    profile: { goal: profile.goal, daysPerWeekTarget: profile.daysPerWeekTarget },
    facts,
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
