// server-only: src/lib/mcp/tools.read.ts
// The read tools of the MCP endpoint. No tool takes a uid: the repo is already
// bound to MCP_OWNER_UID. Tool schemas use zod 4 (the `zod4` alias); the app's
// own schemas stay on zod 3.
import { z } from 'zod4';
import type { McpServer } from '@modelcontextprotocol/server';
import { toCoachProfile } from '@/lib/ai/context-builders';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@/i18n';
import { parseRepRange } from '@/lib/repGoal';
import { groupMarks } from '@/lib/setStructureGroups';
import { withTimeout } from './limits';
import { isSafeDocId, type McpRepo, type McpWriteReads, type RawDoc, type RawList } from './repo.server';
import { errorResult, jsonResult, type ToolResult } from './results';
import { WEEK_TIME_ZONE, berlinYmd, isoWeekOf, weekRange } from './week';

/** What the read tools read: the base repo plus two single-purpose reads the write tools also use. */
export type ReadToolsRepo = McpRepo & Pick<McpWriteReads, 'getExercise' | 'listRoutineHistory'>;

// ─── Input schemas ───────────────────────────────────────────────────

const docId = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeDocId, { message: 'must be a plain id with no "/"' });

export const toolSchemas = {
  list_routines: z.object({}),
  get_routine: z.object({
    id: docId.describe('Routine id from list_routines'),
  }),
  list_exercises: z.object({
    muscleGroup: z.enum(MUSCLE_GROUPS_LIST).optional().describe('Filter by muscle group (stored English key)'),
  }),
  get_recent_logs: z.object({
    days: z.number().int().min(1).max(90).default(14).describe('How many days back, 1 to 90'),
  }),
  get_exercise_history: z.object({
    exerciseId: docId.describe('Exercise id from list_exercises, a routine or a log'),
    days: z.number().int().min(1).max(365).default(120).describe('How many days back to search, 1 to 365'),
    limit: z.number().int().min(1).max(30).default(10).describe('Most sessions to return, 1 to 30'),
  }),
  get_profile: z.object({}),
  get_week_status: z.object({
    week: z
      .string()
      .regex(/^\d{4}-W\d{2}$/, { message: 'must be an ISO week like 2026-W46' })
      .optional()
      .describe('ISO week "YYYY-Www"; default the current week in Europe/Berlin'),
  }),
};

type Args<K extends keyof typeof toolSchemas> = z.infer<(typeof toolSchemas)[K]>;

// ─── Field helpers (stored documents are read as unknown) ────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];

/**
 * `name` is always the stored name: it is what logs, routines and ids are built
 * on. `displayName` is added only when the app shows something else, which is an
 * untouched seeded exercise on a Spanish profile.
 */
function names(libraryId: string | undefined, storedName: unknown, language: Language) {
  const name = str(storedName) ?? '';
  const shown = displayExerciseName({ exerciseId: libraryId, name }, language);
  return shown !== name ? { name, displayName: shown } : { name };
}

/** Equipment facts of a library exercise; each key is present only when the document holds a valid value. */
function equipmentOf(data: Record<string, unknown>) {
  const warmup = typeof data.warmup === 'object' && data.warmup !== null ? (data.warmup as Record<string, unknown>) : {};
  return {
    warmupTemplate: str(warmup.template),
    loadIncrementKg: num(data.loadIncrementKg) ?? undefined,
    dumbbellLoad: data.dumbbellLoad === 'perHand' || data.dumbbellLoad === 'total' ? data.dumbbellLoad : undefined,
  };
}

const languageOf = (profile: Record<string, unknown> | null): Language =>
  isLanguage(profile?.language) ? profile.language : DEFAULT_LANGUAGE;

function routineOut(doc: RawDoc, language: Language) {
  const exercises = records(doc.data.exercises).map(ex => ({
    id: str(ex.id) ?? '',
    ...names(str(ex.id), ex.name, language),
    muscleGroup: str(ex.muscleGroup) ?? '',
    setStructure: str(ex.setStructure) ?? 'normal',
  }));
  // `group` and `groupIncomplete`, each present only when it applies.
  const marks = groupMarks(exercises);
  return {
    id: doc.id,
    name: str(doc.data.name) ?? '',
    description: str(doc.data.description),
    order: num(doc.data.order) ?? undefined,
    exercises: exercises.map((ex, i) => ({ ...ex, ...marks[i] })),
  };
}

