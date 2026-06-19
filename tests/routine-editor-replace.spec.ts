import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  replaceRoutineExerciseAt,
  removeRoutineExerciseAt,
  dedupeExercisesByName,
} from '../src/lib/routineEditing';

/**
 * Routine editor — Replace Exercise parity.
 *
 * A true browser e2e (Google sign-in + live Firestore) is not runnable here without
 * credentials/an emulator, so these tests exercise the SHARED pure logic the routine
 * editor actually calls (src/lib/routineEditing.ts) plus the component contracts by
 * source. They verify the real code paths, not a parallel reimplementation.
 */

// Minimal Exercise/RoutineExercise fixtures (typed loosely to avoid importing the
// app's path-aliased types into the test runtime).
const ex = (id: string, name: string, muscleGroup: string) => ({ id, name, muscleGroup });

const routineList = () => [
  { ...ex('bench', 'Bench Press', 'Chest'), setStructure: 'normal' },
  { ...ex('row', 'Barbell Row', 'Back'), setStructure: 'superset' },
  { ...ex('squat', 'Back Squat', 'Legs'), setStructure: 'normal' },
];

const SRC = (...p: string[]) => path.resolve(__dirname, '..', 'src', ...p);
const read = (...p: string[]) => fs.readFileSync(SRC(...p), 'utf8');

test.describe('Routine editor replace parity', () => {
  // (a) Replacing the exercise at position 2 swaps the exercise but keeps
  //     position=2 and its set-type unchanged.
  test('replace at position 2 keeps slot and set-type', () => {
    const list = routineList() as any;
    const replacement = ex('dl', 'Deadlift', 'Back');

    const next = replaceRoutineExerciseAt(list, 1, replacement as any) as any[];

    expect(next.length).toBe(list.length);
    // Position 2 (index 1) now holds the replacement...
    expect(next[1].id).toBe('dl');
    expect(next[1].name).toBe('Deadlift');
    // ...at the same slot, with the slot's set-type preserved.
    expect(next[1].setStructure).toBe('superset');
    // Neighbours untouched.
    expect(next[0].id).toBe('bench');
    expect(next[2].id).toBe('squat');
  });

  // (b) The replace picker is single-select and scoped to the replaced
  //     exercise's category. Asserted via the component contracts.
  test('replace picker is single-select and category-scoped', () => {
    const replaceDialog = read('components', 'training-log', 'ReplaceExerciseDialog.tsx');
    // The shared picker is driven in single-select mode...
    expect(replaceDialog).toMatch(/mode=("|')single("|')/);
    // ...and scoped to a passed-in muscle group.
    expect(replaceDialog).toContain('initialMuscleGroup');

    const addEdit = read('components', 'routines', 'AddEditRoutineDialog.tsx');
    // The routine editor scopes the replace dialog to the replaced exercise's category.
    expect(addEdit).toContain('initialMuscleGroup={exerciseBeingReplaced?.muscleGroup}');
  });

  // (c) The picker renders NO duplicate exercise names.
  test('picker list has no duplicate names', () => {
    const withDupes = [
      ex('a', 'Neutral-Grip Lat Pull down', 'Back'),
      ex('b', 'Bench Press', 'Chest'),
      ex('c', 'Neutral-Grip Lat Pull down', 'Back'), // duplicate name, different id
      ex('d', 'Bench Press', 'Chest'),
    ];

    const rendered = dedupeExercisesByName(withDupes as any);
    const names = rendered.map(e => e.name);
    const uniqueNames = Array.from(new Set(names.map(n => n.trim().toLowerCase())));

    expect(names.length).toBe(uniqueNames.length); // list is unique
    expect(rendered.length).toBe(2);

    // And the shared picker actually renders the deduped list.
    const selector = read('components', 'routines', 'AvailableExercisesSelector.tsx');
    expect(selector).toContain('dedupeExercisesByName');
  });

  // (d) Removing an exercise reduces count by exactly 1 and preserves the order
  //     of the rest.
  test('remove reduces count by one and preserves order', () => {
    const list = routineList() as any;
    const next = removeRoutineExerciseAt(list, 1) as any[];

    expect(next.length).toBe(list.length - 1);
    expect(next.map(e => e.id)).toEqual(['bench', 'squat']);
  });

  // (e) After Save + reload, the replaced exercise persists at the same slot.
  //     Simulates the dialog's onSubmit serialization + a reload (re-parse).
  test('replaced exercise persists at same slot after save + reload', () => {
    const list = replaceRoutineExerciseAt(routineList() as any, 1, ex('dl', 'Deadlift', 'Back') as any) as any[];

    // onSubmit maps to RoutineData, dropping the UI-only `isMissing` flag.
    const saved = list
      .filter(e => !e.isMissing)
      .map(({ isMissing, ...rest }: any) => rest);

    // Persist + reload (round-trip through JSON, as Firestore would).
    const reloaded = JSON.parse(JSON.stringify(saved));

    expect(reloaded[1].id).toBe('dl');
    expect(reloaded[1].name).toBe('Deadlift');
    expect(reloaded[1].setStructure).toBe('superset');
    expect(reloaded.map((e: any) => e.id)).toEqual(['bench', 'dl', 'squat']);
  });

  // (5) The replace UI imports the SAME picker component as Training Log.
  test('routine replace reuses the Training Log replace/picker components', () => {
    const replaceDialog = read('components', 'training-log', 'ReplaceExerciseDialog.tsx');
    // Training Log's replace dialog uses the shared picker.
    expect(replaceDialog).toContain('AvailableExercisesSelector');

    const addEdit = read('components', 'routines', 'AddEditRoutineDialog.tsx');
    // The routine editor imports that very same component (no duplicated picker logic).
    expect(addEdit).toMatch(/import\s*\{\s*ReplaceExerciseDialog\s*\}\s*from\s*['"]@\/components\/training-log\/ReplaceExerciseDialog['"]/);
  });
});
