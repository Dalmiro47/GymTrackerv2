// server-only: src/lib/mcp/tools.write.ts
// The write tools of the MCP endpoint: they add exercises and routines, edit the
// exercise list of a routine, edit a few fields of an exercise and set the
// schedule of a day. No tool takes
// a uid, and none removes a document. Every check runs before the batch is opened, so a refused call writes
// nothing. Documents come only from the builders the app uses (routineDoc,
// exerciseDoc, routineHistoryPlan), so the app and the MCP store the same shape.
import { z } from 'zod4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Exercise, ExerciseData, ExercisePerformanceEntry, LoggedSet, MuscleGroup, PersonalRecord, RoutineExercise, WarmupConfig, WorkoutLog } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import { MUSCLE_GROUPS_LIST, WARMUP_TEMPLATES } from '@/lib/constants';
import { buildExerciseDoc } from '@/lib/exerciseDoc';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import { buildExerciseDocId, toSlug } from '@/lib/ids';
import { buildRoutineCreateFields, buildRoutineUpdateFields, type RoutineExerciseEntry } from '@/lib/routineDoc';
import { addRoutineExerciseAt, removeRoutineExerciseAt, replaceRoutineExerciseAt } from '@/lib/routineEditing';
import { planRoutineVersions } from '@/lib/routineHistoryPlan';
import { bestPRFromLogs, needsPRRescan, planPerformanceEntry } from '@/lib/performanceEntryPlan';
import { isBetterPR } from '@/lib/pr';
import { parseRepRange } from '@/lib/repGoal';
import { groupSizeOf, newIncompleteRuns } from '@/lib/setStructureGroups';
import { slugify } from '@/lib/utils';
import { buildWorkoutLogDoc, plannedLogExercise, prefillSetsFrom } from '@/lib/workoutLogDoc';
import { SET_STRUCTURE_OPTIONS } from '@/types/setStructure';
import { withTimeout } from './limits';
import { isSafeDocId, type McpRepoWithWriteReads, type RawDoc } from './repo.server';
import {
  MAX_COACH_NOTES_LENGTH,
  MAX_DURATION_MIN,
  type ExerciseFieldChange,
  type McpWriteRepo,
  type PerformanceEntryWrite,
  type RoutineCascade,
} from './repo.write.server';
import { errorResult, jsonResult, type ToolResult } from './results';
import {
  MAX_ACTIVITY_LENGTH,
  MAX_SCHEDULE_ITEMS,
  SCHEDULE_DAYS_AHEAD,
  readScheduleItems,
  scheduleWindow,
  type ScheduleItem,
} from './schedule';
import { WEEK_TIME_ZONE, addDays, berlinMidnightMs, berlinYmd, isRealYmd } from './week';

// ─── Limits (MCP only; the app has no upper bounds) ──────────────────

export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_ROUTINE_EXERCISES = 30;
/** A stored routine may be longer than the MCP limit; a reorder must still be able to name every id. */
const MAX_REORDER_IDS = 100;
export const MAX_LOAD_INCREMENT_KG = 25;
const LOAD_INCREMENT_STEP_KG = 0.25;
const DUMBBELL_LOADS = ['perHand', 'total'] as const;
/** The most sets log_set stores for one exercise of a session. */
export const MAX_SETS_PER_EXERCISE = 20;
/** Same bounds as the app's save: reps 1 to 99, weight 0 to 999 in 0.5 steps. */
const MAX_REPS = 99;
const MAX_WEIGHT_KG = 999;
const WEIGHT_STEP_KG = 0.5;
/** How far back start_workout looks for the last session of an exercise before it reads the performance entry. */
export const PREFILL_WINDOW_DAYS = 180;
/** A computed session duration above this is not trusted: the session was probably left open. */
export const SUSPECT_DURATION_MIN = 180;
const MINUTE_MS = 60_000;

// ─── Input schemas ───────────────────────────────────────────────────

const docId = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeDocId, { message: 'must be a plain id with no "/"' });

const text = z.string().trim().max(MAX_TEXT_LENGTH).optional();

// Strict: an item takes the keys of its kind only. The routine name is read from the routine, never from the input.
const scheduleItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('routine'), routineId: docId.describe('Routine id from list_routines') }),
  z.strictObject({
    kind: z.literal('activity'),
    activity: z.string().trim().min(1).max(MAX_ACTIVITY_LENGTH).describe('Short free text, e.g. "boxing", at most 40 characters'),
  }),
  z.strictObject({ kind: z.literal('rest') }),
]);

