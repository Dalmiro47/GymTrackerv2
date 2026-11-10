import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutineExercise } from '@/types';
import type { RoutineSnapshot, RoutineVersion } from '@/types/routineHistory';
import { hashRoutineSnapshot } from '@/lib/routineHistory';
import { planRoutineVersions } from './routineHistoryPlan';

// Expected versions are written by hand. Only the hash values come from
// hashRoutineSnapshot, which this change does not touch.
const RID = 'push-day';
const NOW = 1_800_000_000_000;

const bench: RoutineExercise = {
  id: 'bench-press_chest',
  name: 'Bench Press',
  muscleGroup: 'Chest',
  targetNotes: 'Mid chest',
  exerciseSetup: 'Bench flat',
  setStructure: 'superset',
};
const dips: RoutineExercise = { id: 'dips_triceps', name: 'Dips', muscleGroup: 'Triceps' };

const routineA = { name: 'Push Day', description: 'Chest and triceps', exercises: [bench] };
const routineB = { name: 'Push Day', description: 'Chest and triceps', exercises: [bench, dips] };

const snapA: RoutineSnapshot = {
  name: 'Push Day',
  description: 'Chest and triceps',
  exercises: [
    { id: 'bench-press_chest', name: 'Bench Press', muscleGroup: 'Chest', setStructure: 'superset', targetNotes: 'Mid chest' },
  ],
};
const snapB: RoutineSnapshot = {
  name: 'Push Day',
  description: 'Chest and triceps',
  exercises: [
    { id: 'bench-press_chest', name: 'Bench Press', muscleGroup: 'Chest', setStructure: 'superset', targetNotes: 'Mid chest' },
    { id: 'dips_triceps', name: 'Dips', muscleGroup: 'Triceps', setStructure: 'normal', targetNotes: '' },
  ],
};
const hashA = hashRoutineSnapshot(snapA);
const hashB = hashRoutineSnapshot(snapB);

const stored = (ms: number, snapshot: RoutineSnapshot, over: Partial<RoutineVersion> = {}): RoutineVersion => ({
  id: `${RID}_${ms}`,
  routineId: RID,
  routineName: snapshot.name,
  changeType: 'updated',
  source: 'routine-editor',
  createdAtMs: ms,
  snapshot,
  snapshotHash: hashRoutineSnapshot(snapshot),
  prevHash: null,
  ...over,
});

test('the two fixtures hash differently', () => {
  assert.notEqual(hashA, hashB);
});

test('1 version: a created routine with no history', () => {
  const planned = planRoutineVersions({
    routineId: RID, existing: [], before: null, after: routineA, changeType: 'created', source: 'routine-editor', now: NOW,
  });
  assert.deepEqual(planned, [
    {
      id: `${RID}_${NOW}`,
      routineId: RID,
      routineName: 'Push Day',
      changeType: 'created',
      source: 'routine-editor',
      createdAtMs: NOW,
      snapshot: snapA,
      snapshotHash: hashA,
      prevHash: null,
    },
  ]);
});

test('2 versions: the first update of a routine with no history gets a baseline', () => {
  const planned = planRoutineVersions({
    routineId: RID, existing: [], before: routineA, after: routineB, changeType: 'updated', source: 'routine-editor', now: NOW,
  });
  assert.deepEqual(planned, [
    {
      id: `${RID}_${NOW}`,
      routineId: RID,
      routineName: 'Push Day',
      changeType: 'baseline',
      source: 'backfill',
      createdAtMs: NOW,
      snapshot: snapA,
      snapshotHash: hashA,
      prevHash: null,
    },
    {
      id: `${RID}_${NOW + 1}`,
      routineId: RID,
      routineName: 'Push Day',
      changeType: 'updated',
      source: 'routine-editor',
      createdAtMs: NOW + 1,
      snapshot: snapB,
      snapshotHash: hashB,
      prevHash: hashA,
    },
  ]);
  assert.ok(planned[0].createdAtMs < planned[1].createdAtMs);
  assert.notEqual(planned[0].id, planned[1].id);
});

test('1 version: a no-op first update still records the baseline, and only that', () => {
  const planned = planRoutineVersions({
    routineId: RID, existing: [], before: routineA, after: routineA, changeType: 'updated', source: 'exercise-cascade', now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].changeType, 'baseline');
  assert.equal(planned[0].source, 'backfill');
  assert.equal(planned[0].snapshotHash, hashA);
});

