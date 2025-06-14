
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService, // New import
  getLastLoggedPerformance as fetchLastPerformanceService,
  saveExercisePerformanceEntry as savePerformanceEntryService
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
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [isDeletingLog, setIsDeletingLog] = useState(false); // New state

  const [availableRoutines, setAvailableRoutines] = useState<Routine[]>([]);
  const [isLoadingRoutines, setIsLoadingRoutines] = useState(true);

  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);

  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');

  const formatLastPerformanceDisplay = (perf: ExercisePerformanceEntry | null): string => {
    if (!perf || perf.sets.length === 0) return "No previous data";
    return perf.sets.map(s => `${s.reps ?? '0'}x${s.weight ?? '0'}kg`).join(', ');
  };

  const fetchAndSetLastPerformance = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    // console.log(`[HOOK] fetchAndSetLastPerformance called for exerciseId: ${exerciseId}`);
    const perf = await fetchLastPerformanceService(user.id, exerciseId);
    // console.log(`[HOOK] Performance data received for ${exerciseId}:`, perf ? JSON.stringify(perf) : 'null');
    
    setCurrentLog(prevLog => {
      if (!prevLog) return null;
      return {
        ...prevLog,
        exercises: prevLog.exercises.map(ex =>
          ex.exerciseId === exerciseId ? { ...ex, lastPerformanceDisplay: formatLastPerformanceDisplay(perf) } : ex
        )
      };
    });
    return perf;
  }, [user?.id]);


  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    if (!user?.id) {
        setIsLoadingLog(false);
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
        return;
    }

    setIsLoadingLog(true);
    try {
        const fetchedLog = await fetchLogService(user.id, dateId);
        let finalExercises: LoggedExercise[] = [];
        let logRoutineId: string | undefined = fetchedLog?.routineId;
        let logRoutineName: string | undefined = fetchedLog?.routineName;

        if (logRoutineId) {
            let routineDetails: Routine | null | undefined = availableRoutines.find(r => r.id === logRoutineId);
            if (!routineDetails && !isLoadingRoutines && user?.id) {
                 // console.log(`[HOOK] Routine ${logRoutineId} not in availableRoutines, fetching directly.`);
                routineDetails = await getRoutineById(user.id, logRoutineId);
            }

            if (routineDetails) {
                // console.log(`[HOOK] Routine ${routineDetails.name} found for log. Populating exercises.`);
                logRoutineName = routineDetails.name;
                finalExercises = await Promise.all(routineDetails.exercises.map(async (routineEx, index) => {
                    const loggedVersionForThisDate = fetchedLog?.exercises.find(loggedEx => loggedEx.exerciseId === routineEx.id);
                    const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id);

                    let setsForCurrentLog: LoggedSet[];
                    if (loggedVersionForThisDate?.sets && loggedVersionForThisDate.sets.length > 0) {
                        setsForCurrentLog = loggedVersionForThisDate.sets.map(s => ({...s, id: s.id || `set-${dateId}-${routineEx.id}-${index}-${Date.now()}`}));
                    } else if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                        setsForCurrentLog = lastPerformanceEntry.sets.map((s, i) => ({
                            id: `set-${dateId}-${routineEx.id}-${i}-${Date.now()}`,
                            reps: s.reps,
                            weight: s.weight,
                        }));
                    } else {
                        setsForCurrentLog = [{ id: `set-${dateId}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
                    }

                    return {
                        id: loggedVersionForThisDate?.id || `${routineEx.id}-${dateId}-${index}`,
                        exerciseId: routineEx.id,
                        name: routineEx.name,
                        muscleGroup: routineEx.muscleGroup,
                        exerciseSetup: routineEx.exerciseSetup || '',
                        sets: setsForCurrentLog,
                        notes: loggedVersionForThisDate?.notes || '',
                        lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry),
                    };
                }));
            } else if (fetchedLog) { // Routine details not found, but log exists
                 // console.log(`[HOOK] Routine details for ${logRoutineId} not found, but fetchedLog exists. Using exercises from fetchedLog.`);
                 finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                    const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                    return {...ex, exerciseSetup: ex.exerciseSetup || '', lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), sets: ex.sets.map(s => ({...s, id: s.id || `set-${dateId}-${ex.exerciseId}-${Date.now()}`})) };
                 }));
            }
        } else if (fetchedLog) { // Log exists, no routineId
            // console.log(`[HOOK] Log found for ${dateId}, no routineId. Using exercises from fetchedLog.`);
             finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                return {...ex, exerciseSetup: ex.exerciseSetup || '', lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), sets: ex.sets.map(s => ({...s, id: s.id || `set-${dateId}-${ex.exerciseId}-${Date.now()}`})) };
             }));
        }
        // If no fetchedLog and no routineId, finalExercises remains empty (new log).

        setCurrentLog({
            id: dateId,
            date: dateId,
            routineId: logRoutineId,
            routineName: logRoutineName,
            exercises: finalExercises,
            notes: fetchedLog?.notes || '',
        });

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: error.message, variant: "destructive" });
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast, availableRoutines, isLoadingRoutines, fetchAndSetLastPerformance]);
  
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

  useEffect(() => {
    // console.log(`[HOOK] useEffect for date/user/loading states triggered. Date: ${selectedDate}, User ID: ${user?.id}, Auth Loading: ${authIsLoading}, Routines Loading: ${isLoadingRoutines}, Exercises Loading: ${isLoadingExercises}`);
    if (user?.id && !authIsLoading && !isLoadingRoutines && !isLoadingExercises) {
        // console.log("[HOOK] Conditions met to load log for date.");
        loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
        // console.log("[HOOK] No user and not auth loading. Setting empty log.");
        const dateIdForEmpty = format(selectedDate, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        setIsLoadingLog(false);
    }
  }, [selectedDate, user, authIsLoading, isLoadingRoutines, isLoadingExercises, loadLogForDate]);

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) {
        // console.log(`[HOOK] handleSelectRoutine: Routine with ID ${routineId} not found in availableRoutines.`);
        return;
    }
    // console.log(`[HOOK] handleSelectRoutine: Selected routine ${selectedRoutine.name}`);

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (ex, index) => {
            const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.id);
            // console.log(`[HOOK] handleSelectRoutine - Processing exercise from routine: ${ex.name} (ID: ${ex.id})`);
            // console.log(`[HOOK] handleSelectRoutine - Fetched lastPerformanceEntry.sets for ${ex.name}:`, JSON.stringify(lastPerformanceEntry?.sets));

            let initialSets: LoggedSet[];
            if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                initialSets = lastPerformanceEntry.sets.map((s, i) => ({
                    id: `set-${dateOfLog}-${ex.id}-${i}-${Date.now()}`, // Ensure unique ID for new log context
                    reps: s.reps,
                    weight: s.weight,
                }));
            } else {
                initialSets = [{ id: `set-${dateOfLog}-${ex.id}-0-${Date.now()}`, reps: null, weight: null }];
            }
            // console.log(`[HOOK] handleSelectRoutine - Derived initialSets for ${ex.name}:`, JSON.stringify(initialSets));
            return {
                id: `${ex.id}-${dateOfLog}-${index}`, // Unique ID for this instance in the log
                exerciseId: ex.id,
                name: ex.name,
                muscleGroup: ex.muscleGroup,
                exerciseSetup: ex.exerciseSetup || '',
                sets: initialSets,
                notes: '',
                lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry),
            };
        })
    );

    setCurrentLog({
      id: dateOfLog,
      date: dateOfLog,
      routineId: selectedRoutine.id,
      routineName: selectedRoutine.name,
      exercises: exercisesFromRoutine,
      notes: currentNotes,
    });
  };

  const addExerciseToLog = async (exercise: Exercise) => {
    if (!currentLog || !user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const lastPerformanceEntry = await fetchAndSetLastPerformance(exercise.id);

    // console.log(`[HOOK] addExerciseToLog - Processing exercise: ${exercise.name} (ID: ${exercise.id})`);
    // console.log(`[HOOK] addExerciseToLog - Fetched lastPerformanceEntry.sets for ${exercise.name}:`, JSON.stringify(lastPerformanceEntry?.sets));

    let initialSets: LoggedSet[];
    if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
        initialSets = lastPerformanceEntry.sets.map((s, i) => ({
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`,
            reps: s.reps,
            weight: s.weight,
        }));
    } else {
        initialSets = [{ id: `set-${dateOfLog}-${exercise.id}-0-${Date.now()}`, reps: null, weight: null }];
    }
    // console.log(`[HOOK] addExerciseToLog - Derived initialSets for ${exercise.name}:`, JSON.stringify(initialSets));

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${Date.now()}`,
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      exerciseSetup: exercise.exerciseSetup || '',
      sets: initialSets,
      notes: '',
      lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry),
    };
    setCurrentLog(prev => prev ? { ...prev, exercises: [...prev.exercises, newLoggedExercise] } : null);
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
          .map(ex => ({
              ...ex,
              sets: ex.sets.map(s => ({
                  id: s.id, // Keep the set ID
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };
      
      // console.log('[HOOK] saveCurrentLog: logToSave prepared:', JSON.stringify(logToSave, null, 2));

      // Save performance entry for each exercise in the log that has valid data
      for (const loggedEx of logToSave.exercises) {
        const validSetsForPerfEntry = loggedEx.sets.filter(s => (s.reps > 0) || (s.weight > 0));
        if (validSetsForPerfEntry.length > 0) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, validSetsForPerfEntry);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
            // Optionally, decide if this should stop the whole log save or just log an error and continue
          }
        }
      }

      // Only save the log if there are exercises or notes
      if (logToSave.exercises.length > 0 || (logToSave.notes && logToSave.notes.trim() !== '')) {
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
        toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
      // Refresh last performance for all exercises in the current log after save attempt
      if (currentLog) {
        for (const ex of currentLog.exercises) {
          await fetchAndSetLastPerformance(ex.exerciseId);
        }
      }
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;

    // 1. Update the local state of currentLog with the modified sets for this exercise
    updateExerciseInLog(loggedExercise);

    // 2. Save/Update the performance entry for this specific exercise (for "last performance" tracking)
    // Only save if there are actual reps or weight recorded.
    const validSets = loggedExercise.sets.filter(s => (s.reps !== null && Number(s.reps) > 0) || (s.weight !== null && Number(s.weight) > 0));
    
    if (validSets.length > 0) {
      const numericSets = validSets.map(s => ({
        id: s.id, // Keep the set ID
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
    }
    
    // 3. Refresh the "lastPerformanceDisplay" for this exercise specifically
    await fetchAndSetLastPerformance(loggedExercise.exerciseId);
  };

  const updateOverallLogNotes = (notes: string) => {
    setCurrentLog(prev => prev ? { ...prev, notes } : null);
  };

  const deleteCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to delete.", variant: "destructive" });
      return;
    }
    setIsDeletingLog(true);
    try {
      await deleteLogService(user.id, formattedDateId);
      // Reset currentLog to an empty state for the selected date
      setCurrentLog({
        id: formattedDateId,
        date: formattedDateId,
        exercises: [],
        notes: '',
        routineId: undefined,
        routineName: undefined,
      });
      toast({ title: "Log Deleted", description: `Workout for ${formattedDateId} has been deleted.` });
    } catch (error: any) {
      toast({ title: "Error Deleting Log", description: error.message, variant: "destructive" });
    } finally {
      setIsDeletingLog(false);
    }
  };


  return {
    selectedDate,
    setSelectedDate,
    currentLog,
    isLoadingLog,
    isSavingLog,
    isDeletingLog, // Expose new state
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
    fetchAndSetLastPerformance,
    deleteCurrentLog, // Expose new function
  };
};
