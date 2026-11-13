// server-only: src/lib/mcp/tools.write.ts
// The write tools of the MCP endpoint: they add exercises and routines, edit the
// exercise list of a routine and edit a few fields of an exercise. No tool takes
// a uid, and none removes a document. Every check runs before the batch is opened, so a refused call writes
// nothing. Documents come only from the builders the app uses (routineDoc,
// exerciseDoc, routineHistoryPlan), so the app and the MCP store the same shape.
import { z } from 'zod4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Exercise, ExerciseData, MuscleGroup, RoutineExercise } from '@/types';
import type { RoutineVersion } from '@/types/routineHistory';
import { MUSCLE_GROUPS_LIST, WARMUP_TEMPLATES } from '@/lib/constants';
import { buildExerciseDoc } from '@/lib/exerciseDoc';
import { displayExerciseName } from '@/lib/exerciseDisplay';
import { buildExerciseDocId, toSlug } from '@/lib/ids';
import { buildRoutineCreateFields, buildRoutineUpdateFields, type RoutineExerciseEntry } from '@/lib/routineDoc';
import { addRoutineExerciseAt, removeRoutineExerciseAt, replaceRoutineExerciseAt } from '@/lib/routineEditing';
import { planRoutineVersions } from '@/lib/routineHistoryPlan';
import { parseRepRange } from '@/lib/repGoal';
import { slugify } from '@/lib/utils';
import { withTimeout } from './limits';
import { isSafeDocId, type McpRepoWithWriteReads, type RawDoc } from './repo.server';
import type { ExerciseFieldChange, McpWriteRepo, RoutineCascade } from './repo.write.server';
import { errorResult, jsonResult, type ToolResult } from './results';

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

// ─── Input schemas ───────────────────────────────────────────────────

const docId = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeDocId, { message: 'must be a plain id with no "/"' });

const text = z.string().trim().max(MAX_TEXT_LENGTH).optional();

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
  | 'id_unavailable'
  | 'no_fields'
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

/** Runs the one batch of a tool. A batch is atomic: a failed commit writes nothing. */
async function commit(name: string, write: () => Promise<void>): Promise<void> {
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
    refuse('write_failed', 'The write did not complete. Read the routine or the exercise again before any retry.');
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

  /** Stores a new exercise list for an existing routine: one batch with its history versions. */
  async function saveExercises(tool: string, routine: StoredRoutine, next: RoutineExercise[]) {
    const fields = buildRoutineUpdateFields({ exercises: next }) as { exercises: RoutineExerciseEntry[] };
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

  return {
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
        return saveExercises('add_exercise_to_routine', routine, next);
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
        return saveExercises('replace_exercise_in_routine', routine, next);
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
        return saveExercises('remove_exercise_from_routine', routine, next);
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
        return saveExercises('reorder_routine_exercises', routine, next);
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
}
