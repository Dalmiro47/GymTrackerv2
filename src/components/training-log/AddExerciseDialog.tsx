"use client";

import type { Exercise } from '@/types';
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

interface AddExerciseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  availableExercises: Exercise[];
  isLoadingExercises: boolean;
  onAddExercise: (exercise: Exercise) => void;
}

export function AddExerciseDialog({
  isOpen,
  setIsOpen,
  availableExercises,
  isLoadingExercises,
  onAddExercise,
}: AddExerciseDialogProps) {

  // Adapter: The selector gives us an ID and boolean. We need to find the object and pass it up.
  const handleSelectionChange = (exerciseId: string) => {
    const exercise = availableExercises.find(ex => ex.id === exerciseId);
    if (exercise) {
      onAddExercise(exercise);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent 
        className="!max-w-2xl !w-[95vw] flex flex-col h-[80vh] p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()} // Prevents mobile keyboard on open
      >
        <DialogHeader className="p-6 pb-2 shrink-0">
          <DialogTitle className="font-headline">Add Exercise</DialogTitle>
          <DialogDescription>Select an exercise to add to your workout log.</DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-hidden p-6 pt-2">
            <AvailableExercisesSelector 
                allExercises={availableExercises}
                selectedExerciseIds={[]} // No pre-selected needed for adding new
                isLoadingExercises={isLoadingExercises}
                onSelectionChange={handleSelectionChange}
                mode="single"
            />
        </div>

        <DialogFooter className="p-4 border-t bg-background shrink-0">
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
