
"use client";

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, Routine, RoutineData, RoutineExercise, SetStructure } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AvailableExercisesSelector } from './AvailableExercisesSelector';
import { SelectedRoutineExercisesList } from './SelectedRoutineExercisesList';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const routineFormSchema = z.object({
  name: z.string().min(3, "Routine name must be at least 3 characters."),
  description: z.string().optional(),
});

type RoutineFormData = z.infer<typeof routineFormSchema>;

interface AddEditRoutineDialogProps {
  routineToEdit?: Routine | null;
  onSave: (data: Omit<RoutineData, 'order'>, routineId?: string) => Promise<void>;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isSaving: boolean;
  allUserExercises: Exercise[];
  isLoadingExercises: boolean;
}

export function AddEditRoutineDialog({
  routineToEdit,
  onSave,
  isOpen,
  setIsOpen,
  isSaving,
  allUserExercises,
  isLoadingExercises,
}: AddEditRoutineDialogProps) {
  const { toast } = useToast();
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<RoutineFormData>({
    resolver: zodResolver(routineFormSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const [selectedExerciseObjects, setSelectedExerciseObjects] = useState<RoutineExercise[]>([]);
  
  const exerciseIdMap = useMemo(
    () => new Map(allUserExercises.map(ex => [ex.id, ex])),
    [allUserExercises]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
  
    if (!routineToEdit) {
      reset({ name: '', description: '' });
      setSelectedExerciseObjects([]);
      return;
    }
  
    reset({
      name: routineToEdit.name,
      description: routineToEdit.description || '',
    });
  
    if (isLoadingExercises) {
      return;
    }
  
    const hydratedExercises = routineToEdit.exercises.map(routineEx => {
      const fullDef = exerciseIdMap.get(routineEx.id);
      if (fullDef) {
        return { ...routineEx, isMissing: false };
      }
      return { ...routineEx, isMissing: true };
    });
    setSelectedExerciseObjects(hydratedExercises);
  
  }, [routineToEdit, reset, isOpen, isLoadingExercises, exerciseIdMap]);


  const handleExerciseSelectionChange = (exerciseId: string, isSelected: boolean) => {
    setSelectedExerciseObjects(prevSelected => {
      if (isSelected) {
        const exerciseToAdd = allUserExercises.find(ex => ex.id === exerciseId);
        if (!exerciseToAdd) return prevSelected;
        if (!prevSelected.find(e => e.id === exerciseId)) {
          const routineExercise: RoutineExercise = { ...exerciseToAdd, setStructure: 'normal' };
          return [...prevSelected, routineExercise];
        }
        return prevSelected;
      } else {
        return prevSelected.filter(e => e.id !== exerciseId);
      }
    });
  };

  const handleUpdateSetStructure = (exerciseId: string, structure: SetStructure) => {
    setSelectedExerciseObjects(prev => 
      prev.map(ex => ex.id === exerciseId ? { ...ex, setStructure: structure } : ex)
    );
  };

  const handleReorderExercises = (reorderedExercises: RoutineExercise[]) => {
    setSelectedExerciseObjects(reorderedExercises);
  };
  
  const onSubmit = async (data: RoutineFormData) => {
    const validExercises = selectedExerciseObjects.filter(ex => !ex.isMissing);

    if (validExercises.length === 0) {
        toast({
            title: "No Valid Exercises Selected",
            description: "Please select at least one valid exercise for the routine.",
            variant: "destructive",
        });
        return;
    }
    const routineData: Omit<RoutineData, 'order'> = {
      ...data,
      exercises: validExercises.map(({ isMissing, ...ex }) => ex), 
    };
    await onSave(routineData, routineToEdit?.id);
  };

  const selectedExerciseIds = selectedExerciseObjects.map(ex => ex.id);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-4xl flex flex-col h-full sm:h-auto max-h-[95vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="font-headline text-xl">
            {routineToEdit ? 'Edit Routine' : 'Create New Routine'}
          </DialogTitle>
          <DialogDescription>
            {routineToEdit ? 'Update the details for this routine.' : 'Fill in the details and select exercises for your new routine.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-grow overflow-y-auto space-y-6 pr-4 -mr-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="name">Routine Name</Label>
              <Input id="name" {...register('name')} aria-invalid={errors.name ? "true" : "false"} />
              {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea id="description" {...register('description')} rows={2} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AvailableExercisesSelector
              allExercises={allUserExercises}
              selectedExerciseIds={selectedExerciseIds}
              onSelectionChange={handleExerciseSelectionChange}
              isLoadingExercises={isLoadingExercises}
            />
            <SelectedRoutineExercisesList
              selectedExercises={selectedExerciseObjects}
              onRemoveExercise={(exerciseId) => handleExerciseSelectionChange(exerciseId, false)}
              onReorderExercises={handleReorderExercises}
              onUpdateSetStructure={handleUpdateSetStructure}
            />
          </div>
        </form>

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit(onSubmit)} disabled={isSaving || isLoadingExercises} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? (routineToEdit ? "Saving..." : "Creating...") : (routineToEdit ? "Save Changes" : "Save Routine")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
