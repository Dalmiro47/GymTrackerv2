"use client";

import { useState, useMemo, useEffect } from 'react';
import type { Exercise } from '@/types';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, ChevronRight, Check, ArrowLeft, Dumbbell, Plus } from 'lucide-react';
import { MUSCLE_GROUPS_LIST, type MuscleGroup } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { dedupeExercisesByNameAndMuscle } from '@/lib/routineEditing';

interface AvailableExercisesSelectorProps {
  allExercises: Exercise[];
  selectedExerciseIds: string[];
  onSelectionChange: (exerciseId: string, isSelected: boolean) => void;
  isLoadingExercises: boolean;
  mode?: 'multi' | 'single';
  initialMuscleGroup?: MuscleGroup | null;
  /** Exercises that are already in the target (e.g. logged today). Shown, but not selectable. */
  disabledExerciseIds?: string[];
}

export function AvailableExercisesSelector({
  allExercises,
  selectedExerciseIds,
  onSelectionChange,
  isLoadingExercises,
  mode = 'multi',
  initialMuscleGroup = null,
  disabledExerciseIds = [],
}: AvailableExercisesSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMuscleGroup, setActiveMuscleGroup] = useState<MuscleGroup | 'All' | null>(initialMuscleGroup);

  useEffect(() => {
    setActiveMuscleGroup(initialMuscleGroup);
    setSearchTerm('');
  }, [initialMuscleGroup]);

  // The library can contain the same exercise twice; rendering both makes the picker
  // untrustworthy. Dedupe once, then derive counts/filtering from the result. The key
  // includes the muscle group so a shared name across groups (e.g. "Dips" for Chest and
  // for Triceps) stays visible as two distinct entries.
  const uniqueExercises = useMemo(
    () => dedupeExercisesByNameAndMuscle(allExercises),
    [allExercises]
  );

  const exerciseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    uniqueExercises.forEach(ex => {
      const mg = ex.muscleGroup;
      counts[mg] = (counts[mg] || 0) + 1;
    });
    return counts;
  }, [uniqueExercises]);

  const filteredExercises = useMemo(() => {
    let temp = [...uniqueExercises];
    
    if (activeMuscleGroup === null && searchTerm.trim() !== '') {
       return temp.filter(ex => ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim()));
    }

    if (activeMuscleGroup && activeMuscleGroup !== 'All') {
      temp = temp.filter(ex => ex.muscleGroup === activeMuscleGroup);
    }

    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase().trim();
      temp = temp.filter(ex => ex.name.toLowerCase().includes(q));
    }
    return temp;
  }, [uniqueExercises, searchTerm, activeMuscleGroup]);

  // The muscle-group grid and the filtered list are two views of ONE tree — never two
  // separate `return`s. Typing the first character flips grid -> list; if each view owned
  // its own <Input>, React would unmount the focused field and mobile keyboards would
  // close after every first keystroke. The search box below is rendered once, always.
  const isGridView = activeMuscleGroup === null && searchTerm === '';

  return (
    <div className={cn("flex flex-col h-full", isGridView ? "gap-4" : "gap-3")}>
      <div className="flex items-center gap-2">
        {!isGridView && (
          <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-11 shrink-0 gap-1 px-2 text-[13px] text-muted-foreground"
              onClick={() => {
                  setActiveMuscleGroup(null);
                  setSearchTerm('');
              }}
          >
              <ArrowLeft className="h-4 w-4" />
              Categories
          </Button>
        )}
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              isGridView || activeMuscleGroup === null || activeMuscleGroup === 'All'
                ? 'Search all exercises...'
                : `Search ${activeMuscleGroup} exercises...`
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-11 rounded-md pl-9"
          />
        </div>
      </div>

      {isGridView ? (
        <ScrollArea className="flex-grow -mx-4 px-4">
          <div className="grid grid-cols-2 gap-2.5 pb-4">
            <button
                onClick={() => setActiveMuscleGroup('All')}
                className="pressable flex min-h-[64px] items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Dumbbell className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">All Exercises</span>
                    <span className="block text-[12px] text-muted-foreground tabular-nums">{uniqueExercises.length} items</span>
                </span>
            </button>

            {MUSCLE_GROUPS_LIST.map(mg => {
              const count = exerciseCounts[mg] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={mg}
                  onClick={() => setActiveMuscleGroup(mg)}
                  className="pressable flex min-h-[64px] flex-col justify-center rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="truncate text-[15px] font-semibold">{mg}</span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">{count} exercises</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      ) : (
      <div className="flex-grow border rounded-md bg-background overflow-hidden relative">
         <ScrollArea className="h-full w-full p-2">
            {filteredExercises.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {filteredExercises.map(exercise => {
                  const isSelected = selectedExerciseIds.includes(exercise.id);
                  const isDisabled = disabledExerciseIds.includes(exercise.id);

                  return (
                    <div
                      key={exercise.id}
                      aria-disabled={isDisabled || undefined}
                      className={cn(
                        "flex min-h-[52px] items-center justify-between gap-2 rounded-md border p-2.5 transition-colors",
                        isDisabled
                            ? "cursor-not-allowed border-transparent bg-muted/20 opacity-50"
                            : mode === 'multi' && isSelected
                                ? "cursor-pointer border-primary bg-primary/10"
                                : "cursor-pointer border-transparent bg-muted/20 hover:bg-accent"
                      )}
                      onClick={() => {
                          if (isDisabled) return;
                          if (mode === 'single') {
                              onSelectionChange(exercise.id, true);
                          } else {
                              onSelectionChange(exercise.id, !isSelected);
                          }
                      }}
                    >
                      <div className="min-w-0">
                        <p className={cn("truncate text-[15px] font-medium", mode === 'multi' && isSelected && "text-primary")}>
                            {exercise.name}
                        </p>
                        <p className="text-[12px] text-muted-foreground">{exercise.muscleGroup}</p>
                      </div>

                      {isDisabled ? (
                          <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                              <Check className="h-3 w-3" />
                              Added
                          </Badge>
                      ) : mode === 'multi' ? (
                          isSelected ? (
                              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-200">
                                  <Check className="h-3.5 w-3.5" />
                              </div>
                          ) : (
                              <div className="h-6 w-6 rounded-full border border-muted-foreground/30 shrink-0" />
                          )
                      ) : (
                          <Button size="icon" variant="ghost" tabIndex={-1} className="h-9 w-9 shrink-0 rounded-full text-muted-foreground md:h-9 md:w-9">
                              <Plus className="h-5 w-5" />
                          </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
                <p>No exercises found.</p>
              </div>
            )}
         </ScrollArea>
      </div>
      )}
    </div>
  );
}
