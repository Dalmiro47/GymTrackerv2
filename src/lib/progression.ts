/**
 * @fileOverview Pure, testable per-exercise progression/stall detector.
 *
 * The primary signal is "time since last PR" (PR recency), not a percentage
 * delta: with Epley, one extra rep at 8-10 reps yields a near-fixed ~2.5%
 * delta, so a percentage is essentially a boolean "added one rep" and carries
 * little information. We instead track when each lift last set a new best, and
 * use the recent-vs-prior comparison only to detect regression.
 *
 * This module is intentionally decoupled from React and Firestore: it imports
 * only domain types and date-fns. Callers fetch the logs (see `getLogsSince` in
 * trainingLogService) and pass them in.
 */
import type { WorkoutLog } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import { parseISO, differenceInCalendarDays } from 'date-fns';

// --- Tunable constants ---
export const WINDOW_SESSIONS = 6;
export const MIN_SESSIONS = 4;
export const REGRESS_THRESHOLD = 0.025;
export const RECENT_PR_DAYS = 14;
// Recency-of-logging cutoff for the "active" display signal. Independent of the
// LOOKBACK_WEEKS history used for PR/status, so weeksSincePr stays accurate.
export const ACTIVE_WEEKS = 4;

export type ProgressionStatus = 'progressing' | 'plateau' | 'regressing' | 'insufficient';

/** Whether the session metric is an estimated 1RM (kg) or a max-reps count. */
export type ProgressionMetricKind = 'e1rm' | 'reps';

export interface ProgressionResult {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  status: ProgressionStatus;
  /** Key lift (compound) vs accessory — drives noise suppression in the UI. */
  isKey: boolean;
  /** Current best — recentBest e1RM/reps, rounded. Used for trend reasoning (e.g. coach). */
  currentBest: number;
  metricKind: ProgressionMetricKind;
  /** The actual best set behind the PR: weight (kg) × reps. null when no PR. For
   *  bodyweight moves weight is 0 and reps is the rep PR. */
  pr: { weight: number; reps: number } | null;
  /** Whole weeks since the last running-max PR. null when no PR in history. */
  weeksSincePr: number | null;
  /** Date (YYYY-MM-DD) the current running-max PR was set, or null. */
  lastPrDate: string | null;
  /** Most recent session date (YYYY-MM-DD) in the loaded history. */
  lastLoggedDate: string;
  /** Logged within ACTIVE_WEEKS of now — a display/declutter signal only. */
  isActive: boolean;
  /** Per-session metric series (chronological window) for a sparkline, rounded. */
  series: number[];
}

interface SessionContribution {
  date: string;
  sets: { reps: number; weight: number }[];
}

interface ExerciseHistory {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  trackProgression?: boolean;
  sessions: SessionContribution[];
}

/** Epley estimated 1RM. Loses accuracy above ~12 reps but relative trend holds. */
const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Heuristic name matching for the key/accessory split, used only when the
// exercise has no explicit `trackProgression` override. Key patterns win ties.
const KEY_PATTERNS = ['squat', 'deadlift', 'rdl', 'press', 'bench', 'row', 'pulldown', 'pull up', 'pullup', 'pull-up', 'hip thrust'];
const ACCESSORY_PATTERNS = ['raise', 'curl', 'extension', 'fly', 'flye', 'calf', 'crunch', 'abductor', 'leg extension', 'leg curl'];

function classifyKey(name: string, trackProgression?: boolean): boolean {
  if (typeof trackProgression === 'boolean') return trackProgression;
  const n = (name || '').toLowerCase();
  if (KEY_PATTERNS.some(p => n.includes(p))) return true;
  if (ACCESSORY_PATTERNS.some(p => n.includes(p))) return false;
  // Unknown movements default to accessory to keep the alarm signal low-noise.
  return false;
}

type SessionPeak = { value: number; weight: number; reps: number };

/**
 * Best set of a session by the chosen metric, keeping the actual weight/reps
 * so callers can surface the real PR rather than an estimate. Returns null when
 * the exercise was not meaningfully performed (no reps), letting the caller
 * drop empty sessions.
 */
function sessionPeak(
  sets: { reps: number; weight: number }[],
  kind: ProgressionMetricKind,
): SessionPeak | null {
  let best: SessionPeak | null = null;
  for (const s of sets) {
    const reps = num(s.reps);
    if (reps <= 0) continue;
    const weight = num(s.weight);
    const value = kind === 'e1rm' ? epley(weight, reps) : reps;
    if (!best || value > best.value) best = { value, weight, reps };
  }
  return best;
}

/**
 * Classify progression for every exercise found in `logs`.
 *
 * @param logs Workout logs to analyse. Order does not matter (sorted internally).
 *             Callers should pass the desired window and may exclude deload
 *             sessions to avoid false regressions.
 * @param now  Reference "today" for PR-recency math (injectable for tests).
 */
