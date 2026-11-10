import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutineExercise } from '@/types';
import { addRoutineExerciseAt } from './routineEditing';

// Frozen copy of the insert that was inline in AddEditRoutineDialog
// (handleExerciseSelectionChange) before the helper existed.
const legacyInsert = (
  prevSelected: RoutineExercise[],
  insertionIndex: number | null,
  routineExercise: RoutineExercise,
): RoutineExercise[] => {
  if (insertionIndex !== null) {
    const newList = [...prevSelected];
    newList.splice(insertionIndex, 0, routineExercise);
    return newList;
  } else {
    return [...prevSelected, routineExercise];
  }
};

const ex = (id: string): RoutineExercise => ({ id, name: id.toUpperCase(), muscleGroup: 'Chest', setStructure: 'normal' });
const list = [ex('a'), ex('b'), ex('c')];
const added = ex('new');
const ids = (l: RoutineExercise[]) => l.map(e => e.id);

test('addRoutineExerciseAt: same result as the old inline splice at start, middle, end and null', () => {
  for (const index of [0, 1, 2, 3, null]) {
    assert.deepEqual(addRoutineExerciseAt(list, index, added), legacyInsert(list, index, added), `index ${String(index)}`);
  }
  assert.deepEqual(addRoutineExerciseAt([], null, added), legacyInsert([], null, added));
  assert.deepEqual(addRoutineExerciseAt([], 0, added), legacyInsert([], 0, added));
});

test('addRoutineExerciseAt: positions', () => {
  assert.deepEqual(ids(addRoutineExerciseAt(list, 0, added)), ['new', 'a', 'b', 'c']);
  assert.deepEqual(ids(addRoutineExerciseAt(list, 1, added)), ['a', 'new', 'b', 'c']);
  assert.deepEqual(ids(addRoutineExerciseAt(list, 3, added)), ['a', 'b', 'c', 'new']);
  assert.deepEqual(ids(addRoutineExerciseAt(list, null, added)), ['a', 'b', 'c', 'new']);
});

test('addRoutineExerciseAt: returns a new list and keeps the input', () => {
  const input = [...list];
  const out = addRoutineExerciseAt(input, 1, added);
  assert.notEqual(out, input);
  assert.deepEqual(ids(input), ['a', 'b', 'c']);
});
