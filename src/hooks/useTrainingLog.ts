

"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { WorkoutLog, LoggedExercise, LoggedSet, Routine, Exercise, ExercisePerformanceEntry, PersonalRecord, SetStructure, WarmupConfig } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWorkoutLog as fetchLogService,
  saveWorkoutLog as saveLogService,
  deleteWorkoutLog as deleteLogService,
  getMonthLogFlags,
  updatePerformanceEntryOnLogDelete,
  getLastNonDeloadPerformance,
  saveExercisePerformanceEntries,
} from '@/services/trainingLogService';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { getRoutines as fetchUserRoutines } from '@/services/routineService';
import { format, startOfMonth } from 'date-fns';
import { useToast } from './use-toast';
import { inferWarmupTemplate, roundToGymHalf } from '@/lib/utils';
import { isBetterPR, formatPR, pickBestSet } from '@/lib/pr';
import { setUnsavedChanges } from '@/lib/unsavedChanges';
import { friendlyErrorMessage } from '@/lib/errorMessages';


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

// The subset of a log that is compared for "unsaved changes" (see isDirty).
// An exercise is "provisional" (planned, not yet done) while its sets are still
// exactly what was pre-filled from the last session. Any reps/weight edit, added
// or removed set flips it — mere focus does not. Mirrors the `persistedShape`
// dirty check, but per exercise.
const setsShape = (sets: Array<{ reps: number | null; weight: number | null }>) =>
  JSON.stringify(sets.map(s => [s.reps ?? null, s.weight ?? null]));

const withDerivedProvisional = (ex: LoggedExercise): LoggedExercise => {
  if (!ex.prefill) return { ...ex, isProvisional: false, sets: ex.sets.map(s => ({ ...s, isProvisional: false })) };
  const untouched = setsShape(ex.sets) === setsShape(ex.prefill.sets);
  return {
    ...ex,
    isProvisional: untouched,
    sets: ex.sets.map((s, i) => {
      const p = ex.prefill!.sets[i];
      const sameSet = untouched || (!!p && (s.reps ?? null) === (p.reps ?? null) && (s.weight ?? null) === (p.weight ?? null));
      return { ...s, isProvisional: sameSet };
    }),
  };
};

const makePrefill = (performanceEntry: { lastPerformedSets?: Array<{ reps: number | null; weight: number | null }>; lastPerformedDate?: number | null } | null | undefined, sets: LoggedSet[]) => ({
  sets: sets.map(s => ({ reps: s.reps ?? null, weight: s.weight ?? null })),
  lastPerformedDate: performanceEntry?.lastPerformedSets?.length ? (performanceEntry.lastPerformedDate ?? null) : null,
});

const persistedShape = (log: WorkoutLog) => ({
  notes: log.notes ?? '',
  routineId: log.routineId ?? null,
  routineName: log.routineName ?? null,
  exercises: log.exercises.map(ex => ({
    id: ex.id,
    exerciseId: ex.exerciseId,
    setStructureOverride: ex.setStructureOverride ?? null,
    warmupConfig: ex.warmupConfig ?? null,
    notes: ex.notes ?? '',
    sets: ex.sets.map(s => ({ reps: s.reps ?? null, weight: s.weight ?? null })),
  })),
});

const makeEmptyLog = (id: string): WorkoutLog => ({
  id, date: id, exercises: [], exerciseIds: [], notes: '',
  routineId: undefined, routineName: undefined,
});


