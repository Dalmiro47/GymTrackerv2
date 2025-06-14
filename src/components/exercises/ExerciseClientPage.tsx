
"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Exercise, MuscleGroup, ExerciseData } from '@/types';
import type { ExerciseFormData } from './AddExerciseDialog';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { defaultExercises } from '@/lib/defaultExercises';
import { useAuth } from '@/contexts/AuthContext';
import { addExercise, getExercises, updateExercise, deleteExercise, addDefaultExercisesBatch } from '@/services/exerciseService';

import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Search, Filter, Loader2 } from 'lucide-react';
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
      };

      if (exerciseToEdit) {
        await updateExercise(user.id, exerciseToEdit.id, exercisePayload);
        toast({ title: "Exercise Updated", description: `${formData.name} has been successfully updated.` });
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

  const openDeleteConfirmation = (exerciseId: string) => {
    setExerciseToDeleteId(exerciseId);
  };

  const handleDeleteExercise = async () => {
    if (!exerciseToDeleteId || !user?.id) {
      toast({ title: "Error", description: "Could not delete exercise. User or Exercise ID missing.", variant: "destructive" });
      return;
    }

    const exerciseName = exercises.find(ex => ex.id === exerciseToDeleteId)?.name || "The exercise";
    try {
      await deleteExercise(user.id, exerciseToDeleteId);
      toast({ title: "Exercise Deleted", description: `${exerciseName} has been removed.` });
      
      const updatedExercisesList = await fetchUserExercises(user.id);
      setExercises(updatedExercisesList);

    } catch (error: any) {
      console.error("Failed to delete exercise:", error);
      toast({ title: "Delete Error", description: `Could not delete ${exerciseName}. ${error.message}`, variant: "destructive" });
    } finally {
      setExerciseToDeleteId(null);
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
              {MUSCLE_GROUPS_LIST.map(group => (
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


      <AlertDialog open={!!exerciseToDeleteId} onOpenChange={(open) => !open && setExerciseToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the exercise
              "{exercises.find(ex => ex.id === exerciseToDeleteId)?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setExerciseToDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteExercise} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

