
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord, SetStructure, WarmupConfig } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getLoggedDateStrings as fetchLoggedDateStringsService,
  updatePerformanceEntryOnLogDelete,
  getLastNonDeloadPerformance,
  saveExercisePerformanceEntry,
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format } from 'date-fns';
import { useToast } from './use-toast';
import { inferWarmupTemplate, roundToGymHalf } from '@/lib/utils';


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

  const [isDeload, setIsDeload] = useState(false);
  const [originalLogState, setOriginalLogState] = useState<WorkoutLog | null>(null);
  const skipNextDeloadEffectRef = useRef(false);


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
                    const fullDef = availableExercises.find(e => e.id === exFromStoredLog.exerciseId);
                    
                    const setsWithIds = exFromStoredLog.sets.map((s, idx) => ({
                      ...s,
                      id: s.id || `set-${dateId}-${exFromStoredLog.exerciseId}-${idx}-${Date.now()}`,
                    }));

                    return {
                        ...exFromStoredLog,
                        name: fullDef?.name ?? exFromStoredLog.name,
                        muscleGroup: fullDef?.muscleGroup ?? exFromStoredLog.muscleGroup,
                        exerciseSetup: fullDef?.exerciseSetup ?? exFromStoredLog.exerciseSetup ?? '',
                        warmupConfig: exFromStoredLog.warmupConfig
                          ?? (fullDef ? getWarmupConfig(fullDef) : undefined),
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

            if (log.isDeload) {
              skipNextDeloadEffectRef.current = true;
            }

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
  }, [user?.id, toast, fetchExercisePerformanceData, formatPersonalRecordDisplay, availableExercises]);

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
  }, [user?.id, toast, fetchLoggedDates, selectedDate]); 

  useEffect(() => {
    if (authIsLoading || isLoadingExercises) {
      setIsLoadingLog(true);
      return;
    }
    loadLogForDate(selectedDate);
  }, [selectedDate, authIsLoading, isLoadingExercises, loadLogForDate]);

  const applyDeloadTransform = (log: WorkoutLog | null): WorkoutLog | null => {
    if (!log) return null;
    const { volumeMultiplier, intensityMultiplier } = DEFAULT_DELOAD_PARAMS;
  
    const transformSets = (sets: LoggedSet[]): LoggedSet[] => {
      if (!sets || sets.length === 0) return sets;
  
      const keepCount = Math.max(1, Math.ceil(sets.length * volumeMultiplier));
  
      // Rank by weight desc (null/NaN treated as 0), pick top N
      const ranked = sets
        .map((s, i) => ({ i, w: Number.isFinite(Number(s.weight)) ? Number(s.weight) : 0 }))
        .sort((a, b) => b.w - a.w)
        .slice(0, keepCount)
        .map(x => x.i);
  
      // Preserve original order of the picked indices
      const selectedIndexSet = new Set(ranked);
      const selected = sets.filter((_, i) => selectedIndexSet.has(i));
  
      // Apply intensity reduction + rounding
      return selected.map(set => ({
        ...set,
        weight: set.weight != null
          ? roundToGymHalf(Number(set.weight) * intensityMultiplier)
          : set.weight,
      }));
    };
  
    const transformedExercises = log.exercises.map(ex => ({
      ...ex,
      sets: transformSets(ex.sets),
    }));
  
    return { ...log, exercises: transformedExercises };
  };

  const setLogDeloadAware = (
    produceNext: (prev: WorkoutLog | null) => WorkoutLog | null
  ) => {
    setCurrentLog(prev => {
      const next = produceNext(prev);
      if (!next) return prev;
      setOriginalLogState(next);   // store untouched baseline
      return isDeload ? applyDeloadTransform(next) : next;
    });
  };

  useEffect(() => {
    if (isDeload) {
      if (skipNextDeloadEffectRef.current) {
        skipNextDeloadEffectRef.current = false;
        return; 
      }
      if (!originalLogState) setOriginalLogState(cloneDeep(currentLog));
      setCurrentLog(applyDeloadTransform(currentLog));
    } else {
      if (originalLogState) {
        setCurrentLog(cloneDeep(originalLogState));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeload]);


  const markExerciseAsInteracted = (exerciseIdToUpdate: string) => {
    const updater = (log: WorkoutLog | null): WorkoutLog | null => {
      if (!log) return null;
      return {
        ...log,
        exercises: log.exercises.map(ex =>
          ex.id === exerciseIdToUpdate
            ? { ...ex, sets: ex.sets.map(s => ({ ...s, isProvisional: false })) }
            : ex
        ),
      };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
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
                name: fullExerciseDef?.name ?? routineEx.name,
                muscleGroup: fullExerciseDef?.muscleGroup ?? routineEx.muscleGroup,
                exerciseSetup: fullExerciseDef?.exerciseSetup ?? '',
                sets: initialSets,
                notes: '',
                personalRecordDisplay: formatPersonalRecordDisplay(performanceEntry?.personalRecord || null),
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
      setStructure: 'normal',
      setStructureOverride: null,
    };

    setLogDeloadAware((log) => {
        const logToUpdate = log || baseLog;
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
    setLogDeloadAware((log) => {
      if (!log) return log;
      const updatedExercises = log.exercises.filter(ex => ex.id !== loggedExerciseId);
      return { 
          ...log, 
          exercises: updatedExercises,
          exerciseIds: updatedExercises.map(e => e.exerciseId) 
      };
    });
  };

  const replaceExerciseInLog = async (exerciseIdToReplace: string, newExercise: Exercise) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');
    const baseLog = currentLog || { id: dateOfLog, date: dateOfLog, exercises: [], exerciseIds: [], notes: '' };
    const performanceEntry = await fetchExercisePerformanceData(newExercise.id, baseLog.routineId);

    const initialSets: LoggedSet[] = (performanceEntry?.lastPerformedSets?.length ? performanceEntry.lastPerformedSets : [{ reps: null, weight: null }])
      .map((s, i) => ({ ...s, id: `set-${dateOfLog}-${newExercise.id}-${i}-${Date.now()}`, isProvisional: true }));

    setLogDeloadAware((log) => {
      if (!log) return log;
      const idx = log.exercises.findIndex(ex => ex.id === exerciseIdToReplace);
      if (idx === -1) return log;

      const prev = log.exercises[idx];
      const updatedExercises = [...log.exercises];
      updatedExercises[idx] = {
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
        setStructure: prev.setStructure ?? 'normal',
        setStructureOverride: prev.setStructureOverride ?? null,
      };

      return {
        ...log,
        exercises: updatedExercises,
        exerciseIds: updatedExercises.map(e => e.exerciseId),
      };
    });
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

  const updateExerciseInLog = (updated: LoggedExercise) => {
    const finalUpdated: LoggedExercise = {
      ...updated,
      isProvisional: updated.isProvisional,
      sets: updated.sets.map(s => ({ ...s, isProvisional: s.isProvisional ?? false })),
    };
    const updater = (log: WorkoutLog | null) => {
      if (!log) return null;
      return {
        ...log,
        exercises: log.exercises.map(ex => (ex.id === finalUpdated.id ? finalUpdated : ex)),
      };
    };
    setCurrentLog(updater);
    setOriginalLogState(updater);
  };
  
  const updateExerciseSetStructureOverride = (exerciseId: string, structure: SetStructure | null) => {
    const updater = (log: WorkoutLog | null) => {
      if (!log) return null;
      return {
        ...log,
        exercises: log.exercises.map(ex =>
          ex.id === exerciseId
            ? { ...ex, setStructureOverride: structure }
            : ex
        )
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
                      normalizeForPR(loggedEx.sets),
                      finalLogToSave.id
                    );
                }
            }
          }
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
  
    const selectedExercise = currentLog.exercises.find(e => e.id === exerciseLogId);
    if (!selectedExercise) {
        toast({ title: "Error", description: "Could not find the exercise to save.", variant: "destructive" });
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
  
      const exercisesForPayload = await Promise.all(
        logToSave.exercises.map(async (ex) => {
          const { isProvisional, ...rest } = ex;
          const perf = await fetchExercisePerformanceData(rest.exerciseId, logToSave.routineId);
          return {
            ...rest,
            personalRecordDisplay: formatPersonalRecordDisplay(perf?.personalRecord || null),
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
      await fetchLoggedDates();
  
      if (!payload.isDeload) {
          await saveExercisePerformanceEntry(
            user.id,
            selectedExercise.exerciseId,
            normalizeForPR(selectedExercise.sets),
            payload.id
          );
      }
  
      const newPerf = await fetchExercisePerformanceData(selectedExercise.exerciseId, currentLog.routineId);
      const prText = formatPersonalRecordDisplay(newPerf?.personalRecord || null);
  
      const updater = (log: WorkoutLog | null): WorkoutLog | null => {
        if (!log) return null;
        return {
          ...log,
          exercises: log.exercises.map(ex =>
            ex.id === exerciseLogId
              ? { ...ex, isProvisional: false, personalRecordDisplay: prText }
              : ex
          ),
        };
      };
      setCurrentLog(updater);
      setOriginalLogState(updater);
  
      toast({ title: "Exercise Saved", description: `${selectedExercise?.name ?? "Exercise"} saved.` });
    } catch (error: any) {
      toast({ title: "Error", description: `Could not save exercise. ${error.message}`, variant: "destructive" });
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
    updateExerciseSetStructureOverride,
    saveCurrentLog,
    saveSingleExercise,
    updateOverallLogNotes,
    deleteCurrentLog,
    markExerciseAsInteracted,
    isDeload,
    setIsDeload,
  };
};


    
    

    



    