export const writeToolSchemas = {
  create_exercise: z.object({
    name: z.string().trim().min(2).max(MAX_NAME_LENGTH).describe('Exercise name, 2 to 80 characters'),
    muscleGroup: z.enum(MUSCLE_GROUPS_LIST).describe('Muscle group (stored English key)'),
    targetNotes: text.describe('Target area, e.g. "Upper chest"'),
    exerciseSetup: text.describe('Setup notes, e.g. seat position'),
    progressiveOverload: text.describe('Rep range or progression rule, e.g. "8-12 reps"'),
    instructions: text.describe('How to do the exercise'),
  }),
  create_routine: z.object({
    name: z.string().trim().min(3).max(MAX_NAME_LENGTH).describe('Routine name, 3 to 80 characters'),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional().describe('Short description, at most 500 characters'),
    exerciseIds: z
      .array(docId)
      .min(1)
      .max(MAX_ROUTINE_EXERCISES)
      .describe('Exercise ids from list_exercises, in routine order, 1 to 30, each at most once'),
  }),
  add_exercise_to_routine: z.object({
    routineId: docId.describe('Routine id from list_routines'),
    exerciseId: docId.describe('Exercise id from list_exercises'),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_ROUTINE_EXERCISES)
      .optional()
      .describe('0-based position to insert at; omit to add at the end'),
  }),
  replace_exercise_in_routine: z.object({
    routineId: docId.describe('Routine id from list_routines'),
    index: z.number().int().min(0).max(MAX_REORDER_IDS - 1).describe('0-based position of the exercise to replace'),
    expectedExerciseId: docId.describe('Id of the exercise that is at that position now'),
    newExerciseId: docId.describe('Id of the exercise to put there, from list_exercises'),
  }),
  remove_exercise_from_routine: z.object({
    routineId: docId.describe('Routine id from list_routines'),
    exerciseId: docId.describe('Id of the exercise to take out of the routine'),
  }),
  reorder_routine_exercises: z.object({
    routineId: docId.describe('Routine id from list_routines'),
    exerciseIds: z
      .array(docId)
      .min(1)
      .max(MAX_REORDER_IDS)
      .describe('Every exercise id of the routine, once each, in the new order'),
  }),
  set_routine_set_structure: z.object({
    routineId: docId.describe('Routine id from list_routines'),
    setStructure: z.enum(SET_STRUCTURE_OPTIONS).describe('The set structure to give to every exercise in exerciseIds'),
    exerciseIds: z
      .array(docId)
      .min(1)
      .max(MAX_REORDER_IDS)
      .describe(
        'Ids of exercises of the routine, each once, in any order: exactly 2 for superset, exactly 3 for triset, 1 or more for the others',
      ),
  }),
  set_schedule_day: z.object({
    date: z
      .string()
      .refine(isRealYmd, { message: 'must be a calendar day like 2026-11-16' })
      .describe('The day to schedule, "YYYY-MM-DD": Monday of the current week to 28 days from today (Europe/Berlin)'),
    items: z
      .array(scheduleItem)
      .max(MAX_SCHEDULE_ITEMS)
      .describe(
        'Everything scheduled for that day, 0 to 3 items; [] clears the day. kind "routine" (a gym session), ' +
          '"activity" (anything else) or "rest"; "rest" must be the only item, and a routine can be listed once',
      ),
  }),
  // Strict: the day is always today in Europe/Berlin, so a date key is refused, not dropped.
  start_workout: z.strictObject({
    routineId: docId.optional().describe('Routine id from list_routines; omit to use the one routine scheduled today'),
  }),
  log_set: z.strictObject({
    exerciseId: docId.describe('Id of an exercise of the open session, from get_current_workout'),
    setNumber: z
      .number()
      .int()
      .min(1)
      .max(MAX_SETS_PER_EXERCISE)
      .describe('1-based number of the set within this exercise: the next one, or a logged one together with overwrite'),
    weight: z
      .number()
      .min(0)
      .max(MAX_WEIGHT_KG)
      .multipleOf(WEIGHT_STEP_KG)
      .describe('Weight in kg, 0 to 999 in steps of 0.5; 0 for a bodyweight set'),
    reps: z.number().int().min(1).max(MAX_REPS).describe('Repetitions done, 1 to 99'),
    overwrite: z.boolean().optional().describe('true replaces the values of a set that is already logged at setNumber'),
  }),
  finish_workout: z.strictObject({
    coachNotes: z
      .string()
      .trim()
      .min(1)
      .max(MAX_COACH_NOTES_LENGTH)
      .describe('The coach summary of the session for next time, 1 to 2000 characters'),
    durationMin: z
      .number()
      .int()
      .min(1)
      .max(MAX_DURATION_MIN)
      .optional()
      .describe('How long the session took, in whole minutes, 1 to 300; omit to use the time since start_workout'),
  }),
  // Strict: a key this tool does not edit (name, muscleGroup...) is refused, not dropped.
  update_exercise: z.strictObject({
    exerciseId: docId.describe('Exercise id from list_exercises'),
    targetNotes: text.describe('Target area, e.g. "Upper chest"; "" clears it'),
    exerciseSetup: text.describe('Setup notes, e.g. seat position; "" clears it'),
    progressiveOverload: text.describe('Rep range, written like "8-12 reps"; "" clears it'),
    warmupTemplate: z.enum(WARMUP_TEMPLATES).optional().describe('Warm-up template'),
    loadIncrementKg: z
      .number()
      .gt(0)
      .max(MAX_LOAD_INCREMENT_KG)
      .multipleOf(LOAD_INCREMENT_STEP_KG)
      .nullable()
      .optional()
      .describe(
        'Smallest weight step in kg, in the same unit as the logged weight, e.g. 2.5 or 5: above 0, at most 25, a multiple of 0.25; ' +
          'with dumbbellLoad "total", a step of 2 kg per dumbbell is 4; null removes it',
      ),
    dumbbellLoad: z
      .enum(DUMBBELL_LOADS)
      .nullable()
      .optional()
      .describe(
        '"perHand": the logged weight is the weight of one dumbbell. "total": the logged weight is both dumbbells added together. null removes it',
      ),
  }),
};

type Args<K extends keyof typeof writeToolSchemas> = z.infer<(typeof writeToolSchemas)[K]>;

// ─── Errors ──────────────────────────────────────────────────────────

export type WriteErrorCode =
  | 'not_found'
  | 'duplicate_exercise'
  | 'already_in_routine'
  | 'slot_mismatch'
  | 'not_in_routine'
  | 'last_exercise'
  | 'order_mismatch'
  | 'routine_full'
  | 'group_size'
  | 'not_consecutive'
  | 'incomplete_group'
  | 'id_unavailable'
  | 'no_fields'
  | 'out_of_window'
  | 'too_many_items'
  | 'rest_not_alone'
  | 'duplicate_routine'
  | 'session_open'
  | 'log_exists'
  | 'no_scheduled_routine'
  | 'ambiguous_schedule'
  | 'no_session'
  | 'not_in_log'
  | 'ambiguous_exercise'
  | 'set_number'
  | 'set_exists'
  | 'duration_suspect'
  | 'conflict'
  | 'write_failed';

class ToolError extends Error {
  constructor(readonly code: WriteErrorCode, message: string) {
    super(message);
  }
}

const refuse = (code: WriteErrorCode, message: string): never => {
  throw new ToolError(code, message);
};

const NOTHING_WRITTEN = 'Nothing was written.';

/**
 * Runs a tool body. A refusal answers `code: message`. Anything else that throws
 * here happened before the batch was opened (a read failed), so nothing was written.
 */
async function run(name: string, fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return jsonResult(await fn());
  } catch (error) {
    if (error instanceof ToolError) return errorResult(`${error.code}: ${error.message}`);
    // The error itself is not logged: Firestore messages can carry the document path.
    console.error(`[mcp] ${name}_failed`);
    return errorResult(`write_failed: Could not read the data this change needs. ${NOTHING_WRITTEN} Try again later.`);
  }
}

/** gRPC ALREADY_EXISTS (6): a batch `create` met a document that is already there. */
const isAlreadyExists = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
};

/** gRPC NOT_FOUND (5): a batch `update` met a document that is no longer there. */
const isNotFound = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 5 || code === 'not-found' || code === 'NOT_FOUND';
};

const REREAD_ROUTINE = 'Read the routine or the exercise again before any retry.';
const REREAD_SESSION = 'Call get_current_workout before any retry.';

/**
 * Runs the one batch of a tool. A batch is atomic: a failed commit writes nothing.
 * `reread` tells the caller what to read before a retry.
 */
async function commit(name: string, write: () => Promise<void>, reread = REREAD_ROUTINE): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (isAlreadyExists(error)) {
      refuse('conflict', `A document with the same id was created at the same time. ${NOTHING_WRITTEN} Read the data again, then retry.`);
    }
    if (isNotFound(error)) {
      refuse('conflict', `The document to change was removed at the same time. ${NOTHING_WRITTEN} Read the data again.`);
    }
    console.error(`[mcp] ${name}_commit_failed`);
    refuse('write_failed', `The write did not complete. ${reread}`);
  }
}

// ─── Stored documents (read as unknown) ──────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

const identityKey = (name: string, muscleGroup: string) =>
  `${name.trim().toLowerCase()}::${muscleGroup.trim().toLowerCase()}`;

const EXERCISE_TEXT_FIELDS = ['targetNotes', 'exerciseSetup', 'progressiveOverload'] as const;

const textOf = (data: Record<string, unknown>, key: (typeof EXERCISE_TEXT_FIELDS)[number]): string =>
  typeof data[key] === 'string' ? (data[key] as string) : '';

const warmupTemplateOf = (data: Record<string, unknown>): string | undefined =>
  typeof data.warmup === 'object' && data.warmup !== null ? str((data.warmup as { template?: unknown }).template) : undefined;

/** An exercise as `update_exercise` answers it: the fields the tool can change, plus the parsed rep range. */
const exerciseOut = (id: string, data: Record<string, unknown>) => {
  const progressiveOverload = str(data.progressiveOverload);
  return {
    id,
    name: str(data.name) ?? '',
    muscleGroup: str(data.muscleGroup) ?? '',
    targetNotes: str(data.targetNotes),
    exerciseSetup: str(data.exerciseSetup),
    progressiveOverload,
    repRange: parseRepRange(progressiveOverload),
    warmupTemplate: warmupTemplateOf(data),
    loadIncrementKg: typeof data.loadIncrementKg === 'number' ? data.loadIncrementKg : undefined,
    dumbbellLoad: str(data.dumbbellLoad),
  };
};

