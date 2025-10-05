
"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Exercise, ExerciseData, Routine } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import type { ExerciseFormData } from './AddExerciseDialog';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { 
  addExercise, 
  getExercises, 
  updateExercise, 
  deleteExercise as deleteExerciseService, 
  ensureExercisesSeeded,
  getHiddenDefaultExercises,
  restoreHiddenDefaults,
  type SeedResult 
} from '@/services/exerciseService';
import { getRoutines, updateRoutine } from '@/services/routineService';
import { stripUndefinedDeep } from '@/lib/sanitize';
import { assertMuscleGroup } from '@/lib/muscleGroup';

import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Search, Filter, Loader2, AlertTriangle, History } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import {
  Dialog,
  DialogClose,
  DialogContent as RestoreDialogContent,
  DialogDescription as RestoreDialogDescription,
  DialogFooter as RestoreDialogFooter,
  DialogHeader as RestoreDialogHeader,
  DialogTitle as RestoreDialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

type HiddenDefault = { id: string; name: string; muscleGroup: string };

const groupExercisesByMuscle = (exercises: Exercise[], muscleOrder: readonly MuscleGroup[]): { muscleGroup: MuscleGroup; exercises: Exercise[] }[] => {
  const grouped = new Map<MuscleGroup, Exercise[]>();
  muscleOrder.forEach(groupName => {
    grouped.set(groupName, []);
  });

  exercises.forEach(exercise => {
    const list = grouped.get(exercise.muscleGroup) || [];
    list.push(exercise);
    grouped.set(exercise.muscleGroup, list);
  });

  return muscleOrder
    .map(muscleGroup => ({
      muscleGroup,
      exercises: grouped.get(muscleGroup) || [],
    }))
    .filter(group => group.exercises.length > 0);
};


export function ExerciseClientPage() {
  const authContext = useAuth();
  const { user } = authContext;
  const { toast } = useToast();
  const router = useRouter(); 

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | 'All'>('All');

  const [exerciseToEdit, setExerciseToEdit] = useState<Exercise | null>(null);
  const [exerciseToDeleteId, setExerciseToDeleteId] = useState<string | null>(null);
  const [isBusyDeleting, setIsBusyDeleting] = useState(false);
  const [affectedRoutines, setAffectedRoutines] = useState<Routine[]>([]);

  const [isLoading, setIsLoading] = useState(true); 
  const [isDialogSaving, setIsDialogSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // State for restore functionality
  const [hiddenDefaults, setHiddenDefaults] = useState<HiddenDefault[]>([]);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [selectedToRestore, setSelectedToRestore] = useState<string[]>([]);
  const [isRestoring, setIsRestoring] = useState(false);


  const fetchUserExercises = useCallback(async (currentUserId: string | null | undefined): Promise<void> => {
    if (!currentUserId) {
      setExercises([]);
      return;
    }
    try {
      const userExercises = await getExercises(currentUserId);
      setExercises(userExercises);
    } catch (error: any) {
      console.error("Failed to fetch exercises:", error);
      toast({
        title: "Error Fetching Exercises",
        description: `Could not fetch your exercises. ${error.message || 'Please try again later.'}`,
        variant: "destructive",
      });
    }
  }, [toast]);
  
  const fetchHiddenDefaults = useCallback(async (currentUserId: string) => {
    try {
      const list = await getHiddenDefaultExercises(currentUserId);
      setHiddenDefaults(list);
    } catch (e) {
      console.error("Failed to fetch hidden defaults:", e);
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      let cancelled = false;
      (async () => {
        setIsLoading(true);
        try {
          const { addedCount } = await ensureExercisesSeeded(user.id);
          if (!cancelled && addedCount > 0) {
            toast({
              title: "Library Synced",
              description: `Added ${addedCount} new default exercise${addedCount > 1 ? 's' : ''} to your library.`,
            });
          }
        } catch (err: any) {
          if (!cancelled) {
            toast({
              title: "Library Sync Failed",
              description: err.message || "Could not check for default exercises.",
              variant: "destructive",
            });
          }
        } finally {
          if (!cancelled) {
            await Promise.all([
              fetchUserExercises(user.id),
              fetchHiddenDefaults(user.id),
            ]);
            setIsLoading(false);
          }
        }
      })();
      return () => { cancelled = true; };
    } else if (!authContext.isLoading && !user) {
      setExercises([]);
      setHiddenDefaults([]);
      setIsLoading(false);
    }
  }, [user, authContext.isLoading, fetchUserExercises, fetchHiddenDefaults, toast]);
  
  const canonicalExercises = useMemo(() => {
      return exercises.map(e => ({...e, muscleGroup: assertMuscleGroup(e.muscleGroup as any)}));
  }, [exercises]);

  const { availableMuscleGroups, muscleGroupCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    const seenGroups = new Set<MuscleGroup>();

    canonicalExercises.forEach(ex => {
      const group = ex.muscleGroup;
      seenGroups.add(group);
      counts[group] = (counts[group] || 0) + 1;
    });
    
    const available = MUSCLE_GROUPS_LIST.filter(group => seenGroups.has(group));
    
    return { availableMuscleGroups: available, muscleGroupCounts: counts };
  }, [canonicalExercises]);


  useEffect(() => {
    if (selectedMuscleGroup !== 'All' && !availableMuscleGroups.includes(selectedMuscleGroup)) {
      setSelectedMuscleGroup('All');
    }
  }, [availableMuscleGroups, selectedMuscleGroup]);


  const isFilteringOrSearching = useMemo(() => {
    return searchTerm.trim() !== '' || selectedMuscleGroup !== 'All';
  }, [searchTerm, selectedMuscleGroup]);

  const displayedExercises = useMemo(() => {
    if (!isFilteringOrSearching) return [];

    let tempExercises = [...canonicalExercises];
    if (searchTerm.trim() !== '') {
      tempExercises = tempExercises.filter(ex => ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim()));
    }
    if (selectedMuscleGroup !== 'All') {
      tempExercises = tempExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    return tempExercises;
  }, [canonicalExercises, searchTerm, selectedMuscleGroup, isFilteringOrSearching]);

  const exercisesGroupedByMuscle = useMemo(() => {
    if (isFilteringOrSearching) return [];
    return groupExercisesByMuscle(canonicalExercises, MUSCLE_GROUPS_LIST);
  }, [canonicalExercises, isFilteringOrSearching]);

  const handleOpenAddDialog = () => {
    setExerciseToEdit(null);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (exercise: Exercise) => {
    setExerciseToEdit(exercise);
    setIsDialogOpen(true);
  };

  const handleSaveExercise = async (formData: ExerciseFormData) => {
    if (!user?.id) {
      toast({ title: "Authentication Error", description: "You must be logged in to save exercises.", variant: "destructive" });
      return;
    }

    setIsDialogSaving(true);
    try {
      const exercisePayload: ExerciseData = {
        name: formData.name,
        muscleGroup: formData.muscleGroup,
        targetNotes: (formData.targetNotes || '').trim(),
        exerciseSetup: (formData.exerciseSetup || '').trim(),
        progressiveOverload: (formData.progressiveOverload || '').trim(),
        dataAiHint: formData.name.toLowerCase().split(" ").slice(0,2).join(" ") || 'exercise',
        warmup: formData.warmup,
      };

      if (exerciseToEdit) {
        await updateExercise(user.id, exerciseToEdit.id, exercisePayload);
        toast({ title: "Exercise Updated", description: `${formData.name} has been successfully updated.` });

        const routines = await getRoutines(user.id);
        const affected = routines.filter(r =>
          r.exercises.some(e => e.id === exerciseToEdit.id)
        );

        if (affected.length > 0) {
            await Promise.all(affected.map(r => {
                const updatedExercises = r.exercises.map(e =>
                    e.id === exerciseToEdit.id ? { ...e, ...exercisePayload } : e
                );
                return updateRoutine(user.id!, r.id, { exercises: updatedExercises });
            }));
            toast({
                title: "Routines Synced",
                description: `Updated ${exercisePayload.name} in ${affected.length} routine(s).`,
            });
        }


      } else {
        await addExercise(user.id, exercisePayload);
        toast({ title: "Exercise Added", description: `${formData.name} has been successfully added.` });
      }
      
      await fetchUserExercises(user.id);

      setIsDialogOpen(false);
      setExerciseToEdit(null);
    } catch (error: any) {
      console.error("Detailed error adding/updating exercise to Firestore: ", error);
      toast({
        title: "Save Error",
        description: `Could not save ${formData.name}. Firestore error: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsDialogSaving(false);
    }
  };

  const openDeleteConfirmation = async (exerciseId: string) => {
    if (!user?.id) return;
    setExerciseToDeleteId(exerciseId);
    setIsBusyDeleting(true);
    try {
      const routines = await getRoutines(user.id);
      const affected = routines.filter(r => r.exercises.some(e => e.id === exerciseId));
      setAffectedRoutines(affected);
    } catch (e) {
      toast({ title: "Error checking routines", description: "Could not verify if exercise is in use.", variant: "destructive" });
    } finally {
      setIsBusyDeleting(false); // To enable dialog buttons
    }
  };

  const closeDeleteDialog = () => {
    setExerciseToDeleteId(null);
    setAffectedRoutines([]);
  };

  const handleDeleteExercise = async () => {
    if (!exerciseToDeleteId || !user?.id) {
      toast({ title: "Error", description: "Could not delete exercise. User or Exercise ID missing.", variant: "destructive" });
      return;
    }
  
    setIsBusyDeleting(true);
    const exerciseName = exercises.find(ex => ex.id === exerciseToDeleteId)?.name || "The exercise";
  
    try {
      if (affectedRoutines.length > 0) {
        await Promise.all(
          affectedRoutines.map(routine =>
            updateRoutine(user.id!, routine.id, stripUndefinedDeep({
              name: routine.name,
              description: routine.description ?? '',
              order: routine.order,
              exercises: routine.exercises.filter(e => e.id !== exerciseToDeleteId),
            }))
          )
        );
        toast({ title: "Routines Updated", description: `${exerciseName} removed from ${affectedRoutines.length} routine(s).` });
      }
  
      await deleteExerciseService(user.id, exerciseToDeleteId);
      toast({ title: "Exercise Deleted", description: `${exerciseName} has been removed from your library.` });
      
      await fetchUserExercises(user.id);
      await fetchHiddenDefaults(user.id);
    } catch (error: any) {
      console.error("Failed to delete exercise and update routines:", error);
      toast({ title: "Delete Error", description: `Could not delete ${exerciseName}. ${error.message}`, variant: "destructive" });
    } finally {
      setIsBusyDeleting(false);
      closeDeleteDialog();
    }
  };
 
  const handleOpenRestoreDialog = () => {
    setSelectedToRestore(hiddenDefaults.map(h => h.id));
    setIsRestoreDialogOpen(true);
  };

  const handleConfirmRestore = async () => {
    if (!user?.id || selectedToRestore.length === 0) return;
    setIsRestoring(true);
    try {
      const { addedCount } = await restoreHiddenDefaults(user.id, selectedToRestore);
      toast({
        title: "Restore Successful",
        description: addedCount > 0 ? `Restored ${addedCount} default exercise${addedCount > 1 ? 's' : ''}.` : 'No exercises were restored.'
      });
      setIsRestoreDialogOpen(false);
      await fetchUserExercises(user.id);
      await fetchHiddenDefaults(user.id);
    } catch(e: any) {
      toast({ title: 'Restore Failed', description: e.message || 'Could not restore default exercises.', variant: 'destructive'});
    } finally {
      setIsRestoring(false);
    }
  };


  if (authContext.isLoading || isLoading) { 
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-xl text-primary font-semibold">
          {authContext.isLoading ? "Loading authentication..." : "Loading your exercises..."}
        </p>
      </div>
    );
  }

  if (!user && !authContext.isLoading) { 
    return (
      <div className="flex flex-col justify-center items-center h-64">
        <p className="text-xl text-primary font-semibold mb-4">Please log in to manage your exercises.</p>
        <Button onClick={() => router.push('/login')}>Go to Login</Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Exercise Library" description="Browse, add, and manage your exercises.">
         <div className="flex items-center gap-2">
            {hiddenDefaults.length > 0 && (
                <Button variant="outline" onClick={handleOpenRestoreDialog}>
                  <History className="mr-2 h-4 w-4" />
                  Restore Defaults
                  <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground text-xs font-bold">
                    {hiddenDefaults.length}
                  </span>
                </Button>
            )}
            <Button
              variant="default"
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={handleOpenAddDialog}
              disabled={isLoading} 
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Add New Exercise
            </Button>
         </div>
      </PageHeader>

      <AddExerciseDialog
        exerciseToEdit={exerciseToEdit}
        onSave={handleSaveExercise}
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        isSaving={isDialogSaving}
      />
      
      <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <RestoreDialogContent>
          <RestoreDialogHeader>
            <RestoreDialogTitle>Restore Hidden Default Exercises</RestoreDialogTitle>
            <RestoreDialogDescription>Select the default exercises you want to add back to your library.</RestoreDialogDescription>
          </RestoreDialogHeader>
          <div className="py-4">
            {hiddenDefaults.length > 0 ? (
                <ScrollArea className="max-h-64 w-full rounded-md border p-4">
                    <div className="space-y-2">
                    {hiddenDefaults.map(ex => (
                        <div key={ex.id} className="flex items-center space-x-2">
                            <Checkbox 
                                id={`restore-${ex.id}`}
                                checked={selectedToRestore.includes(ex.id)}
                                onCheckedChange={(checked) => {
                                    setSelectedToRestore(prev => 
                                        checked ? [...prev, ex.id] : prev.filter(id => id !== ex.id)
                                    )
                                }}
                            />
                            <Label htmlFor={`restore-${ex.id}`} className="flex-grow cursor-pointer">
                                {ex.name}
                                <span className="ml-2 text-xs text-muted-foreground">({ex.muscleGroup})</span>
                            </Label>
                        </div>
                    ))}
                    </div>
                </ScrollArea>
            ) : (
                <p className="text-sm text-muted-foreground">No hidden default exercises to restore.</p>
            )}
          </div>
          <RestoreDialogFooter>
            <DialogClose asChild>
                <Button variant="ghost" disabled={isRestoring}>Cancel</Button>
            </DialogClose>
            <Button onClick={handleConfirmRestore} disabled={isRestoring || selectedToRestore.length === 0}>
                {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                Restore Selected
            </Button>
          </RestoreDialogFooter>
        </RestoreDialogContent>
      </Dialog>


      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search exercises by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg bg-card py-2 pl-10 pr-4 shadow-sm focus:ring-primary"
            aria-label="Search exercises"
            disabled={isLoading && !exercises.length}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
           <Select
              value={selectedMuscleGroup}
              onValueChange={(value) => setSelectedMuscleGroup(value as MuscleGroup | 'All')}
              disabled={isLoading && !exercises.length}
            >
            <SelectTrigger className="w-full rounded-lg bg-card py-2 pl-10 pr-4 shadow-sm focus:ring-primary" aria-label="Filter by muscle group">
              <SelectValue placeholder="Filter by muscle group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Muscle Groups</SelectItem>
              {availableMuscleGroups.map(group => (
                <SelectItem key={group} value={group}>
                  {group} ({muscleGroupCounts[group] || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isLoading && isFilteringOrSearching ? (
        displayedExercises.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayedExercises.map(exercise => (
              <ExerciseCard
                key={exercise.id}
                exercise={exercise}
                onEdit={() => handleOpenEditDialog(exercise)}
                onDelete={() => openDeleteConfirmation(exercise.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-xl text-muted-foreground font-semibold mb-2">No exercises found for your current filter/search.</p>
            <p className="text-muted-foreground">Try adjusting your search or filters, or add a new exercise!</p>
          </div>
        )
      ) : !isLoading && exercisesGroupedByMuscle.length > 0 ? (
        <Accordion type="multiple" className="w-full space-y-2">
          {exercisesGroupedByMuscle.map(group => (
            <AccordionItem value={group.muscleGroup} key={group.muscleGroup} className="border bg-card shadow-sm rounded-lg">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                 <span className="text-xl font-headline font-semibold text-primary">
                  {group.muscleGroup} ({group.exercises.length})
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-0">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.exercises.map(exercise => (
                    <ExerciseCard
                      key={exercise.id}
                      exercise={exercise}
                      onEdit={() => handleOpenEditDialog(exercise)}
                      onDelete={() => openDeleteConfirmation(exercise.id)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (!isLoading && exercises.length === 0 && user) ? ( 
          <div className="text-center py-12">
            <p className="text-xl text-muted-foreground font-semibold mb-2">Your exercise library is empty.</p>
            <p className="text-muted-foreground">Click "Add New Exercise" to get started!</p>
          </div>
        )
      : null }

      <AlertDialog open={!!exerciseToDeleteId} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <AlertTriangle className="mr-2 text-destructive"/>
              Confirm Deletion
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
              <div>
                {isBusyDeleting ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking routines...
                  </div>
                ) : affectedRoutines.length > 0 ? (
                    <div className='space-y-3'>
                      <div className="font-semibold text-foreground">This exercise is used in {affectedRoutines.length} routine(s):</div>
                      <ScrollArea className="max-h-32 w-full rounded-md border p-2">
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {affectedRoutines.map(r => <li key={r.id}>{r.name}</li>)}
                        </ul>
                      </ScrollArea>
                      <div>Deleting this exercise will also <span className="font-bold">remove it from these routines</span>.</div>
                      <div>Are you sure you want to proceed?</div>
                    </div>
                ) : (
                  <div>
                    This will permanently delete the exercise "{exercises.find(ex => ex.id === exerciseToDeleteId)?.name}".
                  </div>
                )}
              </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog} disabled={isBusyDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteExercise} 
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              disabled={isBusyDeleting}
            >
              {isBusyDeleting ? <Loader2 className="h-4 w-4 animate-spin"/> : (affectedRoutines.length > 0 ? "Delete Anyway" : "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