export const useTrainingLog = (initialDate: Date) => {
  const { user, isLoading: authIsLoading } = useAuth();
  const { toast } = useToast();

  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
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
  // True when the loaded baseline already contains deload-transformed sets
  // (saved with `deloadApplied`). Display must not transform it again.
  const [deloadApplied, setDeloadApplied] = useState(false);
  const [originalLogState, setOriginalLogState] = useState<WorkoutLog | null>(null);
  // Last state known to match Firestore. `isDirty` = baseline differs from it.
  const [savedSnapshot, setSavedSnapshot] = useState<WorkoutLog | null>(null);
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

  const fetchExercisePerformanceData = useCallback(async (exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
    if (!user?.id || !exerciseId) return null;
    return await getLastNonDeloadPerformance(user.id, exerciseId);
  }, [user?.id]);

  const refreshMonthFlags = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
      setLoggedDayStrings(logged);
      setDeloadDayStrings(deload);
    } catch (e) {
      // Calendar underlines are cosmetic; never turn a successful save into an error.
      console.error('[useTrainingLog] refreshMonthFlags failed:', e);
    }
  }, [user?.id, displayedMonth]);

  // One parallel read per unique exercise — replaces N sequential round-trips.
  const fetchPerformanceDataByExerciseId = useCallback(async (exerciseIds: string[]) => {
    const uniqueIds = Array.from(new Set(exerciseIds));
    const entries = await Promise.all(
      uniqueIds.map(async (id) => [id, await fetchExercisePerformanceData(id)] as const)
    );
    return new Map(entries);
  }, [fetchExercisePerformanceData]);

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
        setOriginalLogState(makeEmptyLog(dateId));
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
                deloadApplied: fetchedLog.deloadApplied ?? false,
                deloadParams: fetchedLog.deloadParams,
            };
            setOriginalLogState(log);
            setSavedSnapshot(log);
            setIsDeload(log.isDeload ?? false);
            setDeloadApplied(log.deloadApplied ?? false);

        } else {
            const empty = makeEmptyLog(dateId);
            setOriginalLogState(empty);
            setSavedSnapshot(empty);
            setIsDeload(false);
            setDeloadApplied(false);
        }

    } catch (error: any) {
        console.error('[useTrainingLog] loadLogForDate failed:', error);
        toast({ title: "Load error", description: friendlyErrorMessage(error, "Couldn't load that day's workout."), variant: "destructive" });
        const empty = makeEmptyLog(dateId);
        setOriginalLogState(empty);
        setSavedSnapshot(empty);
    } finally {
        setIsLoadingLog(false);
    }
  }, [user?.id, toast, fetchExercisePerformanceData, availableExercises]);

  useEffect(() => {
    if (user?.id) {
      setIsLoadingRoutines(true);
      fetchUserRoutines(user.id)
        .then(setAvailableRoutines)
        .catch(error => { console.error('[useTrainingLog] routines load failed:', error); toast({ title: "Load error", description: friendlyErrorMessage(error, "Couldn't load your routines."), variant: "destructive" }); })
        .finally(() => setIsLoadingRoutines(false));

      setIsLoadingExercises(true);
      fetchAllUserExercises(user.id)
        .then(setAvailableExercises)
        .catch(error => { console.error('[useTrainingLog] exercises load failed:', error); toast({ title: "Load error", description: friendlyErrorMessage(error, "Couldn't load your exercises."), variant: "destructive" }); })
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

  // Dirty = baseline differs from what Firestore has (deload toggle included).
  // Only data that actually gets persisted is compared: UI-only markers such as
  // `isProvisional` (flipped just by focusing an input) and the derived PR
  // display fields must not make the log look changed.
  const isDirty = useMemo(() => {
    if (!originalLogState || !savedSnapshot) return false;
    if (isDeload !== (savedSnapshot.isDeload ?? false)) return true;
    return JSON.stringify(persistedShape(originalLogState)) !== JSON.stringify(persistedShape(savedSnapshot));
  }, [originalLogState, savedSnapshot, isDeload]);

  useEffect(() => {
    setUnsavedChanges(isDirty);
    return () => setUnsavedChanges(false);
  }, [isDirty]);

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

  // The displayed log is *derived* from the baseline, never stored — so deload
  // (transformed) values can't be fed back into the baseline and compound.
  const currentLog = useMemo(() => {
    if (!originalLogState) return null;
    // An applied deload is already reduced in the baseline — show it as stored.
    return isDeload && !deloadApplied ? applyDeloadTransform(originalLogState) : originalLogState;
  }, [originalLogState, isDeload, deloadApplied, applyDeloadTransform]);

  // Stable callback: mutations go through the functional updater so they never
  // read a stale baseline; the displayed log re-derives in the same render.
  const mutateBaseline = useCallback((
    produceNextFromBaseline: (baseline: WorkoutLog | null) => WorkoutLog | null
  ) => {
    setOriginalLogState(prev => {
      const next = produceNextFromBaseline(prev);
      return next ?? prev;
    });
  }, []);



  const handleSelectRoutine = async (routineId: string) => {
    if (!user?.id) return;
    const dateOfLog = format(selectedDate, 'yyyy-MM-dd'); 

    if (routineId === "none") {
      const clearedLog = makeEmptyLog(dateOfLog);
      setOriginalLogState(clearedLog);
      setIsDeload(false);
      setDeloadApplied(false);
      return;
    }

    const selectedRoutine = availableRoutines.find(r => r.id === routineId);
    if (!selectedRoutine) return;

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
                prefill: makePrefill(performanceEntry, initialSets),
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
    setOriginalLogState(newLog);
    // The fresh log has untransformed sets; a stale `deloadApplied` would make
    // `currentLog` skip the deload transform while the Deload alert still shows.
    setDeloadApplied(false);
  };

  const addExerciseToLog = async (exercise: Exercise, index?: number) => {
    if (!user?.id) return;

    // One exercise per day, same rule as routines. The picker already marks logged
    // exercises as "Added"; this guards the other entry points.
    if (originalLogState?.exercises.some(ex => ex.exerciseId === exercise.id)) {
      toast({
        title: "Already in today's log",
        description: `${exercise.name} is already logged for this day. Add sets to the existing entry instead.`,
      });
      return;
    }

    const dateOfLog = format(selectedDate, 'yyyy-MM-dd');

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
      prefill: makePrefill(performanceEntry, initialSets),
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
    const performanceEntry = await fetchExercisePerformanceData(newExercise.id);

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
        prefill: makePrefill(performanceEntry, initialSets),
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
    // `isProvisional` is derived from the prefill, never trusted from the card.
    const finalUpdated = withDerivedProvisional(updated);
    mutateBaseline((base) => {
      if (!base) return null;
      return {
        ...base,
        exercises: base.exercises.map(ex => (ex.id === finalUpdated.id ? finalUpdated : ex)),
      };
    });
  };
  
  const updateExerciseSetStructureOverride = (exerciseId: string, structure: SetStructure | null) => {
    const base = originalLogState ?? currentLog;
    if (!base) return;

    const nextBaseline: WorkoutLog = {
      ...base,
      exercises: base.exercises.map(ex =>
        ex.id === exerciseId
          ? { ...ex, setStructureOverride: structure }
          : ex
      ),
    };
    // State only: `setStructureOverride` is part of `persistedShape`, so the
    // change shows as unsaved and is written by the user's explicit Save.
    setOriginalLogState(nextBaseline);
  };
  
  const saveCurrentLog = async () => {
    if (!user?.id || !currentLog) {
      toast({ title: "Error", description: "No user or log data to save.", variant: "destructive" });
      return;
    }
    setIsSavingLog(true);

    try {
      // Save what the user sees. For a (not yet applied) deload that is the
      // transformed view; the reduced sets are persisted with `deloadApplied`
      // so the next load shows them as stored instead of reducing them again.
      const logToSave: WorkoutLog = { ...currentLog };

      if (isDeload) {
        logToSave.isDeload = true;
        logToSave.deloadApplied = true;
        logToSave.deloadParams = DEFAULT_DELOAD_PARAMS;
      } else {
        logToSave.isDeload = false;
        logToSave.deloadApplied = false;
        logToSave.deloadParams = undefined;
      }

      const perfById = await fetchPerformanceDataByExerciseId(
        logToSave.exercises.map(ex => ex.exerciseId)
      );

      const exercisesWithUpdatedPrs = logToSave.exercises.map((loggedEx) => {
        const { isProvisional, ...restOfEx } = loggedEx;
        const performanceEntry = perfById.get(restOfEx.exerciseId) ?? null;
        const storedPR = performanceEntry?.personalRecord
            ? { reps: performanceEntry.personalRecord.reps, weight: performanceEntry.personalRecord.weight }
            : null;
        const sets = restOfEx.sets.map(s => {
            const { isProvisional: setProvisional, ...restOfSet } = s;
            return restOfSet;
        });

        // Fold today's best set into the local PR display (the backend entry is
        // updated below) so no refetch is needed after saving.
        const bestToday = (!isDeload && !isProvisional) ? pickBestSet(sets) : null;
        const currentPR = bestToday && isBetterPR(bestToday, storedPR) ? bestToday : storedPR;

        return {
          ...restOfEx,
          personalRecordDisplay: formatPR(currentPR),
          currentPR: currentPR,
          sets,
        };
      });

      const finalLogToSave: WorkoutLog = {
        ...logToSave,
        exercises: exercisesWithUpdatedPrs,
        exerciseIds: Array.from(new Set(exercisesWithUpdatedPrs.map(ex => ex.exerciseId))),
      };

      const shouldSaveMainLogDocument = finalLogToSave.exercises.length > 0 || (finalLogToSave.notes && finalLogToSave.notes.trim() !== '') || finalLogToSave.routineId;

      if (shouldSaveMainLogDocument) {
          await saveLogService(user.id, finalLogToSave.id, finalLogToSave);
          if (!finalLogToSave.isDeload) {
            const entriesToPersist = logToSave.exercises
              .filter(ex => !ex.isProvisional)
              .map(ex => ({ exerciseId: ex.exerciseId, sets: ex.sets }));
            if (entriesToPersist.length > 0) {
              await saveExercisePerformanceEntries(user.id, entriesToPersist, finalLogToSave.id);
            }
          }
          // Update local state from the payload just saved instead of refetching.
          setOriginalLogState(finalLogToSave);
          setSavedSnapshot(finalLogToSave);
          setDeloadApplied(finalLogToSave.deloadApplied ?? false);
          await refreshMonthFlags();
          toast({ title: "Log Saved", description: `Workout for ${formattedDateId} saved.` });
      } else {
          const existingLogDocument = await fetchLogService(user.id, finalLogToSave.id);
          if (existingLogDocument) {
              await deleteLogService(user.id, finalLogToSave.id);
              await Promise.all(existingLogDocument.exercises.map(exInDeletedLog =>
                  updatePerformanceEntryOnLogDelete(user.id!, exInDeletedLog.exerciseId, finalLogToSave.id)
              ));
              await refreshMonthFlags();
              setSavedSnapshot(finalLogToSave);
              toast({ title: "Log Cleared", description: `Empty log for ${formattedDateId} was cleared.`});
          } else {
              setSavedSnapshot(finalLogToSave);
              toast({ title: "Log Not Saved", description: "Log is empty."});
          }
      }

    } catch (error: any) {
      console.error('[useTrainingLog] saveCurrentLog failed:', error);
      toast({ title: "Save error", description: friendlyErrorMessage(error, "Couldn't save your workout. Check your connection and try again."), variant: "destructive" });
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

    try {
      const logSnapshotForPrUpdate = await fetchLogService(user.id, logIdToDelete);
      const exercisesInDeletedLog = logSnapshotForPrUpdate ? [...logSnapshotForPrUpdate.exercises] : [];

      await deleteLogService(user.id, logIdToDelete);

      await Promise.all(exercisesInDeletedLog.map(deletedEx =>
        updatePerformanceEntryOnLogDelete(user.id!, deletedEx.exerciseId, logIdToDelete)
          .catch((prClearError: any) => {
            console.error(`[HOOK] deleteCurrentLog: Failed to clear/update PR for ${deletedEx.name}: ${prClearError.message}`);
          })
      ));

      const empty = makeEmptyLog(logIdToDelete);
      setOriginalLogState(empty);
      setSavedSnapshot(empty);
      setIsDeload(false);
      setDeloadApplied(false);

      toast({ title: "Log Deleted", description: `Workout for ${logIdToDelete} has been deleted.` });
      await refreshMonthFlags();
    } catch (error: any) {
      console.error('[useTrainingLog] deleteCurrentLog failed:', error);
      toast({ title: "Delete error", description: friendlyErrorMessage(error, "Couldn't delete the workout. Please try again."), variant: "destructive" });
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
    isDirty,
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
    updateOverallLogNotes,
    deleteCurrentLog,
    isDeload,
    setIsDeload,
    displayedMonth,
    setDisplayedMonth,
  };
};


    


    


    




