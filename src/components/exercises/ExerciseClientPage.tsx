
"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Exercise, MuscleGroup, ExerciseData, Routine } from '@/types';
import type { ExerciseFormData } from './AddExerciseDialog';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { defaultExercises } from '@/lib/defaultExercises';
import { useAuth } from '@/contexts/AuthContext';
import { addExercise, getExercises, updateExercise, deleteExercise as deleteExerciseService, addDefaultExercisesBatch } from '@/services/exerciseService';
import { getRoutines, updateRoutine } from '@/services/routineService';
import { inferWarmupTemplate } from '@/lib/utils';
import { stripUndefinedDeep } from '@/lib/sanitize';

import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Search, Filter, Loader2, AlertTriangle } from 'lucide-react';
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
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';

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
  const [isSeeding, setIsSeeding] = useState(false);
  const [hasAttemptedSeedForCurrentUser, setHasAttemptedSeedForCurrentUser] = useState(false);


  const fetchUserExercises = useCallback(async (currentUserId: string | null | undefined): Promise<Exercise[]> => {
    if (!currentUserId) {
      return [];
    }
    try {
      const userExercises = await getExercises(currentUserId);
      return userExercises;
    } catch (error: any) {
      console.error("Failed to fetch exercises:", error);
      toast({
        title: "Error Fetching Exercises",
        description: `Could not fetch your exercises. ${error.message || 'Please try again later.'}`,
        variant: "destructive",
      });
      return [];
    }
  }, [toast]);


  useEffect(() => {
    const loadData = async () => {
      if (user?.id) {
        setIsLoading(true); 
        let userExercises = await fetchUserExercises(user.id);

        if (userExercises.length === 0 && !hasAttemptedSeedForCurrentUser) {
          setHasAttemptedSeedForCurrentUser(true); 
          setIsSeeding(true);
          toast({ title: "Setting up your library...", description: "Adding default exercises."});
          try {
            await addDefaultExercisesBatch(user.id, defaultExercises);
            userExercises = await fetchUserExercises(user.id); 
            toast({ title: "Library Ready!", description: "Default exercises added."});
          } catch (seedError: any) {
            console.error("Failed to seed default exercises:", seedError);
            toast({
              title: "Error Seeding Library",
              description: `Could not add default exercises. ${seedError.message || 'Unknown error'}`,
              variant: "destructive",
            });
          } finally {
            setIsSeeding(false);
          }
        }
        setExercises(userExercises);
        setIsLoading(false); 
      } else if (user === null && !authContext.isLoading) { 
        setExercises([]);
        setIsLoading(false);
        setIsSeeding(false);
        setHasAttemptedSeedForCurrentUser(false); 
      }
    };

    if (user !== undefined) { 
        loadData();
    }
    
     return () => {
        if(user?.id && !authContext.isLoading) { 
          // Future: Consider more robust user change detection if needed.
        }
    };
  }, [user, fetchUserExercises, toast, authContext.isLoading, hasAttemptedSeedForCurrentUser]);

  const availableMuscleGroups = useMemo(() => {
    const groups = new Set(exercises.map(ex => ex.muscleGroup));
    return MUSCLE_GROUPS_LIST.filter(group => groups.has(group));
  }, [exercises]);

  const isFilteringOrSearching = useMemo(() => {
    return searchTerm.trim() !== '' || selectedMuscleGroup !== 'All';
  }, [searchTerm, selectedMuscleGroup]);

  const displayedExercises = useMemo(() => {
    if (!isFilteringOrSearching) return [];

    let tempExercises = [...exercises];
    if (searchTerm.trim() !== '') {
      tempExercises = tempExercises.filter(ex => ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim()));
    }
    if (selectedMuscleGroup !== 'All') {
      tempExercises = tempExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    return tempExercises;
  }, [exercises, searchTerm, selectedMuscleGroup, isFilteringOrSearching]);

  const exercisesGroupedByMuscle = useMemo(() => {
    if (isFilteringOrSearching) return [];
    return groupExercisesByMuscle(exercises, MUSCLE_GROUPS_LIST);
  }, [exercises, isFilteringOrSearching]);

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
        targetNotes: formData.targetNotes || '',
        exerciseSetup: formData.exerciseSetup || '',
        dataAiHint: formData.name.toLowerCase().split(" ").slice(0,2).join(" ") || 'exercise',
        warmup: formData.warmup,
      };

      if (!exercisePayload.warmup) {
        const { template, isWeightedBodyweight } = inferWarmupTemplate(formData.name);
        exercisePayload.warmup = { template, isWeightedBodyweight };
      }

      if (exerciseToEdit) {
        await updateExercise(user.id, exerciseToEdit.id, exercisePayload);
        toast({ title: "Exercise Updated", description: `${formData.name} has been successfully updated.` });

        if (exerciseToEdit.name !== formData.name) {
          const routines = await getRoutines(user.id);
          const affected = routines.filter(r =>
            r.exercises.some(e => e.id === exerciseToEdit.id && e.name !== formData.name)
          );
          await Promise.all(affected.map(r =>
            updateRoutine(user.id!, r.id, stripUndefinedDeep({
              name: r.name,
              description: r.description ?? '',
              order: r.order,
              exercises: r.exercises.map(e =>
                e.id === exerciseToEdit.id ? { ...e, name: formData.name } : e
              ),
            }))
          ));
        }

      } else {
        await addExercise(user.id, exercisePayload);
        toast({ title: "Exercise Added", description: `${formData.name} has been successfully added.` });
      }
      
      const updatedExercisesList = await fetchUserExercises(user.id);
      setExercises(updatedExercisesList);

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
      // If there are affected routines, remove the exercise from them first
      if (affectedRoutines.length > 0) {
        await Promise.all(
          affectedRoutines.map(async (routine) => {
            try {
              await updateRoutine(user.id!, routine.id, stripUndefinedDeep({
                name: routine.name,
                description: routine.description ?? '',
                order: routine.order,
                exercises: routine.exercises.filter(e => e.id !== exerciseToDeleteId),
              }));
            } catch(err) {
              console.error(`Failed to update routine ${routine.name}`, err);
              // We can decide to throw or just log. For now, we'll log and continue.
              toast({ title: `Warning: Failed to update routine ${routine.name}`, variant: "destructive"})
            }
          })
        );
        toast({ title: "Routines Updated", description: `${exerciseName} removed from ${affectedRoutines.length} routine(s).` });
      }
  
      // Now, delete the exercise itself
      await deleteExerciseService(user.id, exerciseToDeleteId);
      toast({ title: "Exercise Deleted", description: `${exerciseName} has been removed from your library.` });
      
      const updatedExercisesList = await fetchUserExercises(user.id);
      setExercises(updatedExercisesList);
    } catch (error: any) {
      console.error("Failed to delete exercise and update routines:", error);
      toast({ title: "Delete Error", description: `Could not delete ${exerciseName}. ${error.message}`, variant: "destructive" });
    } finally {
      setIsBusyDeleting(false);
      closeDeleteDialog();
    }
  };
 
  if (authContext.isLoading) { 
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-xl text-primary font-semibold">Loading authentication...</p>
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
  
  if (user && isLoading) { 
     return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-xl text-primary font-semibold">
          {isSeeding ? "Setting up your library..." : "Loading your exercises..."}
        </p>
      </div>
    );
  }


  return (
    <>
      <PageHeader title="Exercise Library" description="Browse, add, and manage your exercises.">
         <Button
            variant="default"
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={handleOpenAddDialog}
            disabled={isSeeding || isLoading} 
          >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add New Exercise
        </Button>
      </PageHeader>

      <AddExerciseDialog
        exerciseToEdit={exerciseToEdit}
        onSave={handleSaveExercise}
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        isSaving={isDialogSaving}
      />

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
            disabled={isSeeding || (isLoading && !exercises.length)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
           <Select
              value={selectedMuscleGroup}
              onValueChange={(value) => setSelectedMuscleGroup(value as MuscleGroup | 'All')}
              disabled={isSeeding || (isLoading && !exercises.length)}
            >
            <SelectTrigger className="w-full rounded-lg bg-card py-2 pl-10 pr-4 shadow-sm focus:ring-primary" aria-label="Filter by muscle group">
              <SelectValue placeholder="Filter by muscle group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Muscle Groups</SelectItem>
              {availableMuscleGroups.map(group => (
                <SelectItem key={group} value={group}>{group}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isSeeding && !isLoading ? ( 
        <div className="flex justify-center items-center h-40">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="ml-3 text-lg text-primary font-semibold">Populating your library with default exercises...</p>
        </div>
      ) : !isLoading && isFilteringOrSearching ? (
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
      ) : (!isLoading && !isSeeding && exercises.length === 0 && user) ? ( 
          <div className="text-center py-12">
            <p className="text-xl text-muted-foreground font-semibold mb-2">Your exercise library is empty.</p>
            <p className="text-muted-foreground">Add some exercises to get started!</p>
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
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
          {isBusyDeleting ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking routines...
            </div>
          ) : affectedRoutines.length > 0 ? (
            <div className='text-sm text-muted-foreground'>
              <div className="mb-2 font-semibold text-foreground">This exercise is used in {affectedRoutines.length} routine(s):</div>
              <ScrollArea className="max-h-32 w-full rounded-md border p-2">
                <ul className="list-disc pl-5 text-sm">
                  {affectedRoutines.map(r => <li key={r.id}>{r.name}</li>)}
                </ul>
              </ScrollArea>
              <div className="mt-3">Deleting this exercise will also <span className="font-bold">remove it from these routines</span>.</div>
              <div className="mt-1">Are you sure you want to proceed?</div>
            </div>
          ) : (
            <div className='text-sm text-muted-foreground'>
              This will permanently delete the exercise "{exercises.find(ex => ex.id === exerciseToDeleteId)?.name}".
            </div>
          )}
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
