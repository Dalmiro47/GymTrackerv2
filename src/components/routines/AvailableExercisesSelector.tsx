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

interface AvailableExercisesSelectorProps {
  allExercises: Exercise[];
  selectedExerciseIds: string[];
  onSelectionChange: (exerciseId: string, isSelected: boolean) => void;
  isLoadingExercises: boolean;
  mode?: 'multi' | 'single'; // NEW: Determines interaction style
  initialMuscleGroup?: MuscleGroup | null; // NEW: Allows starting inside a category
}

export function AvailableExercisesSelector({
  allExercises,
  selectedExerciseIds,
  onSelectionChange,
  isLoadingExercises,
  mode = 'multi',
  initialMuscleGroup = null,
}: AvailableExercisesSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMuscleGroup, setActiveMuscleGroup] = useState<MuscleGroup | 'All' | null>(initialMuscleGroup);

  // Reset to initial group if the dialog re-opens with a different prop
  useEffect(() => {
    setActiveMuscleGroup(initialMuscleGroup);
    setSearchTerm('');
  }, [initialMuscleGroup]);

  // Group exercises by muscle for the counts on the grid view
  const exerciseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allExercises.forEach(ex => {
      const mg = ex.muscleGroup;
      counts[mg] = (counts[mg] || 0) + 1;
    });
    return counts;
  }, [allExercises]);

  const filteredExercises = useMemo(() => {
    let temp = [...allExercises];
    
    // If searching globally (no muscle group selected), just filter by name
    if (activeMuscleGroup === null && searchTerm.trim() !== '') {
       return temp.filter(ex => ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim()));
    }

    // Otherwise, filter by muscle group FIRST
    if (activeMuscleGroup && activeMuscleGroup !== 'All') {
      temp = temp.filter(ex => ex.muscleGroup === activeMuscleGroup);
    }

    // THEN filter by search term within that group
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase().trim();
      temp = temp.filter(ex => ex.name.toLowerCase().includes(q));
    }
    return temp;
  }, [allExercises, searchTerm, activeMuscleGroup]);

  // VIEW 1: Muscle Group Grid
  // Only show if no muscle group is active AND we aren't searching globally
  if (activeMuscleGroup === null && searchTerm === '') {
    return (
      <div className="flex flex-col h-full gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search all exercises..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <ScrollArea className="flex-grow -mx-6 px-6"> 
           {/* Added negative margin to scroll area to allow full width scrolling while keeping padding */}
          <div className="grid grid-cols-2 gap-3 pb-4">
            <button
                onClick={() => setActiveMuscleGroup('All')}
                className="flex flex-col items-center justify-center p-4 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all text-center gap-2"
            >
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                    <Dumbbell className="h-6 w-6" />
                </div>
                <div>
                    <span className="font-semibold block">All Exercises</span>
                    <span className="text-xs text-muted-foreground">{allExercises.length} items</span>
                </div>
            </button>

            {MUSCLE_GROUPS_LIST.map(mg => {
              const count = exerciseCounts[mg] || 0;
              if (count === 0) return null; // Hide empty groups
              return (
                <button
                  key={mg}
                  onClick={() => setActiveMuscleGroup(mg)}
                  className="flex flex-col items-start p-4 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all text-left"
                >
                  <span className="font-semibold text-base">{mg}</span>
                  <span className="text-xs text-muted-foreground">{count} exercises</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // VIEW 2: Exercise List (Filtered)
  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2">
        <Button 
            variant="ghost" 
            size="sm" 
            className="h-9 px-2 -ml-2 text-muted-foreground"
            onClick={() => {
                setActiveMuscleGroup(null);
                setSearchTerm('');
            }}
        >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Categories
        </Button>
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${activeMuscleGroup === 'All' ? '' : activeMuscleGroup} exercises...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-grow border rounded-md bg-background overflow-hidden relative">
         <ScrollArea className="h-full w-full p-2">
            {filteredExercises.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {filteredExercises.map(exercise => {
                  const isSelected = selectedExerciseIds.includes(exercise.id);
                  
                  return (
                    <div
                      key={exercise.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer",
                        // In multi mode, highlight selected. In single mode, just hover effect.
                        mode === 'multi' && isSelected 
                            ? "bg-primary/5 border-primary shadow-sm" 
                            : "hover:bg-muted/50 border-transparent bg-muted/10"
                      )}
                      onClick={() => {
                          if (mode === 'single') {
                              // Single select mode: Click implies action immediately
                              onSelectionChange(exercise.id, true);
                          } else {
                              // Multi select mode: Toggle selection
                              onSelectionChange(exercise.id, !isSelected);
                          }
                      }}
                    >
                      <div>
                        <p className={cn("font-medium text-sm", mode === 'multi' && isSelected && "text-primary")}>
                            {exercise.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
                      </div>
                      
                      {mode === 'multi' ? (
                          // Checkbox UI for Routines
                          isSelected ? (
                              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-200">
                                  <Check className="h-3.5 w-3.5" />
                              </div>
                          ) : (
                              <div className="h-6 w-6 rounded-full border border-muted-foreground/30 shrink-0" />
                          )
                      ) : (
                          // Plus icon for Training Log (Single Add)
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground">
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
    </div>
  );
}