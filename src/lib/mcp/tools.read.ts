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
import { withTimeout } from './limits';
import { isSafeDocId, type McpRepo, type RawDoc } from './repo.server';
import { errorResult, jsonResult, type ToolResult } from './results';

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

const languageOf = (profile: Record<string, unknown> | null): Language =>
  isLanguage(profile?.language) ? profile.language : DEFAULT_LANGUAGE;

function routineOut(doc: RawDoc, language: Language) {
  return {
    id: doc.id,
    name: str(doc.data.name) ?? '',
    description: str(doc.data.description),
    order: num(doc.data.order) ?? undefined,
    exercises: records(doc.data.exercises).map(ex => ({
      id: str(ex.id) ?? '',
      ...names(str(ex.id), ex.name, language),
      muscleGroup: str(ex.muscleGroup) ?? '',
      setStructure: str(ex.setStructure) ?? 'normal',
    })),
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

export function createReadTools(repo: McpRepo, now: () => Date = () => new Date()) {
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
        return doc ? jsonResult(routineOut(doc, languageOf(profile))) : errorResult(`No routine with id "${id}".`);
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
  };
}

// ─── Registration ────────────────────────────────────────────────────

const NAMES_NOTE =
  '`name` is the stored name; `displayName` appears only when the app shows a different (Spanish) name.';
const UTC_NOTE = 'The window is cut on the server\'s UTC date, so it can be one day wider than the local view.';
const STATUS_NOTE =
  'status "planned" means the exercise was saved as a plan and its sets are a copy of the last session, not a lift.';

export function registerReadTools(server: McpServer, repo: McpRepo, now?: () => Date) {
  const tools = createReadTools(repo, now);
  const annotations = { readOnlyHint: true };

  server.registerTool(
    'list_routines',
    {
      title: 'List routines',
      description: `The owner's workout routines in app order (at most 50), each with its exercises. ${NAMES_NOTE}`,
      inputSchema: toolSchemas.list_routines,
      annotations,
    },
    withTimeout(tools.list_routines),
  );

  server.registerTool(
    'get_routine',
    {
      title: 'Get routine',
      description: `One routine with its exercises. ${NAMES_NOTE}`,
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
        `progressiveOverload the rep range. ${NAMES_NOTE}`,
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
}
