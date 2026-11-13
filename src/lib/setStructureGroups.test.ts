import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMarks, groupSizeOf, incompleteRuns, newIncompleteRuns } from './setStructureGroups';

/** `list('a:superset', 'b')`: ids with their structure; no structure means the field is absent. */
const list = (...items: string[]) =>
  items.map(item => {
    const [id, setStructure] = item.split(':');
    return setStructure === undefined ? { id } : { id, setStructure };
  });

const ss = (...ids: string[]) => ids.map(id => `${id}:superset`);
const tri = (...ids: string[]) => ids.map(id => `${id}:triset`);

test('groupSizeOf: superset 2, triset 3, everything else 1', () => {
  assert.equal(groupSizeOf('superset'), 2);
  assert.equal(groupSizeOf('triset'), 3);
  for (const other of ['normal', 'dropSet', 'restPause', 'giant set', '', null, undefined]) {
    assert.equal(groupSizeOf(other), 1, String(other));
  }
});

test('incompleteRuns: valid lists have none', () => {
  for (const [label, items] of [
    ['empty list', []],
    ['all normal', ['a:normal', 'b:normal']],
    ['a missing setStructure reads as normal', ['a', 'b']],
    ['2 supersets', ss('a', 'b')],
    ['4 supersets are two pairs', ss('a', 'b', 'c', 'd')],
    ['triset of 3', tri('a', 'b', 'c')],
    ['triset of 6', tri('a', 'b', 'c', 'd', 'e', 'f')],
    ['a pair next to a triset does not merge', [...ss('a', 'b'), ...tri('c', 'd', 'e')]],
    ['a normal exercise between two pairs', [...ss('a', 'b'), 'x:normal', ...ss('c', 'd')]],
    ['dropSet runs of any length', ['a:dropSet', 'b:dropSet', 'c:dropSet']],
    ['restPause runs of any length', ['a:restPause', 'b:restPause']],
  ] as const) {
    assert.deepEqual(incompleteRuns(list(...items)), [], label);
  }
});

test('incompleteRuns: a run that is not a multiple of the group size', () => {
  assert.deepEqual(incompleteRuns(list(...ss('a', 'b', 'c'))), [{ structure: 'superset', ids: ['a', 'b', 'c'] }]);
  assert.deepEqual(incompleteRuns(list('x', 'a:superset', 'y')), [{ structure: 'superset', ids: ['a'] }]);
  assert.deepEqual(incompleteRuns(list(...tri('a', 'b'))), [{ structure: 'triset', ids: ['a', 'b'] }]);
  assert.deepEqual(incompleteRuns(list(...tri('a', 'b', 'c', 'd'))), [{ structure: 'triset', ids: ['a', 'b', 'c', 'd'] }]);
  // Two runs split by another structure are judged one by one.
  assert.deepEqual(incompleteRuns(list('a:superset', 'x:dropSet', 'b:superset', ...tri('c', 'd', 'e'))), [
    { structure: 'superset', ids: ['a'] },
    { structure: 'superset', ids: ['b'] },
  ]);
});

test('newIncompleteRuns: only a run the change creates or changes', () => {
  const before = list('a:superset', 'x', ...ss('b', 'c'));
  // Untouched broken run, valid change elsewhere.
  assert.deepEqual(newIncompleteRuns(before, list('a:superset', 'x', 'b', 'c')), []);
  // The broken run moved as it is: same structure, same ids, same order.
  assert.deepEqual(newIncompleteRuns(before, list('x', ...ss('b', 'c'), 'y', 'a:superset')), []);
  // The broken run is repaired.
  assert.deepEqual(newIncompleteRuns(before, list('a', 'x', ...ss('b', 'c'))), []);
  // A new broken run.
  assert.deepEqual(newIncompleteRuns(before, list('a:superset', 'x', 'b:superset', 'c')), [{ structure: 'superset', ids: ['b'] }]);
  // The broken run changed: it grew to another incomplete length.
  assert.deepEqual(newIncompleteRuns(list(...ss('a'), 'x'), list(...tri('a'), 'x')), [{ structure: 'triset', ids: ['a'] }]);
  assert.deepEqual(newIncompleteRuns(list(...ss('a', 'b', 'c')), list(...ss('a', 'c', 'b'))), [{ structure: 'superset', ids: ['a', 'c', 'b'] }]);
});

test('groupMarks: a number per full chunk, a flag on every member of an incomplete run', () => {
  assert.deepEqual(groupMarks(list()), []);
  assert.deepEqual(groupMarks(list('a', 'b:dropSet')), [{}, {}]);
  assert.deepEqual(
    groupMarks(list(...ss('a', 'b', 'c', 'd'), 'x', ...tri('e', 'f', 'g'))),
    [{ group: 1 }, { group: 1 }, { group: 2 }, { group: 2 }, {}, { group: 3 }, { group: 3 }, { group: 3 }],
  );
  // 3 supersets: the app links the first two and leaves the third alone.
  assert.deepEqual(
    groupMarks(list(...ss('a', 'b', 'c'), 'x', ...ss('d', 'e'))),
    [{ group: 1, groupIncomplete: true }, { group: 1, groupIncomplete: true }, { groupIncomplete: true }, {}, { group: 2 }, { group: 2 }],
  );
  assert.deepEqual(groupMarks(list('a:superset', ...tri('b', 'c'))), [{ groupIncomplete: true }, { groupIncomplete: true }, { groupIncomplete: true }]);
});
