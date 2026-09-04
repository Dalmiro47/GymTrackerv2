"use client";

import type { Exercise } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AvailableExercisesSelector } from '@/components/routines/AvailableExercisesSelector';

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

  // Adapter function
  const handleSelectionChange = (exerciseId: string) => {
    const exercise = availableExercises.find(ex => ex.id === exerciseId);
    if (exercise) {
      onReplaceExercise(exercise);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        className="flex h-[85dvh] w-[min(95vw,640px)] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()} // STOP MOBILE KEYBOARD
      >
        <DialogHeader className="shrink-0 p-4 pb-2">
          <DialogTitle>Replace Exercise</DialogTitle>
          <DialogDescription>Select a different exercise from your library.</DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-hidden p-4 pt-2">
            <AvailableExercisesSelector
                key={`${isOpen}-${initialMuscleGroup}`}
                allExercises={availableExercises}
                selectedExerciseIds={[]}
                isLoadingExercises={isLoadingExercises}
                onSelectionChange={handleSelectionChange}
                mode="single"
                initialMuscleGroup={initialMuscleGroup}
            />
        </div>

        <DialogFooter className="shrink-0 border-t bg-card/40 p-3">
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