/** Working sets as logged; a fully empty row is not a set. */
const setsOut = (v: unknown) =>
  records(v)
    .map(s => ({ reps: num(s.reps), weight: num(s.weight) }))
    .filter(s => s.reps !== null || s.weight !== null);

/**
 * `performed === false` means the exercise was saved as a plan: its sets are a
 * copy of the last session, not a lift. `undefined` predates the flag and counts
 * as performed.
 */
const statusOf = (ex: Record<string, unknown>) => (ex.performed === false ? 'planned' : 'performed');

const logDate = (doc: RawDoc) => str(doc.data.date) ?? doc.id;

/** UTC calendar day `days` before `now`, as YYYY-MM-DD. */
function cutoffYmd(now: Date, days: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return d.toISOString().slice(0, 10);
}

// ─── Week status ─────────────────────────────────────────────────────

type PlanExercise = { id: string; name: unknown };
/** Where the routine's exercise list for a log day came from. */
type RoutineBasis = 'history' | 'baseline' | 'current' | 'unknown';
type RoutinePlan = { basis: RoutineBasis; exercises: PlanExercise[] | null };

const planExercises = (v: unknown): PlanExercise[] =>
  records(v).flatMap(ex => {
    const id = str(ex.id);
    return id ? [{ id, name: ex.name }] : [];
  });

/**
 * A log stores `routineId` but no routine version, so the version used on `date`
 * is inferred from the routine history:
 *  - history:  the newest version created on or before that day (Berlin date). An
 *              edit made later on the same day counts as that day's version.
 *  - baseline: no version that old, but the oldest one is a baseline: it records
 *              the state the routine had before history started.
 *  - current:  the routine has no history at all, so it never changed: the
 *              routine document is the version.
 *  - unknown:  anything else (history cut off, or the log is older than the
 *              routine). No exercise is reported as skipped.
 */
