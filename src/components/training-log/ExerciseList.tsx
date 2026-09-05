"use client";

import React from 'react';
import { PlusCircle } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { LoggedExercise, LoggedSet, MuscleGroup, SetStructure } from '@/types';
import { LoggedExerciseCard } from '@/components/training-log/LoggedExerciseCard';
import { RoutineGroupConnector } from '@/components/training-log/RoutineGroupConnector';
import { useI18n } from '@/contexts/LanguageContext';

// Get the effective structure for an exercise (override, then routine default, then normal)
function effectiveOf(ex: { setStructure?: SetStructure; setStructureOverride?: SetStructure | null } | undefined): SetStructure {
  if (!ex) return 'normal';
  return ex.setStructureOverride ?? ex.setStructure ?? 'normal';
}

// Logic for max group size
const getGroupSize = (type: string) => {
  const t = type.toLowerCase();
  if (t === 'superset') return 2;
  if (t === 'triset') return 3;
  if (t === 'giant set') return 99;
  return 1;
};

export interface ExerciseListProps {
  exercises: LoggedExercise[];
  sensors: SensorDescriptor<SensorOptions>[];
  savedExerciseIds: Set<string>;
  isBusy: boolean;
  isReadOnly: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  onUpdateSets: (loggedExercise: LoggedExercise, sets: LoggedSet[]) => void;
  onRemove: (rowId: string) => void;
  onReplace: (rowId: string, muscleGroup: MuscleGroup) => void;
  onUpdateSetStructureOverride: (exerciseId: string, structure: SetStructure | null) => void;
  onAddAt: (index: number) => void;
}

/**
 * The day's exercise cards, memoised.
 *
 * Every card runs `useSortable` plus a stack of hooks and its own set rows, so a
 * re-render of the whole list is the most expensive thing on this page. It used to run
 * on any Training Log state change — including merely opening a picker — and that
 * render had to finish before the dialog could paint, which is what made dialogs feel
 * delayed. Memoised here + stable callbacks from the page = opening a dialog no longer
 * touches the list at all, the way the AI Coach button only ever re-renders itself.
 *
 * Keep every prop referentially stable across unrelated renders or the memo is a no-op.
 */
export const ExerciseList = React.memo(function ExerciseList({
  exercises,
  sensors,
  savedExerciseIds,
  isBusy,
  isReadOnly,
  onDragEnd,
  onUpdateSets,
  onRemove,
  onReplace,
  onUpdateSetStructureOverride,
  onAddAt,
}: ExerciseListProps) {
  const { t } = useI18n();
  const rowIds = React.useMemo(() => exercises.map(ex => ex.id), [exercises]);

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          <div>
            {exercises.map((loggedEx, index) => {
                const currentStructure = effectiveOf(loggedEx);
                const nextExercise = exercises[index + 1];
                const nextStructure = nextExercise ? effectiveOf(nextExercise) : 'normal';

                // LOGIC: Only link if next is same structure AND we are not at the end of a group size cap
                let shouldLink = false;

                if (nextExercise && currentStructure !== 'normal' && currentStructure === nextStructure) {
                    // Calculate streak (how many items before this one were the same type?)
                    let streak = 1;
                    for (let i = index - 1; i >= 0; i--) {
                        const prev = exercises[i];
                        if (effectiveOf(prev) === currentStructure) {
                            streak++;
                        } else {
                            break;
                        }
                    }

                    const maxSize = getGroupSize(currentStructure);
                    // Link if we haven't hit the max size for this group chunk
                    if (streak % maxSize !== 0) {
                        shouldLink = true;
                    }
                }

              return (
              <React.Fragment key={loggedEx.id}>
                <div className={cn(!shouldLink && "mb-3")}>
                    <LoggedExerciseCard
                      loggedExercise={loggedEx}
                      onUpdateSets={(sets) => onUpdateSets(loggedEx, sets)}
                      onRemove={() => onRemove(loggedEx.id)}
                      onReplace={() => onReplace(loggedEx.id, loggedEx.muscleGroup)}
                      isSavingParentLog={isBusy}
                      onUpdateSetStructureOverride={onUpdateSetStructureOverride}
                      isReadOnly={isReadOnly}
                      isSavedForDay={savedExerciseIds.has(loggedEx.id)}
                    />
                </div>
                {index < exercises.length - 1 && (
                  shouldLink ? (
                    <RoutineGroupConnector structure={currentStructure} />
                  ) : (
                    // Standard Divider
                    <div className="relative my-2 group">
                        <div className="relative z-10 flex items-center justify-center">
                            <Button
                                onClick={() => onAddAt(index + 1)}
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-dashed bg-background px-3 text-[12px] font-medium text-muted-foreground hover:border-solid hover:text-foreground"
                            >
                                <PlusCircle className="h-3.5 w-3.5" />
                                {t('log.addExerciseHere')}
                            </Button>
                        </div>
                        <div className="absolute inset-0 flex items-center" aria-hidden="true">
                            <div className="w-full border-t border-border" />
                        </div>
                    </div>
                  )
                )}
              </React.Fragment>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Final Add Button */}
      <div className="flex items-center gap-2 pt-1">
          <Separator className="flex-1" />
          <Button
              onClick={() => onAddAt(exercises.length)}
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-full border-dashed px-3.5 text-[13px] font-medium text-muted-foreground hover:border-solid hover:text-foreground"
          >
              <PlusCircle className="h-4 w-4" />
              {t('log.addAnotherExercise')}
          </Button>
          <Separator className="flex-1" />
      </div>
    </>
  );
});
