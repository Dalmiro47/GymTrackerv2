
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord, WarmupConfig } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLastLoggedPerformance as fetchPerformanceEntryService, 
  getLoggedDateStrings as fetchLoggedDateStringsService,
  updatePerformanceEntryOnLogDelete,
  saveSingleExerciseToLogService
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format, parseISO } from 'date-fns';
import { useToast } from './use-toast';
import { inferWarmupTemplate } from '@/lib/utils';

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

  const fetchExercisePerformanceData = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    const entry = await fetchPerformanceEntryService(user.id, exerciseId);
    return entry;
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
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId);
                    
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

            setCurrentLog({
                id: fetchedLog.id,
                date: fetchedLog.date,
                exercises: finalExercisesForCurrentLog,
                exerciseIds: finalExercisesForCurrentLog.map(e => e.exerciseId),
                notes: fetchedLog.notes || '',
                routineId: fetchedLog.routineId,
                routineName: fetchedLog.routineName,
            });

        } else {
            setCurrentLog({
                id: dateId,
                date: dateId,
                exercises: [],
                exerciseIds: [],
                notes: '',
                routineId: undefined,
                routineName: undefined,
            });
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


  const markExerciseAsInteracted = (exerciseIdToUpdate: string) => {
    setCurrentLog(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map(ex => 
          ex.id === exerciseIdToUpdate 
          ? { ...ex, isProvisional: false, sets: ex.sets.map(s => ({...s, isProvisional: false})) } 
          : ex
        )
      };
    });
  };
  
  const getWarmupConfig = (exercise: Exercise): WarmupConfig => {
    if (exercise.warmup) {
      return exercise.warmup;
    }
    const { template, perHand, isWeightedBodyweight } = inferWarmupTemplate(exercise.name);
    return { template, perHand, isWeightedBodyweight };
  };

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd'); 

    if (routineId === "none") {
      setCurrentLog(prev => {
        const baseLog = {
          id: dateOfLog, 
          date: dateOfLog,
          notes: prev?.notes || '', 
          routineId: undefined,
          routineName: undefined,
          exercises: [],
          exerciseIds: []
        };
        return baseLog;
      });
      return;
    }

    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) {
        setCurrentLog(prev => prev ? { ...prev, routineId: undefined, routineName: undefined, exercises: [], exerciseIds: [] } : { id: dateOfLog, date: dateOfLog, exercises: [], exerciseIds:[], notes: ''});
        return;
    }

    const currentNotes = currentLog?.notes || '';

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (routineEx, index) => {
            const fullExerciseDef = availableExercises.find(ex => ex.id === routineEx.id);
            const performanceEntry = await fetchExercisePerformanceData(routineEx.id);
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
    setCurrentLog({ 
        id: dateOfLog, 
        date: dateOfLog, 
        routineId: selectedRoutine.id, 
        routineName: selectedRoutine.name, 
        exercises: exercisesFromRoutine, 
        exerciseIds: exercisesFromRoutine.map(e => e.exerciseId), 
        notes: currentNotes 
    });
  };

  const addExerciseToLog = async (exercise: Exercise, index?: number) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    
    const baseLog = currentLog || { id: dateOfLog, date: dateOfLog, exercises: [], exerciseIds: [], notes: '' };

    const performanceEntry = await fetchExercisePerformanceData(exercise.id);

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

    setCurrentLog(prev => {
        const logToUpdate = prev || baseLog;
        const updatedExercises = [...logToUpdate.exercises];
        const insertionIndex = (index === null || index === undefined) ? updatedExercises.length : index;
        updatedExercises.splice(insertionIndex, 0, newLoggedExercise);

        return { 
            ...logToUpdate, 
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(e => e.exerciseId) 
        };
    });
  };

  const removeExerciseFromLog = (loggedExerciseId: string) => {
    setCurrentLog(prev => {
        if (!prev) return null;
        const updatedExercises = prev.exercises.filter(ex => ex.id !== loggedExerciseId);
        return { 
            ...prev, 
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(e => e.exerciseId) 
        };
    });
  };

  const replaceExerciseInLog = async (exerciseIdToReplace: string, newExercise: Exercise) => {
    if (!user?.id || !currentLog) return;
  
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const performanceEntry = await fetchExercisePerformanceData(newExercise.id);
  
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
  
    setCurrentLog(prev => {
      if (!prev) return null;
      const indexToReplace = prev.exercises.findIndex(ex => ex.id === exerciseIdToReplace);
      if (indexToReplace === -1) return prev;
  
      const updatedExercises = [...prev.exercises];
      updatedExercises[indexToReplace] = newLoggedExercise;
  
      return {
        ...prev,
        exercises: updatedExercises,
        exerciseIds: updatedExercises.map(ex => ex.exerciseId),
      };
    });
  };

  const reorderExercisesInLog = (reorderedExercises: LoggedExercise[]) => {
     setCurrentLog(prev => {
        if (!prev) return null;
        return { 
            ...prev, 
            exercises: reorderedExercises,
            exerciseIds: reorderedExercises.map(e => e.exerciseId) 
        };
    });
  };

  const updateExerciseInLog = (updatedExercise: LoggedExercise) => {
    const finalUpdatedExercise = { ...updatedExercise, isProvisional: false, sets: updatedExercise.sets.map(s => ({...s, isProvisional: false})) };
    setCurrentLog(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map(ex => ex.id === finalUpdatedExercise.id ? finalUpdatedExercise : ex)
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
      const logToSave = { ...currentLog };

      const exercisesWithUpdatedPrs = await Promise.all(
        logToSave.exercises.map(async (loggedEx) => {
          const { isProvisional, ...restOfEx } = loggedEx; // Remove isProvisional for saving
          const performanceEntry = await fetchExercisePerformanceData(restOfEx.exerciseId);
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
          await saveSingleExerciseToLogService(user.id, finalLogToSave.id, finalLogToSave);
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
      
      setCurrentLog(prev => {
        if (!prev) return null;
        return {
          ...prev,
          exercises: exercisesWithUpdatedPrs
        };
      });

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const updateOverallLogNotes = (notes: string) => {
    setCurrentLog(prev => {
        const baseLog = prev || { id: formattedDateId, date: formattedDateId, exercises: [], exerciseIds: [], notes: '' };
        return { ...baseLog, notes };
    });
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
      setCurrentLog({
        id: dateForEmptyLog, 
        date: dateForEmptyLog,
        exercises: [],
        exerciseIds: [],
        notes: '',
        routineId: undefined,
        routineName: undefined,
      });

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

  const getSetInsertionIndex = () => exerciseInsertionIndex;

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
    exerciseInsertionIndex,
    setExerciseInsertionIndex
  };
};
