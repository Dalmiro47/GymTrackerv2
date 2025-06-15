
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
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
  const [isDeletingLog, setIsDeletingLog] = useState(false);

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
    if (!user?.id || !exerciseId) {
        console.warn(`[HOOK] fetchAndSetLastPerformance called with invalid userId (${user?.id}) or exerciseId (${exerciseId})`);
        return null;
    }
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
        let logRoutineId: string | undefined = undefined;
        let logRoutineName: string | undefined = undefined;

        if (fetchedLog) { // If a log exists for this date
            logRoutineId = fetchedLog.routineId;
            logRoutineName = fetchedLog.routineName;

            if (fetchedLog.routineId) { // Log was based on a routine
                let routineDetails: Routine | null | undefined = availableRoutines.find(r => r.id === fetchedLog.routineId);
                if (!routineDetails && user?.id) {
                    routineDetails = await getRoutineById(user.id, fetchedLog.routineId);
                }

                if (routineDetails) {
                    logRoutineName = routineDetails.name;
                    finalExercises = await Promise.all(routineDetails.exercises.map(async (routineEx, index) => {
                        const loggedVersionForThisDate = fetchedLog.exercises.find(loggedEx => loggedEx.exerciseId === routineEx.id);
                        const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id); // For display AND pre-fill
                        
                        let setsForCurrentDay: LoggedSet[];
                        if (loggedVersionForThisDate?.sets && loggedVersionForThisDate.sets.length > 0) {
                            // Use sets already recorded for THIS specific date log
                            setsForCurrentDay = loggedVersionForThisDate.sets.map(s => ({...s, id: s.id || `set-${dateId}-${routineEx.id}-${index}-${Date.now()}`}));
                        } else if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                            // Pre-fill with last performance if no sets for this specific date log yet
                            setsForCurrentDay = lastPerformanceEntry.sets.map((s, i) => ({ id: `set-${dateId}-${routineEx.id}-${i}-${Date.now()}`, reps: s.reps, weight: s.weight }));
                        } else {
                            // Default to one empty set if nothing else
                            setsForCurrentDay = [{ id: `set-${dateId}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
                        }
                        
                        return {
                            id: loggedVersionForThisDate?.id || `${routineEx.id}-${dateId}-${index}`,
                            exerciseId: routineEx.id,
                            name: routineEx.name,
                            muscleGroup: routineEx.muscleGroup,
                            exerciseSetup: loggedVersionForThisDate?.exerciseSetup || routineEx.exerciseSetup || '',
                            sets: setsForCurrentDay,
                            notes: loggedVersionForThisDate?.notes || '',
                            lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry),
                        };
                    }));
                } else { // Routine not found, but log exists. Use exercises from the fetched log directly.
                    finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                        const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                        return {...ex, lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), sets: ex.sets.map(s => ({...s, id: s.id || `set-${dateId}-${ex.exerciseId}-${Date.now()}`})) };
                    }));
                }
            } else { // Log exists, but no routineId. Use exercises from the fetched log directly.
                 finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                    const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                     // Ensure sets from fetchedLog are used, not overwritten by lastPerformance for prefill
                    const setsForCurrentDay = ex.sets.map(s => ({...s, id: s.id || `set-${dateId}-${ex.exerciseId}-${Date.now()}`}));
                    return {
                        ...ex,
                        sets: setsForCurrentDay,
                        lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry)
                    };
                }));
            }
        }
        // If no fetchedLog, finalExercises remains empty, new log will be created.

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
  }, [user?.id, toast, availableRoutines, fetchAndSetLastPerformance]);

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
    if (user?.id && !authIsLoading && !isLoadingRoutines && !isLoadingExercises) {
        loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
        const dateIdForEmpty = format(selectedDate, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        setIsLoadingLog(false);
    }
  }, [selectedDate, user, authIsLoading, isLoadingRoutines, isLoadingExercises, loadLogForDate]);

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    // console.log(`[HOOK] handleSelectRoutine: Selected routine ${selectedRoutine.name} (ID: ${selectedRoutine.id})`);
    // console.log(`[HOOK] Exercises in selected routine ${selectedRoutine.name}:`, selectedRoutine.exercises.map(e => `Name: ${e.name}, ID: ${e.id}`));

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id);
            // console.log(`[HOOK] handleSelectRoutine - For ${routineEx.name} (ID: ${routineEx.id}), lastPerformanceEntry:`, JSON.stringify(lastPerformanceEntry));

            let initialSets: LoggedSet[];
            if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                initialSets = lastPerformanceEntry.sets.map((s, i) => ({
                    id: `set-${dateOfLog}-${routineEx.id}-${i}-${Date.now()}`,
                    reps: s.reps,
                    weight: s.weight,
                }));
            } else {
                initialSets = [{ id: `set-${dateOfLog}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
            }
            // console.log(`[HOOK] handleSelectRoutine - Derived initialSets for ${routineEx.name}:`, JSON.stringify(initialSets));
            return {
                id: `${routineEx.id}-${dateOfLog}-${index}`,
                exerciseId: routineEx.id,
                name: routineEx.name,
                muscleGroup: routineEx.muscleGroup,
                exerciseSetup: routineEx.exerciseSetup || '',
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

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${dateOfLog}-${Date.now()}`, // Ensure unique ID for dnd-kit
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
    console.log('[HOOK] saveCurrentLog: Initiated.');

    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      console.error('[HOOK] saveCurrentLog: Aborted - No user or currentLog.');
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
                  id: s.id, // Keep existing ID for the set
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };

      console.log('[HOOK] saveCurrentLog: logToSave prepared:', JSON.stringify(logToSave, null, 2));

      console.log('[HOOK] saveCurrentLog: Starting loop to save performance entries.');
      for (const loggedEx of logToSave.exercises) {
        console.log(`[HOOK] saveCurrentLog: Processing exercise for performance entry - Name: ${loggedEx.name}, Exercise ID: ${loggedEx.exerciseId}`);
        const validSetsForPerfEntry = loggedEx.sets.filter(s => (s.reps != null && Number(s.reps) > 0) || (s.weight != null && Number(s.weight) > 0));

        console.log(`[HOOK] saveCurrentLog: Valid sets for ${loggedEx.name}:`, JSON.stringify(validSetsForPerfEntry));

        if (validSetsForPerfEntry.length > 0) {
          try {
            console.log(`[HOOK] saveCurrentLog: Calling savePerformanceEntryService for ${loggedEx.name} (Exercise ID: ${loggedEx.exerciseId})`);
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, validSetsForPerfEntry);
            console.log(`[HOOK] saveCurrentLog: Successfully saved performance entry for ${loggedEx.name}`);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
          }
        } else {
          console.log(`[HOOK] saveCurrentLog: No valid sets to save performance entry for ${loggedEx.name}`);
        }
      }
      console.log('[HOOK] saveCurrentLog: Finished loop for performance entries.');

      const shouldSaveMainLog = logToSave.exercises.length > 0 || (logToSave.notes && logToSave.notes.trim() !== '');
      console.log(`[HOOK] saveCurrentLog: Condition to save main log is ${shouldSaveMainLog}. Exercises count: ${logToSave.exercises.length}, Notes: "${logToSave.notes}"`);

      if (shouldSaveMainLog) {
        console.log('[HOOK] saveCurrentLog: Proceeding to save main workout log.');
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
        console.log('[HOOK] saveCurrentLog: Main workout log saved successfully.');
      } else {
        toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
        console.log('[HOOK] saveCurrentLog: Main workout log not saved - empty content.');
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
      console.error('[HOOK] saveCurrentLog: General error during save process:', error);
    } finally {
      setIsSavingLog(false);
      if (currentLog && user?.id) { // Refresh last performance after attempting save
        // console.log('[HOOK] saveCurrentLog: Refreshing last performance for all exercises in current log post-save.');
        for (const ex of currentLog.exercises) {
          await fetchAndSetLastPerformance(ex.exerciseId);
        }
      }
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    console.log(`[HOOK] saveExerciseProgress: Initiated for ${loggedExercise.name}`);

    updateExerciseInLog(loggedExercise);

    const validSets = loggedExercise.sets.filter(s => (s.reps !== null && Number(s.reps) > 0) || (s.weight !== null && Number(s.weight) > 0));

    if (validSets.length > 0) {
      const numericSets = validSets.map(s => ({
        id: s.id,
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));
      try {
        console.log(`[HOOK] saveExerciseProgress: Calling savePerformanceEntryService for ${loggedExercise.name} (Exercise ID: ${loggedExercise.exerciseId})`);
        await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
        console.log(`[HOOK] saveExerciseProgress: Successfully saved performance entry for ${loggedExercise.name}`);
      } catch (error: any) {
        console.error(`[HOOK] saveExerciseProgress: Error saving performance entry for ${loggedExercise.name}: ${error.message}`);
        toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}.`, variant: "destructive"});
        // Do not proceed to refresh if save failed.
        return;
      }
    } else {
        console.log(`[HOOK] saveExerciseProgress: No valid sets for ${loggedExercise.name}, skipping performance entry save.`);
    }

    // console.log(`[HOOK] saveExerciseProgress: Refreshing last performance for ${loggedExercise.name}`);
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
    isDeletingLog,
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
    deleteCurrentLog,
  };
};

