"use client";

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, Routine, RoutineData, RoutineExercise, SetStructure } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/LanguageContext';

const exerciseIdentityKey = (ex: { name: string; muscleGroup?: string | null }) =>
  `${ex.name.trim().toLowerCase()}::${String(ex.muscleGroup ?? '').trim().toLowerCase()}`;
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

// Built per render language so the validation message is translated too.
const makeRoutineFormSchema = (nameMin: string) => z.object({
  name: z.string().min(3, nameMin),
  description: z.string().optional(),
});

type RoutineFormData = z.infer<ReturnType<typeof makeRoutineFormSchema>>;

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
  const { t } = useI18n();
  const routineFormSchema = useMemo(() => makeRoutineFormSchema(t('routineForm.nameMin')), [t]);
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
  // Fallback identity = name + muscleGroup (never name alone). Lets a routine
  // re-link to a library exercise that was deleted and recreated under a new id.
  const exerciseKeyMap = useMemo(
    () => new Map(allUserExercises.map(ex => [exerciseIdentityKey(ex), ex])),
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
  
    if (isLoadingExercises) {
      // Never show the previously edited routine's list while this one loads.
      setSelectedExerciseObjects([]);
      return;
    }
  
    const hydratedExercises = routineToEdit.exercises.map(routineEx => {
      const byId = exerciseIdMap.get(routineEx.id);
      if (byId) return { ...routineEx, isMissing: false };
      const byKey = exerciseKeyMap.get(exerciseIdentityKey(routineEx));
      if (byKey) return { ...routineEx, id: byKey.id, isMissing: false };
      return { ...routineEx, isMissing: true };
    });
    setSelectedExerciseObjects(hydratedExercises);
    setIsPickerOpen(false);
    setInsertionIndex(null);
    setReplaceIndex(null);
    setIsReplaceOpen(false);

  }, [routineToEdit, reset, isOpen, isLoadingExercises, exerciseIdMap, exerciseKeyMap]);


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
    if (selectedExerciseObjects.some(ex => ex.isMissing)) {
        toast({
            title: t('routineForm.notFoundTitle'),
            description: t('routineForm.notFoundDesc'),
            variant: "destructive",
        });
        return;
    }
    const validExercises = selectedExerciseObjects.filter(ex => !ex.isMissing);

    if (validExercises.length === 0) {
        toast({
            title: t('routineForm.noExercisesTitle'),
            description: t('routineForm.noExercisesDesc'),
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
        className="flex h-[85dvh] w-[min(95vw,640px)] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()} // STOP MOBILE KEYBOARD
      >

        <DialogHeader className="z-10 shrink-0 border-b bg-background p-4 pr-12">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>
              {isPickerOpen ? t('routineForm.selectExercises') : (routineToEdit ? t('routineForm.editRoutine') : t('routineForm.createRoutine'))}
            </DialogTitle>
            {isPickerOpen && (
               <Badge variant="secondary" className="ml-2 shrink-0">
                 {t('routineForm.selected', { n: selectedExerciseObjects.length })}
               </Badge>
            )}
          </div>
          <DialogDescription>
            {isPickerOpen ? t('routineForm.pickerDesc') : t('routineForm.formDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-y-auto p-4">
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
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('routineForm.name')}</Label>
                  <Input
                    id="name"
                    {...register('name')}
                    placeholder={t('routineForm.namePlaceholder')}
                    className="h-11 font-medium"
                    aria-invalid={errors.name ? "true" : "false"}
                  />
                  {errors.name && <p className="text-[13px] text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">{t('routineForm.descriptionLabel')}</Label>
                  <Textarea
                    id="description"
                    {...register('description')}
                    placeholder={t('routineForm.descriptionPlaceholder')}
                    rows={2}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="eyebrow">{t('routineForm.exercisesCount', { n: selectedExerciseObjects.length })}</Label>
                </div>

                <div className="min-h-[100px] rounded-md border bg-card">
                    {selectedExerciseObjects.length === 0 ? (
                        <div className="flex h-32 flex-col items-center justify-center text-[13px] text-muted-foreground">
                            <p>{t('routineForm.noneAdded')}</p>
                            <Button
                                type="button"
                                variant="link"
                                onClick={(e) => { e.preventDefault(); openPickerAtIndex(null); }}
                            >
                                {t('routineForm.browseLibrary')}
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

        <DialogFooter className="shrink-0 flex-row items-center gap-2 border-t bg-background p-4 sm:justify-between">
          {isPickerOpen ? (
            <>
                <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={(e) => { e.preventDefault(); setIsPickerOpen(false); }}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" /> {t('common.back')}
                </Button>
                <Button
                    type="button"
                    onClick={handleDoneAdding}
                >
                    <Check className="mr-2 h-4 w-4" /> {t('routineForm.doneAdding')}
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
                    {t('common.cancel')}
                </Button>
                <Button
                    type="submit"
                    form="routine-form"
                    disabled={isSaving || isLoadingExercises}
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? t('routineForm.savingEllipsis') : (routineToEdit ? t('routineForm.saveChanges') : t('routineForm.createRoutine'))}
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
