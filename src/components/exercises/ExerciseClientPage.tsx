
"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Exercise, MuscleGroup, ExerciseData } from '@/types';
import type { ExerciseFormData } from './AddExerciseDialog'; // Import ExerciseFormData
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { addExercise, getExercises, updateExercise, deleteExercise } from '@/services/exerciseService';

import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Search, Filter, Loader2 } from 'lucide-react';
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

// Helper function to group exercises by muscle group, maintaining order from MUSCLE_GROUPS_LIST
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
  const { user } = useAuth();
  const { toast } = useToast();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | 'All'>('All');
  
  const [exerciseToEdit, setExerciseToEdit] = useState<Exercise | null>(null);
  const [exerciseToDeleteId, setExerciseToDeleteId] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogSaving, setIsDialogSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);


  const fetchUserExercises = useCallback(async () => {
    if (!user?.id) {
      setIsLoading(false); // Not logged in, stop loading
      return;
    }
    setIsLoading(true);
    try {
      const userExercises = await getExercises(user.id);
      setExercises(userExercises);
    } catch (error) {
      console.error("Failed to fetch exercises:", error);
      toast({
        title: "Error",
        description: "Could not fetch your exercises. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, toast]);

  useEffect(() => {
    fetchUserExercises();
  }, [fetchUserExercises]);

  const isFilteringOrSearching = useMemo(() => {
    return searchTerm.trim() !== '' || selectedMuscleGroup !== 'All';
  }, [searchTerm, selectedMuscleGroup]);

  const displayedExercises = useMemo(() => {
    if (!isFilteringOrSearching) return []; // Don't filter if not searching/filtering
    
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
    if (isFilteringOrSearching) return []; // Don't group if filtering/searching
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
        description: formData.description || '',
        image: formData.image || '',
        // dataAiHint can be derived or added if part of formData
      };

      if (exerciseToEdit) { // Editing existing exercise
        await updateExercise(user.id, exerciseToEdit.id, exercisePayload);
        toast({ title: "Exercise Updated", description: `${formData.name} has been successfully updated.` });
      } else { // Adding new exercise
        await addExercise(user.id, exercisePayload);
        toast({ title: "Exercise Added", description: `${formData.name} has been successfully added.` });
      }
      await fetchUserExercises(); // Re-fetch all exercises
      setIsDialogOpen(false);
      setExerciseToEdit(null);
    } catch (error) {
      console.error("Failed to save exercise:", error);
      toast({
        title: "Save Error",
        description: `Could not save ${formData.name}. Please try again.`,
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
      await fetchUserExercises(); // Re-fetch
    } catch (error) {
      console.error("Failed to delete exercise:", error);
      toast({ title: "Delete Error", description: `Could not delete ${exerciseName}.`, variant: "destructive" });
    } finally {
      setExerciseToDeleteId(null);
    }
  };
  

  if (isLoading && !exercises.length) { // Show full page loader only on initial load
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-xl text-primary font-semibold">Loading your exercises...</p>
      </div>
    );
  }
   if (!user) {
    return (
      <div className="flex flex-col justify-center items-center h-64">
        <p className="text-xl text-primary font-semibold mb-4">Please log in to manage your exercises.</p>
        <Button onClick={() => window.location.href = '/login'}>Go to Login</Button>
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
        // No trigger button here, it's controlled by isDialogOpen state
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
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
           <Select value={selectedMuscleGroup} onValueChange={(value) => setSelectedMuscleGroup(value as MuscleGroup | 'All')}>
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
      
      {isLoading && exercises.length > 0 && ( // Show subtle loader if data already exists but refetching
        <div className="my-4 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Refreshing...
        </div>
      )}

      {isFilteringOrSearching ? (
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
      ) : (
        exercisesGroupedByMuscle.length > 0 ? (
          <div className="space-y-8">
            {exercisesGroupedByMuscle.map(group => (
              <section key={group.muscleGroup} aria-labelledby={`muscle-group-${group.muscleGroup}`}>
                <h2 
                  id={`muscle-group-${group.muscleGroup}`} 
                  className="text-2xl font-headline font-semibold mb-4 text-primary border-b pb-2"
                >
                  {group.muscleGroup}
                </h2>
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
              </section>
            ))}
          </div>
        ) : (
         !isLoading && exercises.length === 0 && ( // Show this only if not loading and no exercises
            <div className="text-center py-12">
              <p className="text-xl text-muted-foreground font-semibold mb-2">Your exercise library is empty.</p>
              <p className="text-muted-foreground">Add some exercises to get started!</p>
            </div>
          )
        )
      )}

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
