
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

const initialExercises: Exercise[] = [
  // Chest
  { id: 'chest-001', name: 'Incline Dumbbell Press', muscleGroup: 'Chest', description: 'Targets the upper chest using dumbbells.', image: 'https://placehold.co/300x200.png?text=IDP', dataAiHint: "dumbbell press" },
  { id: 'chest-002', name: 'Incline Smith Machine Press', muscleGroup: 'Chest', description: 'Targets the upper chest using a Smith machine.', image: 'https://placehold.co/300x200.png?text=ISMP', dataAiHint: "smith machine" },
  { id: 'chest-003', name: 'Machine Chest Press', muscleGroup: 'Chest', description: 'Targets the middle chest using a machine.', image: 'https://placehold.co/300x200.png?text=MCP', dataAiHint: "chest machine" },
  { id: 'chest-004', name: 'Bench Press', muscleGroup: 'Chest', description: 'Compound exercise targeting the middle chest.', image: 'https://placehold.co/300x200.png?text=BP', dataAiHint: "bench press" },
  { id: 'chest-005', name: 'Seated Cable Pec Flye', muscleGroup: 'Chest', description: 'Targets the lower chest using cables.', image: 'https://placehold.co/300x200.png?text=SCPF', dataAiHint: "cable machine" },
  { id: 'chest-006', name: 'Dips (Chest Focus)', muscleGroup: 'Chest', description: 'Targets the lower chest. Lean forward to emphasize chest.', image: 'https://placehold.co/300x200.png?text=DIPS', dataAiHint: "dip station" },
  
  // Back
  { id: 'back-001', name: 'Wide-Grip Pull-ups', muscleGroup: 'Back', description: 'Targets lats and middle back using a wide grip.', image: 'https://placehold.co/300x200.png?text=WGPU', dataAiHint: "pull up" },
  { id: 'back-002', name: 'Chest-Supported Row', muscleGroup: 'Back', description: 'Targets upper back and middle back with chest support.', image: 'https://placehold.co/300x200.png?text=CSR', dataAiHint: "row machine" },
  { id: 'back-003', name: 'Wide-Grip Lat Pulldown', muscleGroup: 'Back', description: 'Targets lats and middle back using a wide grip on a pulldown machine.', image: 'https://placehold.co/300x200.png?text=WGLP', dataAiHint: "lat pulldown" },
  { id: 'back-004', name: 'Neutral-Grip Lat Pulldown', muscleGroup: 'Back', description: 'Targets lats and teres major using a neutral grip on a pulldown machine.', image: 'https://placehold.co/300x200.png?text=NGLP', dataAiHint: "lat pulldown" },
  { id: 'back-005', name: 'Half-Kneeling 1-Arm Lat Pulldown', muscleGroup: 'Back', description: 'Unilateral exercise targeting lats and teres major.', image: 'https://placehold.co/300x200.png?text=HKLP', dataAiHint: "cable machine" },
  { id: 'back-006', name: 'Barbell Rows', muscleGroup: 'Back', description: 'Compound exercise targeting the upper and middle back.', image: 'https://placehold.co/300x200.png?text=BBR', dataAiHint: "barbell row" },

  // Shoulders
  { id: 'shoulders-001', name: 'Standing Overhead Press', muscleGroup: 'Shoulders', description: 'Targets the anterior deltoid with a barbell while standing.', image: 'https://placehold.co/300x200.png?text=SOHP', dataAiHint: "overhead press" },
  { id: 'shoulders-002', name: 'Dumbbell Overhead Press', muscleGroup: 'Shoulders', description: 'Targets the anterior deltoid with dumbbells.', image: 'https://placehold.co/300x200.png?text=DOHP', dataAiHint: "dumbbell press" },
  { id: 'shoulders-003', name: 'Machine Shoulder Press', muscleGroup: 'Shoulders', description: 'Targets the anterior deltoid using a shoulder press machine.', image: 'https://placehold.co/300x200.png?text=MSP', dataAiHint: "shoulder machine" },
  { id: 'shoulders-004', name: 'Lateral Raise Machine', muscleGroup: 'Shoulders', description: 'Targets the lateral deltoid using a machine.', image: 'https://placehold.co/300x200.png?text=LRM', dataAiHint: "shoulder machine" },
  { id: 'shoulders-005', name: 'Dumbbell Lateral Raise', muscleGroup: 'Shoulders', description: 'Targets the lateral deltoid with dumbbells.', image: 'https://placehold.co/300x200.png?text=DLR', dataAiHint: "dumbbell raise" },
  { id: 'shoulders-006', name: 'Cable Lateral Raise', muscleGroup: 'Shoulders', description: 'Targets the lateral deltoid using cables.', image: 'https://placehold.co/300x200.png?text=CLR', dataAiHint: "cable machine" },
  { id: 'shoulders-007', name: 'Reverse Peck Deck', muscleGroup: 'Shoulders', description: 'Targets the posterior deltoid using a peck deck machine in reverse.', image: 'https://placehold.co/300x200.png?text=RPD', dataAiHint: "pec deck" },
  { id: 'shoulders-008', name: 'Seated Reverse Dumbbell Flye', muscleGroup: 'Shoulders', description: 'Targets the posterior deltoid with dumbbells while seated.', image: 'https://placehold.co/300x200.png?text=SRDF', dataAiHint: "dumbbell flye" },

  // Legs
  { id: 'legs-001', name: 'Barbell Back Squat', muscleGroup: 'Legs', description: 'Compound exercise targeting quadriceps, glutes, and hamstrings.', image: 'https://placehold.co/300x200.png?text=SQ', dataAiHint: "barbell squat" },
  { id: 'legs-002', name: 'Hack Squat', muscleGroup: 'Legs', description: 'Targets quadriceps using a hack squat machine.', image: 'https://placehold.co/300x200.png?text=HS', dataAiHint: "hack squat" },
  { id: 'legs-003', name: 'Leg Extension', muscleGroup: 'Legs', description: 'Isolation exercise for quadriceps.', image: 'https://placehold.co/300x200.png?text=LE', dataAiHint: "leg extension" },
  { id: 'legs-004', name: 'Leg Press', muscleGroup: 'Legs', description: 'Targets quadriceps and glutes using a leg press machine.', image: 'https://placehold.co/300x200.png?text=LP', dataAiHint: "leg press" },
  { id: 'legs-005', name: 'Leg Curl Machine', muscleGroup: 'Legs', description: 'Isolation exercise for hamstrings (seated or lying).', image: 'https://placehold.co/300x200.png?text=LC', dataAiHint: "leg curl" },
  { id: 'legs-006', name: 'Romanian Deadlift (RDL)', muscleGroup: 'Legs', description: 'Targets hamstrings and glutes, emphasizing hip hinge.', image: 'https://placehold.co/300x200.png?text=RDL', dataAiHint: "romanian deadlift" },
  { id: 'legs-007', name: 'Hip Thrust', muscleGroup: 'Legs', description: 'Primarily targets the glutes.', image: 'https://placehold.co/300x200.png?text=HT', dataAiHint: "hip thrust" },
  { id: 'legs-008', name: 'Abductor Machine', muscleGroup: 'Legs', description: 'Targets hip abductors (outer glutes).', image: 'https://placehold.co/300x200.png?text=ABM', dataAiHint: "abductor machine" },
  { id: 'legs-009', name: 'Standing Calf Raise', muscleGroup: 'Legs', description: 'Targets the gastrocnemius muscle in the calves.', image: 'https://placehold.co/300x200.png?text=SCR', dataAiHint: "calf raise" },

  // Triceps
  { id: 'triceps-001', name: 'Dips (Tricep Focus)', muscleGroup: 'Triceps', description: 'Targets the lateral head of the triceps. Keep body upright.', image: 'https://placehold.co/300x200.png?text=DIPST', dataAiHint: "dip station" },
  { id: 'triceps-002', name: 'Cable Tricep Kickback', muscleGroup: 'Triceps', description: 'Targets the lateral head of the triceps using a cable.', image: 'https://placehold.co/300x200.png?text=CTK', dataAiHint: "cable machine" },
  { id: 'triceps-003', name: 'Overhead Cable Tricep Extension', muscleGroup: 'Triceps', description: 'Targets the long head of the triceps using an overhead cable setup.', image: 'https://placehold.co/300x200.png?text=OCTE', dataAiHint: "cable machine" },
  { id: 'triceps-004', name: 'Skullcrusher (Lying Tricep Extension)', muscleGroup: 'Triceps', description: 'Targets the long head of the triceps, typically with an EZ bar or dumbbells.', image: 'https://placehold.co/300x200.png?text=SKC', dataAiHint: "ez bar" },

  // Biceps
  { id: 'biceps-001', name: 'EZ Bar Curl', muscleGroup: 'Biceps', description: 'Targets the short head (inner) of the biceps with an EZ bar.', image: 'https://placehold.co/300x200.png?text=EZBC', dataAiHint: "ez bar" },
  { id: 'biceps-002', name: 'Chin-up (Underhand Grip)', muscleGroup: 'Biceps', description: 'Compound exercise targeting biceps (short and long heads) and back.', image: 'https://placehold.co/300x200.png?text=CHIN', dataAiHint: "pull up" },
  { id: 'biceps-003', name: 'Incline Dumbbell Curl', muscleGroup: 'Biceps', description: 'Targets the long head (outer) of the biceps with dumbbells on an incline bench.', image: 'https://placehold.co/300x200.png?text=IDC', dataAiHint: "dumbbell curl" },
  { id: 'biceps-004', name: 'Face Away Cable Curl (Bayesian Curl)', muscleGroup: 'Biceps', description: 'Targets the long head (outer) of the biceps, emphasizing stretch with cables.', image: 'https://placehold.co/300x200.png?text=FACC', dataAiHint: "cable machine" },
  { id: 'biceps-005', name: 'Hammer Curl', muscleGroup: 'Biceps', description: 'Targets the brachialis and brachioradialis, contributing to arm thickness.', image: 'https://placehold.co/300x200.png?text=HC', dataAiHint: "dumbbell curl" },

  // Abs
  { id: 'abs-001', name: 'Cable Crunch', muscleGroup: 'Abs', description: 'Targets upper abdominals using a cable machine.', image: 'https://placehold.co/300x200.png?text=CACR', dataAiHint: "cable machine" },
  { id: 'abs-002', name: 'Crunch Machine', muscleGroup: 'Abs', description: 'Targets upper abdominals using a crunch machine.', image: 'https://placehold.co/300x200.png?text=CRM', dataAiHint: "abs machine" },
  { id: 'abs-003', name: 'Candlestick', muscleGroup: 'Abs', description: 'Targets upper and lower abdominals, bodyweight exercise.', image: 'https://placehold.co/300x200.png?text=CNDL', dataAiHint: "floor exercise" },
  { id: 'abs-004', name: 'Hanging Leg Raise', muscleGroup: 'Abs', description: 'Targets lower abdominals and hip flexors, performed while hanging.', image: 'https://placehold.co/300x200.png?text=HLR', dataAiHint: "pull up bar" },
  { id: 'abs-005', name: 'Captain\'s Chair Leg Raise', muscleGroup: 'Abs', description: 'Targets lower abdominals with back support on a captain\'s chair.', image: 'https://placehold.co/300x200.png?text=CCLR', dataAiHint: "leg raise" },
  { id: 'abs-006', name: 'Decline Crunch (Super Range Motion)', muscleGroup: 'Abs', description: 'Targets upper and lower abdominals with an extended range of motion on a decline bench.', image: 'https://placehold.co/300x200.png?text=DCSM', dataAiHint: "decline bench" },
  { id: 'abs-007', name: 'Ab Wheel Rollout', muscleGroup: 'Abs', description: 'Targets the entire core for stability using an ab wheel.', image: 'https://placehold.co/300x200.png?text=AWR', dataAiHint: "ab wheel" },
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
    setExerciseToEdit(null); 
  };

  const handleEditExercise = (exercise: Exercise) => {
    setExerciseToEdit(exercise);
    // This assumes the AddExerciseDialog is controlled by a state that is set here
    // or that the dialog's trigger is part of the ExerciseCard which handles opening.
    // For the current setup, the `AddExerciseDialog` in PageHeader is used.
    // Ideally, `AddExerciseDialog` would take an `isOpen` prop controlled here.
    // For now, the user clicks the "Edit Exercise" (formerly "Add") button after `exerciseToEdit` is set.
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
      <PlusCircle className="mr-2 h-4 w-4" /> 
      {exerciseToEdit ? "Edit Current Exercise" : "Add Exercise"}
    </Button>
  );

  // This function is intended to be called to open the dialog for editing
  // It requires AddExerciseDialog to be controllable (e.g., via isOpen prop)
  // For now, it just sets the exercise to edit.
  const triggerEditDialog = (exercise: Exercise) => {
    setExerciseToEdit(exercise);
    // Here you would also set an `isEditDialogOpen` state to true if AddExerciseDialog was controlled
  };


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
        {/* The single dialog instance for both adding and editing */}
        <AddExerciseDialog 
          exerciseToEdit={exerciseToEdit} 
          onSave={handleSaveExercise} 
          // The trigger for adding new. Editing is handled by buttons on cards.
          // To make card edit buttons open *this* dialog, AddExerciseDialog needs to be controllable.
          // A simple workaround for now: text changes, user clicks.
          triggerButton={
             <Button variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={() => {
                if (exerciseToEdit) {
                  // This button is now effectively "Save Edit" if exerciseToEdit is set
                  // But the dialog itself has the save button. This trigger just opens it.
                } else {
                  setExerciseToEdit(null); // Ensure it's for adding new
                }
                // The dialog's own open state mechanism will handle showing it.
             }}>
              <PlusCircle className="mr-2 h-4 w-4" /> 
              {exerciseToEdit ? "Edit Selected Exercise" : "Add New Exercise"}
            </Button>
          }
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
                triggerEditDialog(exercise);
                // The user now needs to click the main "Edit Selected Exercise" button in PageHeader
                // to open the dialog. This is because AddExerciseDialog isn't fully controlled yet.
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

