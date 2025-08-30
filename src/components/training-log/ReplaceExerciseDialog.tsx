
"use client";

import { useState, useMemo, useEffect } from 'react';
import type { Exercise } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, Loader2 } from 'lucide-react';

interface ReplaceExerciseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  availableExercises: Exercise[];
  isLoadingExercises: boolean;
  onReplaceExercise: (exercise: Exercise) => void;
  initialMuscleGroup?: MuscleGroup;
}

export function ReplaceExerciseDialog({
  isOpen,
  setIsOpen,
  availableExercises,
  isLoadingExercises,
  onReplaceExercise,
  initialMuscleGroup,
}: ReplaceExerciseDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | 'All'>(initialMuscleGroup || 'All');

  useEffect(() => {
    if (isOpen) {
        setSelectedMuscleGroup(initialMuscleGroup || 'All');
    }
  }, [isOpen, initialMuscleGroup]);


  const filteredExercises = useMemo(() => {
    let tempExercises = [...availableExercises];
    if (searchTerm.trim() !== '') {
      tempExercises = tempExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim())
      );
    }
    if (selectedMuscleGroup !== 'All') {
      tempExercises = tempExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    return tempExercises;
  }, [availableExercises, searchTerm, selectedMuscleGroup]);

  const handleSelectExercise = (exercise: Exercise) => {
    onReplaceExercise(exercise);
    setIsOpen(false);
    setSearchTerm('');
    setSelectedMuscleGroup('All');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-headline">Replace Exercise</DialogTitle>
          <DialogDescription>Select a different exercise from your library.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Select
                value={selectedMuscleGroup}
                onValueChange={(value) => setSelectedMuscleGroup(value as MuscleGroup | 'All')}
                disabled={isLoadingExercises}
              >
                <SelectTrigger className="w-full pl-9">
                  <SelectValue placeholder="Filter by muscle group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Muscle Groups</SelectItem>
                  {MUSCLE_GROUPS_LIST.map(group => (
                    <SelectItem key={group} value={group}>{group}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search exercise..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9"
                disabled={isLoadingExercises}
              />
            </div>
          </div>

          <ScrollArea className="h-[300px] w-full rounded-md border p-2">
            {isLoadingExercises ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredExercises.length > 0 ? (
              <div className="space-y-1">
                {filteredExercises.map(exercise => (
                  <Button
                    key={exercise.id}
                    variant="ghost"
                    className="w-full justify-start text-left h-auto py-2 px-2"
                    onClick={() => handleSelectExercise(exercise)}
                  >
                    <div>
                        <p className="font-medium">{exercise.name}</p>
                        <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No other exercises available to swap.
              </p>
            )}
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