type StoredRoutine = { id: string; name: string; description?: string; exercises: RoutineExercise[] };

const routineOut = (id: string, name: string, description: string | undefined, exercises: RoutineExerciseEntry[]) => ({
  id,
  name,
  description: description || undefined,
  exercises: exercises.map(ex => ({ id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup, setStructure: ex.setStructure })),
});

// ─── Workout session (stored logs are read as unknown) ───────────────

type StoredLogExercise = Record<string, unknown> & { exerciseId: string };
type StoredSet = { id?: unknown; reps?: unknown; weight?: unknown };
/** The open log of today or yesterday. `date` is its id: the day the session started. */
type OpenSession = { date: string; data: Record<string, unknown>; exercises: StoredLogExercise[] };

const isOpenLog = (doc: RawDoc) => doc.data.sessionOpen === true;

/** The first exercise that is still planned: what comes next in the session. */
const nextPlanned = (exercises: Record<string, unknown>[]) => {
  const next = exercises.find(ex => ex.performed === false);
  return next ? { exerciseId: str(next.exerciseId) ?? '', name: str(next.name) ?? '' } : null;
};

const prOut = (pr: { reps: number; weight: number } | null) => (pr ? { weight: pr.weight, reps: pr.reps } : null);

// ─── Handlers ────────────────────────────────────────────────────────

export type WriteToolDeps = {
  repo: McpRepoWithWriteReads;
  writes: McpWriteRepo;
  now?: () => Date;
};