test('0 versions: the snapshot equals the latest version', () => {
  const planned = planRoutineVersions({
    routineId: RID,
    existing: [stored(NOW - 500, snapA)],
    before: routineA,
    after: routineA,
    changeType: 'updated',
    source: 'routine-editor',
    now: NOW,
  });
  assert.deepEqual(planned, []);
});

test('0 versions: prose fields outside the snapshot do not count as a change', () => {
  const reworded = { ...routineA, exercises: [{ ...bench, exerciseSetup: 'Bench at 15 degrees', progressiveOverload: '8-10' }] };
  const planned = planRoutineVersions({
    routineId: RID, existing: [stored(NOW - 500, snapA)], before: routineA, after: reworded, changeType: 'updated', source: 'exercise-cascade', now: NOW,
  });
  assert.deepEqual(planned, []);
});

test('prevHash chain: the latest version is found by createdAtMs, in any input order', () => {
  const older = stored(NOW - 2000, snapB);
  const newer = stored(NOW - 1000, snapA, { prevHash: hashB });
  for (const existing of [[older, newer], [newer, older]]) {
    const planned = planRoutineVersions({
      routineId: RID, existing, before: routineA, after: routineB, changeType: 'updated', source: 'routine-editor', now: NOW,
    });
    assert.equal(planned.length, 1, 'history exists, so no baseline');
    assert.equal(planned[0].changeType, 'updated');
    assert.equal(planned[0].prevHash, hashA);
    assert.equal(planned[0].snapshotHash, hashB);
    assert.equal(planned[0].createdAtMs, NOW);
  }
});

test('createdAtMs is always after the latest existing version, so an id is never reused', () => {
  for (const latestMs of [NOW, NOW + 5000]) {
    const planned = planRoutineVersions({
      routineId: RID, existing: [stored(latestMs, snapA)], before: routineA, after: routineB, changeType: 'updated', source: 'routine-editor', now: NOW,
    });
    assert.equal(planned.length, 1);
    assert.equal(planned[0].createdAtMs, latestMs + 1);
    assert.equal(planned[0].id, `${RID}_${latestMs + 1}`);
  }
});

test('a delete always records, even when the snapshot equals the latest version', () => {
  const planned = planRoutineVersions({
    routineId: RID, existing: [stored(NOW - 500, snapA)], before: null, after: routineA, changeType: 'deleted', source: 'routine-editor', now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].changeType, 'deleted');
  assert.equal(planned[0].snapshotHash, hashA);
  assert.equal(planned[0].prevHash, hashA);
});

test('a delete with no history and no before state records one version and no baseline', () => {
  const planned = planRoutineVersions({
    routineId: RID, existing: [], before: null, after: routineA, changeType: 'deleted', source: 'routine-editor', now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].changeType, 'deleted');
  assert.equal(planned[0].prevHash, null);
});

test('kept quirk: a routine re-created with the content of its deleted version records nothing', () => {
  const planned = planRoutineVersions({
    routineId: RID,
    existing: [stored(NOW - 500, snapA, { changeType: 'deleted' })],
    before: null,
    after: routineA,
    changeType: 'created',
    source: 'routine-editor',
    now: NOW,
  });
  assert.deepEqual(planned, []);
});

test('source passes through to the new version; the baseline is always backfill', () => {
  for (const source of ['routine-editor', 'exercise-cascade'] as const) {
    const planned = planRoutineVersions({
      routineId: RID, existing: [], before: routineA, after: routineB, changeType: 'updated', source, now: NOW,
    });
    assert.equal(planned[0].source, 'backfill');
    assert.equal(planned[1].source, source);
  }
});

test('the planner does not change its inputs', () => {
  const existing = [stored(NOW - 2000, snapB), stored(NOW - 1000, snapA)];
  const frozen = JSON.stringify({ existing, routineA, routineB });
  planRoutineVersions({
    routineId: RID, existing, before: routineA, after: routineB, changeType: 'updated', source: 'routine-editor', now: NOW,
  });
  assert.equal(JSON.stringify({ existing, routineA, routineB }), frozen);
});
