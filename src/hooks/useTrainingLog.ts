
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLastLoggedPerformance as fetchLastPerformanceService, // Use direct service call
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

  // This function is now primarily for:
  // 1. Refreshing the "Last: ..." display on demand via its button.
  // 2. Providing raw ExercisePerformanceEntry to callers for pre-filling SETS on NEW log days.
  const fetchAndSetLastPerformance = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) {
        console.warn(`[HOOK] fetchAndSetLastPerformance called with invalid userId (${user?.id}) or exerciseId (${exerciseId})`);
        return null;
    }
    // console.log(`[HOOK] fetchAndSetLastPerformance called for exerciseId: ${exerciseId}`);
    const perf = await fetchLastPerformanceService(user.id, exerciseId);
    // console.log(`[HOOK] Performance data received for ${exerciseId}:`, perf ? JSON.stringify(perf) : 'null');

    // Update the display string in the currentLog if the exercise exists there
    setCurrentLog(prevLog => {
      if (!prevLog) return null;
      return {
        ...prevLog,
        exercises: prevLog.exercises.map(ex =>
          ex.exerciseId === exerciseId ? { ...ex, lastPerformanceDisplay: formatLastPerformanceDisplay(perf) } : ex
        )
      };
    });
    return perf; // Return for pre-filling sets on new log days
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
        let newCurrentLogData: WorkoutLog;

        if (fetchedLog) { // Log EXISTS for this date
            // console.log(`[HOOK] loadLogForDate: Fetched log for ${dateId}:`, JSON.stringify(fetchedLog));
            const exercisesForThisDay: LoggedExercise[] = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    // Fetch absolute latest performance ONLY for the display string
                    const latestPerformanceEntryForDisplay = await fetchLastPerformanceService(user.id, exFromStoredLog.exerciseId);
                    // console.log(`[HOOK] loadLogForDate: For exercise ${exFromStoredLog.name} (ID: ${exFromStoredLog.exerciseId}) from stored log, its sets:`, JSON.stringify(exFromStoredLog.sets));
                    // console.log(`[HOOK] loadLogForDate: For exercise ${exFromStoredLog.name}, latest perf for display:`, JSON.stringify(latestPerformanceEntryForDisplay));
                    return {
                        ...exFromStoredLog, // All props from the exercise stored in this day's log
                        // CRITICAL: Use sets from the log of THIS specific day
                        sets: exFromStoredLog.sets.map((s, idx) => ({...s, id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`})),
                        lastPerformanceDisplay: formatLastPerformanceDisplay(latestPerformanceEntryForDisplay), // Display absolute latest for reference
                    };
                })
            );
            newCurrentLogData = {
                ...fetchedLog, // Includes id, date, notes, routineId, routineName from fetchedLog
                exercises: exercisesForThisDay,
            };
            // console.log(`[HOOK] loadLogForDate: Constructed newCurrentLogData from fetchedLog:`, JSON.stringify(newCurrentLogData));
        } else { // NO log exists for this date - it's a new day or unlogged day
            // console.log(`[HOOK] loadLogForDate: No log found for ${dateId}. Initializing new log.`);
            newCurrentLogData = {
                id: dateId,
                date: dateId,
                exercises: [], // Start with empty exercises; routine/manual add will populate using latest performance
                notes: '',
            };
        }
        setCurrentLog(newCurrentLogData);

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: error.message, variant: "destructive" });
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' }); // Fallback to empty log on error
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast]); // Removed fetchAndSetLastPerformance from deps, using service directly now

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
    const currentNotes = currentLog?.notes || ''; // Preserve overall notes if any
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            // For a NEW log day, pre-fill sets from the ABSOLUTE LATEST performance
            const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id); // This also updates display string
            // console.log(`[HOOK] handleSelectRoutine - For ${routineEx.name} (ID: ${routineEx.id}), lastPerformanceEntry:`, JSON.stringify(lastPerformanceEntry));

            let initialSets: LoggedSet[];
            if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                initialSets = lastPerformanceEntry.sets.map((s, i) => ({
                    id: `set-${dateOfLog}-${routineEx.id}-${i}-${Date.now()}`, // New ID for this log instance
                    reps: s.reps,
                    weight: s.weight,
                }));
            } else {
                initialSets = [{ id: `set-${dateOfLog}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
            }
            // console.log(`[HOOK] handleSelectRoutine - Derived initialSets for ${routineEx.name}:`, JSON.stringify(initialSets));
            return {
                id: `${routineEx.id}-${dateOfLog}-${index}-${Date.now()}`, // Unique ID for dnd-kit for this log instance
                exerciseId: routineEx.id,
                name: routineEx.name,
                muscleGroup: routineEx.muscleGroup,
                exerciseSetup: routineEx.exerciseSetup || '',
                sets: initialSets,
                notes: '',
                lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), // Already updated by fetchAndSetLastPerformance
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
    // For a NEW log day, pre-fill sets from the ABSOLUTE LATEST performance
    const lastPerformanceEntry = await fetchAndSetLastPerformance(exercise.id); // Also updates display string

    let initialSets: LoggedSet[];
    if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
        initialSets = lastPerformanceEntry.sets.map((s, i) => ({
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`, // New ID for this log instance
            reps: s.reps,
            weight: s.weight,
        }));
    } else {
        initialSets = [{ id: `set-${dateOfLog}-${exercise.id}-0-${Date.now()}`, reps: null, weight: null }];
    }

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${dateOfLog}-${Date.now()}`, // Unique ID for dnd-kit
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      exerciseSetup: exercise.exerciseSetup || '',
      sets: initialSets,
      notes: '',
      lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), // Already updated
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
    // console.log('[HOOK] saveCurrentLog: Initiated.');
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      // console.error('[HOOK] saveCurrentLog: Aborted - No user or currentLog.');
      return;
    }
    setIsSavingLog(true);
    try {
      const logToSave: WorkoutLog = {
        ...currentLog,
        exercises: currentLog.exercises
          .map(ex => ({
              id: ex.id, // Persist the DND-kit friendly ID for the LoggedExercise instance
              exerciseId: ex.exerciseId,
              name: ex.name,
              muscleGroup: ex.muscleGroup,
              exerciseSetup: ex.exerciseSetup || '',
              notes: ex.notes || '',
              // lastPerformanceDisplay is purely UI, not saved in the log itself.
              sets: ex.sets.map(s => ({
                  id: s.id, // Keep existing ID for the set instance
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };
      // console.log('[HOOK] saveCurrentLog: logToSave prepared:', JSON.stringify(logToSave, null, 2));

      // console.log('[HOOK] saveCurrentLog: Starting loop to save performance entries.');
      for (const loggedEx of logToSave.exercises) {
        // console.log(`[HOOK] saveCurrentLog: Processing exercise for performance entry - Name: ${loggedEx.name}, Exercise ID: ${loggedEx.exerciseId}`);
        const validSetsForPerfEntry = loggedEx.sets.filter(s => (s.reps != null && Number(s.reps) > 0) || (s.weight != null && Number(s.weight) > 0));
        // console.log(`[HOOK] saveCurrentLog: Valid sets for ${loggedEx.name}:`, JSON.stringify(validSetsForPerfEntry));

        if (validSetsForPerfEntry.length > 0) {
          try {
            // console.log(`[HOOK] saveCurrentLog: Calling savePerformanceEntryService for ${loggedEx.name} (Exercise ID: ${loggedEx.exerciseId})`);
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, validSetsForPerfEntry);
            // console.log(`[HOOK] saveCurrentLog: Successfully saved performance entry for ${loggedEx.name}`);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
          }
        } else {
          // console.log(`[HOOK] saveCurrentLog: No valid sets to save performance entry for ${loggedEx.name}`);
        }
      }
      // console.log('[HOOK] saveCurrentLog: Finished loop for performance entries.');

      const shouldSaveMainLog = logToSave.exercises.length > 0 || (logToSave.notes && logToSave.notes.trim() !== '');
      // console.log(`[HOOK] saveCurrentLog: Condition to save main log is ${shouldSaveMainLog}. Exercises count: ${logToSave.exercises.length}, Notes: "${logToSave.notes}"`);

      if (shouldSaveMainLog) {
        // console.log('[HOOK] saveCurrentLog: Proceeding to save main workout log.');
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
        // console.log('[HOOK] saveCurrentLog: Main workout log saved successfully.');
      } else {
        toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
        // console.log('[HOOK] saveCurrentLog: Main workout log not saved - empty content.');
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
      console.error('[HOOK] saveCurrentLog: General error during save process:', error);
    } finally {
      setIsSavingLog(false);
      // After saving, reload the log for the current date to ensure UI consistency
      // This will also refresh lastPerformanceDisplay strings based on new performanceEntries
      if (user?.id) {
        // console.log('[HOOK] saveCurrentLog: Reloading log for date to refresh displays.');
        await loadLogForDate(selectedDate);
      }
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    // console.log(`[HOOK] saveExerciseProgress: Initiated for ${loggedExercise.name}`);

    // Optimistically update the local state first
    updateExerciseInLog(loggedExercise);

    const validSets = loggedExercise.sets.filter(s => (s.reps !== null && Number(s.reps) > 0) || (s.weight !== null && Number(s.weight) > 0));

    if (validSets.length > 0) {
      const numericSets = validSets.map(s => ({
        id: s.id, // Pass the set ID
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));
      try {
        // console.log(`[HOOK] saveExerciseProgress: Calling savePerformanceEntryService for ${loggedExercise.name} (Exercise ID: ${loggedExercise.exerciseId})`);
        await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
        // console.log(`[HOOK] saveExerciseProgress: Successfully saved performance entry for ${loggedExercise.name}`);
      } catch (error: any) {
        console.error(`[HOOK] saveExerciseProgress: Error saving performance entry for ${loggedExercise.name}: ${error.message}`);
        toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}. ${error.message}`, variant: "destructive"});
        return; // Do not proceed to refresh if save failed.
      }
    } else {
        // console.log(`[HOOK] saveExerciseProgress: No valid sets for ${loggedExercise.name}, skipping performance entry save.`);
    }

    // Refresh the "Last: ..." display for this specific exercise after saving its progress
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
      // Reset currentLog to a fresh state for the selected date
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
    fetchAndSetLastPerformance, // Expose for on-demand refresh
    deleteCurrentLog,
  };
};

    
