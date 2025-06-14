
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getWorkoutLog as fetchLogService, 
  saveWorkoutLog as saveLogService, // This is for the whole day's log
  getLastLoggedPerformance as fetchLastPerformanceService,
  saveExercisePerformanceEntry as savePerformanceEntryService // This is for individual exercise "last time"
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines, getRoutineById } from '@/services/routineService';
import { format } from 'date-fns';
import { useToast } from './use-toast';

export const useTrainingLog = (initialDate: Date) => {
  const { user, isLoading: authIsLoading } = useAuth();
  const { toast } = useToast();
  
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [currentLog, setCurrentLog] = useState<WorkoutLog | null>(null);
  const [isLoadingLog, setIsLoadingLog] = useState(true);
  const [isSavingLog, setIsSavingLog] = useState(false); // For the "Save Day's Log" button

  const [availableRoutines, setAvailableRoutines] = useState<Routine[]>([]);
  const [isLoadingRoutines, setIsLoadingRoutines] = useState(true);
  
  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);

  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');

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
    } else {
      setAvailableRoutines([]);
      setAvailableExercises([]);
      setIsLoadingRoutines(false);
      setIsLoadingExercises(false);
    }
  }, [user?.id, toast]);

  const formatLastPerformance = (perf: ExercisePerformanceEntry | null): string => {
    if (!perf || perf.sets.length === 0) return "No previous data";
    return perf.sets.map(s => `${s.reps ?? '0'}x${s.weight ?? '0'}kg`).join(', ');
  };
  
  const fetchAndSetLastPerformance = async (exerciseId: string) => {
    if (!user?.id) return;
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

  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    if (!user?.id) {
        setIsLoadingLog(false);
        const dateIdForEmpty = format(dateToLoad, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        return;
    }

    setIsLoadingLog(true);
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    try {
        const fetchedLog = await fetchLogService(user.id, dateId);
        let finalExercises: LoggedExercise[] = [];
        let logRoutineId: string | undefined = fetchedLog?.routineId;
        let logRoutineName: string | undefined = fetchedLog?.routineName;

        if (logRoutineId) {
            let routineDetails: Routine | null | undefined = null;
            if (availableRoutines.length > 0) {
                routineDetails = availableRoutines.find(r => r.id === logRoutineId);
            }
            
            if (!routineDetails && !isLoadingRoutines) { 
                routineDetails = await getRoutineById(user.id, logRoutineId);
            }

            if (routineDetails) {
                logRoutineName = routineDetails.name;
                finalExercises = routineDetails.exercises.map((routineEx, index) => {
                    const loggedVersion = fetchedLog?.exercises.find(loggedEx => loggedEx.exerciseId === routineEx.id);
                    return {
                        id: loggedVersion?.id || `${routineEx.id}-${dateId}-${index}`, 
                        exerciseId: routineEx.id,
                        name: routineEx.name,
                        muscleGroup: routineEx.muscleGroup,
                        exerciseSetup: routineEx.exerciseSetup || '', // Populate exerciseSetup
                        sets: loggedVersion?.sets || [{ id: `set-${dateId}-${routineEx.id}-0`, reps: null, weight: null }],
                        notes: loggedVersion?.notes || '',
                        lastPerformanceDisplay: 'Loading...',
                    };
                });
            } else if (fetchedLog) {
                finalExercises = fetchedLog.exercises.map(ex => ({...ex, exerciseSetup: ex.exerciseSetup || ''})); // Ensure exerciseSetup
            }
        } else if (fetchedLog) {
             finalExercises = fetchedLog.exercises.map(ex => ({...ex, exerciseSetup: ex.exerciseSetup || ''})); // Ensure exerciseSetup
        }

        const exercisesWithPerformance = await Promise.all(
            finalExercises.map(async (ex) => {
                const perf = await fetchLastPerformanceService(user.id, ex.exerciseId);
                return { ...ex, lastPerformanceDisplay: formatLastPerformance(perf) };
            })
        );
        
        setCurrentLog({
            id: dateId,
            date: dateId,
            routineId: logRoutineId,
            routineName: logRoutineName,
            exercises: exercisesWithPerformance,
            notes: fetchedLog?.notes || '',
        });

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: error.message, variant: "destructive" });
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast, availableRoutines, isLoadingRoutines]);

  useEffect(() => {
    // console.log('[useTrainingLog] Auth user in hook:', user);
    if (user?.id) {
        // console.log(`[useTrainingLog] User ID available: ${user.id}. Calling loadLogForDate for ${selectedDate}.`);
        loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) { 
        // console.log(`[useTrainingLog] No user ID and not auth loading. Clearing log for ${selectedDate}.`);
        const dateIdForEmpty = format(selectedDate, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        setIsLoadingLog(false);
    }
    // else {
    //    console.log(`[useTrainingLog] Conditions not met for loadLogForDate. User: ${user?.id}, AuthLoading: ${authIsLoading}`);
    // }
  }, [selectedDate, loadLogForDate, user?.id, authIsLoading]);
  
  const handleSelectRoutine = (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    const exercisesFromRoutine: LoggedExercise[] = selectedRoutine.exercises.map((ex, index) => ({
      id: `${ex.id}-${formattedDateId}-${index}`, 
      exerciseId: ex.id,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      exerciseSetup: ex.exerciseSetup || '', // Populate exerciseSetup
      sets: [{ id: `set-${formattedDateId}-${ex.id}-0`, reps: null, weight: null }],
      notes: '',
      lastPerformanceDisplay: 'Loading...', 
    }));
    
    setCurrentLog({
      id: formattedDateId,
      date: formattedDateId,
      routineId: selectedRoutine.id,
      routineName: selectedRoutine.name,
      exercises: exercisesFromRoutine,
      notes: currentLog?.notes || '',
    });

    exercisesFromRoutine.forEach(ex => fetchAndSetLastPerformance(ex.exerciseId));
  };

  const addExerciseToLog = async (exercise: Exercise) => {
    if (!currentLog || !user?.id) return;
    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${Date.now()}`,
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      exerciseSetup: exercise.exerciseSetup || '', // Populate exerciseSetup
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
  
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);
    try {
      const logToSave: WorkoutLog = {
        ...currentLog,
        exercises: currentLog.exercises
          .map(ex => ({ // Ensure sets are numbers and exerciseSetup is included
              ...ex,
              exerciseSetup: ex.exerciseSetup || '', // Ensure exerciseSetup is part of saved data
              sets: ex.sets.map(s => ({
                  id: s.id,
                  reps: s.reps === null || isNaN(s.reps) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(s.weight) ? 0 : Number(s.weight),
              }))
          }))
          // Removed filter that might discard exercises with 0 rep/weight sets if user intends to log 0
      };
      
      // console.log('[useTrainingLog] logToSave prepared:', JSON.stringify(logToSave, null, 2));

      if (logToSave.exercises.length === 0 && !logToSave.notes && !logToSave.routineId) {
        // console.log('[useTrainingLog] Empty log (no exercises, no notes, no routineId), not saving.');
        // Consider deleting the log from Firestore if it exists and is now empty, or just don't save.
        // For now, we'll prevent saving an absolutely empty log unless it was based on a routine (keeps routine context)
      } else {
        await saveLogService(user.id, formattedDateId, logToSave); // Pass the full logToSave
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    
    updateExerciseInLog(loggedExercise); // Update local state immediately

    const validSets = loggedExercise.sets.filter(s => (s.reps ?? 0) > 0 || (s.weight ?? 0) > 0);
    if (validSets.length > 0) {
      const numericSets = validSets.map(s => ({
        id: s.id,
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
    }
    
    // The "Save Day's Log" button is responsible for saving the entire log to Firestore.
    // This function focuses on updating the "last performance" and local state.

    await fetchAndSetLastPerformance(loggedExercise.exerciseId); // Refresh "last performance" display
  };

  const updateOverallLogNotes = (notes: string) => {
    setCurrentLog(prev => prev ? { ...prev, notes } : null);
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
    saveCurrentLog,
    updateOverallLogNotes,
    fetchAndSetLastPerformance
  };
};
