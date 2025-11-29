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

  // State to toggle between "Builder View" and "Picker View"
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const [selectedExerciseObjects, setSelectedExerciseObjects] = useState<RoutineExercise[]>([]);
  
  const exerciseIdMap = useMemo(
    () => new Map(allUserExercises.map(ex => [ex.id, ex])),
    [allUserExercises]
  );

  useEffect(() => {
    if (!isOpen) return;
  
    if (!routineToEdit) {
      reset({ name: '', description: '' });
      setSelectedExerciseObjects([]);
      setIsPickerOpen(false); // Always start in builder view
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
  
  }, [routineToEdit, reset, isOpen, isLoadingExercises, exerciseIdMap]);


  const handleExerciseSelectionChange = (exerciseId: string, isSelected: boolean) => {
    setSelectedExerciseObjects(prevSelected => {
      if (isSelected) {
        const exerciseToAdd = allUserExercises.find(ex => ex.id === exerciseId);
        if (!exerciseToAdd) return prevSelected;
        // Don't add duplicates
        if (prevSelected.find(e => e.id === exerciseId)) return prevSelected;
        
        const routineExercise: RoutineExercise = { ...exerciseToAdd, setStructure: 'normal' };
        return [...prevSelected, routineExercise];
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

  const selectedExerciseIds = selectedExerciseObjects.map(ex => ex.id);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Increased height for mobile friendliness */}
      <DialogContent className="max-w-2xl flex flex-col h-[90vh] sm:h-[85vh] p-0 gap-0 overflow-hidden">
        
        {/* HEADER */}
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

        {/* CONTENT AREA - Scrollable */}
        <div className="flex-grow overflow-y-auto p-6 bg-muted/5">
          
          {/* VIEW 1: PICKER MODE */}
          {isPickerOpen ? (
            <div className="h-full flex flex-col gap-4">
               {/* Reusing your existing component, but now it takes full width */}
               <AvailableExercisesSelector
                  allExercises={allUserExercises}
                  selectedExerciseIds={selectedExerciseIds}
                  onSelectionChange={handleExerciseSelectionChange}
                  isLoadingExercises={isLoadingExercises}
                />
            </div>
          ) : (
            
          /* VIEW 2: BUILDER MODE */
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
                
                {/* Selected List - Now Full Width */}
                <div className="min-h-[100px] rounded-md border bg-card">
                    {selectedExerciseObjects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                            <p>No exercises added yet.</p>
                            <Button 
                                type="button" 
                                variant="link" 
                                onClick={() => setIsPickerOpen(true)}
                            >
                                Browse Library
                            </Button>
                        </div>
                    ) : (
                        <SelectedRoutineExercisesList
                            selectedExercises={selectedExerciseObjects}
                            onRemoveExercise={(exerciseId) => handleExerciseSelectionChange(exerciseId, false)}
                            onReorderExercises={handleReorderExercises}
                            onUpdateSetStructure={handleUpdateSetStructure}
                        />
                    )}
                </div>

                <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full border-dashed border-2 h-12 text-muted-foreground hover:text-primary hover:border-primary/50"
                    onClick={() => setIsPickerOpen(true)}
                >
                    <Plus className="mr-2 h-4 w-4" /> Add Exercises
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* FOOTER */}
        <DialogFooter className="p-4 border-t bg-background shrink-0 flex-row gap-2 sm:justify-between items-center">
          {isPickerOpen ? (
            <>
                <Button type="button" variant="ghost" onClick={() => setIsPickerOpen(false)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button type="button" onClick={() => setIsPickerOpen(false)} className="bg-primary">
                    <Check className="mr-2 h-4 w-4" /> Done Adding
                </Button>
            </>
          ) : (
            <>
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
                    Cancel
                </Button>
                <Button 
                    type="submit" 
                    form="routine-form" // Link to the form ID
                    disabled={isSaving || isLoadingExercises} 
                    className="bg-primary"
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? "Saving..." : (routineToEdit ? "Save Changes" : "Create Routine")}
                </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}