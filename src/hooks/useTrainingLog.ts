

"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord, SetStructure, WarmupConfig } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getMonthLogFlags,
  updatePerformanceEntryOnLogDelete,
  getLastNonDeloadPerformance,
  saveExercisePerformanceEntry,
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format, startOfMonth } from 'date-fns';
import { useToast } from './use-toast';
import { inferWarmupTemplate, roundToGymHalf } from '@/lib/utils';
import { isBetterPR, formatPR, pickBestSet } from '@/lib/pr';


// A safe deep-clone function using JSON stringify/parse, suitable for serializable data.
const cloneDeep = <T>(obj: T): T => {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.error("Deep clone failed:", e);
    return obj; // Fallback to shallow copy if deep clone fails
  }
};

const DEFAULT_DELOAD_PARAMS = {
    volumeMultiplier: 0.5,
    intensityMultiplier: 0.9,
};

const normalizeForPR = (sets: LoggedSet[]) =>
  sets
    .filter(s =>
      s.reps != null && s.weight != null &&
      Number.isFinite(Number(s.reps)) && Number.isFinite(Number(s.weight))
    )
    .map(s => ({ reps: Number(s.reps), weight: Number(s.weight) }));

const makeEmptyLog = (id: string): WorkoutLog => ({
  id, date: id, exercises: [], exerciseIds: [], notes: '',
  routineId: undefined, routineName: undefined,
});


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
  const [deloadDayStrings, setDeloadDayStrings] = useState<string[]>([]);
  const [isLoadingLoggedDayStrings, setIsLoadingLoggedDayStrings] = useState(true);

  const [isDeload, setIsDeload] = useState(false);
  const [originalLogState, setOriginalLogState] = useState<WorkoutLog | null>(null);
  const [displayedMonth, setDisplayedMonth] = React.useState<Date>(
    startOfMonth(selectedDate ?? new Date())
  );


  const formattedDateId = format(selectedDate, 'yyyy-MM-dd');
  
  React.useEffect(() => {
    if (!user?.id) {
      setLoggedDayStrings([]);
      setDeloadDayStrings([]);
      setIsLoadingLoggedDayStrings(false);
      return;
    }
    setIsLoadingLoggedDayStrings(true);
    let alive = true;
  
    (async () => {
      try {
        const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
        if (!alive) return;
        setLoggedDayStrings(logged);
        setDeloadDayStrings(deload);
      } catch (e) {
        console.error('[useTrainingLog] Failed to fetch month flags:', e);
        if (alive) {
          setLoggedDayStrings([]);
          setDeloadDayStrings([]);
        }
      } finally {
        if (alive) setIsLoadingLoggedDayStrings(false);
      }
    })();
  
    return () => { alive = false; };
  }, [user?.id, displayedMonth]);

  const fetchExercisePerformanceData = useCallback(async (exerciseId: string, routineId?: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    return await getLastNonDeloadPerformance(user.id, exerciseId, routineId);
  }, [user?.id]);

  const getWarmupConfig = (exercise: Exercise): WarmupConfig => {
    if (exercise.warmup) {
      return exercise.warmup;
    }
    const { template, isWeightedBodyweight } = inferWarmupTemplate(exercise.name);
    return { template, isWeightedBodyweight };
  };

  const loadLogForDate = useCallback(async (dateToLoad: Date) => {
    const dateId = format(dateToLoad, 'yyyy-MM-dd');
    if (!user?.id) {
        const emptyLog = makeEmptyLog(dateId);
        setCurrentLog(emptyLog);
        setOriginalLogState(cloneDeep(emptyLog));
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
                    const fullDef = availableExercises.find(e => e.id === exFromStoredLog.exerciseId);
                    
                    const setsWithIds = exFromStoredLog.sets.map((s, idx) => ({
                      ...s,
                      id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`,
                    }));
                    
                    const currentPR = performanceEntry?.personalRecord
                      ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
                      : null;

                    return {
                        ...exFromStoredLog,
                        name: fullDef?.name ?? exFromStoredLog.name,
                        muscleGroup: fullDef?.muscleGroup ?? exFromStoredLog.muscleGroup,
                        exerciseSetup: fullDef?.exerciseSetup ?? exFromStoredLog.exerciseSetup ?? '',
                        progressiveOverload: fullDef?.progressiveOverload ?? exFromStoredLog.progressiveOverload ?? '',
                        warmupConfig: exFromStoredLog.warmupConfig
                          ?? (fullDef ? getWarmupConfig(fullDef) : undefined),
                        sets: setsWithIds,
                        personalRecordDisplay: formatPR(currentPR),
                        currentPR: currentPR,
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
            const newLog = makeEmptyLog(dateId);
            setCurrentLog(newLog);
            setOriginalLogState(cloneDeep(newLog));
            setIsDeload(false);
        }

    } catch (error: any) {
        toast({ title: "Error Loading Log", description: `Could not load log for ${dateId}. ${error.message}`, variant: "destructive" });
        setCurrentLog(makeEmptyLog(dateId));
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast, fetchExercisePerformanceData, availableExercises]);

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
      setLoggedDayStrings([]);
      setIsLoadingRoutines(false);
      setIsLoadingExercises(false);
      setIsLoadingLoggedDayStrings(false);
    }
  }, [user?.id, toast]); 

  React.useEffect(() => {
    if (!selectedDate) return;
    setDisplayedMonth(prev => {
      if (
        prev.getMonth() === selectedDate.getMonth() &&
        prev.getFullYear() === selectedDate.getFullYear()
      ) {
        return prev; // no change
      }
      return startOfMonth(selectedDate);
    });
  }, [selectedDate]);

  useEffect(() => {
    if (authIsLoading || isLoadingExercises) {
      setIsLoadingLog(true);
      return;
    }
    loadLogForDate(selectedDate);
  }, [selectedDate, authIsLoading, isLoadingExercises, loadLogForDate]);

  const applyDeloadTransform = useCallback((log: WorkoutLog | null): WorkoutLog | null => {
    if (!log) return null;
    const { volumeMultiplier, intensityMultiplier } = DEFAULT_DELOAD_PARAMS;
  
    const transformSets = (sets: LoggedSet[]): LoggedSet[] => {
      if (!sets || sets.length === 0) return sets;
  
      const keepCount = Math.max(1, Math.ceil(sets.length * volumeMultiplier));
  
      const ranked = sets
        .map((s, i) => ({ i, w: Number.isFinite(Number(s.weight)) ? Number(s.weight) : 0 }))
        .sort((a, b) => b.w - a.w)
        .slice(0, keepCount)
        .map(x => x.i);
  
      const selectedIndexSet = new Set(ranked);
      return sets
        .filter((_, i) => selectedIndexSet.has(i))
        .map(set => ({
          ...set,
          weight: set.weight != null
            ? roundToGymHalf(Number(set.weight) * intensityMultiplier)
            : set.weight,
      }));
    };
  
    return { ...log, exercises: log.exercises.map(ex => ({ ...ex, sets: transformSets(ex.sets) })) };
  }, []);

  useEffect(() => {
    if (!currentLog) return;
    if (isDeload) {
      const src = originalLogState ?? currentLog;
      const next = applyDeloadTransform(src);
      if (next) setCurrentLog(next);
    } else if (originalLogState) {
      setCurrentLog(cloneDeep(originalLogState));
    }
  }, [isDeload, originalLogState, applyDeloadTransform]);

  const mutateBaseline = (
    produceNextFromBaseline: (baseline: WorkoutLog | null) => WorkoutLog | null
  ) => {
    const baseline = originalLogState ?? currentLog ?? null;
    const nextBaseline = produceNextFromBaseline(baseline);

    if (!nextBaseline) return;

    setOriginalLogState(nextBaseline);
    setCurrentLog(isDeload ? applyDeloadTransform(nextBaseline) : nextBaseline);
  };


  const markExerciseAsInteracted = (exerciseIdToUpdate: string) => {
    mutateBaseline((base) => {
      if (!base) return null;
      return {
        ...base,
        exercises: base.exercises.map(ex =>
          ex.id === exerciseIdToUpdate
            ? { ...ex, isProvisional: false, sets: ex.sets.map(s => ({ ...s, isProvisional: false })) }
            : ex
        ),
      };
    });
  };
  

  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd'); 

    if (routineId === "none") {
      const clearedLog = makeEmptyLog(dateOfLog);
      setOriginalLogState(cloneDeep(clearedLog));
      setCurrentLog(clearedLog);
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

            const currentPR = performanceEntry?.personalRecord
              ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
              : null;

            return {
                id: `${routineEx.id}-${dateOfLog}-${index}-${Date.now()}`, 
                exerciseId: routineEx.id,
                name: fullExerciseDef?.name ?? routineEx.name,
                muscleGroup: fullExerciseDef?.muscleGroup ?? routineEx.muscleGroup,
                exerciseSetup: fullExerciseDef?.exerciseSetup ?? '',
                progressiveOverload: fullExerciseDef?.progressiveOverload ?? '',
                sets: initialSets,
                notes: '',
                personalRecordDisplay: formatPR(currentPR),
                currentPR: currentPR,
                isProvisional: true, 
                warmupConfig: fullExerciseDef ? getWarmupConfig(fullExerciseDef) : undefined,
                setStructure: routineEx.setStructure ?? 'normal',
                setStructureOverride: null,
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
    setOriginalLogState(cloneDeep(newLog));
    setCurrentLog(isDeload ? applyDeloadTransform(newLog) : newLog);
  };

  const addExerciseToLog = async (exercise: Exercise, index?: number) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    
    const baseLogForPerf = currentLog || makeEmptyLog(dateOfLog);
    const performanceEntry = await fetchExercisePerformanceData(exercise.id, baseLogForPerf.routineId);

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

    const currentPR = performanceEntry?.personalRecord
      ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
      : null;

    const newLoggedExercise: LoggedExercise = {
      id: `${exercise.id}-${dateOfLog}-${Date.now()}`, 
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      exerciseSetup: exercise.exerciseSetup || '',
      progressiveOverload: exercise.progressiveOverload || '',
      sets: initialSets,
      notes: '',
      personalRecordDisplay: formatPR(currentPR),
      currentPR: currentPR,
      isProvisional: true,
      warmupConfig: getWarmupConfig(exercise),
      setStructure: 'normal',
      setStructureOverride: null,
    };

    mutateBaseline((base) => {
        const baseLog = base ?? makeEmptyLog(dateOfLog);
        const updatedExercises = [...baseLog.exercises];
        const insertionIndex = (index == null) ? updatedExercises.length : index;
        updatedExercises.splice(insertionIndex, 0, newLoggedExercise);

        return { 
            ...baseLog, 
            exercises: updatedExercises,
            exerciseIds: updatedExercises.map(e => e.exerciseId) 
        };
    });
  };

  const removeExerciseFromLog = (loggedExerciseId: string) => {
    mutateBaseline((base) => {
      if (!base) return base;
      const updatedExercises = base.exercises.filter(ex => ex.id !== loggedExerciseId);
      return { 
          ...base, 
          exercises: updatedExercises,
          exerciseIds: updatedExercises.map(e => e.exerciseId) 
      };
    });
  };

  const replaceExerciseInLog = async (exerciseIdToReplace: string, newExercise: Exercise) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const baseLogForPerf = currentLog || makeEmptyLog(dateOfLog);
    const performanceEntry = await fetchExercisePerformanceData(newExercise.id, baseLogForPerf.routineId);

    const initialSets: LoggedSet[] = (performanceEntry?.lastPerformedSets?.length ? performanceEntry.lastPerformedSets : [{ reps: null, weight: null }])
      .map((s, i) => ({ ...s, id: `set-${dateOfLog}-${newExercise.id}-${i}-${Date.now()}`, isProvisional: true }));

    const currentPR = performanceEntry?.personalRecord
      ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
      : null;

    mutateBaseline((base) => {
      if (!base) return base;
      const idx = base.exercises.findIndex(ex => ex.id === exerciseIdToReplace);
      if (idx === -1) return base;

      const prev = base.exercises[idx];
      const updatedExercises = [...base.exercises];
      updatedExercises[idx] = {
        id: `${newExercise.id}-${dateOfLog}-${Date.now()}`,
        exerciseId: newExercise.id,
        name: newExercise.name,
        muscleGroup: newExercise.muscleGroup,
        exerciseSetup: newExercise.exerciseSetup || '',
        progressiveOverload: newExercise.progressiveOverload || '',
        sets: initialSets,
        notes: '',
        personalRecordDisplay: formatPR(currentPR),
        currentPR: currentPR,
        isProvisional: true,
        warmupConfig: getWarmupConfig(newExercise),
        setStructure: prev.setStructure ?? 'normal',
        setStructureOverride: prev.setStructureOverride ?? null,
      };

      return {
        ...base,
        exercises: updatedExercises,
        exerciseIds: updatedExercises.map(e => e.exerciseId),
      };
    });
  };

  const reorderExercisesInLog = (reorderedExercises: LoggedExercise[]) => {
     mutateBaseline((base) => {
        if (!base) return null;
        return { 
            ...base, 
            exercises: reorderedExercises,
            exerciseIds: reorderedExercises.map(e => e.exerciseId) 
        };
    });
  };

  const updateExerciseInLog = (updated: LoggedExercise) => {
    const finalUpdated: LoggedExercise = {
      ...updated,
      isProvisional: updated.isProvisional,
      sets: updated.sets.map(s => ({ ...s, isProvisional: s.isProvisional ?? false })),
    };
    mutateBaseline((base) => {
      if (!base) return null;
      return {
        ...base,
        exercises: base.exercises.map(ex => (ex.id === finalUpdated.id ? finalUpdated : ex)),
      };
    });
  };
  
  const updateExerciseSetStructureOverride = (exerciseId: string, structure: SetStructure | null) => {
    mutateBaseline((base) => {
      if (!base) return null;
      return {
        ...base,
        exercises: base.exercises.map(ex =>
          ex.id === exerciseId
            ? { ...ex, setStructureOverride: structure }
            : ex
        )
      };
    });
  };
  
  const applyLocalPRUpdate = useCallback((exerciseId: string, todaysSets: LoggedSet[]) => {
    const bestToday = pickBestSet(todaysSets);
    if (!bestToday) return;

    mutateBaseline(base => {
        if (!base) return null;
        return {
            ...base,
            exercises: base.exercises.map(ex => {
                if (ex.exerciseId !== exerciseId) return ex;
                
                const newIsBetter = isBetterPR(bestToday, ex.currentPR ?? null);
                const nextPR = newIsBetter ? bestToday : (ex.currentPR ?? null);

                return { 
                  ...ex, 
                  currentPR: nextPR,
                  personalRecordDisplay: formatPR(nextPR),
                };
            })
        };
    });
  }, []);

  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);

    try {
      const logToSave = originalLogState ? { ...originalLogState } : { ...currentLog };

      if (isDeload) {
        logToSave.isDeload = true;
        logToSave.deloadParams = DEFAULT_DELOAD_PARAMS;
      } else {
        logToSave.isDeload = false;
        logToSave.deloadParams = undefined;
      }

      const exercisesWithUpdatedPrs = await Promise.all(
        logToSave.exercises.map(async (loggedEx) => {
          const { isProvisional, ...restOfEx } = loggedEx; 
          const performanceEntry = await fetchExercisePerformanceData(restOfEx.exerciseId, logToSave.routineId);
          const currentPR = performanceEntry?.personalRecord
              ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
              : null;
          return {
            ...restOfEx,
            personalRecordDisplay: formatPR(currentPR),
            currentPR: currentPR,
            sets: restOfEx.sets.map(s => {
                const { isProvisional: setProvisional, ...restOfSet } = s; 
                return restOfSet;
            })
          };
        })
      );
      
      const finalLogToSave: WorkoutLog = {
        ...logToSave, 
        exercises: exercisesWithUpdatedPrs,
        exerciseIds: Array.from(new Set(exercisesWithUpdatedPrs.map(ex => ex.exerciseId))),
      };

      const shouldSaveMainLogDocument = finalLogToSave.exercises.length > 0 || (finalLogToSave.notes && finalLogToSave.notes.trim() !== '') || finalLogToSave.routineId;

      if (shouldSaveMainLogDocument) {
          await saveLogService(user.id, finalLogToSave.id, finalLogToSave);
          if (!finalLogToSave.isDeload) {
            for (const loggedEx of finalLogToSave.exercises) {
                const originalExerciseInLog = currentLog.exercises.find(ex => ex.id === loggedEx.id);
                if (originalExerciseInLog && !originalExerciseInLog.isProvisional) {
                    await saveExercisePerformanceEntry(
                      user.id,
                      loggedEx.exerciseId,
                      loggedEx.sets,
                      finalLogToSave.id
                    );
                    applyLocalPRUpdate(loggedEx.exerciseId, loggedEx.sets);
                }
            }
          }
          const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
          setLoggedDayStrings(logged);
          setDeloadDayStrings(deload);
          toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
          const existingLogDocument = await fetchLogService(user.id, finalLogToSave.id);
          if (existingLogDocument) { 
              await deleteLogService(user.id, finalLogToSave.id);
              for (const exInDeletedLog of existingLogDocument.exercises) { 
                  await updatePerformanceEntryOnLogDelete(user.id, exInDeletedLog.exerciseId, finalLogToSave.id);
              }
              const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
              setLoggedDayStrings(logged);
              setDeloadDayStrings(deload);
              toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
          } else {
              toast({ title: "Log Not Saved", description: "Log is empty."});
          }
      }
      
      await loadLogForDate(selectedDate);

    } catch (error: any) {
      toast({ title: "Error Saving Log", description: `Could not save log. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const saveSingleExercise = async (exerciseLogId: string) => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
  
    const baseline = originalLogState ?? currentLog;
    const selectedExercise = baseline.exercises.find(e => e.id === exerciseLogId);
    if (!selectedExercise) {
        toast({ title: "Error", description: "Could not find the exercise to save.", variant: "destructive" });
        return;
    }

    setIsSavingLog(true);
    try {
      const logToSave = { ...baseline };
      if (isDeload) {
        logToSave.isDeload = true;
        logToSave.deloadParams = DEFAULT_DELOAD_PARAMS;
      } else {
        logToSave.isDeload = false;
        logToSave.deloadParams = undefined;
      }
  
      const exercisesForPayload = await Promise.all(
        logToSave.exercises.map(async (ex) => {
          const { isProvisional, ...rest } = ex;
          const perf = await fetchExercisePerformanceData(rest.exerciseId, logToSave.routineId);
          const currentPR = perf?.personalRecord
              ? { reps: perf.personalRecord.reps, weight: perf.personalRecord.weight }
              : null;
          return {
            ...rest,
            personalRecordDisplay: formatPR(currentPR),
            currentPR: currentPR,
            sets: rest.sets.map(({ isProvisional: _p, ...s }) => s),
          };
        })
      );
  
      const payload: WorkoutLog = {
        ...logToSave,
        exercises: exercisesForPayload,
        exerciseIds: Array.from(new Set(exercisesForPayload.map(e => e.exerciseId))),
      };
  
      await saveLogService(user.id, payload.id, payload);
      const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
      setLoggedDayStrings(logged);
      setDeloadDayStrings(deload);
  
      if (!payload.isDeload) {
          await saveExercisePerformanceEntry(
            user.id,
            selectedExercise.exerciseId,
            selectedExercise.sets,
            payload.id
          );
          applyLocalPRUpdate(selectedExercise.exerciseId, selectedExercise.sets);
      }
  
      toast({ title: "Exercise Saved", description: `${selectedExercise?.name ?? "Exercise"} saved.` });
    } catch (error: any) {
      toast({ title: "Error", description: `Could not save exercise. ${error.message}`, variant: "destructive" });
    } finally {
      setIsSavingLog(false);
    }
  };

  const updateOverallLogNotes = (notes: string) => {
    mutateBaseline((base) => {
        const baseLog = base || makeEmptyLog(formattedDateId);
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
      
      const emptyLog = makeEmptyLog(logIdToDelete);
      setCurrentLog(emptyLog);
      setOriginalLogState(cloneDeep(emptyLog));
      setIsDeload(false);

      toast({ title: "Log Deleted", description: `Workout for ${logIdToDelete} has been deleted.` });
      const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
      setLoggedDayStrings(logged);
      setDeloadDayStrings(deload);
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
    deloadDayStrings, 
    isLoadingLoggedDayStrings,
    handleSelectRoutine,
    addExerciseToLog,
    removeExerciseFromLog,
    replaceExerciseInLog,
    reorderExercisesInLog,
    updateExerciseInLog,
    updateExerciseSetStructureOverride,
    saveCurrentLog,
    saveSingleExercise,
    updateOverallLogNotes,
    deleteCurrentLog,
    markExerciseAsInteracted,
    isDeload,
    setIsDeload,
    displayedMonth,
    setDisplayedMonth,
  };
};


    


    


    