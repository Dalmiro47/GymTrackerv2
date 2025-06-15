
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLastLoggedPerformance as fetchLastPerformanceService,
  saveExercisePerformanceEntry as savePerformanceEntryService,
  getLoggedDateStrings as fetchLoggedDateStringsService, // New service import
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

  const formatLastPerformanceDisplay = (perf: ExercisePerformanceEntry | null): string => {
    if (!perf || perf.sets.length === 0) return "No previous data";
    return perf.sets.map(s => `${s.reps ?? '0'}x${s.weight ?? '0'}kg`).join(', ');
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


  const fetchAndSetLastPerformance = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    const perf = await fetchLastPerformanceService(user.id, exerciseId);
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
        let newCurrentLogData: WorkoutLog;

        if (fetchedLog) {
            console.log(`[HOOK] loadLogForDate: Fetched log for ${dateId}:`, JSON.stringify(fetchedLog));
            const exercisesForThisDay: LoggedExercise[] = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const latestPerformanceEntryForDisplay = await fetchLastPerformanceService(user.id, exFromStoredLog.exerciseId);
                    return {
                        ...exFromStoredLog,
                        sets: exFromStoredLog.sets.map((s, idx) => ({...s, id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`})),
                        lastPerformanceDisplay: formatLastPerformanceDisplay(latestPerformanceEntryForDisplay),
                    };
                })
            );
            newCurrentLogData = {
                ...fetchedLog,
                exercises: exercisesForThisDay,
            };
        } else {
            console.log(`[HOOK] loadLogForDate: No log found for ${dateId}. Initializing new log.`);
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
        console.error(`[HOOK] Error in loadLogForDate for ${dateId}:`, error);
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast]);

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
      
      fetchLoggedDates(); // Fetch logged dates when user is available
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

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id);
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
            return {
                id: `${routineEx.id}-${dateOfLog}-${index}-${Date.now()}`,
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
      id: `${exercise.id}-${dateOfLog}-${Date.now()}`,
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
              id: ex.id,
              exerciseId: ex.exerciseId,
              name: ex.name,
              muscleGroup: ex.muscleGroup,
              exerciseSetup: ex.exerciseSetup || '',
              notes: ex.notes || '',
              sets: ex.sets.map(s => ({
                  id: s.id, 
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };
      console.log('[HOOK] saveCurrentLog: logToSave prepared:', JSON.stringify(logToSave, null, 2));

      for (const loggedEx of logToSave.exercises) {
        const validSetsForPerfEntry = loggedEx.sets.filter(s => (s.reps != null && Number(s.reps) > 0) || (s.weight != null && Number(s.weight) > 0));
        if (validSetsForPerfEntry.length > 0) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, validSetsForPerfEntry);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
          }
        }
      }
      
      const shouldSaveMainLog = logToSave.exercises.length > 0 || (logToSave.notes != null && logToSave.notes.trim() !== '');
      console.log(`[HOOK] saveCurrentLog: Condition to save main log is ${shouldSaveMainLog}. Exercises count: ${logToSave.exercises.length}, Notes: "${logToSave.notes}"`);


      if (shouldSaveMainLog) {
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
        console.log('[HOOK] saveCurrentLog: Main workout log saved successfully.');
        await fetchLoggedDates(); // Refresh logged dates after saving
      } else {
        toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
        console.log('[HOOK] saveCurrentLog: Main workout log not saved - empty content.');
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
      console.error('[HOOK] saveCurrentLog: General error during save process:', error);
    } finally {
      setIsSavingLog(false);
      if (user?.id) {
        await loadLogForDate(selectedDate);
      }
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) return;
    updateExerciseInLog(loggedExercise);
    const validSets = loggedExercise.sets.filter(s => (s.reps !== null && Number(s.reps) > 0) || (s.weight !== null && Number(s.weight) > 0));

    if (validSets.length > 0) {
      const numericSets = validSets.map(s => ({
        id: s.id,
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));
      try {
        await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
      } catch (error: any) {
        console.error(`[HOOK] saveExerciseProgress: Error saving performance entry for ${loggedExercise.name}: ${error.message}`);
        toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}. ${error.message}`, variant: "destructive"});
        return; 
      }
    }
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
      await fetchLoggedDates(); // Refresh logged dates after deleting
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
    loggedDayStrings, // Expose string dates
    isLoadingLoggedDayStrings,
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

    