export function createWriteTools({ repo, writes, now = () => new Date() }: WriteToolDeps) {
  /** A library exercise as the routine editor holds it. */
  async function loadExercise(id: string): Promise<Exercise> {
    const doc = await repo.getExercise(id);
    if (!doc) return refuse('not_found', `No exercise with id "${id}" in the library. ${NOTHING_WRITTEN}`);
    const name = str(doc.data.name);
    const muscleGroup = str(doc.data.muscleGroup);
    if (!name || !muscleGroup) {
      return refuse('conflict', `The stored exercise "${id}" has no name or muscle group. ${NOTHING_WRITTEN} Fix it in the app.`);
    }
    return {
      id: doc.id,
      name,
      muscleGroup: muscleGroup as MuscleGroup,
      targetNotes: str(doc.data.targetNotes),
      exerciseSetup: str(doc.data.exerciseSetup),
      progressiveOverload: str(doc.data.progressiveOverload),
      dataAiHint: str(doc.data.dataAiHint),
    };
  }

  async function loadRoutine(id: string): Promise<StoredRoutine> {
    const doc = await repo.getRoutine(id);
    if (!doc) return refuse('not_found', `No routine with id "${id}". ${NOTHING_WRITTEN}`);
    return toStoredRoutine(doc);
  }

  function toStoredRoutine(doc: RawDoc): StoredRoutine {
    const id = doc.id;
    const raw = Array.isArray(doc.data.exercises) ? doc.data.exercises : [];
    // The whole list is rewritten, so an entry this code cannot read must stop the
    // tool: rewriting it would lose or corrupt that entry.
    const readable = raw.every(
      (ex): ex is Record<string, unknown> =>
        typeof ex === 'object' && ex !== null && !!str(ex.id) && !!str(ex.name) && !!str(ex.muscleGroup),
    );
    if (!readable) {
      return refuse('conflict', `Routine "${id}" has a stored exercise this tool cannot read. ${NOTHING_WRITTEN} Edit it in the app.`);
    }
    return {
      id: doc.id,
      name: str(doc.data.name) ?? '',
      description: typeof doc.data.description === 'string' ? doc.data.description : undefined,
      exercises: raw as unknown as RoutineExercise[],
    };
  }

  /** Every stored version of the routine. Refuses rather than guess which one is the latest. */
  async function loadHistory(routineId: string): Promise<RoutineVersion[]> {
    const list = await repo.listRoutineHistory(routineId);
    const readable = list.rows.every(
      row => typeof row.data.createdAtMs === 'number' && Number.isFinite(row.data.createdAtMs) && typeof row.data.snapshotHash === 'string',
    );
    if (list.truncated || !readable) {
      return refuse('conflict', `The change history of routine "${routineId}" cannot be read in full. ${NOTHING_WRITTEN}`);
    }
    return list.rows.map(row => ({ ...(row.data as unknown as RoutineVersion), id: row.id }));
  }

  /**
   * Stores a new exercise list for an existing routine: one batch with its history versions.
   * It refuses a list that creates or changes an incomplete superset or triset; an
   * incomplete group that was already stored and is untouched is tolerated. `groupHint`
   * tells the caller what to do instead. `groupsBefore` is the list the groups are
   * compared with, when it is not the stored one.
   */
  async function saveExercises(
    tool: string,
    routine: StoredRoutine,
    next: RoutineExercise[],
    groupHint: string,
    groupsBefore: RoutineExercise[] = routine.exercises,
  ) {
    const fields = buildRoutineUpdateFields({ exercises: next }) as { exercises: RoutineExerciseEntry[] };
    const [broken] = newIncompleteRuns(groupsBefore, fields.exercises);
    if (broken) {
      refuse(
        'incomplete_group',
        `This change would leave an incomplete ${broken.structure} in routine "${routine.id}": ` +
          `${broken.ids.map(id => `"${id}"`).join(', ')}. A superset is exactly 2 exercises next to each other and a triset ` +
          `exactly 3. ${NOTHING_WRITTEN} ${groupHint}`,
      );
    }
    const before = { name: routine.name, description: routine.description, exercises: routine.exercises };
    const versions = planRoutineVersions({
      routineId: routine.id,
      existing: await loadHistory(routine.id),
      before,
      after: { ...before, exercises: fields.exercises },
      changeType: 'updated',
      source: 'mcp',
      now: now().getTime(),
    });
    await commit(tool, () => writes.setRoutineExercises(routine.id, fields, versions));
    return {
      ok: true,
      routine: routineOut(routine.id, routine.name, routine.description, fields.exercises),
      historyRecorded: versions.some(v => v.changeType === 'updated'),
    };
  }

  /** The logs of yesterday and today in Berlin: where an open session can be. */
  async function recentLogs(): Promise<{ today: string; rows: RawDoc[] }> {
    const today = berlinYmd(now());
    const list = await repo.getLogsBetween(addDays(today, -1), today, 2);
    return { today, rows: list.rows };
  }

  /**
   * The open session: the log of today, else of yesterday (a session that runs past
   * midnight keeps the day it started on). An open log older than that is not a session.
   */
  async function loadOpenSession(): Promise<OpenSession> {
    const { rows } = await recentLogs();
    const doc = rows.filter(isOpenLog).sort((a, b) => b.id.localeCompare(a.id))[0];
    if (!doc) return refuse('no_session', `No workout session is open. ${NOTHING_WRITTEN} Call start_workout first.`);
    const raw: unknown[] = Array.isArray(doc.data.exercises) ? doc.data.exercises : [];
    // The whole list is rewritten, so an entry this code cannot read must stop the tool.
    const readable = raw.every(
      (ex): ex is StoredLogExercise => typeof ex === 'object' && ex !== null && !!str((ex as { exerciseId?: unknown }).exerciseId),
    );
    if (!isRealYmd(doc.id) || !readable || raw.length === 0) {
      return refuse('conflict', `The open workout log has an entry this tool cannot read. ${NOTHING_WRITTEN} Edit it in the app.`);
    }
    return { date: doc.id, data: doc.data, exercises: raw };
  }

  return {
    start_workout: ({ routineId: wanted }: Args<'start_workout'>) =>
      run('start_workout', async () => {
        const { today, rows } = await recentLogs();
        const open = rows.find(isOpenLog);
        if (open) {
          refuse(
            'session_open',
            `A workout session is already open: the log of ${open.id}. ${NOTHING_WRITTEN} ` +
              `Continue it with log_set, or close it with finish_workout.`,
          );
        }
        if (rows.some(doc => doc.id === today)) {
          refuse(
            'log_exists',
            `A workout log for ${today} already exists. ${NOTHING_WRITTEN} This tool never changes an existing log; use the app for that day.`,
          );
        }

        let routineId = wanted;
        if (!routineId) {
          const schedule = await repo.getScheduleBetween(today, today, 1);
          const scheduled = schedule.rows
            .flatMap(doc => readScheduleItems(doc.data.items))
            .flatMap(item => (item.kind === 'routine' ? [item.routineId] : []));
          if (scheduled.length === 0) {
            return refuse('no_scheduled_routine', `No routine is scheduled for ${today}. ${NOTHING_WRITTEN} Give a routineId from list_routines.`);
          }
          if (scheduled.length > 1) {
            return refuse(
              'ambiguous_schedule',
              `${scheduled.length} routines are scheduled for ${today}: ${scheduled.map(id => `"${id}"`).join(', ')}. ` +
                `${NOTHING_WRITTEN} Give the routineId of the one to start.`,
            );
          }
          routineId = scheduled[0];
        }

        const routine = await loadRoutine(routineId);
        if (routine.exercises.length === 0) {
          refuse('conflict', `Routine "${routine.id}" has no exercise. ${NOTHING_WRITTEN}`);
        }
        const ids = routine.exercises.map(ex => ex.id);
        const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
        if (repeated || !ids.every(isSafeDocId)) {
          refuse(
            'conflict',
            `Routine "${routine.id}" holds an exercise more than once or with an id this tool cannot use. ${NOTHING_WRITTEN} Edit it in the app.`,
          );
        }

        // Newest first; a log of today or later is not a past session.
        const history = await repo.getLogsSince(addDays(today, -PREFILL_WINDOW_DAYS), PREFILL_WINDOW_DAYS + 1);
        const past = history.rows.filter(doc => doc.id < today).map(doc => doc.data);
        const nowMs = now().getTime();

        // Same rules as the app when a routine is selected: every exercise is planned,
        // with a copy of the sets of its last session that was not a deload.
        const planned = await Promise.all(
          routine.exercises.map(async (routineExercise, index) => {
            const lib = await repo.getExercise(routineExercise.id);
            const name = lib ? str(lib.data.name) : undefined;
            const muscleGroup = lib ? str(lib.data.muscleGroup) : undefined;
            const library =
              lib && name && muscleGroup
                ? {
                    name,
                    muscleGroup: muscleGroup as MuscleGroup,
                    exerciseSetup: typeof lib.data.exerciseSetup === 'string' ? lib.data.exerciseSetup : undefined,
                    progressiveOverload: typeof lib.data.progressiveOverload === 'string' ? lib.data.progressiveOverload : undefined,
                    warmup: typeof lib.data.warmup === 'object' && lib.data.warmup !== null ? (lib.data.warmup as WarmupConfig) : undefined,
                  }
                : null;
            let lastSets = prefillSetsFrom(past, routineExercise.id);
            if (lastSets === null) {
              const entry = await repo.getPerformanceEntry(routineExercise.id);
              const stored = entry?.lastPerformedSets;
              lastSets = Array.isArray(stored) && stored.length > 0 ? (stored as LoggedSet[]) : null;
            }
            return plannedLogExercise({ date: today, index, nowMs, routineExercise, library, lastSets });
          }),
        );

        const payload: WorkoutLog = {
          id: today,
          date: today,
          routineId: routine.id,
          routineName: routine.name,
          exercises: planned,
          exerciseIds: planned.map(ex => ex.exerciseId),
          notes: '',
          isDeload: false,
          deloadApplied: false,
        };
        // The stored shape comes from the builder the app's save uses.
        const { doc } = buildWorkoutLogDoc(today, payload);
        const exercises = doc.exercises as Record<string, unknown>[];
        await commit(
          'start_workout',
          () =>
            writes.createWorkoutLog(today, {
              routineId: routine.id,
              routineName: routine.name,
              exercises,
              exerciseIds: doc.exerciseIds as string[],
              // Epoch milliseconds, like the dates of a performance entry; finish_workout reads it back.
              startedAt: nowMs,
            }),
          REREAD_SESSION,
        );
        return {
          ok: true,
          date: today,
          routineId: routine.id,
          routineName: routine.name,
          exercises: exercises.map(ex => ({
            exerciseId: str(ex.exerciseId) ?? '',
            name: str(ex.name) ?? '',
            status: 'planned',
            setStructure: str(ex.setStructure) ?? 'normal',
          })),
          next: nextPlanned(exercises),
        };
      }),

    log_set: ({ exerciseId, setNumber, weight, reps, overwrite }: Args<'log_set'>) =>
      run('log_set', async () => {
        const session = await loadOpenSession();
        const { date } = session;
        const matches = session.exercises.filter(ex => ex.exerciseId === exerciseId);
        if (matches.length === 0) {
          refuse('not_in_log', `Exercise "${exerciseId}" is not in the open workout log of ${date}. ${NOTHING_WRITTEN} Call get_current_workout.`);
        }
        if (matches.length > 1) {
          refuse(
            'ambiguous_exercise',
            `Exercise "${exerciseId}" is in the open workout log of ${date} ${matches.length} times, so the set has no single place. ` +
              `${NOTHING_WRITTEN} Log this exercise in the app.`,
          );
        }
        const exercise = matches[0];
        const storedSets: StoredSet[] = Array.isArray(exercise.sets)
          ? (exercise.sets as unknown[]).filter((s): s is StoredSet => typeof s === 'object' && s !== null)
          : [];
        // The sets of a planned exercise are a copy of the last session, not done sets: the first logged set replaces them.
        const done = exercise.performed === false ? [] : storedSets;
        const setsOut = (sets: StoredSet[]) => sets.map((s, i) => ({ setNumber: i + 1, weight: s.weight, reps: s.reps }));
        const name = str(exercise.name) ?? '';

        if (setNumber > done.length + 1) {
          refuse(
            'set_number',
            `Set ${setNumber} of "${exerciseId}" cannot be logged: ${done.length} set(s) are logged, so the next one is set ${done.length + 1}. ${NOTHING_WRITTEN}`,
          );
        }

        const existing = (await repo.getPerformanceEntry(exerciseId)) as Partial<ExercisePerformanceEntry> | null;
        const existingPR = existing?.personalRecord ?? null;

        let nextSets: StoredSet[];
        if (setNumber <= done.length) {
          const current = done[setNumber - 1];
          if (current.reps === reps && current.weight === weight) {
            // A retry of a call that already went through: nothing to write.
            return {
              ok: true,
              changed: false,
              date,
              exercise: { exerciseId, name, sets: setsOut(done) },
              personalRecord: prOut(existingPR),
              newPersonalRecord: false,
              next: nextPlanned(session.exercises),
            };
          }
          if (!overwrite) {
            refuse(
              'set_exists',
              `Set ${setNumber} of "${exerciseId}" is already logged as ${String(current.weight)} kg x ${String(current.reps)}. ` +
                `${NOTHING_WRITTEN} To correct it, call again with overwrite true.`,
            );
          }
          nextSets = done.map((s, i) => (i === setNumber - 1 ? { id: s.id, reps, weight } : s));
        } else {
          nextSets = [...done, { id: `set-${date}-${exerciseId}-${done.length}-${now().getTime()}`, reps, weight }];
        }

        const exercises = session.exercises.map(ex => (ex === exercise ? { ...ex, sets: nextSets, performed: true } : ex));
        const exerciseIds = exercises.map(ex => ex.exerciseId);

        // Same side effect as an app save: the performance entry of a performed
        // exercise, and never from a deload log.
        const entries: PerformanceEntryWrite[] = [];
        let personalRecord: { reps: number; weight: number } | null = existingPR;
        if (session.data.isDeload !== true) {
          const sets = nextSets as LoggedSet[];
          let prFromOtherLogs: PersonalRecord | null = null;
          if (needsPRRescan(existing, sets, date)) {
            // The set behind the PR was lowered: another log may now hold the best set.
            const logs = await repo.listLogsWithExercise(exerciseId);
            if (logs.truncated) {
              refuse(
                'conflict',
                `There are too many logs of "${exerciseId}" to check its personal record again. ${NOTHING_WRITTEN} Correct this set in the app.`,
              );
            }
            prFromOtherLogs = bestPRFromLogs(logs.rows, exerciseId, date, {}, berlinMidnightMs);
          }
          const plan = planPerformanceEntry({
            existing,
            sets,
            logDate: date,
            // The app stamps the local midnight of the log's day; on the server that is Berlin's.
            achievedAtMs: berlinMidnightMs(date),
            prFromOtherLogs,
          });
          entries.push({ exerciseId, fields: plan.fields, clearPR: plan.clearPR });
          personalRecord = plan.clearPR ? null : (plan.fields.personalRecord ?? existingPR);
        }

        await commit('log_set', () => writes.setWorkoutLogExercises(date, { exercises, exerciseIds }, entries), REREAD_SESSION);
        return {
          ok: true,
          changed: true,
          date,
          exercise: { exerciseId, name, sets: setsOut(nextSets) },
          personalRecord: prOut(personalRecord),
          newPersonalRecord: isBetterPR(personalRecord, existingPR),
          next: nextPlanned(exercises),
        };
      }),

    finish_workout: ({ coachNotes, durationMin }: Args<'finish_workout'>) =>
      run('finish_workout', async () => {
        const session = await loadOpenSession();
        const notes = coachNotes.trim();

        // The duration in whole minutes: the given one, else the time since start_workout.
        let duration = durationMin;
        if (duration === undefined) {
          const startedAt = session.data.startedAt;
          const elapsedMs = typeof startedAt === 'number' && Number.isFinite(startedAt) ? now().getTime() - startedAt : NaN;
          const computed = Math.round(elapsedMs / MINUTE_MS);
          if (!(elapsedMs >= 0)) {
            return refuse(
              'duration_suspect',
              `The start time of the session of ${session.date} cannot be read, so its duration is unknown. ${NOTHING_WRITTEN} ` +
                `Ask the user how long the session took, then call again with durationMin.`,
            );
          }
          if (computed > SUSPECT_DURATION_MIN) {
            return refuse(
              'duration_suspect',
              `The session of ${session.date} started ${computed} minutes ago, more than ${SUSPECT_DURATION_MIN}: it was probably ` +
                `left open. ${NOTHING_WRITTEN} Ask the user how long the session took, then call again with durationMin.`,
            );
          }
          duration = Math.max(1, computed);
        }
        const minutes = duration;

        await commit('finish_workout', () => writes.finishWorkoutLog(session.date, notes, minutes), REREAD_SESSION);
        const performed = session.exercises.filter(ex => ex.performed !== false).length;
        return { ok: true, date: session.date, performed, planned: session.exercises.length - performed, duration: minutes, coachNotes: notes };
      }),

    create_exercise: (args: Args<'create_exercise'>) =>
      run('create_exercise', async () => {
        const name = args.name.trim();
        const { muscleGroup } = args;

        const library = await repo.listExercises();
        if (library.truncated) {
          refuse('conflict', `The library is too large to check for a duplicate. ${NOTHING_WRITTEN}`);
        }
        // Identity is name + muscle group. Both the stored name and the Spanish
        // display name of a seeded exercise count, as in the app.
        const wanted = identityKey(name, muscleGroup);
        const duplicate = library.rows.find(doc => {
          const storedName = str(doc.data.name) ?? '';
          const storedGroup = str(doc.data.muscleGroup) ?? '';
          return (
            identityKey(storedName, storedGroup) === wanted ||
            identityKey(displayExerciseName({ id: doc.id, name: storedName }, 'es'), storedGroup) === wanted
          );
        });
        if (duplicate) {
          refuse('duplicate_exercise', `"${name}" (${muscleGroup}) already exists with id "${duplicate.id}". ${NOTHING_WRITTEN}`);
        }

        const id = toSlug(name) ? await repo.findFreeDocId('exercises', buildExerciseDocId(name, muscleGroup)) : null;
        if (!id) return refuse('id_unavailable', `No id can be built from the name "${name}". ${NOTHING_WRITTEN} Use another name.`);

        const data: ExerciseData = {
          name,
          muscleGroup,
          targetNotes: args.targetNotes?.trim() ?? '',
          exerciseSetup: args.exerciseSetup?.trim() ?? '',
          progressiveOverload: args.progressiveOverload?.trim() ?? '',
          instructions: args.instructions?.trim() ?? '',
          // Same rule as the Exercises page.
          dataAiHint: name.toLowerCase().split(' ').slice(0, 2).join(' ') || 'exercise',
        };
        const doc = buildExerciseDoc(data);
        await commit('create_exercise', () => writes.createExercise(id, doc));
        return {
          ok: true,
          exercise: {
            id,
            name: doc.name,
            muscleGroup: doc.muscleGroup,
            targetNotes: doc.targetNotes || undefined,
            exerciseSetup: doc.exerciseSetup || undefined,
            progressiveOverload: doc.progressiveOverload || undefined,
          },
        };
      }),

    create_routine: (args: Args<'create_routine'>) =>
      run('create_routine', async () => {
        const name = args.name.trim();
        const { exerciseIds } = args;
        if (exerciseIds.length < 1) refuse('last_exercise', `A routine needs at least 1 exercise. ${NOTHING_WRITTEN}`);
        if (exerciseIds.length > MAX_ROUTINE_EXERCISES) {
          refuse('routine_full', `A routine holds at most ${MAX_ROUTINE_EXERCISES} exercises. ${NOTHING_WRITTEN}`);
        }
        const repeated = exerciseIds.find((id, i) => exerciseIds.indexOf(id) !== i);
        if (repeated) refuse('already_in_routine', `Exercise "${repeated}" is listed more than once. ${NOTHING_WRITTEN}`);

        const exercises: RoutineExercise[] = [];
        for (const exerciseId of exerciseIds) {
          exercises.push({ ...(await loadExercise(exerciseId)), setStructure: 'normal' });
        }

        const baseId = slugify(name);
        const id = baseId ? await repo.findFreeDocId('routines', baseId) : null;
        if (!id) return refuse('id_unavailable', `No id can be built from the name "${name}". ${NOTHING_WRITTEN} Use another name.`);

        // Same rule as the app: after the last routine, or 0 for the first one.
        const lastOrder = await repo.getLastRoutineOrder();
        const routine = buildRoutineCreateFields(
          { name, description: args.description?.trim() ?? '', exercises },
          lastOrder === null ? 0 : lastOrder + 1,
        );

        // The id can carry history: a deleted routine's versions outlive it.
        const versions = planRoutineVersions({
          routineId: id,
          existing: await loadHistory(id),
          before: null,
          after: routine,
          changeType: 'created',
          source: 'mcp',
          now: now().getTime(),
        });
        await commit('create_routine', () => writes.createRoutine(id, routine, versions));
        return {
          ok: true,
          routine: routineOut(id, routine.name, routine.description, routine.exercises as RoutineExerciseEntry[]),
          historyRecorded: versions.length > 0,
        };
      }),

    add_exercise_to_routine: ({ routineId, exerciseId, index }: Args<'add_exercise_to_routine'>) =>
      run('add_exercise_to_routine', async () => {
        const routine = await loadRoutine(routineId);
        if (routine.exercises.some(ex => ex.id === exerciseId)) {
          refuse('already_in_routine', `Exercise "${exerciseId}" is already in routine "${routineId}". ${NOTHING_WRITTEN}`);
        }
        if (routine.exercises.length >= MAX_ROUTINE_EXERCISES) {
          refuse('routine_full', `Routine "${routineId}" already holds ${routine.exercises.length} exercises. ${NOTHING_WRITTEN}`);
        }
        if (index !== undefined && index > routine.exercises.length) {
          refuse(
            'slot_mismatch',
            `Position ${index} is past the end: routine "${routineId}" has ${routine.exercises.length} exercises. ${NOTHING_WRITTEN} Read the routine again.`,
          );
        }
        const exercise = await loadExercise(exerciseId);
        const next = addRoutineExerciseAt(routine.exercises, index ?? null, { ...exercise, setStructure: 'normal' });
        return saveExercises('add_exercise_to_routine', routine, next, 'Use a position before or after the group.');
      }),

    replace_exercise_in_routine: ({ routineId, index, expectedExerciseId, newExerciseId }: Args<'replace_exercise_in_routine'>) =>
      run('replace_exercise_in_routine', async () => {
        const routine = await loadRoutine(routineId);
        const current = routine.exercises[index];
        if (!current || current.id !== expectedExerciseId) {
          refuse(
            'slot_mismatch',
            `Position ${index} of routine "${routineId}" does not hold "${expectedExerciseId}". ${NOTHING_WRITTEN} Read the routine again.`,
          );
        }
        if (routine.exercises.some(ex => ex.id === newExerciseId)) {
          refuse('already_in_routine', `Exercise "${newExerciseId}" is already in routine "${routineId}". ${NOTHING_WRITTEN}`);
        }
        const exercise = await loadExercise(newExerciseId);
        // Same helper as the routine editor: the slot keeps its position and set structure.
        const next = replaceRoutineExerciseAt(routine.exercises, index, exercise);
        // The groups are compared with the new id already in the slot: a swap changes no group.
        const groupsBefore = routine.exercises.map((ex, i) => (i === index ? { ...ex, id: newExerciseId } : ex));
        return saveExercises('replace_exercise_in_routine', routine, next, 'Read the routine again.', groupsBefore);
      }),

    remove_exercise_from_routine: ({ routineId, exerciseId }: Args<'remove_exercise_from_routine'>) =>
      run('remove_exercise_from_routine', async () => {
        const routine = await loadRoutine(routineId);
        const matches = routine.exercises.filter(ex => ex.id === exerciseId).length;
        if (matches === 0) {
          refuse('not_in_routine', `Exercise "${exerciseId}" is not in routine "${routineId}". ${NOTHING_WRITTEN}`);
        }
        if (matches > 1) {
          refuse('conflict', `Exercise "${exerciseId}" is in routine "${routineId}" more than once. ${NOTHING_WRITTEN} Edit it in the app.`);
        }
        if (routine.exercises.length === 1) {
          refuse('last_exercise', `"${exerciseId}" is the only exercise of routine "${routineId}", and a routine needs at least 1. ${NOTHING_WRITTEN}`);
        }
        const next = removeRoutineExerciseAt(routine.exercises, routine.exercises.findIndex(ex => ex.id === exerciseId));
        return saveExercises(
          'remove_exercise_from_routine',
          routine,
          next,
          'Set every exercise of the group to normal with set_routine_set_structure first.',
        );
      }),

    reorder_routine_exercises: ({ routineId, exerciseIds }: Args<'reorder_routine_exercises'>) =>
      run('reorder_routine_exercises', async () => {
        const routine = await loadRoutine(routineId);
        // The full id list doubles as a stale check: it must name exactly the stored exercises.
        const storedIds = routine.exercises.map(ex => ex.id);
        const sameSet =
          new Set(storedIds).size === storedIds.length &&
          new Set(exerciseIds).size === exerciseIds.length &&
          exerciseIds.length === storedIds.length &&
          exerciseIds.every(id => storedIds.includes(id));
        if (!sameSet) {
          refuse(
            'order_mismatch',
            `exerciseIds must hold every exercise id of routine "${routineId}" exactly once. ${NOTHING_WRITTEN} Read the routine again.`,
          );
        }
        const byId = new Map(routine.exercises.map(ex => [ex.id, ex]));
        const next = exerciseIds.map(id => byId.get(id)!);
        return saveExercises(
          'reorder_routine_exercises',
          routine,
          next,
          'Keep the exercises of a group next to each other, or set the group to normal with set_routine_set_structure first.',
        );
      }),

    set_routine_set_structure: ({ routineId, setStructure, exerciseIds }: Args<'set_routine_set_structure'>) =>
      run('set_routine_set_structure', async () => {
        const ids = [...new Set(exerciseIds)];
        const size = groupSizeOf(setStructure);
        if (size > 1 && ids.length !== size) {
          refuse(
            'group_size',
            `A ${setStructure} is exactly ${size} different exercises; exerciseIds holds ${ids.length}. ${NOTHING_WRITTEN}`,
          );
        }
        const routine = await loadRoutine(routineId);
        for (const id of ids) {
          const matches = routine.exercises.filter(ex => ex.id === id).length;
          if (matches === 0) {
            refuse('not_in_routine', `Exercise "${id}" is not in routine "${routineId}". ${NOTHING_WRITTEN} Read the routine again.`);
          }
          if (matches > 1) {
            refuse('conflict', `Exercise "${id}" is in routine "${routineId}" more than once. ${NOTHING_WRITTEN} Edit it in the app.`);
          }
        }
        if (size > 1) {
          // The order of exerciseIds does not matter; their positions in the routine do.
          const positions = ids.map(id => routine.exercises.findIndex(ex => ex.id === id));
          if (Math.max(...positions) - Math.min(...positions) !== size - 1) {
            refuse(
              'not_consecutive',
              `The exercises of a ${setStructure} must be next to each other in routine "${routineId}". ${NOTHING_WRITTEN} ` +
                `Call reorder_routine_exercises first.`,
            );
          }
        }

        const named = new Set(ids);
        if (routine.exercises.every(ex => !named.has(ex.id) || (ex.setStructure || 'normal') === setStructure)) {
          // Nothing differs from the stored routine: no write, no history version.
          const { exercises } = buildRoutineUpdateFields({ exercises: routine.exercises }) as { exercises: RoutineExerciseEntry[] };
          return {
            ok: true,
            changed: false,
            routine: routineOut(routine.id, routine.name, routine.description, exercises),
            historyRecorded: false,
          };
        }
        const next = routine.exercises.map(ex => (named.has(ex.id) ? { ...ex, setStructure } : ex));
        return saveExercises(
          'set_routine_set_structure',
          routine,
          next,
          'Name every exercise of a group in one call: 2 for a superset, 3 for a triset; to undo a group, set all of its exercises to normal.',
        );
      }),

    update_exercise: ({ exerciseId, ...input }: Args<'update_exercise'>) =>
      run('update_exercise', async () => {
        if (Object.values(input).every(value => value === undefined)) {
          refuse('no_fields', `Give at least one field to change. ${NOTHING_WRITTEN}`);
        }
        const doc = await repo.getExercise(exerciseId);
        if (!doc) return refuse('not_found', `No exercise with id "${exerciseId}" in the library. ${NOTHING_WRITTEN}`);
        const stored = doc.data;
        if (!str(stored.name) || !str(stored.muscleGroup)) {
          return refuse('conflict', `The stored exercise "${exerciseId}" has no name or muscle group. ${NOTHING_WRITTEN} Fix it in the app.`);
        }

        // Only what differs from the stored document is written.
        const change: ExerciseFieldChange = {};
        for (const key of EXERCISE_TEXT_FIELDS) {
          const next = input[key]?.trim();
          if (next !== undefined && next !== textOf(stored, key)) change[key] = next;
        }
        if (input.warmupTemplate !== undefined && input.warmupTemplate !== warmupTemplateOf(stored)) {
          change.warmupTemplate = input.warmupTemplate;
        }
        const differs = (next: unknown, current: unknown) => (next === null ? current !== undefined : next !== current);
        if (input.loadIncrementKg !== undefined && differs(input.loadIncrementKg, stored.loadIncrementKg)) {
          change.loadIncrementKg = input.loadIncrementKg;
        }
        if (input.dumbbellLoad !== undefined && differs(input.dumbbellLoad, stored.dumbbellLoad)) {
          change.dumbbellLoad = input.dumbbellLoad;
        }

        const changed = Object.keys(change);
        if (changed.length === 0) {
          return { ok: true, changed, exercise: exerciseOut(doc.id, stored), routinesUpdated: [] };
        }

        // The document as it reads after the write, for the routine copies and the answer.
        const after: Record<string, unknown> = { ...stored };
        for (const key of EXERCISE_TEXT_FIELDS) {
          if (change[key] !== undefined) after[key] = change[key];
        }
        if (change.warmupTemplate !== undefined) {
          const warmup = typeof stored.warmup === 'object' && stored.warmup !== null ? stored.warmup : {};
          after.warmup = { ...warmup, template: change.warmupTemplate };
        }
        for (const key of ['loadIncrementKg', 'dumbbellLoad'] as const) {
          if (change[key] === null) delete after[key];
          else if (change[key] !== undefined) after[key] = change[key];
        }

        // Same cascade as the Exercises page: a routine keeps a copy of the three
        // text fields, so every routine that holds the exercise gets the new text.
        const cascades: RoutineCascade[] = [];
        const routinesUpdated: Array<{ id: string; name: string; historyRecorded: boolean }> = [];
        if (EXERCISE_TEXT_FIELDS.some(key => change[key] !== undefined)) {
          const texts = {
            targetNotes: textOf(after, 'targetNotes'),
            exerciseSetup: textOf(after, 'exerciseSetup'),
            progressiveOverload: textOf(after, 'progressiveOverload'),
          };
          const list = await repo.listRoutines();
          if (list.truncated) {
            refuse('conflict', `There are too many routines to update every copy of this exercise. ${NOTHING_WRITTEN}`);
          }
          const nowMs = now().getTime();
          for (const row of list.rows) {
            const raw: unknown[] = Array.isArray(row.data.exercises) ? row.data.exercises : [];
            const holds = raw.some(ex => typeof ex === 'object' && ex !== null && (ex as { id?: unknown }).id === exerciseId);
            if (!holds) continue;
            const routine = toStoredRoutine(row);
            const next = routine.exercises.map(ex => (ex.id === exerciseId ? { ...ex, ...texts } : ex));
            const fields = buildRoutineUpdateFields({ exercises: next }) as { exercises: RoutineExerciseEntry[] };
            const before = { name: routine.name, description: routine.description, exercises: routine.exercises };
            const versions = planRoutineVersions({
              routineId: routine.id,
              existing: await loadHistory(routine.id),
              before,
              after: { ...before, exercises: fields.exercises },
              changeType: 'updated',
              source: 'mcp',
              now: nowMs,
            });
            cascades.push({ id: routine.id, exercises: fields.exercises, versions });
            routinesUpdated.push({
              id: routine.id,
              name: routine.name,
              historyRecorded: versions.some(v => v.changeType === 'updated'),
            });
          }
        }

        await commit('update_exercise', () => writes.updateExerciseFields(exerciseId, change, cascades));
        return { ok: true, changed, exercise: exerciseOut(doc.id, after), routinesUpdated };
      }),

    set_schedule_day: ({ date, items }: Args<'set_schedule_day'>) =>
      run('set_schedule_day', async () => {
        const window = scheduleWindow(berlinYmd(now()));
        if (!isRealYmd(date) || date < window.from || date > window.to) {
          refuse(
            'out_of_window',
            `"${date}" is not a day from ${window.from} to ${window.to}: the schedule takes Monday of the current week ` +
              `to ${SCHEDULE_DAYS_AHEAD} days from today (${WEEK_TIME_ZONE}). ${NOTHING_WRITTEN}`,
          );
        }
        if (items.length > MAX_SCHEDULE_ITEMS) {
          refuse('too_many_items', `A day holds at most ${MAX_SCHEDULE_ITEMS} items. ${NOTHING_WRITTEN}`);
        }
        if (items.length > 1 && items.some(item => item.kind === 'rest')) {
          refuse('rest_not_alone', `A rest day has "rest" as its only item. ${NOTHING_WRITTEN}`);
        }
        const routineIds = items.flatMap(item => (item.kind === 'routine' ? [item.routineId] : []));
        const repeated = routineIds.find((id, i) => routineIds.indexOf(id) !== i);
        if (repeated) refuse('duplicate_routine', `Routine "${repeated}" is listed more than once. ${NOTHING_WRITTEN}`);

        const stored: ScheduleItem[] = [];
        for (const item of items) {
          if (item.kind === 'routine') {
            const doc = await repo.getRoutine(item.routineId);
            if (!doc) return refuse('not_found', `No routine with id "${item.routineId}". ${NOTHING_WRITTEN}`);
            // The name as it is now: the schedule keeps it even when the routine is renamed later.
            stored.push({ kind: 'routine', routineId: doc.id, routineName: str(doc.data.name) ?? '' });
          } else if (item.kind === 'activity') {
            stored.push({ kind: 'activity', activity: item.activity.trim() });
          } else {
            stored.push({ kind: 'rest' });
          }
        }

        await commit('set_schedule_day', () => writes.setScheduleDay(date, stored));
        return { ok: true, date, scheduled: stored.length > 0 ? stored : null };
      }),
  };
}

