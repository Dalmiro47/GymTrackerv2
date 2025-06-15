
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
  updatePerformanceEntryOnLogDelete, // Changed from clearPersonalRecordIfSourcedFromLog
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format, parseISO } from 'date-fns';
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

  const formatPersonalRecordDisplay = useCallback((pr: PersonalRecord | null): string => {
    if (!pr || (pr.reps === 0 && pr.weight === 0 && !pr.logId)) return "PR: N/A";
    const repsDisplay = pr.reps ?? 'N/A';
    const weightDisplay = pr.weight ?? 'N/A';
    return `PR: ${repsDisplay}x${weightDisplay}kg`;
  }, []);
  
  const fetchLoggedDates = useCallback(async () => {
    if (!user?.id) {
      setLoggedDayStrings([]);
      setIsLoadingLoggedDayStrings(false);
      return;
    }
    setIsLoadingLoggedDayStrings(true);
    console.log("[HOOK] fetchLoggedDates: Fetching for user:", user.id);
    try {
      const dates = await fetchLoggedDateStringsService(user.id);
      console.log("[HOOK] fetchLoggedDates: Received dates:", dates);
      setLoggedDayStrings(dates);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to load logged dates: ${error.message}`, variant: "destructive" });
      setLoggedDayStrings([]);
    } finally {
      setIsLoadingLoggedDayStrings(false);
      console.log("[HOOK] fetchLoggedDates: Finished. isLoadingLoggedDayStrings:", false);
    }
  }, [user?.id, toast]);

  const fetchExercisePerformanceData = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    console.log(`[HOOK] fetchExercisePerformanceData: Fetching for exerciseId: ${exerciseId}, userId: ${user.id}`);
    const entry = await fetchPerformanceEntryService(user.id, exerciseId);
    console.log(`[HOOK] fetchExercisePerformanceData: Result for exerciseId: ${exerciseId}`, entry);
    return entry;
  }, [user?.id]);


  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    if (!user?.id) {
        setCurrentLog({ id: dateId, date: dateId, exercises: [], notes: '' });
        setIsLoadingLog(false);
        return;
    }

    setIsLoadingLog(true);
    try {
        const fetchedLog = await fetchLogService(user.id, dateId);
        let newCurrentLogData: WorkoutLog;

        if (fetchedLog) {
            console.log(`[HOOK] loadLogForDate: Fetched log for ${dateId}:`, fetchedLog);
            const exercisesForThisDay: LoggedExercise[] = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId);
                    console.log(`[HOOK] loadLogForDate (EXISTING LOG): PerformanceEntry for ${exFromStoredLog.name} (ID: ${exFromStoredLog.exerciseId}):`, performanceEntry);
                    return {
                        ...exFromStoredLog, 
                        sets: exFromStoredLog.sets.map((s, idx) => ({...s, id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`})),
                        personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                    };
                })
            );
            newCurrentLogData = { ...fetchedLog, exercises: exercisesForThisDay };
        } else {
            console.log(`[HOOK] loadLogForDate: No log found for ${dateId}. Initializing new log structure.`);
            newCurrentLogData = { id: dateId, date: dateId, exercises: [], notes: '', routineId: undefined, routineName: undefined };
        }
        setCurrentLog(newCurrentLogData);
    } catch (error: any)
{
        toast({ title: "Error Loading Log", description: `Could not load log for ${dateId}. ${error.message}`, variant: "destructive" });
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
    const effectDateId = format(selectedDate, 'yyyy-MM-dd');
    if (user?.id && !authIsLoading && !isLoadingRoutines && !isLoadingExercises) {
      loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
      setCurrentLog({ id: effectDateId, date: effectDateId, exercises: [], notes: '' });
      setIsLoadingLog(false);
    } else {
      setIsLoadingLog(true); 
    }
  }, [selectedDate, user?.id, authIsLoading, isLoadingRoutines, isLoadingExercises, loadLogForDate]);


  const refreshPersonalRecordDisplayForExercise = useCallback(async (exerciseId: string) => {
    if (!user?.id || !currentLog) return; 
    const performanceEntry = await fetchExercisePerformanceData(exerciseId);
    console.log(`[HOOK] refreshPersonalRecordDisplayForExercise: PerformanceEntry for ${exerciseId}:`, performanceEntry);
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
    if (!selectedRoutine) {
        setCurrentLog(prev => prev ? { ...prev, routineId: undefined, routineName: undefined, exercises: [] } : null);
        return;
    }

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const performanceEntry = await fetchExercisePerformanceData(routineEx.id);
            console.log(`[HOOK] handleSelectRoutine: PerformanceEntry for ${routineEx.name} (ID: ${routineEx.id}):`, performanceEntry);
            
            let initialSets: LoggedSet[];
            if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
                initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
                    ...s, 
                    id: `set-${dateOfLog}-${routineEx.id}-${i}-${Date.now()}`, 
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
    setCurrentLog({ id: dateOfLog, date: dateOfLog, routineId: selectedRoutine.id, routineName: selectedRoutine.name, exercises: exercisesFromRoutine, notes: currentNotes });
  };

  const addExerciseToLog = async (exercise: Exercise) => {
    if (!currentLog || !user?.id) return; 
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const performanceEntry = await fetchExercisePerformanceData(exercise.id);
    console.log(`[HOOK] addExerciseToLog: PerformanceEntry for ${exercise.name} (ID: ${exercise.id}):`, performanceEntry);

    let initialSets: LoggedSet[];
    if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
        initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
            ...s, 
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`,
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

      for (const loggedEx of logToSave.exercises) {
        const setsForPerformanceEntry = loggedEx.sets; 
        if (setsForPerformanceEntry.length > 0) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, setsForPerformanceEntry, formattedDateId);
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
          }
        }
      }
      
      const shouldSaveMainLog = logToSave.exercises.length > 0 || (logToSave.notes != null && logToSave.notes.trim() !== '');

      if (shouldSaveMainLog) {
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
        await fetchLoggedDates(); 
      } else {
        const existingLog = await fetchLogService(user.id, formattedDateId);
        if (existingLog) {
            await deleteLogService(user.id, formattedDateId);
            toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
            await fetchLoggedDates(); 
        } else {
            toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
        }
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
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

    const numericSets = loggedExercise.sets.map(s => ({
      id: s.id,
      reps: Number(s.reps ?? 0),
      weight: Number(s.weight ?? 0)
    }));
    
    try {
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets, formattedDateId);
      await refreshPersonalRecordDisplayForExercise(loggedExercise.exerciseId);
    } catch (error: any) {
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
    const logIdToDelete = currentLog.id;
    const exercisesInDeletedLog = [...currentLog.exercises]; 

    try {
      await deleteLogService(user.id, logIdToDelete);
      
      for (const deletedEx of exercisesInDeletedLog) {
        try {
          await updatePerformanceEntryOnLogDelete(user.id, deletedEx.exerciseId, logIdToDelete);
          await refreshPersonalRecordDisplayForExercise(deletedEx.exerciseId);
        } catch (prClearError: any) {
          console.error(`[HOOK] deleteCurrentLog: Failed to clear/update PR for ${deletedEx.name}: ${prClearError.message}`);
        }
      }
      
      setCurrentLog({
        id: formattedDateId, 
        date: formattedDateId,
        exercises: [],
        notes: '',
        routineId: undefined,
        routineName: undefined,
      });

      toast({ title: "Log Deleted", description: `Workout for ${logIdToDelete} has been deleted.` });
      await fetchLoggedDates(); 
    } catch (error: any) {
      toast({ title: "Error Deleting Log", description: `Could not delete log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsDeletingLog(false);
      if (user?.id) {
        await loadLogForDate(selectedDate);
      }
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

