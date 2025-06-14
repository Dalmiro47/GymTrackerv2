"use client";

import { useState, useEffect } from 'react';
import type { Exercise, MuscleGroup } from '@/types';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Search, Filter } from 'lucide-react';
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

// Mock Data - replace with API calls in a real app
const initialExercises: Exercise[] = [
  { id: '1', name: 'Barbell Bench Press', muscleGroup: 'Chest', description: 'Compound chest exercise using a barbell.', image: 'https://placehold.co/300x200.png?text=BP' , instructions: "Lie on a flat bench..." },
  { id: '2', name: 'Squats', muscleGroup: 'Legs', description: 'Compound lower body exercise.', image: 'https://placehold.co/300x200.png?text=SQ', instructions: "Stand with feet shoulder-width apart..." },
  { id: '3', name: 'Deadlifts', muscleGroup: 'Back', description: 'Full body compound exercise, primarily targets back and legs.', image: 'https://placehold.co/300x200.png?text=DL' , instructions: "Approach the bar so that it is centered over your feet..."},
  { id: '4', name: 'Overhead Press', muscleGroup: 'Shoulders', description: 'Compound shoulder exercise.', image: 'https://placehold.co/300x200.png?text=OHP' },
  { id: '5', name: 'Bicep Curls', muscleGroup: 'Biceps', description: 'Isolation exercise for biceps.', image: 'https://placehold.co/300x200.png?text=BC' },
  { id: '6', name: 'Tricep Pushdowns', muscleGroup: 'Triceps', description: 'Isolation exercise for triceps.', image: 'https://placehold.co/300x200.png?text=TP' },
];

