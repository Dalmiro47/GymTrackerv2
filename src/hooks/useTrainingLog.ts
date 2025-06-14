
"use client";

import { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
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

  const [availableRoutines, setAvailableRoutines] = useState<Routine[]>([]);
  const [isLoadingRoutines, setIsLoadingRoutines] = useState(true);

  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);

  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');

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

  const formatLastPerformanceDisplay = (perf: ExercisePerformanceEntry | null): string => {
    if (!perf || perf.sets.length === 0) return "No previous data";
    return perf.sets.map(s => `${s.reps ?? '0'}x${s.weight ?? '0'}kg`).join(', ');
  };

  const fetchAndSetLastPerformance = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    console.log(`[HOOK] fetchAndSetLastPerformance called for exerciseId: ${exerciseId}`);
    const perf = await fetchLastPerformanceService(user.id, exerciseId);
    console.log(`[HOOK] Performance data received for ${exerciseId}:`, perf ? JSON.stringify(perf) : 'null');
    const display = formatLastPerformanceDisplay(perf);
    setCurrentLog(prevLog => {
      if (!prevLog) return null;
      return {
        ...prevLog,
        exercises: prevLog.exercises.map(ex =>
          ex.exerciseId === exerciseId ? { ...ex, lastPerformanceDisplay: display } : ex
        )
      };
    });
    return perf;
  }, [user?.id]);

  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    if (!user?.id) {
        setIsLoadingLog(false);
        const dateIdForEmpty = format(dateToLoad, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        return;
    }

    setIsLoadingLog(true);
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    try {
        const fetchedLog = await fetchLogService(user.id, dateId);
        let finalExercises: LoggedExercise[] = [];
        let logRoutineId: string | undefined = fetchedLog?.routineId;
        let logRoutineName: string | undefined = fetchedLog?.routineName;

        if (logRoutineId) {
            let routineDetails: Routine | null | undefined = null;
            if (availableRoutines.length > 0 && !isLoadingRoutines) {
                routineDetails = availableRoutines.find(r => r.id === logRoutineId);
            }
            if (!routineDetails && !isLoadingRoutines && user?.id) {
                routineDetails = await getRoutineById(user.id, logRoutineId);
            }

            if (routineDetails) {
                logRoutineName = routineDetails.name;
                finalExercises = await Promise.all(routineDetails.exercises.map(async (routineEx, index) => {
                    const loggedVersionForThisDate = fetchedLog?.exercises.find(loggedEx => loggedEx.exerciseId === routineEx.id);
                    const lastPerformanceEntry = await fetchAndSetLastPerformance(routineEx.id);

                    let setsForCurrentLog: LoggedSet[];
                    if (loggedVersionForThisDate?.sets && loggedVersionForThisDate.sets.length > 0) {
                        setsForCurrentLog = loggedVersionForThisDate.sets.map(s => ({...s}));
                    } else if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                        setsForCurrentLog = lastPerformanceEntry.sets.map((s, i) => ({
                            id: `set-${dateId}-${routineEx.id}-${i}-${Date.now()}`,
                            reps: s.reps,
                            weight: s.weight,
                        }));
                    } else {
                        setsForCurrentLog = [{ id: `set-${dateId}-${routineEx.id}-0-${Date.now()}`, reps: null, weight: null }];
                    }

                    return {
                        id: loggedVersionForThisDate?.id || `${routineEx.id}-${dateId}-${index}`,
                        exerciseId: routineEx.id,
                        name: routineEx.name,
                        muscleGroup: routineEx.muscleGroup,
                        exerciseSetup: routineEx.exerciseSetup || '',
                        sets: setsForCurrentLog,
                        notes: loggedVersionForThisDate?.notes || '',
                        lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry),
                    };
                }));
            } else if (fetchedLog) {
                 finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                    const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                    return {...ex, exerciseSetup: ex.exerciseSetup || '', lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), sets: ex.sets.map(s => ({...s})) };
                 }));
            }
        } else if (fetchedLog) {
             finalExercises = await Promise.all(fetchedLog.exercises.map(async ex => {
                const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.exerciseId);
                return {...ex, exerciseSetup: ex.exerciseSetup || '', lastPerformanceDisplay: formatLastPerformanceDisplay(lastPerformanceEntry), sets: ex.sets.map(s => ({...s})) };
             }));
        }

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
  }, [user?.id, toast, availableRoutines, isLoadingRoutines, fetchAndSetLastPerformance]);

  useEffect(() => {
    if (user?.id && !isLoadingRoutines && !isLoadingExercises) {
        loadLogForDate(selectedDate);
    } else if (!user?.id && !authIsLoading) {
        const dateIdForEmpty = format(selectedDate, 'yyyy-MM-dd');
        setCurrentLog({ id: dateIdForEmpty, date: dateIdForEmpty, exercises: [], notes: '' });
        setIsLoadingLog(false);
    }
  }, [selectedDate, loadLogForDate, user, authIsLoading, isLoadingRoutines, isLoadingExercises]);

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

    const currentNotes = currentLog?.notes || '';
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

    const exercisesFromRoutine: LoggedExercise[] = await Promise.all(
        selectedRoutine.exercises.map(async (ex, index) => {
            const lastPerformanceEntry = await fetchAndSetLastPerformance(ex.id);

            console.log(`[HOOK] handleSelectRoutine - Processing exercise from routine: ${ex.name} (ID: ${ex.id})`);
            console.log(`[HOOK] handleSelectRoutine - Fetched lastPerformanceEntry.sets for ${ex.name}:`, JSON.stringify(lastPerformanceEntry?.sets));

            let initialSets: LoggedSet[];
            if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
                initialSets = lastPerformanceEntry.sets.map((s, i) => ({
                    id: `set-${dateOfLog}-${ex.id}-${i}-${Date.now()}`,
                    reps: s.reps,
                    weight: s.weight,
                }));
            } else {
                initialSets = [{ id: `set-${dateOfLog}-${ex.id}-0-${Date.now()}`, reps: null, weight: null }];
            }
            console.log(`[HOOK] handleSelectRoutine - Derived initialSets for ${ex.name}:`, JSON.stringify(initialSets));

            return {
                id: `${ex.id}-${dateOfLog}-${index}`,
                exerciseId: ex.id,
                name: ex.name,
                muscleGroup: ex.muscleGroup,
                exerciseSetup: ex.exerciseSetup || '',
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

    console.log(`[HOOK] addExerciseToLog - Processing exercise: ${exercise.name} (ID: ${exercise.id})`);
    console.log(`[HOOK] addExerciseToLog - Fetched lastPerformanceEntry.sets for ${exercise.name}:`, JSON.stringify(lastPerformanceEntry?.sets));

    let initialSets: LoggedSet[];
    if (lastPerformanceEntry?.sets && lastPerformanceEntry.sets.length > 0) {
        initialSets = lastPerformanceEntry.sets.map((s, i) => ({
            id: `set-${dateOfLog}-${exercise.id}-${i}-${Date.now()}`,
            reps: s.reps,
            weight: s.weight,
        }));
    } else {
        initialSets = [{ id: `set-${dateOfLog}-${exercise.id}-${Date.now()}`, reps: null, weight: null }];
    }
    console.log(`[HOOK] addExerciseToLog - Derived initialSets for ${exercise.name}:`, JSON.stringify(initialSets));

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${Date.now()}`,
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
              ...ex,
              exerciseSetup: ex.exerciseSetup || '',
              lastPerformanceDisplay: ex.lastPerformanceDisplay || 'N/A',
              sets: ex.sets.map(s => ({
                  id: s.id,
                  reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
                  weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
              }))
          }))
      };

      console.log('[useTrainingLog] logToSave prepared:', JSON.stringify(logToSave, null, 2));

      for (const loggedEx of logToSave.exercises) {
        const validSetsForPerfEntry = loggedEx.sets.filter(s => (s.reps > 0) || (s.weight > 0));
        if (validSetsForPerfEntry.length > 0) {
          try {
            await savePerformanceEntryService(user.id, loggedEx.exerciseId, validSetsForPerfEntry);
          } catch (perfError: any) {
            console.error(`Failed to save performance entry for ${loggedEx.name} during day log save: ${perfError.message}`);
          }
        }
      }

      if (logToSave.exercises.length > 0 || (logToSave.notes && logToSave.notes.trim() !== '')) {
        await saveLogService(user.id, formattedDateId, logToSave);
        toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
        toast({ title: "Log Not Saved", description: "Log is empty. Add exercises or notes."});
      }

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
      if (currentLog) {
        for (const ex of currentLog.exercises) {
          await fetchAndSetLastPerformance(ex.exerciseId);
        }
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
      await savePerformanceEntryService(user.id, loggedExercise.exerciseId, numericSets);
    }

    await fetchAndSetLastPerformance(loggedExercise.exerciseId);
  };

  const updateOverallLogNotes = (notes: string) => {
    setCurrentLog(prev => prev ? { ...prev, notes } : null);
  };

  return {
    selectedDate,
    setSelectedDate,
    currentLog,
    isLoadingLog,
    isSavingLog,
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
    fetchAndSetLastPerformance
  };
};

    