
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLastLoggedPerformance as fetchPerformanceEntryService, 
  saveExercisePerformanceEntry as savePerformanceEntryService,
  getLoggedDateStrings as fetchLoggedDateStringsService,
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
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

  const [loggedDayStrings, setLoggedDayStrings] = useState<string[]>([]);
  const [isLoadingLoggedDayStrings, setIsLoadingLoggedDayStrings] = useState(true);

  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');

  // Helper to format PR display
  const formatPersonalRecordDisplay = (pr: PersonalRecord | null): string => {
    if (!pr || (pr.reps === 0 && pr.weight === 0)) return "PR: N/A";
    return `PR: ${pr.reps}x${pr.weight}kg`;
  };
  
  const fetchLoggedDates = useCallback(async () => {
    if (!user?.id) {
      setLoggedDayStrings([]);
      setIsLoadingLoggedDayStrings(false);
      return;
    }
    setIsLoadingLoggedDayStrings(true);
    try {
      const dates = await fetchLoggedDateStringsService(user.id);
      setLoggedDayStrings(dates);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to load logged dates: ${error.message}`, variant: "destructive" });
      setLoggedDayStrings([]);
    } finally {
      setIsLoadingLoggedDayStrings(false);
    }
  }, [user?.id, toast]);

  // Fetches full performance entry (last sets + PR)
  const fetchExercisePerformanceData = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    return await fetchPerformanceEntryService(user.id, exerciseId);
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

        if (fetchedLog) {
            // console.log(`[HOOK] loadLogForDate: Fetched log for ${dateId}:`, JSON.stringify(fetchedLog));
            const exercisesForThisDay: LoggedExercise[] = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId);
                    return {
                        ...exFromStoredLog, 
                        sets: exFromStoredLog.sets.map((s, idx) => ({...s, id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`})), // Use sets from the day it was logged
                        personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                    };
                })
            );
            newCurrentLogData = {
                ...fetchedLog,
                exercises: exercisesForThisDay,
            };
        } else {
            // console.log(`[HOOK] loadLogForDate: No log found for ${dateId}. Initializing new log.`);
            newCurrentLogData = {
                id: dateId,
                date: dateId,
                exercises: [],
                notes: '',
            };
        }
        setCurrentLog(newCurrentLogData);

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: `Could not load log for ${dateId}. ${error.message}`, variant: "destructive" });
        // console.error(`[HOOK] Error in loadLogForDate for ${dateId}:`, error);
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast, fetchExercisePerformanceData, formatPersonalRecordDisplay]);

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
      
      fetchLoggedDates();
    } else {
      setAvailableRoutines([]);
      setAvailableExercises([]);
      setLoggedDayStrings([]);
      setIsLoadingRoutines(false);
      setIsLoadingExercises(false);
      setIsLoadingLoggedDayStrings(false);
    }
  }, [user?.id, toast, fetchLoggedDates]);

  useEffect(() => {
    // Only load log once user is confirmed and basic data (routines/exercises) might be ready
    // This prevents trying to load a log before user ID is available or if auth is still processing
    if (user?.id && !authIsLoading && !isLoadingRoutines && !isLoadingExercises) {
        loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
        // If no user and auth is done, reset to an empty log for the selected date
        const dateIdForEmpty = format(selectedDate, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        setIsLoadingLog(false);
    }
  }, [selectedDate, user, authIsLoading, isLoadingRoutines, isLoadingExercises, loadLogForDate]);

  // Refreshes only the PR display string for a given exercise in the current log
  const refreshPersonalRecordDisplayForExercise = useCallback(async (exerciseId: string) => {
    if (!user?.id || !currentLog) return;
    const performanceEntry = await fetchExercisePerformanceData(exerciseId);
    setCurrentLog(prevLog => {
      if (!prevLog) return null;
      return {
        ...prevLog,
        exercises: prevLog.exercises.map(ex =>
          ex.exerciseId === exerciseId
            ? { ...ex, personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null) }
            : ex
        )
      };
    });
  }, [user?.id, currentLog, fetchExercisePerformanceData, formatPersonalRecordDisplay]);


  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const performanceEntry = await fetchExercisePerformanceData(routineEx.id);
            let initialSets: LoggedSet[];

            if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
                initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
                    id: `set-${dateOfLog}-${routineEx.id}-${i}-${Date.now()}`,
                    reps: s.reps, 
                    weight: s.weight,
                }));
            } else { 
                initialSets = [{ id: `set-${dateOfLog}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
            }

            return {
                id: `${routineEx.id}-${dateOfLog}-${index}-${Date.now()}`, 
                exerciseId: routineEx.id,
                name: routineEx.name,
                muscleGroup: routineEx.muscleGroup,
                exerciseSetup: routineEx.exerciseSetup || '',
                sets: initialSets,
                notes: '',
                personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
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
    const performanceEntry = await fetchExercisePerformanceData(exercise.id);
    let initialSets: LoggedSet[];

    if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
        initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`,
            reps: s.reps,
            weight: s.weight,
        }));
    } else {
        initialSets = [{ id: `set-${dateOfLog}-${exercise.id}-0-${Date.now()}`, reps: null, weight: null }];
    }

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${dateOfLog}-${Date.now()}`,
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      exerciseSetup: exercise.exerciseSetup || '',
      sets: initialSets,
      notes: '',
      personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
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
      // This is the payload for the daily workout log document
      const logToSave: WorkoutLog = {
        ...currentLog, // Includes id (dateId), date, notes, routineId, routineName
        exercises: currentLog.exercises // These are LoggedExercise[] from the UI
          .map(ex => ({
              // Transform to a simplified structure for the daily log, if needed, or keep full
              id: ex.id, // ID of this exercise instance in this log
              exerciseId: ex.exerciseId, // Reference to the base Exercise
              name: ex.name,
              muscleGroup: ex.muscleGroup,
              exerciseSetup: ex.exerciseSetup || '',
              // personalRecordDisplay is UI only, not stored in the daily log document.
              notes: ex.notes || '', // Notes specific to this exercise on this day
              sets: ex.sets.map(s => ({ // Sets as performed on this day
                  id: s.id, 
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };
      // console.log('[HOOK] saveCurrentLog: logToSave prepared:', JSON.stringify(logToSave, null, 2));

      // Save performance entry (last sets + PR) for each exercise in the log
      for (const loggedEx of logToSave.exercises) {
        const setsForPerformanceEntry = loggedEx.sets; // These are already numeric from the map above
        if (setsForPerformanceEntry.length > 0) { // Only save if there are sets
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, setsForPerformanceEntry);
            // console.log(`[HOOK] saveCurrentLog: Performance entry for ${loggedEx.name} potentially updated.`);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
            // Decide if this should prevent the main log save or just be a warning
          }
        }
      }
      
      // Determine if the main log document itself should be saved (e.g., if it has exercises or notes)
      const shouldSaveMainLog = logToSave.exercises.length > 0 || (logToSave.notes != null && logToSave.notes.trim() !== '');
      // console.log(`[HOOK] saveCurrentLog: Condition to save main log is ${shouldSaveMainLog}. Exercises count: ${logToSave.exercises.length}, Notes: "${logToSave.notes}"`);


      if (shouldSaveMainLog) {
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
        // console.log('[HOOK] saveCurrentLog: Main workout log saved successfully.');
        await fetchLoggedDates(); // Update calendar indicators
      } else {
        // If the log was empty and there was an existing log for this day, delete it.
        const existingLog = await fetchLogService(user.id, formattedDateId);
        if (existingLog) {
            await deleteLogService(user.id, formattedDateId);
            toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
            // console.log(`[HOOK] saveCurrentLog: Existing empty log for ${formattedDateId} cleared.`);
            await fetchLoggedDates();
        } else {
            toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
            // console.log('[HOOK] saveCurrentLog: Main workout log not saved - empty content, and no prior log to clear.');
        }
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
      // console.error('[HOOK] saveCurrentLog: General error during save process:', error);
    } finally {
      setIsSavingLog(false);
      // After saving (or attempting to), reload the log for the current date.
      // This ensures the UI reflects the saved state and PRs are up-to-date.
      if (user?.id) {
        await loadLogForDate(selectedDate); 
      }
    }
  };

  // Saves progress for a single exercise card (updates performance entry and PR display)
  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    
    // Update local state immediately for responsiveness
    updateExerciseInLog(loggedExercise); 

    const numericSets = loggedExercise.sets.map(s => ({
      id: s.id,
      reps: Number(s.reps ?? 0),
      weight: Number(s.weight ?? 0)
    }));
    
    try {
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
      // console.log(`[HOOK] saveExerciseProgress: Successfully saved performance entry for ${loggedExercise.name}`);
      await refreshPersonalRecordDisplayForExercise(loggedExercise.exerciseId); // Update PR display
    } catch (error: any) {
      // console.error(`[HOOK] saveExerciseProgress: Error saving performance entry for ${loggedExercise.name}: ${error.message}`);
      toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}. ${error.message}`, variant: "destructive"});
      return; 
    }
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
      // Reset currentLog to an empty state for this date
      setCurrentLog({
        id: formattedDateId,
        date: formattedDateId,
        exercises: [],
        notes: '',
        routineId: undefined,
        routineName: undefined,
      });
      toast({ title: "Log Deleted", description: `Workout for ${formattedDateId} has been deleted.` });
      await fetchLoggedDates(); // Update calendar indicators
    } catch (error: any) {
      toast({ title: "Error Deleting Log", description: `Could not delete log. ${error.message}`, variant: "destructive" });
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
    loggedDayStrings, 
    isLoadingLoggedDayStrings,
    handleSelectRoutine,
    addExerciseToLog,
    removeExerciseFromLog,
    reorderExercisesInLog,
    updateExerciseInLog,
    saveExerciseProgress,
    saveCurrentLog,
    updateOverallLogNotes,
    refreshPersonalRecordDisplayForExercise, 
    deleteCurrentLog,
  };
};

