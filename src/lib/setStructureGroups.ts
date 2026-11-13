/**
 * Pure rules for superset and triset groups in an exercise list.
 *
 * A group is not stored: the app derives it from the order. Consecutive exercises
 * with the same structure form a run, and the run is cut into chunks from the top:
 * 2 for a superset, 3 for a triset. A run whose length is not a multiple of that
 * size leaves a member without its partners: an incomplete group.
 *
 * Same chunking as the routine editor (SelectedRoutineExercisesList) and the
 * Training Log (ExerciseList), which still hold their own copy. Used by the MCP.
 */

type Entry = { id: string; setStructure?: string | null };

/** How many exercises one group of this structure holds; 1 = the structure does not group. */
export function groupSizeOf(structure: string | null | undefined): number {
  if (structure === 'superset') return 2;
  if (structure === 'triset') return 3;
  return 1;
}

export type GroupRun = { structure: string; ids: string[] };

type Run = GroupRun & { start: number; size: number };

/** Every maximal run of consecutive exercises with the same grouping structure. */
function groupRuns(list: Entry[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let index = 0; index < list.length; index++) {
    const structure = list[index].setStructure || 'normal';
    const size = groupSizeOf(structure);
    if (size === 1) {
      current = null;
    } else if (current && current.structure === structure) {
      current.ids.push(list[index].id);
    } else {
      current = { structure, ids: [list[index].id], start: index, size };
      runs.push(current);
    }
  }
  return runs;
}

/** The runs that leave an incomplete group, in list order. */
export function incompleteRuns(list: Entry[]): GroupRun[] {
  return groupRuns(list)
    .filter(run => run.ids.length % run.size !== 0)
    .map(({ structure, ids }) => ({ structure, ids }));
}

const runKey = (run: GroupRun) => JSON.stringify([run.structure, ...run.ids]);

/**
 * The incomplete runs of `after` that `before` does not hold (same structure, same
 * ids, same order). A run that was already incomplete and is untouched is not returned.
 */
export function newIncompleteRuns(before: Entry[], after: Entry[]): GroupRun[] {
  const known = new Set(incompleteRuns(before).map(runKey));
  return incompleteRuns(after).filter(run => !known.has(runKey(run)));
}

export type GroupMark = { group?: number; groupIncomplete?: true };

/**
 * One mark per exercise, in list order:
 *  - `group`: 1-based number of the full chunk the exercise is in, counted over the
 *    whole list. Absent for an exercise outside a full chunk.
 *  - `groupIncomplete`: true for every member of a run that leaves an incomplete group.
 */
export function groupMarks(list: Entry[]): GroupMark[] {
  const marks: GroupMark[] = list.map(() => ({}));
  let group = 0;
  for (const run of groupRuns(list)) {
    const incomplete = run.ids.length % run.size !== 0;
    const inFullChunks = run.ids.length - (run.ids.length % run.size);
    run.ids.forEach((_, offset) => {
      const mark = marks[run.start + offset];
      if (offset < inFullChunks) mark.group = group + 1 + Math.floor(offset / run.size);
      if (incomplete) mark.groupIncomplete = true;
    });
    group += inFullChunks / run.size;
  }
  return marks;
}
