
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
    if (user?.id && !authIsLoading) { // Removed isLoadingRoutines and isLoadingExercises
      loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
      setCurrentLog({ id: effectDateId, date: effectDateId, exercises: [], exerciseIds: [], notes: '' });
      setIsLoadingLog(false);
    } else {
      setIsLoadingLog(true); 
    }
  }, [selectedDate, user?.id, authIsLoading, loadLogForDate]); // Adjusted dependencies


  // refreshPersonalRecordDisplayForExercise removed


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
                    isProvisional: true, // Mark sets from performance entry as provisional
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
                isProvisional: true, // Mark the whole exercise as provisional
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
            isProvisional: true, // Mark sets from performance entry as provisional
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
      isProvisional: true, // Mark the whole exercise as provisional
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
    setCurrentLog(prev => {
      if (!prev) return null;
      // When sets are updated, the exercise is no longer provisional
      const finalUpdatedExercise = { ...updatedExercise, isProvisional: false };
      return {
        ...prev,
        exercises: prev.exercises.map(ex => ex.id === finalUpdatedExercise.id ? finalUpdatedExercise : ex)
      };
    });
  };
  
  const prepareAndSaveFullLog = async (logData: WorkoutLog) => {
    if (!user?.id) {
        toast({ title: "Error", description: "User not available for saving full log.", variant: "destructive" });
        return;
    }
    const logId = logData.id;

    const logToSaveForFirestore: WorkoutLog = {
        ...logData,
        exercises: logData.exercises.map(ex => {
            const { isProvisional, personalRecordDisplay, ...restOfEx } = ex; // Strip UI-only fields
            return {
                ...restOfEx,
                sets: ex.sets.map(s => {
                    const { isProvisional: setIsProvisional, ...restOfSet } = s; // Strip UI-only fields from sets
                    return {
                        id: restOfSet.id,
                        reps: restOfSet.reps === null || isNaN(Number(restOfSet.reps)) ? 0 : Number(restOfSet.reps),
                        weight: restOfSet.weight === null || isNaN(Number(restOfSet.weight)) ? 0 : Number(restOfSet.weight),
                    };
                })
            };
        }),
        exerciseIds: logData.exercises.map(ex => ex.exerciseId)
    };
    
    const payloadForFirestore: Partial<WorkoutLog> = { ...logToSaveForFirestore };
    if (payloadForFirestore.routineId === undefined) delete payloadForFirestore.routineId;
    if (payloadForFirestore.routineName === undefined) delete payloadForFirestore.routineName;
    if (payloadForFirestore.duration === undefined) delete payloadForFirestore.duration;

    const shouldSaveMainLogDocument = payloadForFirestore.exercises && (payloadForFirestore.exercises.length > 0 || (payloadForFirestore.notes != null && payloadForFirestore.notes.trim() !== ''));

    if (shouldSaveMainLogDocument) {
        await saveLogService(user.id, logId, payloadForFirestore as WorkoutLog);
        await fetchLoggedDates(); // Update calendar indicators
        return true; // Indicate that save happened
    } else {
        const existingLogDocument = await fetchLogService(user.id, logId);
        if (existingLogDocument) {
            await deleteLogService(user.id, logId);
            for (const exInDeletedLog of existingLogDocument.exercises) {
                await updatePerformanceEntryOnLogDelete(user.id, exInDeletedLog.exerciseId, logId);
            }
            await fetchLoggedDates();
            return false; // Indicate that log was cleared (or effectively not saved because it was empty)
        }
        return false; // Log was empty and no existing doc to delete
    }
  };


  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);
    try {
      // Mark all exercises as non-provisional before full save
      const nonProvisionalLog = {
        ...currentLog,
        exercises: currentLog.exercises.map(ex => ({...ex, isProvisional: false, sets: ex.sets.map(s => ({...s, isProvisional: false}))}))
      };
      setCurrentLog(nonProvisionalLog); // Update local state to reflect non-provisional status

      // Save performance entries for all *non-provisional* exercises first
      for (const loggedEx of nonProvisionalLog.exercises) { // Iterate over the nonProvisionalLog
        const setsForPerformanceEntry = loggedEx.sets.map(s => ({
            id: s.id,
            reps: Number(s.reps ?? 0),
            weight: Number(s.weight ?? 0)
        }));
        if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, setsForPerformanceEntry, formattedDateId);
            const performanceEntry = await fetchExercisePerformanceData(loggedEx.exerciseId);
            setCurrentLog(prev => { // Update PR display based on new performance data
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
      
      const saved = await prepareAndSaveFullLog(nonProvisionalLog); // Use nonProvisionalLog
      if (saved) {
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
         const existingLog = await fetchLogService(user.id, formattedDateId);
         if (existingLog) { // It means the log was empty and got deleted
            toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
         } else { // Log was empty and no existing doc, so nothing was really "saved" or "cleared"
            toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
         }
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
      // No need to call loadLogForDate here if setCurrentLog with nonProvisionalLog and PR updates is sufficient
      // If full reload is desired: if (user?.id) { await loadLogForDate(selectedDate); }
    }
  };

  const saveExerciseProgress = async (loggedExercise: LoggedExercise) => {
    if (!user?.id) {
      toast({ title: "Error", description: "User not available.", variant: "destructive" });
      return;
    }
    if (!currentLog) {
        toast({ title: "Error", description: "Log data not initialized. Cannot save progress.", variant: "destructive" });
        return;
    }

    const nonProvisionalExercise = { ...loggedExercise, isProvisional: false, sets: loggedExercise.sets.map(s => ({...s, isProvisional: false})) };
    updateExerciseInLog(nonProvisionalExercise); // Update local state immediately

    const setsForPerformanceEntry = nonProvisionalExercise.sets.map(s => ({
      id: s.id,
      reps: Number(s.reps ?? 0),
      weight: Number(s.weight ?? 0)
    }));
    
    try {
      if (setsForPerformanceEntry.length > 0 && setsForPerformanceEntry.some(s => s.reps > 0 || s.weight > 0)) {
        await savePerformanceEntryService(user.id, nonProvisionalExercise.exerciseId, setsForPerformanceEntry, formattedDateId);
        const performanceEntry = await fetchExercisePerformanceData(nonProvisionalExercise.exerciseId);
         setCurrentLog(prev => { // Update PR display based on new performance data
            if(!prev) return null;
            return {
              ...prev,
              exercises: prev.exercises.map(e => e.id === nonProvisionalExercise.id ? {...e, personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null), isProvisional: false} : e)
            }
          });
      }
      
      // Now ensure the currentLog reflects this specific exercise as non-provisional before saving the whole log
      const logStateWithUpdatedExercise = {
        ...currentLog,
        exercises: currentLog.exercises.map(ex => 
            ex.id === nonProvisionalExercise.id ? nonProvisionalExercise : ex
        )
      };
      
      await prepareAndSaveFullLog(logStateWithUpdatedExercise); // Use the utility function to save
      // "Progress Saved!" toast is handled by LoggedExerciseCard

    } catch (error: any) {
      toast({title: "Save Error", description: `Could not save progress for ${nonProvisionalExercise.name}. ${error.message}`, variant: "destructive"});
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
      if (user?.id) { // After deletion, reload to ensure state is clean (e.g., if a new empty log was created)
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
    // refreshPersonalRecordDisplayForExercise, // Removed
    deleteCurrentLog,
  };
};
