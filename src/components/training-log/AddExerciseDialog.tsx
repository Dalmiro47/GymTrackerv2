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
import { useI18n } from '@/contexts/LanguageContext';

interface AddExerciseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  availableExercises: Exercise[];
  isLoadingExercises: boolean;
  onAddExercise: (exercise: Exercise) => void;
  /** Exercise IDs already in today's log — shown as "Added" and not selectable. */
  loggedExerciseIds?: string[];
}

export function AddExerciseDialog({
  isOpen,
  setIsOpen,
  availableExercises,
  isLoadingExercises,
  onAddExercise,
  loggedExerciseIds = [],
}: AddExerciseDialogProps) {
  const { t } = useI18n();

  // Adapter: The selector gives us an ID and boolean. We need to find the object and pass it up.
  const handleSelectionChange = (exerciseId: string) => {
    if (loggedExerciseIds.includes(exerciseId)) return;
    const exercise = availableExercises.find(ex => ex.id === exerciseId);
    if (exercise) {
      onAddExercise(exercise);
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
          <DialogTitle>{t('addDialog.title')}</DialogTitle>
          <DialogDescription>{t('addDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-hidden p-4 pt-2">
            <AvailableExercisesSelector
                allExercises={availableExercises}
                selectedExerciseIds={[]} // No pre-selected needed for adding new
                isLoadingExercises={isLoadingExercises}
                onSelectionChange={handleSelectionChange}
                mode="single"
                disabledExerciseIds={loggedExerciseIds}
            />
        </div>

        <DialogFooter className="shrink-0 border-t bg-card/40 p-3">
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