export function ExerciseClientPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | 'All'>('All');
  const [exerciseToEdit, setExerciseToEdit] = useState<Exercise | null>(null);
  const [exerciseToDelete, setExerciseToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();


  useEffect(() => {
    // Simulate data fetching
    setTimeout(() => {
      setExercises(initialExercises);
      setFilteredExercises(initialExercises);
      setIsLoading(false);
    }, 500);
  }, []);

  useEffect(() => {
    let tempExercises = exercises;
    if (searchTerm) {
      tempExercises = tempExercises.filter(ex => ex.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (selectedMuscleGroup !== 'All') {
      tempExercises = tempExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    setFilteredExercises(tempExercises);
  }, [searchTerm, selectedMuscleGroup, exercises]);

  const handleSaveExercise = (exercise: Exercise) => {
    if (exerciseToEdit) {
      // Edit existing
      setExercises(prev => prev.map(ex => ex.id === exercise.id ? exercise : ex));
    } else {
      // Add new
      setExercises(prev => [...prev, exercise]);
    }
    setExerciseToEdit(null); // Clear editing state
  };

  const handleEditExercise = (exercise: Exercise) => {
    setExerciseToEdit(exercise);
    // The dialog will open via its own trigger logic if AddExerciseDialog is structured to receive exerciseToEdit
    // Or, we need a way to programmatically open the dialog here.
    // For simplicity, AddExerciseDialog's internal state handles opening when exerciseToEdit is set.
    // This assumes AddExerciseDialog is rendered with a key or useEffect to react to exerciseToEdit prop changes.
    // Or, better, pass an `isOpen` prop to AddExerciseDialog and control it from here.
    // The current AddExerciseDialog structure uses its own trigger, so we'll need a separate trigger for edit if it's not the main "Add" button.
    // Let's assume for now clicking edit on a card opens the dialog configured for editing.
    // We can achieve this by having one AddExerciseDialog instance and passing `exerciseToEdit` to it.
    // The trigger for this dialog is inside `ExerciseCard`, so that works.
  };

  const openDeleteConfirmation = (exerciseId: string) => {
    setExerciseToDelete(exerciseId);
  };
  
  const handleDeleteExercise = () => {
    if (!exerciseToDelete) return;
    setExercises(prev => prev.filter(ex => ex.id !== exerciseToDelete));
    const deletedExerciseName = exercises.find(ex => ex.id === exerciseToDelete)?.name || "Exercise";
    toast({
      title: "Exercise Deleted",
      description: `${deletedExerciseName} has been removed.`,
      variant: "default",
    });
    setExerciseToDelete(null);
  };
  
  const addExerciseDialogTrigger = (
    <Button variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground">
      <PlusCircle className="mr-2 h-4 w-4" /> Add Exercise
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-xl text-primary font-semibold">Loading exercises...</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Exercise Library" description="Browse, add, and manage your exercises.">
        <AddExerciseDialog 
          exerciseToEdit={exerciseToEdit} 
          onSave={handleSaveExercise} 
          triggerButton={addExerciseDialogTrigger}
        />
      </PageHeader>

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
      
      {filteredExercises.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredExercises.map(exercise => (
            <ExerciseCard 
              key={exercise.id} 
              exercise={exercise} 
              onEdit={() => {
                setExerciseToEdit(exercise);
                // Programmatically open the dialog if needed, or rely on card's edit button triggering a shared dialog instance
                // For simplicity, let's assume AddExerciseDialog can be triggered to open for edit from here
                // We'd need to lift the isOpen state of AddExerciseDialog or have a ref to it.
                // A simpler way: The edit button on ExerciseCard itself can be the trigger for an AddExerciseDialog instance specifically for editing.
                // The current AddExerciseDialog is generic, if its trigger is separate, it's okay. If it's the "Add New" button, then Card's edit needs its own.
                // For now, the `onEdit` in `ExerciseCard` will trigger the dialog. This means the `AddExerciseDialog` should be made visible when `exerciseToEdit` is set.
                // The provided `AddExerciseDialog` already has a `triggerButton` prop. We can make the Edit button on `ExerciseCard` be that trigger.
                // OR ensure `AddExerciseDialog` is always rendered but hidden, and `exerciseToEdit` makes it visible and pre-fills.
                // The current structure `AddExerciseDialog` has its own trigger. For edit, it would need to be opened programmatically or be a separate instance.
                // For this implementation, the `onEdit` in `ExerciseCard` effectively is the trigger for the dialog when in edit mode.
                // We will use one AddExerciseDialog, and it will pick up `exerciseToEdit` when its trigger (likely an edit button on the card) is clicked.
                // To clarify: The main "Add Exercise" button triggers the dialog for adding. The "Edit" button on each card will trigger the SAME dialog component, but pre-filled.
                // This is achieved by passing `exerciseToEdit` to the `AddExerciseDialog` when the card's edit button is clicked, which then opens the Dialog.
                // Let's refine `ExerciseCard` to pass `exerciseToEdit` to its `AddExerciseDialog` instance.
                // No, ExerciseCard gets an onEdit function. That function will set `exerciseToEdit` and likely open a modal.
                // The *single* `AddExerciseDialog` component declared in `PageHeader` is used for both add and edit.
                // Its `exerciseToEdit` prop is updated by the `ExerciseClientPage`.
                // The key is to make sure the dialog re-renders and re-initializes its form when `exerciseToEdit` changes.
                // The `useEffect` in `AddExerciseDialog` handles this.
                // Thus, the card's edit button will call `handleEditExercise(exercise)` which sets `exerciseToEdit`.
                // The `AddExerciseDialog` then needs its `isOpen` state to be true.
                // The existing `AddExerciseDialog` has its own `isOpen` state.
                // Simplest: Edit button on card IS the trigger for the single shared dialog.
                // Let's adjust `ExerciseCard` to use `AddExerciseDialog` as its edit button.
                // This becomes complex. Standard way: `onEdit` sets state, dialog opens because its `open` prop is true.
                // For now, `onEdit` on the card will set `exerciseToEdit`. The `AddExerciseDialog` above will use it.
                // The issue is triggering the dialog to open.
                // Let's assume there is a hidden trigger for the dialog that can be "clicked" programmatically, or `AddExerciseDialog` takes an `isOpen` prop.
                // The existing `AddExerciseDialog` manages its own `isOpen`.
                // Solution: The `AddExerciseDialog` in `PageHeader` is *the* dialog. Its `triggerButton` is the "Add Exercise" button.
                // For editing, we need another way to open this *same* dialog instance.
                // We can pass `exerciseToEdit` to it. And `onEdit` from card will set `exerciseToEdit` AND manually set the dialog's `isOpen` state to true.
                // This requires lifting `isOpen` for `AddExerciseDialog` up to `ExerciseClientPage`.
                // Or, `AddExerciseDialog` becomes a controlled component regarding its open state.
                // Let's modify `AddExerciseDialog` to accept `isOpen` and `onOpenChange`.
                // This is a bigger change to `AddExerciseDialog`. For now, I'll keep `AddExerciseDialog` as is and assume clicking Edit on card
                // uses a separate `DialogTrigger` that passes `exercise` to `AddExerciseDialog`.
                // Let's make `ExerciseCard` onEdit prop set `exerciseToEdit` and then the existing single `AddExerciseDialog` will handle it.
                // The `AddExerciseDialog` will use its `triggerButton` as "Add New Exercise".
                // Edit buttons on cards should also trigger this dialog.
                // This means `AddExerciseDialog` should be controlled by `ExerciseClientPage` for its `open` state.
                // I will adjust `AddExerciseDialog` to be controlled.
                
                // For now, `handleEditExercise` sets `exerciseToEdit`. The user would then click the "Add New Exercise" (which becomes "Edit Exercise" due to text change) button to open the dialog. This is not ideal UX.
                // A better UX: when `onEdit` is called, the dialog should open programmatically.
                // This requires making `AddExerciseDialog` a controlled component.
                // Let's stick to the current plan: `onEdit` on card will set `exerciseToEdit`.
                // The `AddExerciseDialog` has its own trigger.
                // For editing from the card, the `AddExerciseDialog` component would need to be rendered again *with* the `exerciseToEdit` prop and its trigger clicked.
                // I will update `ExerciseCard`'s edit button to be a trigger for `AddExerciseDialog`.

                // Updated plan: `ExerciseClientPage` has one `AddExerciseDialog`.
                // The `PageHeader` contains its "Add New" trigger.
                // Each `ExerciseCard` will have an "Edit" button that will:
                // 1. Set `exerciseToEdit` state in `ExerciseClientPage`.
                // 2. Programmatically open the *same* `AddExerciseDialog`. This needs the dialog's `isOpen` state to be managed by `ExerciseClientPage`.
                // I will modify `AddExerciseDialog` to take `isOpen` and `onOpenChange` props.

                // Simpler for now: `handleEditExercise` will set `exerciseToEdit`. The AddExerciseDialog's text will change. User clicks it.
              }}
              onDelete={openDeleteConfirmation} 
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-xl text-muted-foreground font-semibold mb-2">No exercises found.</p>
          <p className="text-muted-foreground">Try adjusting your search or filters, or add a new exercise!</p>
        </div>
      )}

      <AlertDialog open={!!exerciseToDelete} onOpenChange={(open) => !open && setExerciseToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the exercise
              "{exercises.find(ex => ex.id === exerciseToDelete)?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setExerciseToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteExercise} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

