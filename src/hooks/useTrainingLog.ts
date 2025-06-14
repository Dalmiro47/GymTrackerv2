
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getWorkoutLog as fetchLogService, 
  saveWorkoutLog as saveLogService,
  getLastLoggedPerformance as fetchLastPerformanceService,
  saveExercisePerformanceEntry as savePerformanceEntryService
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format } from 'date-fns'; // For formatting date to YYYY-MM-DD
import { useToast } from './use-toast';

export const useTrainingLog = (initialDate: Date) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [currentLog, setCurrentLog] = useState<WorkoutLog | null>(null);
  const [isLoadingLog, setIsLoadingLog] = useState(true);
  const [isSavingLog, setIsSavingLog] = useState(false);

  const [availableRoutines, setAvailableRoutines] = useState<Routine[]>([]);
  const [isLoadingRoutines, setIsLoadingRoutines] = useState(true);
  
  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);

  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');

  // Fetch available routines and exercises for the user
  useEffect(() => {
    if (user?.id) {
      setIsLoadingRoutines(true);
      fetchUserRoutines(user.id)
        .then(setAvailableRoutines)
        .catch(error => toast({ title: "Error", description: `Failed to load routines: ${error.message}`, variant: "destructive" }))
        .finally(() => setIsLoadingRoutines(false));

      setIsLoadingExercises(true);
      fetchAllUserExercises(user.id)
        .then(setAvailableExercises)
        .catch(error => toast({ title: "Error", description: `Failed to load exercises: ${error.message}`, variant: "destructive" }))
        .finally(() => setIsLoadingExercises(false));
    }
  }, [user?.id, toast]);


  // Fetch log for the selected date
  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    if (!user?.id) return;
    setIsLoadingLog(true);
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    try {
      const log = await fetchLogService(user.id, dateId);
      if (log) {
         const logWithPerformance = await Promise.all(log.exercises.map(async (ex) => {
            const perf = await fetchLastPerformanceService(user.id, ex.exerciseId);
            return { ...ex, lastPerformanceDisplay: formatLastPerformance(perf) };
        }));
        setCurrentLog({...log, exercises: logWithPerformance});
      } else {
        setCurrentLog({
          id: dateId,
          date: dateId,
          exercises: [],
          notes: '',
        });
      }
    } catch (error: any) {
      toast({ title: "Error Loading Log", description: error.message, variant: "destructive" });
      setCurrentLog(null); // Or a default empty state
    } finally {
      setIsLoadingLog(false);
    }
  }, [user?.id, toast]);

  useEffect(() => {
    loadLogForDate(selectedDate);
  }, [selectedDate, loadLogForDate]);

  const formatLastPerformance = (perf: ExercisePerformanceEntry | null): string => {
    if (!perf || perf.sets.length === 0) return "No previous data";
    // Example: "3x10 @ 50kg, 1x8 @ 55kg"
    return perf.sets.map(s => `${s.reps}x${s.weight}kg`).join(', ');
  };

  const fetchAndSetLastPerformance = async (exerciseId: string) => {
    if (!user?.id || !currentLog) return;
    const perf = await fetchLastPerformanceService(user.id, exerciseId);
    const display = formatLastPerformance(perf);
    setCurrentLog(prevLog => {
      if (!prevLog) return null;
      return {
        ...prevLog,
        exercises: prevLog.exercises.map(ex => 
          ex.exerciseId === exerciseId ? { ...ex, lastPerformanceDisplay: display } : ex
        )
      };
    });
  };
  
  const handleSelectRoutine = (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    const exercisesFromRoutine: LoggedExercise[] = selectedRoutine.exercises.map((ex, index) => ({
      id: `${ex.id}-${Date.now()}-${index}`, // Unique ID for dnd-kit
      exerciseId: ex.id,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      sets: [{ id: `set-${Date.now()}-1`, reps: null, weight: null }], // Start with one empty set
      notes: '',
      lastPerformanceDisplay: 'Loading...', // Placeholder
    }));
    
    setCurrentLog({
      id: formattedDateId,
      date: formattedDateId,
      routineId: selectedRoutine.id,
      routineName: selectedRoutine.name,
      exercises: exercisesFromRoutine,
      notes: currentLog?.notes || '',
    });

    // Fetch last performance for newly added exercises
    exercisesFromRoutine.forEach(ex => fetchAndSetLastPerformance(ex.exerciseId));
  };

  const addExerciseToLog = async (exercise: Exercise) => {
    if (!currentLog || !user?.id) return;
    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${Date.now()}`,
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      sets: [{ id: `set-${Date.now()}-1`, reps: null, weight: null }],
      notes: '',
      lastPerformanceDisplay: 'Loading...',
    };
    setCurrentLog(prev => prev ? { ...prev, exercises: [...prev.exercises, newLoggedExercise] } : null);
    await fetchAndSetLastPerformance(exercise.id);
  };

  const removeExerciseFromLog = (loggedExerciseId: string) => {
    setCurrentLog(prev => prev ? { ...prev, exercises: prev.exercises.filter(ex => ex.id !== loggedExerciseId) } : null);
  };
  
  const reorderExercisesInLog = (reorderedExercises: LoggedExercise[]) => {
    setCurrentLog(prev => prev ? { ...prev, exercises: reorderedExercises } : null);
  };

  const updateExerciseInLog = (updatedExercise: LoggedExercise) => {
    setCurrentLog(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map(ex => ex.id === updatedExercise.id ? updatedExercise : ex)
      };
    });
  };
  
  // Saves the entire log for the day. Typically called after an individual exercise is "saved" or notes are updated.
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);
    try {
      // Filter out exercises with no actual sets logged before saving
      const logToSave = {
        ...currentLog,
        exercises: currentLog.exercises.filter(ex => ex.sets.some(s => (s.reps ?? 0) > 0 || (s.weight ?? 0) > 0))
      };

      if (logToSave.exercises.length === 0 && !logToSave.notes) {
         // If no exercises and no notes, consider deleting the log for the day?
         // For now, we'll allow saving an empty log if it was explicitly interacted with.
         // Or, prevent saving if truly empty:
         // toast({ title: "Empty Log", description: "Add some exercises or notes to save.", variant: "default" });
         // setIsSavingLog(false);
         // return;
      }

      await saveLogService(user.id, formattedDateId, logToSave);
      toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  // Called when a single exercise's "Save" button is pressed
  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    
    // 1. Update the exercise in the local `currentLog` state
    updateExerciseInLog(loggedExercise);

    // 2. Save the performance entry for this specific exercise
    const validSets = loggedExercise.sets.filter(s => (s.reps ?? 0) > 0 || (s.weight ?? 0) > 0);
    if (validSets.length > 0) {
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, validSets);
    }
    
    // 3. Persist the entire day's log
    // The currentLog state is updated by updateExerciseInLog, so saveCurrentLog uses the latest
    await saveCurrentLog(); 

    // 4. Refresh last performance display for this exercise as it's now the new "last"
    await fetchAndSetLastPerformance(loggedExercise.exerciseId);
  };

  const updateOverallLogNotes = (notes: string) => {
    setCurrentLog(prev => prev ? { ...prev, notes } : null);
    // Debounce or add a separate save button for overall notes if desired
    // For now, relies on an exercise save or explicit log save action to persist
  };


  return {
    selectedDate,
    setSelectedDate,
    currentLog,
    isLoadingLog,
    isSavingLog,
    availableRoutines,
    isLoadingRoutines,
    availableExercises,
    isLoadingExercises,
    handleSelectRoutine,
    addExerciseToLog,
    removeExerciseFromLog,
    reorderExercisesInLog,
    updateExerciseInLog, 
    saveExerciseProgress,
    saveCurrentLog, // Expose for a potential main "Save Day" button
    updateOverallLogNotes,
    fetchAndSetLastPerformance // For manual refresh if needed
  };
};