// ─── Registration ────────────────────────────────────────────────────

const CONFIRM_NOTE =
  'Call it only after the user confirmed this exact change in the conversation; describe the change first and wait for a yes.';
const RESULT_NOTE =
  'On an error the text starts with a code (for example slot_mismatch or conflict) and nothing was written unless it says otherwise.';

export function registerWriteTools(server: McpServer, deps: WriteToolDeps) {
  const tools = createWriteTools(deps);
  const additive = { readOnlyHint: false, destructiveHint: false };
  const destructive = { readOnlyHint: false, destructiveHint: true };
  const guard = <A>(fn: (args: A) => Promise<ToolResult>) => withTimeout(fn, undefined, 'write');

  server.registerTool(
    'start_workout',
    {
      title: 'Start workout',
      description:
        `Starts a live workout session: it creates the workout log of today (${WEEK_TIME_ZONE}) from a routine, ` +
        `the given one or the one routine scheduled today. Every exercise starts as planned, with a copy of the sets ` +
        `of its last session. It is refused when today already has a log (log_exists) or a session of today or ` +
        `yesterday is still open (session_open); it never changes an existing log. After it, call ` +
        `get_current_workout for the targets, log_set for each set and finish_workout at the end. ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.start_workout,
      annotations: additive,
    },
    guard(tools.start_workout),
  );

  server.registerTool(
    'log_set',
    {
      title: 'Log set',
      description:
        `Logs one set the owner just did, on the open workout session only. Weight in kg (0 for bodyweight), in ` +
        `steps of 0.5. setNumber is the 1-based number of the set within the exercise and must be the next one. ` +
        `The first set of an exercise replaces the copied sets and marks the exercise performed. A repeat of a ` +
        `call with the same values writes nothing (changed false), so a retry is safe. A different value at a ` +
        `logged set number is refused (set_exists) unless overwrite is true; use that to correct a set. The ` +
        `personal record follows the sets, also down after a correction. Call it as soon as the owner reports a ` +
        `set; no extra question is needed. The answer holds the sets of the exercise so far, the personal record ` +
        `and the next planned exercise. ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.log_set,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    guard(tools.log_set),
  );

  server.registerTool(
    'finish_workout',
    {
      title: 'Finish workout',
      description:
        `Closes the open workout session and stores the coach summary for next time in coachNotes (at most ` +
        `${MAX_COACH_NOTES_LENGTH} characters); get_recent_logs returns it. It also stores duration in whole ` +
        `minutes: durationMin when given, else the time since start_workout. Without durationMin, a computed ` +
        `duration above ${SUSPECT_DURATION_MIN} minutes or a start time that cannot be read is refused with ` +
        `duration_suspect and nothing is written: ask the user how long the session took and call again with ` +
        `durationMin. Exercises with no logged set stay planned. After it, log_set is refused. ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.finish_workout,
      annotations: additive,
    },
    guard(tools.finish_workout),
  );

  server.registerTool(
    'create_exercise',
    {
      title: 'Create exercise',
      description:
        `Adds a new exercise to the owner's library. It refuses a name that already exists in the same muscle group. ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.create_exercise,
      annotations: additive,
    },
    guard(tools.create_exercise),
  );

  server.registerTool(
    'create_routine',
    {
      title: 'Create routine',
      description:
        `Adds a new routine built from library exercises (ids from list_exercises), placed after the last routine. ` +
        `Every exercise gets the normal set structure. ${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.create_routine,
      annotations: additive,
    },
    guard(tools.create_routine),
  );

  server.registerTool(
    'add_exercise_to_routine',
    {
      title: 'Add exercise to routine',
      description:
        `Adds one library exercise to a routine, at \`index\` or at the end, with the normal set structure. ` +
        `An exercise can be in a routine only once. ${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.add_exercise_to_routine,
      annotations: additive,
    },
    guard(tools.add_exercise_to_routine),
  );

  server.registerTool(
    'replace_exercise_in_routine',
    {
      title: 'Replace exercise in routine',
      description:
        `Swaps the exercise at one position of a routine for another library exercise; the position and its set structure stay. ` +
        `It fails with slot_mismatch when that position does not hold expectedExerciseId. ${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.replace_exercise_in_routine,
      annotations: destructive,
    },
    guard(tools.replace_exercise_in_routine),
  );

  server.registerTool(
    'remove_exercise_from_routine',
    {
      title: 'Remove exercise from routine',
      description:
        `Takes one exercise out of a routine. The exercise stays in the library and past workout logs do not change. ` +
        `It refuses to remove the last exercise of a routine. ${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.remove_exercise_from_routine,
      annotations: destructive,
    },
    guard(tools.remove_exercise_from_routine),
  );

  server.registerTool(
    'reorder_routine_exercises',
    {
      title: 'Reorder routine exercises',
      description:
        `Sets a new order for the exercises of one routine. exerciseIds must hold every exercise id of that routine exactly once. ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.reorder_routine_exercises,
      annotations: additive,
    },
    guard(tools.reorder_routine_exercises),
  );

  server.registerTool(
    'set_routine_set_structure',
    {
      title: 'Set routine set structure',
      description:
        `Sets the set structure (normal, superset, triset, dropSet, restPause) of exercises in one routine. ` +
        `A superset is exactly 2 exercises and a triset exactly 3. They must be next to each other in the routine order; ` +
        `call reorder_routine_exercises first when they are not. The app groups consecutive exercises of the same type ` +
        `from the top: 4 supersets in a row are two pairs. normal, dropSet and restPause apply to each exercise alone ` +
        `and take 1 or more ids. To undo a superset or triset, set all of its exercises to normal in one call. ` +
        `The call is refused when it would leave an incomplete group. The change applies to new log days; a saved log ` +
        `keeps its structure. Before calling, describe the resulting groups to the user and wait for their yes. ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.set_routine_set_structure,
      annotations: destructive,
    },
    guard(tools.set_routine_set_structure),
  );

  server.registerTool(
    'update_exercise',
    {
      title: 'Update exercise',
      description:
        `Changes fields of one library exercise: target notes, setup notes, rep range text, warm-up template, load increment ` +
        `and dumbbell mode. Only the fields given are written; the name and the muscle group cannot be changed here. ` +
        `A text change is also copied into every routine that holds the exercise. A warm-up template change applies to new ` +
        `log days only. An edited text of a default exercise is no longer translated in the app. ` +
        `dumbbellLoad "perHand": the logged weight is the weight of one dumbbell. ` +
        `dumbbellLoad "total": the logged weight is both dumbbells added together. ` +
        `loadIncrementKg is in the same unit as the logged weight: with "total", a step of 2 kg per dumbbell is 4. ` +
        `The answer lists the ` +
        `fields that changed and repRange as the app reads it (null when the text has no numeric range). ` +
        `${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.update_exercise,
      annotations: destructive,
    },
    guard(tools.update_exercise),
  );

  server.registerTool(
    'set_schedule_day',
    {
      title: 'Set schedule day',
      description:
        `Sets what the owner intends to do on one day: up to 3 items of kind "routine" (a gym session with one of ` +
        `the routines), "activity" (a short free text, e.g. "boxing") or "rest". It replaces everything scheduled ` +
        `for that day; items [] clears the day. "rest" must be the only item of its day and a routine can be listed ` +
        `once. The day must be from Monday of the current week to ${SCHEDULE_DAYS_AHEAD} days from today ` +
        `(${WEEK_TIME_ZONE}). The schedule is separate from the workout logs: it writes no log and no routine, and ` +
        `get_week_status returns it as \`scheduled\` on each day. ${CONFIRM_NOTE} ${RESULT_NOTE}`,
      inputSchema: writeToolSchemas.set_schedule_day,
      annotations: destructive,
    },
    guard(tools.set_schedule_day),
  );
}
