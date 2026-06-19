"use client";

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, Routine, RoutineData, RoutineExercise, SetStructure } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, ArrowLeft, Check } from 'lucide-react'; 

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
import { ReplaceExerciseDialog } from '@/components/training-log/ReplaceExerciseDialog';
import { replaceRoutineExerciseAt } from '@/lib/routineEditing';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge'; 

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
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RoutineFormData>({
    resolver: zodResolver(routineFormSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedExerciseObjects, setSelectedExerciseObjects] = useState<RoutineExercise[]>([]);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  
  const exerciseIdMap = useMemo(
    () => new Map(allUserExercises.map(ex => [ex.id, ex])),
    [allUserExercises]
  );

  useEffect(() => {
    if (!isOpen) return;
  
    if (!routineToEdit) {
      reset({ name: '', description: '' });
      setSelectedExerciseObjects([]);
      setIsPickerOpen(false);
      setInsertionIndex(null);
      setReplaceIndex(null);
      setIsReplaceOpen(false);
      return;
    }
  
    reset({
      name: routineToEdit.name,
      description: routineToEdit.description || '',
    });
  
    if (isLoadingExercises) return;
  
    const hydratedExercises = routineToEdit.exercises.map(routineEx => {
      const fullDef = exerciseIdMap.get(routineEx.id);
      return fullDef ? { ...routineEx, isMissing: false } : { ...routineEx, isMissing: true };
    });
    setSelectedExerciseObjects(hydratedExercises);
    setIsPickerOpen(false);
    setInsertionIndex(null);
    setReplaceIndex(null);
    setIsReplaceOpen(false);

  }, [routineToEdit, reset, isOpen, isLoadingExercises, exerciseIdMap]);


  const handleExerciseSelectionChange = (exerciseId: string, isSelected: boolean) => {
    setSelectedExerciseObjects(prevSelected => {
      if (isSelected) {
        if (prevSelected.find(e => e.id === exerciseId)) return prevSelected;

        const exerciseToAdd = allUserExercises.find(ex => ex.id === exerciseId);
        if (!exerciseToAdd) return prevSelected;
        
        const routineExercise: RoutineExercise = { ...exerciseToAdd, setStructure: 'normal' };
        
        if (insertionIndex !== null) {
            const newList = [...prevSelected];
            newList.splice(insertionIndex, 0, routineExercise);
            setInsertionIndex(insertionIndex + 1); 
            return newList;
        } else {
            return [...prevSelected, routineExercise];
        }

      } else {
        const indexRemoved = prevSelected.findIndex(e => e.id === exerciseId);
        if (insertionIndex !== null && indexRemoved !== -1 && indexRemoved < insertionIndex) {
            setInsertionIndex(prev => (prev !== null ? Math.max(0, prev - 1) : null));
        }
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
            title: "No Exercises Selected",
            description: "Please add at least one exercise to your routine.",
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

  const handleDoneAdding = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPickerOpen(false);
    setInsertionIndex(null);
  };

  const openPickerAtIndex = (index: number | null) => {
      setInsertionIndex(index);
      setIsPickerOpen(true);
  }

  const handleOpenReplace = (index: number) => {
    setReplaceIndex(index);
    setIsReplaceOpen(true);
  };

  // Swap the exercise in place: same slot, same set-type (mirrors Training Log).
  const handleReplaceExercise = (newExercise: Exercise) => {
    if (replaceIndex === null) return;
    setSelectedExerciseObjects(prev => replaceRoutineExerciseAt(prev, replaceIndex, newExercise));
    setIsReplaceOpen(false);
    setReplaceIndex(null);
  };

  const selectedExerciseIds = selectedExerciseObjects.map(ex => ex.id);

  // Scope the replace picker to the replaced exercise's category, and exclude every
  // exercise already in the routine — including the one being replaced — so the list
  // is single-select and free of misleading already-added entries.
  const exerciseBeingReplaced =
    replaceIndex !== null ? selectedExerciseObjects[replaceIndex] : null;
  const replaceCandidates = useMemo(() => {
    if (replaceIndex === null) return allUserExercises;
    const usedIds = new Set(selectedExerciseObjects.map(ex => ex.id));
    return allUserExercises.filter(ex => !usedIds.has(ex.id));
  }, [allUserExercises, selectedExerciseObjects, replaceIndex]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        className="max-w-4xl sm:w-[95vw] flex flex-col h-[85dvh] sm:h-[85vh] p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()} // STOP MOBILE KEYBOARD
      >
        
        <DialogHeader className="p-6 pb-4 border-b shrink-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-headline text-xl">
              {isPickerOpen ? 'Select Exercises' : (routineToEdit ? 'Edit Routine' : 'Create Routine')}
            </DialogTitle>
            {isPickerOpen && (
               <Badge variant="secondary" className="ml-2">
                 {selectedExerciseObjects.length} Selected
               </Badge>
            )}
          </div>
          <DialogDescription>
            {isPickerOpen 
              ? 'Search and select exercises to add to your routine.' 
              : 'Organize your routine details below.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-y-auto p-6 bg-muted/5">
          {isPickerOpen ? (
            <div className="h-full flex flex-col gap-4">
               <AvailableExercisesSelector
                  allExercises={allUserExercises}
                  selectedExerciseIds={selectedExerciseIds}
                  onSelectionChange={handleExerciseSelectionChange}
                  isLoadingExercises={isLoadingExercises}
                />
            </div>
          ) : (
            <form id="routine-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 p-1">
                <div className="space-y-2">
                  <Label htmlFor="name">Routine Name</Label>
                  <Input 
                    id="name" 
                    {...register('name')} 
                    placeholder="e.g., Push Day A"
                    className="text-lg font-medium"
                    aria-invalid={errors.name ? "true" : "false"} 
                  />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea 
                    id="description" 
                    {...register('description')} 
                    placeholder="Notes about this routine..."
                    rows={2} 
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Exercises ({selectedExerciseObjects.length})</Label>
                </div>
                
                <div className="min-h-[100px] rounded-md border bg-card">
                    {selectedExerciseObjects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                            <p>No exercises added yet.</p>
                            <Button 
                                type="button" 
                                variant="link" 
                                onClick={(e) => { e.preventDefault(); openPickerAtIndex(null); }}
                            >
                                Browse Library
                            </Button>
                        </div>
                    ) : (
                        <SelectedRoutineExercisesList
                            selectedExercises={selectedExerciseObjects}
                            onRemoveExercise={(exerciseId) => handleExerciseSelectionChange(exerciseId, false)}
                            onReplaceExercise={handleOpenReplace}
                            onReorderExercises={handleReorderExercises}
                            onUpdateSetStructure={handleUpdateSetStructure}
                            onInsertExercise={openPickerAtIndex}
                        />
                    )}
                </div>
                
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-background shrink-0 flex-row gap-2 sm:justify-between items-center">
          {isPickerOpen ? (
            <>
                <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={(e) => { e.preventDefault(); setIsPickerOpen(false); }}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button 
                    type="button" 
                    onClick={handleDoneAdding} 
                >
                    <Check className="mr-2 h-4 w-4" /> Done Adding
                </Button>
            </>
          ) : (
            <>
                <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsOpen(false)} 
                    disabled={isSaving}
                >
                    Cancel
                </Button>
                <Button 
                    type="submit" 
                    form="routine-form" 
                    disabled={isSaving || isLoadingExercises} 
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? "Saving..." : (routineToEdit ? "Save Changes" : "Create Routine")}
                </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ReplaceExerciseDialog
      isOpen={isReplaceOpen}
      setIsOpen={(open) => {
        setIsReplaceOpen(open);
        if (!open) setReplaceIndex(null);
      }}
      availableExercises={replaceCandidates}
      isLoadingExercises={isLoadingExercises}
      onReplaceExercise={handleReplaceExercise}
      initialMuscleGroup={exerciseBeingReplaced?.muscleGroup}
    />
    </>
  );
}
