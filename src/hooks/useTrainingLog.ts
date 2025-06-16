
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
  saveSingleExerciseToLogService, // Import new service
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
        let newCurrentLogData: WorkoutLog;

        if (fetchedLog) {
            const exercisesForThisDay: LoggedExercise[] = await Promise.all(
                fetchedLog.exercises.map(async (exFromStoredLog) => {
                    const performanceEntry = await fetchExercisePerformanceData(exFromStoredLog.exerciseId);
                    return {
                        ...exFromStoredLog, 
                        sets: exFromStoredLog.sets.map((s, idx) => ({...s, id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`})),
                        personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
                        isProvisional: false, // Data from Firestore is considered confirmed
                    };
                })
            );
            newCurrentLogData = { ...fetchedLog, exercises: exercisesForThisDay };
        } else {
            newCurrentLogData = { id: dateId, date: dateId, exercises: [], exerciseIds: [], notes: '', routineId: undefined, routineName: undefined };
        }
        setCurrentLog(newCurrentLogData);
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
    const effectDateId = format(selectedDate, 'yyyy-MM-dd');
    if (user?.id && !authIsLoading) {
      loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
      setCurrentLog({ id: effectDateId, date: effectDateId, exercises: [], exerciseIds: [], notes: '' });
      setIsLoadingLog(false);
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
          ex.id === exerciseIdToUpdate ? { ...ex, isProvisional: false } : ex
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
    setCurrentLog({ id: dateOfLog, date: dateOfLog, routineId: selectedRoutine.id, routineName: selectedRoutine.name, exercises: exercisesFromRoutine, exerciseIds: exercisesFromRoutine.map(e => e.exerciseId), notes: currentNotes });
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
    // This function is typically called when sets are modified directly.
    // It implies interaction, so the exercise is no longer provisional.
    const finalUpdatedExercise = { ...updatedExercise, isProvisional: false };
    setCurrentLog(prev => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map(ex => ex.id === finalUpdatedExercise.id ? finalUpdatedExercise : ex)
      };
    });
     // Mark as interacted explicitly if this function is called.
    markExerciseAsInteracted(updatedExercise.id);
  };
  
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);
    try {
      const exercisesToSave = currentLog.exercises.filter(ex => !ex.isProvisional);

      // Save performance entries for all non-provisional exercises
      for (const loggedEx of exercisesToSave) {
        const setsForPerformanceEntry = loggedEx.sets.map(s => ({
            id: s.id,
            reps: Number(s.reps ?? 0),
            weight: Number(s.weight ?? 0)
        }));
        if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, setsForPerformanceEntry, formattedDateId);
            const performanceEntry = await fetchExercisePerformanceData(loggedEx.exerciseId);
             // Update PR display in local state immediately
            setCurrentLog(prev => {
              if(!prev) return null;
              return {
                ...prev,
                exercises: prev.exercises.map(e => e.id === loggedEx.id ? {...e, personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null)} : e)
              }
            });
          } catch (perfError: any) {
            console.error(`[HOOK] saveCurrentLog: Failed to save performance entry for ${loggedEx.name}: ${perfError.message}`);
          }
        }
      }
      
      const logToSaveForFirestore: WorkoutLog = {
        ...currentLog,
        exercises: exercisesToSave.map(ex => {
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
        exerciseIds: exercisesToSave.map(ex => ex.exerciseId)
      };

      const payloadForFirestore: Partial<WorkoutLog> = { ...logToSaveForFirestore };
      if (payloadForFirestore.routineId === undefined) delete payloadForFirestore.routineId;
      if (payloadForFirestore.routineName === undefined) delete payloadForFirestore.routineName;
      if (payloadForFirestore.duration === undefined) delete payloadForFirestore.duration;

      const shouldSaveMainLogDocument = payloadForFirestore.exercises && (payloadForFirestore.exercises.length > 0 || (payloadForFirestore.notes != null && payloadForFirestore.notes.trim() !== ''));

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
              toast({ title: "Log Not Saved", description: "Log is empty or contains only provisional exercises."});
          }
      }
      // After saving, ensure local state also only contains non-provisional exercises or update provisional flags
       setCurrentLog(prev => prev ? {...prev, exercises: prev.exercises.map(ex => ({...ex, isProvisional: false}))} : null);


    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id) {
      toast({ title: "Error", description: "User not available.", variant: "destructive" });
      return;
    }
     setIsSavingLog(true); // Indicate saving is in progress (can use a more specific state if needed)

    try {
      // 1. Save performance entry (PRs, last sets)
      const setsForPerformanceEntry = loggedExercise.sets.map(s => ({
        id: s.id,
        reps: Number(s.reps ?? 0),
        weight: Number(s.weight ?? 0)
      }));

      if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
        await savePerformanceEntryService(user.id, loggedExercise.exerciseId, setsForPerformanceEntry, formattedDateId);
        // Update PR display locally
        const performanceEntry = await fetchExercisePerformanceData(loggedExercise.exerciseId);
        setCurrentLog(prev => {
          if (!prev) return null;
          return {
            ...prev,
            exercises: prev.exercises.map(e => 
              e.id === loggedExercise.id 
              ? { ...e, personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null), isProvisional: false } 
              : e
            )
          };
        });
      } else {
         // If sets are empty, still mark as not provisional because "Save Progress" was clicked
         setCurrentLog(prev => {
          if (!prev) return null;
          return {
            ...prev,
            exercises: prev.exercises.map(e => e.id === loggedExercise.id ? { ...e, isProvisional: false } : e)
          };
        });
      }


      // 2. Save this single exercise to the day's workout log document
      const exerciseToSaveInLog = { ...loggedExercise, isProvisional: false }; // Ensure it's marked non-provisional
      await saveSingleExerciseToLogService(user.id, formattedDateId, exerciseToSaveInLog);
      
      // 3. Update local state for isProvisional (already done above when updating PR display)
      // and ensure the main currentLog object is updated if this was the first exercise to create the log.
      const potentiallyNewLog = await fetchLogService(user.id, formattedDateId);
      if (potentiallyNewLog && (!currentLog || currentLog.exercises.length === 0)) {
        // This means saveSingleExerciseToLogService created the log document
        // So, ensure our local currentLog is properly initialized if it wasn't
        // and reflects this newly saved exercise correctly.
         loadLogForDate(selectedDate); // Reload to get consistent state
      } else {
        // Just ensure the single exercise is marked non-provisional if log already existed.
        setCurrentLog(prev => {
          if (!prev) return null; // Should not happen if saveSingleExerciseToLogService succeeded
          return {
            ...prev,
            exercises: prev.exercises.map(ex => 
              ex.id === loggedExercise.id ? { ...ex, isProvisional: false } : ex
            )
          };
        });
      }


      await fetchLoggedDates(); // Update calendar indicators
      // "Progress Saved!" toast is handled by LoggedExerciseCard upon successful completion of onSaveProgress
      
    } catch (error: any) {
      toast({title: "Save Error", description: `Could not save progress for ${loggedExercise.name}. ${error.message}`, variant: "destructive"});
      throw error; // Re-throw to allow LoggedExerciseCard to handle its loading state
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
    const exercisesInDeletedLog = [...currentLog.exercises]; 

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
    deleteCurrentLog,
    markExerciseAsInteracted,
  };
};

