# Routine Editor — Replace Exercise Parity Plan

## Goal
Bring the Routine editor's exercise-editing UX to parity with the Training Log:
a trustworthy single-select **Replace** in place, plus a picker with no duplicate
names and correct category scoping. Reuse the Training Log's existing replace/picker
components — do not invent a new pattern.

## How Training Log does it (reference)
- `LoggedExerciseCard` renders an `ArrowLeftRight` button → `onReplace()`.
- `log/page.tsx` opens `ReplaceExerciseDialog` and calls `useTrainingLog.replaceExerciseInLog`,
  which swaps the exercise **in place** (same array index via `findIndex`) and **preserves
  `setStructure` / `setStructureOverride`**.
- `ReplaceExerciseDialog` wraps the shared `AvailableExercisesSelector` with
  `mode="single"` + `initialMuscleGroup` (scopes the list to the replaced exercise's category).

## Diagnosed problems
1. **No replace in the routine editor.** `SelectedRoutineExercisesList` only supports
   Remove, Insert (multi-select add), and reorder.
2. **Picker shows duplicates** (e.g. "Neutral-Grip Lat Pull down" twice). Root cause:
   `AvailableExercisesSelector` renders `allExercises` verbatim with no dedupe. If the user's
   library contains two exercises with the same name (a user-created dup of a seeded default,
   or cross-version seed remnants) both render. Fix at the picker so every consumer benefits.
3. **Insert surfaces misleading flagged entries.** Insert opens the picker in `multi` mode,
   so exercises already in the routine show a checkmark/flag — confusing when the intent is to
   add or, now, to replace one slot. Replace will use `mode="single"` (via `ReplaceExerciseDialog`)
   and exclude already-present exercises, removing the misleading flags for that flow.

## Files to change
- **`src/lib/routineEditing.ts`** (NEW) — pure, shared helpers used by both the UI and tests
  (single source of truth, no duplicated logic):
  - `replaceRoutineExerciseAt(list, index, newExercise)` — swap in place, keep position,
    preserve the slot's `setStructure`.
  - `removeRoutineExerciseAt(list, index)` — remove one, preserve order.
  - `dedupeExercisesByName(exercises)` — case-insensitive, keeps first occurrence.
- **`src/components/routines/AvailableExercisesSelector.tsx`** — dedupe the rendered list via
  `dedupeExercisesByName` (fixes duplicates for Add, Insert, and Replace at once).
- **`src/components/routines/SelectedRoutineExercisesList.tsx`** — add a Replace
  (`ArrowLeftRight`) button per item → `onReplaceExercise(index)`.
- **`src/components/routines/AddEditRoutineDialog.tsx`** — own `replaceIndex` state, render the
  Training Log's `ReplaceExerciseDialog` (the SAME component), call `replaceRoutineExerciseAt`
  on selection, scope via `initialMuscleGroup` = replaced exercise's `muscleGroup`, and exclude
  already-present exercises from the replace list.

## Replace interaction
1. User clicks the Replace icon on a routine exercise row.
2. `ReplaceExerciseDialog` opens, single-select, scoped to that exercise's muscle group.
3. Selecting an exercise swaps it **in place** — position unchanged, `setStructure` unchanged.
4. Saving persists the edited routine; on reload the replaced exercise sits in the same slot.

## Components reused
- `ReplaceExerciseDialog` (from `training-log/`) — same component Training Log uses for replace.
- `AvailableExercisesSelector` — the shared picker, now deduped.

## Testing note
A true browser e2e (Google sign-in + live Firestore) is not runnable in this environment
without credentials/an emulator. The new spec `tests/routine-editor-replace.spec.ts` therefore
exercises the **shared pure logic the UI actually calls** (`routineEditing.ts`) for the
behavioural criteria (replace-in-place, dedupe, remove, save→reload round-trip) and asserts the
**component contracts** by source (replace UI imports the same `ReplaceExerciseDialog`; the
dialog uses `mode="single"` + `initialMuscleGroup`). This keeps the tests deterministic while
verifying the real code paths, not a parallel reimplementation.
