
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
  updatePerformanceEntryOnLogDelete,
  saveSingleExerciseToLogService, 
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
        
        // If a log for this day already exists in Firestore...
        if (fetchedLog) {
            // ...it is the source of truth. Do not rebuild from the routine template.
            const finalExercisesForCurrentLog = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId);
                    
                    // Ensure every set has a unique ID for React keys, and is not provisional
                    const setsWithIds = exFromStoredLog.sets.map((s, idx) => ({
                      ...s,
                      id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`,
                      isProvisional: false,
                    }));

                    return {
                        ...exFromStoredLog,
                        sets: setsWithIds,
                        personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                        isProvisional: false, // Data from a saved log is never provisional.
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
            // No log exists for this day. Set an empty state.
            // The user can then optionally select a routine to populate the log for the first time.
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
    // We no longer need to wait for routines to load the log, as the saved log is the source of truth.
    // The hook will call loadLogForDate as soon as auth state is resolved.
    if (!authIsLoading) { 
      loadLogForDate(selectedDate);
    } else {
      // Auth is still loading, so we are implicitly loading the log as well.
      setIsLoadingLog(true); 
    }
  }, [selectedDate, user?.id, authIsLoading, loadLogForDate]); // user.id to refetch if user changes.


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

  const addExerciseToLog = async (exercise: Exercise) => {
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
    };
    setCurrentLog(prev => {
        const logToUpdate = prev || baseLog;
        const updatedExercises = [...logToUpdate.exercises, newLoggedExercise];
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
    // When a set is changed, mark the exercise and its sets as non-provisional
    const finalUpdatedExercise = { ...updatedExercise, isProvisional: false, sets: updatedExercise.sets.map(s => ({...s, isProvisional: false})) };
    setCurrentLog(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map(ex => ex.id === finalUpdatedExercise.id ? finalUpdatedExercise : ex)
      };
    });
    // markExerciseAsInteracted(updatedExercise.id); // Already handled by setting isProvisional: false above
  };
  
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);
    try {
      // Process ALL exercises in currentLog, marking them as non-provisional for saving
      const allExercisesToSaveNonProvisional = currentLog.exercises.map(ex => ({
        ...ex,
        isProvisional: false, 
        sets: ex.sets.map(s => ({ ...s, isProvisional: false })) 
      }));

      // Update PRs and local state for each exercise
      const exercisesWithUpdatedPrs = await Promise.all(
        allExercisesToSaveNonProvisional.map(async (loggedEx) => {
          const setsForPerformanceEntry = loggedEx.sets.map(s => ({
              id: s.id,
              reps: Number(s.reps ?? 0),
              weight: Number(s.weight ?? 0)
          }));
          if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
            try {
              await savePerformanceEntryService(user.id, loggedEx.exerciseId, setsForPerformanceEntry, formattedDateId);
              const performanceEntry = await fetchExercisePerformanceData(loggedEx.exerciseId);
              return { 
                ...loggedEx, 
                personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                // isProvisional and sets.isProvisional already false from allExercisesToSaveNonProvisional
              };
            } catch (perfError: any) {
              console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
              // Continue with the original loggedEx if PR update fails, but still mark non-provisional
              return loggedEx; 
            }
          }
          return loggedEx; // Return as is if no sets to save for performance
        })
      );
      
      const logToSaveForFirestore: WorkoutLog = {
        ...currentLog, 
        exercises: exercisesWithUpdatedPrs.map(ex => { 
            const { isProvisional, personalRecordDisplay, ...restOfEx } = ex; 
            return {
                ...restOfEx,
                sets: ex.sets.map(s => {
                    const { isProvisional: setIsProvisional, ...restOfSet } = s; 
                    return {
                        id: restOfSet.id,
                        reps: restOfSet.reps === null || isNaN(Number(restOfSet.reps)) ? 0 : Number(restOfSet.reps),
                        weight: restOfSet.weight === null || isNaN(Number(restOfSet.weight)) ? 0 : Number(restOfSet.weight),
                    };
                })
            };
        }),
        exerciseIds: exercisesWithUpdatedPrs.map(ex => ex.exerciseId)
      };

      const payloadForFirestore: Partial<WorkoutLog> = { ...logToSaveForFirestore };
      if (payloadForFirestore.routineId === undefined || payloadForFirestore.routineId === null) delete payloadForFirestore.routineId;
      if (payloadForFirestore.routineName === undefined || payloadForFirestore.routineName === null) delete payloadForFirestore.routineName;
      if (payloadForFirestore.duration === undefined || payloadForFirestore.duration === null) delete payloadForFirestore.duration;
      payloadForFirestore.notes = payloadForFirestore.notes || ''; 

      const shouldSaveMainLogDocument = payloadForFirestore.exercises && (payloadForFirestore.exercises.length > 0 || (payloadForFirestore.notes != null && payloadForFirestore.notes.trim() !== '') || payloadForFirestore.routineId);

      if (shouldSaveMainLogDocument) {
          await saveLogService(user.id, currentLog.id, payloadForFirestore as WorkoutLog);
          await fetchLoggedDates(); 
          toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
          const existingLogDocument = await fetchLogService(user.id, currentLog.id);
          if (existingLogDocument) { 
              await deleteLogService(user.id, currentLog.id);
              for (const exInDeletedLog of existingLogDocument.exercises) { 
                  await updatePerformanceEntryOnLogDelete(user.id, exInDeletedLog.exerciseId, currentLog.id);
              }
              await fetchLoggedDates();
              toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
          } else {
              toast({ title: "Log Not Saved", description: "Log is empty."});
          }
      }
      
      // Update local currentLog state to reflect all exercises are now non-provisional
      // and PRs are updated.
      setCurrentLog(prev => {
        if (!prev) return null;
        return {
          ...prev,
          exercises: exercisesWithUpdatedPrs // This array already has isProvisional: false for all items and sets
        };
      });

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id || !currentLog) { 
      toast({ title: "Error", description: "User or current log context not available.", variant: "destructive" });
      return;
    }
     setIsSavingLog(true); 

    try {
      const exerciseToSaveInLog = { ...loggedExercise, isProvisional: false, sets: loggedExercise.sets.map(s => ({...s, isProvisional: false})) };
      
      const setsForPerformanceEntry = exerciseToSaveInLog.sets.map(s => ({
        id: s.id,
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));

      if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
        await savePerformanceEntryService(user.id, exerciseToSaveInLog.exerciseId, setsForPerformanceEntry, formattedDateId);
      }
      
      const logMetadata = {
        routineId: currentLog.routineId,
        routineName: currentLog.routineName,
        notes: currentLog.notes,
      };
      await saveSingleExerciseToLogService(user.id, formattedDateId, exerciseToSaveInLog, logMetadata);
      
      const performanceEntry = await fetchExercisePerformanceData(exerciseToSaveInLog.exerciseId);
      setCurrentLog(prev => {
        if (!prev) return null;
        return {
          ...prev,
          exercises: prev.exercises.map(e => 
            e.id === exerciseToSaveInLog.id 
            ? { ...exerciseToSaveInLog, personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null) } 
            : e
          ),
          routineId: prev.routineId || logMetadata.routineId,
          routineName: prev.routineName || logMetadata.routineName,
          notes: prev.notes || logMetadata.notes,
        };
      });

      await fetchLoggedDates(); 
      
    } catch (error: any) {
      toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}. ${error.message}`, variant: "destructive"});
      throw error; 
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
    deleteCurrentLog,
    markExerciseAsInteracted,
  };
};