function routinePlanOn(date: string, history: RawList, current: RawDoc | null): RoutinePlan {
  const unknown: RoutinePlan = { basis: 'unknown', exercises: null };
  if (history.truncated) return unknown;
  const versions = history.rows
    .flatMap(row => {
      const createdAtMs = num(row.data.createdAtMs);
      const snapshot = row.data.snapshot;
      if (createdAtMs === null || typeof snapshot !== 'object' || snapshot === null) return [];
      return [{
        createdAtMs,
        changeType: str(row.data.changeType),
        exercises: planExercises((snapshot as Record<string, unknown>).exercises),
      }];
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  if (versions.length === 0) {
    return current ? { basis: 'current', exercises: planExercises(current.data.exercises) } : unknown;
  }
  const onOrBefore = versions.filter(v => berlinYmd(new Date(v.createdAtMs)) <= date);
  if (onOrBefore.length > 0) return { basis: 'history', exercises: onOrBefore[onOrBefore.length - 1].exercises };
  if (versions[0].changeType === 'baseline') return { basis: 'baseline', exercises: versions[0].exercises };
  return unknown;
}

// ─── Handlers ────────────────────────────────────────────────────────

/** Runs a tool body; a failure is logged as a short code and answered with a generic message. */
async function safe(code: string, message: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch {
    // The error itself is not logged: Firestore messages can carry the document path.
    console.error(`[mcp] ${code}_failed`);
    return errorResult(message);
  }
}

export function createReadTools(repo: ReadToolsRepo, now: () => Date = () => new Date()) {
  return {
    list_routines: (_args: Args<'list_routines'>) =>
      safe('list_routines', 'Could not read the routines. Try again later.', async () => {
        const [list, profile] = await Promise.all([repo.listRoutines(), repo.getProfile()]);
        const language = languageOf(profile);
        return jsonResult({
          returned: list.rows.length,
          truncated: list.truncated,
          routines: list.rows.map(doc => routineOut(doc, language)),
        });
      }),

    get_routine: ({ id }: Args<'get_routine'>) =>
      safe('get_routine', 'Could not read the routine. Try again later.', async () => {
        const [doc, profile] = await Promise.all([repo.getRoutine(id), repo.getProfile()]);
        if (!doc) return errorResult(`No routine with id "${id}".`);
        const out = routineOut(doc, languageOf(profile));
        // The rep range lives on the exercise document; the routine only keeps a copy.
        const stored = records(doc.data.exercises);
        const ids = [...new Set(out.exercises.map(ex => ex.id).filter(isSafeDocId))];
        const library = new Map(
          await Promise.all(ids.map(async exId => [exId, await repo.getExercise(exId)] as const)),
        );
        return jsonResult({
          ...out,
          exercises: out.exercises.map((ex, i) => {
            const lib = library.get(ex.id) ?? null;
            const progressiveOverload = str(lib ? lib.data.progressiveOverload : stored[i].progressiveOverload);
            return {
              ...ex,
              progressiveOverload,
              repRange: parseRepRange(progressiveOverload),
              // Library fields only: the routine's copy does not hold them.
              ...(lib ? equipmentOf(lib.data) : {}),
              // Only present when false: the exercise is gone from the library.
              ...(lib ? {} : { inLibrary: false }),
            };
          }),
        });
      }),

    list_exercises: ({ muscleGroup }: Args<'list_exercises'>) =>
      safe('list_exercises', 'Could not read the exercises. Try again later.', async () => {
        const [list, profile] = await Promise.all([repo.listExercises(muscleGroup), repo.getProfile()]);
        const language = languageOf(profile);
        const exercises = list.rows
          .map(doc => ({
            id: doc.id,
            ...names(doc.id, doc.data.name, language),
            muscleGroup: str(doc.data.muscleGroup) ?? '',
            targetNotes: str(doc.data.targetNotes),
            progressiveOverload: str(doc.data.progressiveOverload),
            exerciseSetup: str(doc.data.exerciseSetup),
            ...equipmentOf(doc.data),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        return jsonResult({ returned: exercises.length, truncated: list.truncated, exercises });
      }),

    get_recent_logs: ({ days }: Args<'get_recent_logs'>) =>
      safe('get_recent_logs', 'Could not read the workout logs. Try again later.', async () => {
        const from = cutoffYmd(now(), days);
        // One doc per day: `days` back plus today.
        const [list, profile] = await Promise.all([repo.getLogsSince(from, days + 1), repo.getProfile()]);
        const language = languageOf(profile);
        const logs = list.rows.map(doc => ({
          date: logDate(doc),
          routineId: str(doc.data.routineId),
          routineName: str(doc.data.routineName),
          isDeload: doc.data.isDeload === true,
          notes: str(doc.data.notes),
          exercises: records(doc.data.exercises).map(ex => ({
            exerciseId: str(ex.exerciseId) ?? '',
            ...names(str(ex.exerciseId), ex.name, language),
            muscleGroup: str(ex.muscleGroup) ?? '',
            setStructure: str(ex.setStructureOverride) ?? str(ex.setStructure) ?? 'normal',
            status: statusOf(ex),
            sets: setsOut(ex.sets),
            notes: str(ex.notes),
          })),
        }));
        return jsonResult({ days, from, returned: logs.length, truncated: list.truncated, logs });
      }),

    get_exercise_history: ({ exerciseId, days, limit }: Args<'get_exercise_history'>) =>
      safe('get_exercise_history', 'Could not read the exercise history. Try again later.', async () => {
        const from = cutoffYmd(now(), days);
        const [list, profile] = await Promise.all([repo.getLogsSince(from, days + 1), repo.getProfile()]);
        const matches = list.rows
          .flatMap(doc => {
            const ex = records(doc.data.exercises).find(e => e.exerciseId === exerciseId);
            return ex ? [{ date: logDate(doc), isDeload: doc.data.isDeload === true, ex }] : [];
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        const sessions = matches.slice(0, limit).map(({ date, isDeload, ex }) => ({
          date,
          isDeload,
          status: statusOf(ex),
          sets: setsOut(ex.sets),
        }));
        const newest = matches[0]?.ex;
        return jsonResult({
          exerciseId,
          ...(newest ? names(exerciseId, newest.name, languageOf(profile)) : { name: null }),
          days,
          from,
          returned: sessions.length,
          truncated: matches.length > sessions.length || list.truncated,
          sessions,
        });
      }),

    get_profile: (_args: Args<'get_profile'>) =>
      safe('get_profile', 'Could not read the profile. Try again later.', async () => {
        const profile = await repo.getProfile();
        // toCoachProfile picks the coach fields only: no email, no name, no date of birth.
        return jsonResult({ ...toCoachProfile(profile), language: languageOf(profile) });
      }),

    get_week_status: ({ week }: Args<'get_week_status'>) =>
      safe('get_week_status', 'Could not read the week. Try again later.', async () => {
        const today = berlinYmd(now());
        const currentWeek = isoWeekOf(today);
        const range = weekRange(week ?? currentWeek);
        if (!range) return errorResult(`"${week}" is not an ISO week. Use YYYY-Www, for example ${currentWeek}.`);

        // One doc per day: a week holds at most seven.
        const [logList, routineList, profile] = await Promise.all([
          repo.getLogsBetween(range.monday, range.sunday, 7),
          repo.listRoutines(),
          repo.getProfile(),
        ]);
        const language = languageOf(profile);
        const logsByDate = new Map(logList.rows.map(doc => [logDate(doc), doc]));

        // History and, when the list does not hold it, the document of each routine used this week.
        const routineIds = [
          ...new Set(logList.rows.flatMap(doc => (isSafeDocId(doc.data.routineId) ? [doc.data.routineId] : []))),
        ];
        const routineReads = new Map(
          await Promise.all(
            routineIds.map(async routineId => {
              const listed = routineList.rows.find(r => r.id === routineId) ?? null;
              const [history, current] = await Promise.all([
                repo.listRoutineHistory(routineId),
                listed ? Promise.resolve(listed) : repo.getRoutine(routineId),
              ]);
              return [routineId, { history, current }] as const;
            }),
          ),
        );

        const performedRoutineIds = new Set<string>();
        let sessionsDone = 0;

        const days = range.days.map(date => {
          const doc = logsByDate.get(date);
          if (!doc) return { date, session: null };

          const routineId = str(doc.data.routineId);
          const reads = routineId ? routineReads.get(routineId) : undefined;
          const plan = reads ? routinePlanOn(date, reads.history, reads.current) : null;
          const planIds = plan?.exercises ? new Set(plan.exercises.map(ex => ex.id)) : null;

          const logged = records(doc.data.exercises);
          const loggedIds = new Set(logged.map(ex => str(ex.exerciseId)));
          const exercises = [
            ...logged.map(ex => {
              const exerciseId = str(ex.exerciseId) ?? '';
              const status = statusOf(ex);
              return {
                exerciseId,
                ...names(str(ex.exerciseId), ex.name, language),
                status,
                // A planned exercise's sets are a copy of the last session, so they are left out.
                ...(status === 'performed' ? { sets: setsOut(ex.sets) } : {}),
                // Only present when false: added to the log by hand, or swapped in.
                ...(planIds && !planIds.has(exerciseId) ? { inRoutine: false } : {}),
              };
            }),
            ...(plan?.exercises ?? [])
              .filter(ex => !loggedIds.has(ex.id))
              .map(ex => ({ exerciseId: ex.id, ...names(ex.id, ex.name, language), status: 'skipped' })),
          ];

          const performed = exercises.some(ex => ex.status === 'performed');
          if (performed) {
            sessionsDone++;
            if (routineId) performedRoutineIds.add(routineId);
          }
          return {
            date,
            session: {
              routineId,
              routineName: str(doc.data.routineName),
              isDeload: doc.data.isDeload === true,
              status: performed ? 'performed' : 'planned',
              routineBasis: plan?.basis,
              notes: str(doc.data.notes),
              exercises,
            },
          };
        });

        const daysPerWeekTarget = toCoachProfile(profile).daysPerWeekTarget ?? null;
        return jsonResult({
          week: range.week,
          monday: range.monday,
          sunday: range.sunday,
          today,
          timeZone: WEEK_TIME_ZONE,
          daysPerWeekTarget,
          sessionsDone,
          sessionsRemaining: daysPerWeekTarget === null ? null : Math.max(0, daysPerWeekTarget - sessionsDone),
          routinesNotDone: routineList.rows
            .filter(doc => !performedRoutineIds.has(doc.id))
            .map(doc => ({ id: doc.id, name: str(doc.data.name) ?? '' })),
          truncated: logList.truncated || routineList.truncated,
          days,
        });
      }),
  };
}

// ─── Registration ────────────────────────────────────────────────────

const NAMES_NOTE =
  '`name` is the stored name; `displayName` appears only when the app shows a different (Spanish) name.';
const EQUIPMENT_NOTE =
  'When set: warmupTemplate, loadIncrementKg (smallest weight step in kg) and dumbbellLoad ("perHand" = one dumbbell, "total" = both).';
const GROUP_NOTE =
  'Supersets and trisets: exercises with the same `group` number are done together; groupIncomplete true marks a ' +
  'superset or triset that lacks a partner (a superset is exactly 2 exercises in a row, a triset exactly 3).';
const UTC_NOTE ='The window is cut on the server\'s UTC date, so it can be one day wider than the local view.';
const STATUS_NOTE =
  'status "planned" means the exercise was saved as a plan and its sets are a copy of the last session, not a lift.';

export function registerReadTools(server: McpServer, repo: ReadToolsRepo, now?: () => Date) {
  const tools = createReadTools(repo, now);
  const annotations = { readOnlyHint: true };

  server.registerTool(
    'list_routines',
    {
      title: 'List routines',
      description: `The owner's workout routines in app order (at most 50), each with its exercises. ${GROUP_NOTE} ${NAMES_NOTE}`,
      inputSchema: toolSchemas.list_routines,
      annotations,
    },
    withTimeout(tools.list_routines),
  );

  server.registerTool(
    'get_routine',
    {
      title: 'Get routine',
      description:
        `One routine with its exercises. progressiveOverload is the rep range from the exercise library and ` +
        `repRange its parsed form (null when it has no numeric range); inLibrary false means the exercise is no ` +
        `longer in the library and the range is the routine's stored copy. ${GROUP_NOTE} ${EQUIPMENT_NOTE} ${NAMES_NOTE}`,
      inputSchema: toolSchemas.get_routine,
      annotations,
    },
    withTimeout(tools.get_routine),
  );

  server.registerTool(
    'list_exercises',
    {
      title: 'List exercises',
      description:
        `The exercise library (at most 300), sorted by stored name. targetNotes is the target area, ` +
        `progressiveOverload the rep range. ${EQUIPMENT_NOTE} ${NAMES_NOTE}`,
      inputSchema: toolSchemas.list_exercises,
      annotations,
    },
    withTimeout(tools.list_exercises),
  );

  server.registerTool(
    'get_recent_logs',
    {
      title: 'Recent workout logs',
      description:
        `Workout logs of the last \`days\` days (default 14, max 90), newest first. Weights in kg. ` +
        `${STATUS_NOTE} isDeload logs hold reduced weights and sets. ${UTC_NOTE} ${NAMES_NOTE}`,
      inputSchema: toolSchemas.get_recent_logs,
      annotations,
    },
    withTimeout(tools.get_recent_logs),
  );

  server.registerTool(
    'get_exercise_history',
    {
      title: 'Exercise history',
      description:
        `Sessions of one exercise in the last \`days\` days (default 120, max 365), newest first, ` +
        `at most \`limit\` (default 10, max 30). Weights in kg. ${STATUS_NOTE} ${UTC_NOTE}`,
      inputSchema: toolSchemas.get_exercise_history,
      annotations,
    },
    withTimeout(tools.get_exercise_history),
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Training profile',
      description:
        'The owner\'s training profile: goal, days per week, session length, training age, constraints, age in years, ' +
        'and the app language (en or es).',
      inputSchema: toolSchemas.get_profile,
      annotations,
    },
    withTimeout(tools.get_profile),
  );

  server.registerTool(
    'get_week_status',
    {
      title: 'Week status',
      description:
        `One ISO week, Monday to Sunday in Europe/Berlin (default: the current week): each day with its session ` +
        `and each exercise as performed, planned or skipped. Weights in kg. planned = saved as a plan, not lifted; ` +
        `on a day before today, planned means the exercise was not lifted. skipped = in the routine version of ` +
        `that day, not in that day's log (a routine edit later the same day counts as that day's version; ` +
        `routineBasis "unknown" means no version was found and nothing is marked skipped). sessionsDone counts ` +
        `days with at least one performed exercise; sessionsRemaining is the profile's days-per-week target ` +
        `minus that (null without a target); routinesNotDone lists routines with no performed session this week. ` +
        `${NAMES_NOTE}`,
      inputSchema: toolSchemas.get_week_status,
      annotations,
    },
    withTimeout(tools.get_week_status),
  );
}
