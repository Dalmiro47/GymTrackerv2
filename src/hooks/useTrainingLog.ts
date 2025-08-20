
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord, WarmupConfig } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLastLoggedPerformance as fetchPerformanceEntryService, 
  getLoggedDateStrings as fetchLoggedDateStringsService,
  updatePerformanceEntryOnLogDelete,
  saveSingleExerciseToLogService,
  getLastNonDeloadPerformance,
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format, parseISO } from 'date-fns';
import { useToast } from './use-toast';
import { inferWarmupTemplate, roundToNearestIncrement } from '@/lib/utils';

const DEFAULT_DELOAD_PARAMS = {
  volumeMultiplier: 0.5,
  intensityMultiplier: 0.9,
};

// A safe deep-clone function using JSON stringify/parse, suitable for serializable data.
const cloneDeep = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

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

  const [exerciseInsertionIndex, setExerciseInsertionIndex] = useState<number | null>(null);

  const [isDeload, setIsDeload] = useState(false);
  const [originalLogState, setOriginalLogState] = useState<WorkoutLog | null>(null);


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

  const fetchExercisePerformanceData = useCallback(async (exerciseId: string, routineId?: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    return await getLastNonDeloadPerformance(user.id, exerciseId, routineId);
  }, [user?.id]);


  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    if (!user?.id) {
        setCurrentLog({ id: dateId, date: dateId, exercises: [], exerciseIds: [], notes: '' });
        setIsLoadingLog(false);
        return;
    }

    setIsLoadingLog(true);
    try {
        const fetchedLog = await fetchLogService(user.id, dateId);
        
        if (fetchedLog) {
            const finalExercisesForCurrentLog = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId, fetchedLog.routineId);
                    
                    const setsWithIds = exFromStoredLog.sets.map((s, idx) => ({
                      ...s,
                      id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`,
                      isProvisional: exFromStoredLog.isProvisional,
                    }));

                    return {
                        ...exFromStoredLog,
                        sets: setsWithIds,
                        personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                    };
                })
            );

            const log = {
                id: fetchedLog.id,
                date: fetchedLog.date,
                exercises: finalExercisesForCurrentLog,
                exerciseIds: finalExercisesForCurrentLog.map(e => e.exerciseId),
                notes: fetchedLog.notes || '',
                routineId: fetchedLog.routineId,
                routineName: fetchedLog.routineName,
                isDeload: fetchedLog.isDeload ?? false,
                deloadParams: fetchedLog.deloadParams,
            };
            setCurrentLog(log);
            setOriginalLogState(cloneDeep(log));
            setIsDeload(log.isDeload ?? false);

        } else {
            const newLog = {
                id: dateId,
                date: dateId,
                exercises: [],
                exerciseIds: [],
                notes: '',
                routineId: undefined,
                routineName: undefined,
            };
            setCurrentLog(newLog);
            setOriginalLogState(cloneDeep(newLog));
            setIsDeload(false);
        }

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: `Could not load log for ${dateId}. ${error.message}`, variant: "destructive" });
        setCurrentLog({ id: dateId, date: dateId, exercises: [], exerciseIds: [], notes: '' });
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
    if (!authIsLoading) { 
      loadLogForDate(selectedDate);
    } else {
      setIsLoadingLog(true); 
    }
  }, [selectedDate, user?.id, authIsLoading, loadLogForDate]);

  const applyDeloadTransform = (log: WorkoutLog | null): WorkoutLog | null => {
    if (!log) return null;
    const { volumeMultiplier, intensityMultiplier } = DEFAULT_DELOAD_PARAMS;
    const transformedExercises = log.exercises.map(ex => {
      const newSetCount = Math.max(1, Math.ceil(ex.sets.length * volumeMultiplier));
      const transformedSets = ex.sets.slice(0, newSetCount).map(set => ({
        ...set,
        weight: set.weight != null ? roundToNearestIncrement(set.weight * intensityMultiplier, 2.5) : set.weight,
      }));
      return { ...ex, sets: transformedSets };
    });
    return { ...log, exercises: transformedExercises };
  };

  useEffect(() => {
    if (isDeload) {
        if (!originalLogState) setOriginalLogState(cloneDeep(currentLog));
        setCurrentLog(applyDeloadTransform(currentLog));
    } else {
        if (originalLogState) {
            setCurrentLog(cloneDeep(originalLogState));
        }
    }
  }, [isDeload]);


  const markExerciseAsInteracted = (exerciseIdToUpdate: string) => {
    const updater = (log: WorkoutLog | null): WorkoutLog | null => {
      if (!log) return null;
      return {
        ...log,
        exercises: log.exercises.map(ex =>
          ex.id === exerciseIdToUpdate
          ? { ...ex, isProvisional: false, sets: ex.sets.map(s => ({...s, isProvisional: false})) }
          : ex
        )
      };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };
  
  const getWarmupConfig = (exercise: Exercise): WarmupConfig => {
    if (exercise.warmup) {
      return exercise.warmup;
    }
    const { template, isWeightedBodyweight } = inferWarmupTemplate(exercise.name);
    return { template, isWeightedBodyweight };
  };

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd'); 

    if (routineId === "none") {
      const clearedLog = {
        id: dateOfLog,
        date: dateOfLog,
        notes: currentLog?.notes || '',
        routineId: undefined,
        routineName: undefined,
        exercises: [],
        exerciseIds: []
      };
      setCurrentLog(clearedLog);
      setOriginalLogState(cloneDeep(clearedLog));
      setIsDeload(false);
      return;
    }

    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    const currentNotes = currentLog?.notes || '';

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const fullExerciseDef = availableExercises.find(ex => ex.id === routineEx.id);
            const performanceEntry = await fetchExercisePerformanceData(routineEx.id, selectedRoutine.id);
            let initialSets: LoggedSet[];
            if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
                initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
                    ...s, 
                    id: `set-${dateOfLog}-${routineEx.id}-${i}-${Date.now()}`,
                    isProvisional: true, 
                }));
            } else { 
                initialSets = [{ id: `set-${dateOfLog}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null, isProvisional: true }];
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
                isProvisional: true, 
                warmupConfig: fullExerciseDef ? getWarmupConfig(fullExerciseDef) : undefined,
            };
        })
    );
    const newLog = { 
        id: dateOfLog, 
        date: dateOfLog, 
        routineId: selectedRoutine.id, 
        routineName: selectedRoutine.name, 
        exercises: exercisesFromRoutine, 
        exerciseIds: exercisesFromRoutine.map(e => e.exerciseId), 
        notes: currentNotes 
    };
    setCurrentLog(newLog);
    setOriginalLogState(cloneDeep(newLog));
    if (isDeload) {
      setCurrentLog(applyDeloadTransform(newLog));
    }
  };

  const addExerciseToLog = async (exercise: Exercise, index?: number) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    
    const baseLog = currentLog || { id: dateOfLog, date: dateOfLog, exercises: [], exerciseIds: [], notes: '' };

    const performanceEntry = await fetchExercisePerformanceData(exercise.id, baseLog.routineId);

    let initialSets: LoggedSet[];
    if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
        initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
            ...s, 
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`,
            isProvisional: true, 
        }));
    } else {
        initialSets = [{ id: `set-${dateOfLog}-${exercise.id}-0-${Date.now()}`, reps: null, weight: null, isProvisional: true }];
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
      isProvisional: true,
      warmupConfig: getWarmupConfig(exercise),
    };

    const updater = (log: WorkoutLog | null) => {
        const logToUpdate = log || baseLog;
        const updatedExercises = [...logToUpdate.exercises];
        const insertionIndex = (index === null || index === undefined) ? updatedExercises.length : index;
        updatedExercises.splice(insertionIndex, 0, newLoggedExercise);

        return { 
            ...logToUpdate, 
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(e => e.exerciseId) 
        };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };

  const removeExerciseFromLog = (loggedExerciseId: string) => {
    const updater = (log: WorkoutLog | null) => {
        if (!log) return null;
        const updatedExercises = log.exercises.filter(ex => ex.id !== loggedExerciseId);
        return { 
            ...log, 
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(e => e.exerciseId) 
        };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };

  const replaceExerciseInLog = async (exerciseIdToReplace: string, newExercise: Exercise) => {
    if (!user?.id || !currentLog) return;
  
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const performanceEntry = await fetchExercisePerformanceData(newExercise.id, currentLog.routineId);
  
    let initialSets: LoggedSet[];
    if (performanceEntry?.lastPerformedSets && performanceEntry.lastPerformedSets.length > 0) {
      initialSets = performanceEntry.lastPerformedSets.map((s, i) => ({
        ...s,
        id: `set-${dateOfLog}-${newExercise.id}-${i}-${Date.now()}`,
        isProvisional: true,
      }));
    } else {
      initialSets = [{ id: `set-${dateOfLog}-${newExercise.id}-0-${Date.now()}`, reps: null, weight: null, isProvisional: true }];
    }
  
    const newLoggedExercise: LoggedExercise = {
      id: `${newExercise.id}-${dateOfLog}-${Date.now()}`,
      exerciseId: newExercise.id,
      name: newExercise.name,
      muscleGroup: newExercise.muscleGroup,
      exerciseSetup: newExercise.exerciseSetup || '',
      sets: initialSets,
      notes: '',
      personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
      isProvisional: true,
      warmupConfig: getWarmupConfig(newExercise),
    };
  
    const updater = (log: WorkoutLog | null) => {
        if (!log) return null;
        const indexToReplace = log.exercises.findIndex(ex => ex.id === exerciseIdToReplace);
        if (indexToReplace === -1) return log;
    
        const updatedExercises = [...log.exercises];
        updatedExercises[indexToReplace] = newLoggedExercise;
    
        return {
            ...log,
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(ex => ex.exerciseId),
        };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };

  const reorderExercisesInLog = (reorderedExercises: LoggedExercise[]) => {
     const updater = (log: WorkoutLog | null) => {
        if (!log) return null;
        return { 
            ...log, 
            exercises: reorderedExercises,
            exerciseIds: reorderedExercises.map(e => e.exerciseId) 
        };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };

  const updateExerciseInLog = (updatedExercise: LoggedExercise) => {
    const finalUpdatedExercise = { ...updatedExercise, isProvisional: false, sets: updatedExercise.sets.map(s => ({...s, isProvisional: false})) };
    const updater = (log: WorkoutLog | null) => {
        if (!log) return null;
        return {
            ...log,
            exercises: log.exercises.map(ex => ex.id === finalUpdatedExercise.id ? finalUpdatedExercise : ex)
        };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };
  
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);

    try {
      const logToSave = { ...currentLog };

      if (isDeload) {
        logToSave.isDeload = true;
        logToSave.deloadParams = DEFAULT_DELOAD_PARAMS;
      } else {
        logToSave.isDeload = false;
        logToSave.deloadParams = undefined;
      }

      const exercisesWithUpdatedPrs = await Promise.all(
        logToSave.exercises.map(async (loggedEx) => {
          const { isProvisional, ...restOfEx } = loggedEx; // Remove isProvisional for saving
          const performanceEntry = await fetchExercisePerformanceData(restOfEx.exerciseId, logToSave.routineId);
          return {
            ...restOfEx,
            personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
            sets: restOfEx.sets.map(s => {
                const { isProvisional: setProvisional, ...restOfSet } = s; // Also remove from set
                return restOfSet;
            })
          };
        })
      );
      
      const finalLogToSave: WorkoutLog = {
        ...logToSave, 
        exercises: exercisesWithUpdatedPrs.map(ex => ({ ...ex, isProvisional: undefined })),
        exerciseIds: exercisesWithUpdatedPrs.map(ex => ex.exerciseId),
      };

      const shouldSaveMainLogDocument = finalLogToSave.exercises.length > 0 || (finalLogToSave.notes && finalLogToSave.notes.trim() !== '') || finalLogToSave.routineId;

      if (shouldSaveMainLogDocument) {
          await saveLogService(user.id, finalLogToSave.id, finalLogToSave);
          await fetchLoggedDates(); 
          toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
          const existingLogDocument = await fetchLogService(user.id, finalLogToSave.id);
          if (existingLogDocument) { 
              await deleteLogService(user.id, finalLogToSave.id);
              for (const exInDeletedLog of existingLogDocument.exercises) { 
                  await updatePerformanceEntryOnLogDelete(user.id, exInDeletedLog.exerciseId, finalLogToSave.id);
              }
              await fetchLoggedDates();
              toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
          } else {
              toast({ title: "Log Not Saved", description: "Log is empty."});
          }
      }
      
      const savedLog = {
        ...currentLog,
        exercises: exercisesWithUpdatedPrs
      };
      setCurrentLog(savedLog);
      setOriginalLogState(cloneDeep(savedLog));

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const updateOverallLogNotes = (notes: string) => {
    const updater = (log: WorkoutLog | null) => {
        const baseLog = log || { id: formattedDateId, date: formattedDateId, exercises: [], exerciseIds: [], notes: '' };
        return { ...baseLog, notes };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };

  const deleteCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to delete.", variant: "destructive" });
      return;
    }
    setIsDeletingLog(true);
    const logIdToDelete = currentLog.id;
    
    const logSnapshotForPrUpdate = await fetchLogService(user.id, logIdToDelete);
    const exercisesInDeletedLog = logSnapshotForPrUpdate ? [...logSnapshotForPrUpdate.exercises] : [];


    try {
      await deleteLogService(user.id, logIdToDelete);
      
      for (const deletedEx of exercisesInDeletedLog) {
        try {
          await updatePerformanceEntryOnLogDelete(user.id, deletedEx.exerciseId, logIdToDelete);
        } catch (prClearError: any) {
          console.error(`[HOOK] deleteCurrentLog: Failed to clear/update PR for ${deletedEx.name}: ${prClearError.message}`);
        }
      }
      
      const dateForEmptyLog = format(selectedDate, 'yyyy-MM-dd');
      const emptyLog = {
        id: dateForEmptyLog, 
        date: dateForEmptyLog,
        exercises: [],
        exerciseIds: [],
        notes: '',
        routineId: undefined,
        routineName: undefined,
      };
      setCurrentLog(emptyLog);
      setOriginalLogState(cloneDeep(emptyLog));
      setIsDeload(false);

      toast({ title: "Log Deleted", description: `Workout for ${logIdToDelete} has been deleted.` });
      await fetchLoggedDates(); 
    } catch (error: any) {
      toast({ title: "Error Deleting Log", description: `Could not delete log. ${error.message}`, variant: "destructive" });
      if (user?.id) { 
        await loadLogForDate(selectedDate);
      }
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
    replaceExerciseInLog,
    reorderExercisesInLog,
    updateExerciseInLog,
    saveCurrentLog,
    updateOverallLogNotes,
    deleteCurrentLog,
    markExerciseAsInteracted,
    isDeload,
    setIsDeload,
  };
};
