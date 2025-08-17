
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, Routine, RoutineData, RoutineExercise } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService'; 

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
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
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
  onSave: (data: RoutineData, routineId?: string) => Promise<void>;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isSaving: boolean;
}

export function AddEditRoutineDialog({
  routineToEdit,
  onSave,
  isOpen,
  setIsOpen,
  isSaving,
}: AddEditRoutineDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<RoutineFormData>({
    resolver: zodResolver(routineFormSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const [allUserExercises, setAllUserExercises] = useState<Exercise[]>([]);
  const [selectedExerciseObjects, setSelectedExerciseObjects] = useState<RoutineExercise[]>([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);

  const fetchExercises = useCallback(async () => {
    if (!user?.id || !isOpen) return;
    setIsLoadingExercises(true);
    try {
      const exercises = await fetchAllUserExercises(user.id);
      setAllUserExercises(exercises);
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Could not load your exercises: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsLoadingExercises(false);
    }
  }, [user?.id, toast, isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchExercises();
      if (routineToEdit) {
        reset({
          name: routineToEdit.name,
          description: routineToEdit.description || '',
        });
        setSelectedExerciseObjects(routineToEdit.exercises.map(ex => ({ ...ex })));
      } else {
        reset({ name: '', description: '' });
        setSelectedExerciseObjects([]);
      }
    } else {
      setAllUserExercises([]);
      setSelectedExerciseObjects([]);
      setIsLoadingExercises(true);
    }
  }, [routineToEdit, reset, isOpen, fetchExercises]);


  const handleExerciseSelectionChange = (exerciseId: string, isSelected: boolean) => {
    setSelectedExerciseObjects(prevSelected => {
      if (isSelected) {
        const exerciseToAdd = allUserExercises.find(ex => ex.id === exerciseId);
        if (!exerciseToAdd) return prevSelected;
        if (!prevSelected.find(e => e.id === exerciseId)) {
          const routineExercise: RoutineExercise = { ...exerciseToAdd };
          return [...prevSelected, routineExercise];
        }
        return prevSelected;
      } else {
        return prevSelected.filter(e => e.id !== exerciseId);
      }
    });
  };

  const handleReorderExercises = (reorderedExercises: RoutineExercise[]) => {
    setSelectedExerciseObjects(reorderedExercises);
  };
  
  const onSubmit = async (data: RoutineFormData) => {
    if (selectedExerciseObjects.length === 0) {
        toast({
            title: "No Exercises Selected",
            description: "Please select at least one exercise for the routine.",
            variant: "destructive",
        });
        return;
    }
    const routineData: RoutineData = {
      ...data,
      exercises: selectedExerciseObjects,
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