export function computeProgression(logs: WorkoutLog[], now: Date = new Date()): ProgressionResult[] {
  // 1. Group sets by exercise, then by session date.
  const byExercise = new Map<string, ExerciseHistory>();

  for (const log of logs) {
    if (!log?.date || !Array.isArray(log.exercises)) continue;
    for (const ex of log.exercises) {
      if (!ex?.exerciseId) continue;
      let hist = byExercise.get(ex.exerciseId);
      if (!hist) {
        hist = {
          exerciseId: ex.exerciseId,
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          sessions: [],
        };
        byExercise.set(ex.exerciseId, hist);
      }
      if (typeof ex.trackProgression === 'boolean') hist.trackProgression = ex.trackProgression;
      hist.sessions.push({
        date: log.date,
        sets: (ex.sets || []).map(s => ({ reps: num(s.reps), weight: num(s.weight) })),
      });
    }
  }

  const results: ProgressionResult[] = [];

  for (const hist of byExercise.values()) {
    // Metric: e1RM if the exercise ever used weight, else pure reps.
    const hasWeight = hist.sessions.some(sess => sess.sets.some(s => s.weight > 0));
    const metricKind: ProgressionMetricKind = hasWeight ? 'e1rm' : 'reps';
    const isKey = classifyKey(hist.name, hist.trackProgression);

    // Activity signal: recency of logging, decoupled from the PR/status window.
    // Off-routine training is common, so logging recency (not routine
    // membership) is the chosen "is this exercise still in rotation?" signal.
    const lastLoggedDate = hist.sessions.reduce(
      (max, sess) => (sess.date > max ? sess.date : max),
      hist.sessions[0].date,
    );
    const isActive = differenceInCalendarDays(now, parseISO(lastLoggedDate)) <= ACTIVE_WEEKS * 7;

    // Chronological per-session peak, dropping sessions with no real work.
    const sessionMetrics = hist.sessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(sess => {
        const peak = sessionPeak(sess.sets, metricKind);
        return peak ? { date: sess.date, ...peak } : null;
      })
      .filter((s): s is { date: string } & SessionPeak => s !== null);

    // 2-3. PR detection: walk the whole loaded history, recording a PR every
    // time the metric reaches a new running maximum. A max set on the very
    // first session is valid and means "no PR since then".
    //
    // NOTE: PRs are only detectable within the loaded history. weeksSincePr
    // accuracy improves if the Dashboard fetch window is widened beyond the
    // current range (see LOOKBACK_WEEKS in ProgressionSection), since a PR set
    // before the loaded window will read as if it were set on the first loaded
    // session.
    let prPeak: ({ date: string } & SessionPeak) | null = null;
    for (const s of sessionMetrics) {
      if (!prPeak || s.value > prPeak.value) prPeak = s;
    }
    const lastPrDate = prPeak ? prPeak.date : null;
    const pr = prPeak ? { weight: prPeak.weight, reps: prPeak.reps } : null;
    const daysSincePr = lastPrDate ? differenceInCalendarDays(now, parseISO(lastPrDate)) : null;
    const weeksSincePr = daysSincePr === null ? null : Math.floor(daysSincePr / 7);

    // Window for recent-vs-prior comparison.
    const window = sessionMetrics.slice(-WINDOW_SESSIONS);
    const windowSeries = window.map(s => Math.round(s.value));

    // d. Insufficient data.
    if (window.length < MIN_SESSIONS) {
      results.push({
        exerciseId: hist.exerciseId,
        name: hist.name,
        muscleGroup: hist.muscleGroup,
        status: 'insufficient',
        isKey,
        currentBest: windowSeries.length ? Math.max(...windowSeries) : 0,
        metricKind,
        pr,
        weeksSincePr,
        lastPrDate,
        lastLoggedDate,
        isActive,
        series: windowSeries,
      });
      continue;
    }

    // 4. recentBest (more recent half) vs priorBest (earlier half).
    const mid = Math.floor(window.length / 2);
    const priorBest = Math.max(...window.slice(0, mid).map(s => s.value));
    const recentBest = Math.max(...window.slice(mid).map(s => s.value));

    // 5. Classify. PR recency wins, then regression, else plateau.
    const recentPr = daysSincePr !== null && daysSincePr <= RECENT_PR_DAYS;
    const regressing = priorBest > 0 && (priorBest - recentBest) / priorBest > REGRESS_THRESHOLD;

    let status: ProgressionStatus;
    if (recentPr) status = 'progressing';
    else if (regressing) status = 'regressing';
    else status = 'plateau';

    results.push({
      exerciseId: hist.exerciseId,
      name: hist.name,
      muscleGroup: hist.muscleGroup,
      status,
      isKey,
      currentBest: Math.round(recentBest),
      metricKind,
      pr,
      weeksSincePr,
      lastPrDate,
      lastLoggedDate,
      isActive,
      series: windowSeries,
    });
  }

  return results;
}

/**
 * Display/sort priority by status color band, so the list reads top-to-bottom
 * red → amber → green → grey (attention first):
 *   0 regressing (red) · 1 plateau key (amber) · 2 progressing (green) ·
 *   3 plateau accessory (grey) · 4 insufficient (grey).
 */
function rank(r: ProgressionResult): number {
  switch (r.status) {
    case 'regressing':
      return 0;
    case 'plateau':
      return r.isKey ? 1 : 3;
    case 'progressing':
      return 2;
    default:
      return 4; // insufficient
  }
}

/** Sort for the dashboard. Within a band, key lifts first, then the most stale (longest since PR). */
export function sortProgression(results: ProgressionResult[]): ProgressionResult[] {
  return results.slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.isKey !== b.isKey) return a.isKey ? -1 : 1;
    const wa = a.weeksSincePr ?? -1;
    const wb = b.weeksSincePr ?? -1;
    return wb - wa;
  });
}
