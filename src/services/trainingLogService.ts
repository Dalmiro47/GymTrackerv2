
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves/updates the performance snapshot (last session & PR) for an exercise. Deletes entry if it becomes empty.
 * - getLastLoggedPerformance: Retrieves the performance snapshot for an exercise.
 * - deleteAllPerformanceEntriesForExercise: Deletes the performance entry for a specific exercise.
 * - getLoggedDateStrings: Fetches all dates ("yyyy-MM-dd") that have workout logs.
 * - updatePerformanceEntryOnLogDelete: Updates an exercise's performance entry (PR, last sets) if sourced from a deleted log, attempting to fall back to the next newest log. Deletes entry if it becomes empty.
 * - saveSingleExerciseToLogService: This function is deprecated and replaced by saveWorkoutLog. It is kept for reference but should not be used.
 */
import { db } from '@/lib/firebaseConfig';
import type { WorkoutLog, LoggedSet, LoggedExercise, ExercisePerformanceEntry, PersonalRecord } from '@/types';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc as deleteFirestoreDoc,
  Timestamp,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  deleteField,
} from 'firebase/firestore';
import { parseISO, startOfMonth, endOfMonth, format as fmt } from 'date-fns';
import { stripUndefinedDeep } from '@/lib/sanitize';
import { validWorkingSets, pickBestSet, isBetterPR } from '@/lib/pr';
import { snapToHalf } from '@/lib/rounding';

const getUserWorkoutLogsCollectionPath = (userId: string) => `users/${userId}/workoutLogs`;
const getUserPerformanceEntriesCollectionPath = (userId: string) => `users/${userId}/performanceEntries`;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const saveWorkoutLog = async (userId: string, date: string, workoutLogPayload: WorkoutLog): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to save a workout log.");

  if (workoutLogPayload.id !== date || workoutLogPayload.date !== date) {
    workoutLogPayload.id = date;
    workoutLogPayload.date = date;
  }
  
  const exerciseIds = workoutLogPayload.exercises.map(ex => ex.exerciseId);
  
  const payloadForFirestore: WorkoutLog = { 
    ...workoutLogPayload,
    exerciseIds: exerciseIds,
    exercises: workoutLogPayload.exercises.map(ex => { 
      // Destructure to remove UI-only fields before saving
      const { personalRecordDisplay, isProvisional, currentPR, ...restOfEx } = ex;

      // Clean up optional fields that might be null or undefined on the exercise
      const exerciseToSave: { [key: string]: any } = { ...restOfEx };
      if (exerciseToSave.setStructure === 'normal' || !exerciseToSave.setStructure) {
        delete exerciseToSave.setStructure;
      }
      if (!exerciseToSave.setStructureOverride) {
        delete exerciseToSave.setStructureOverride;
      }
      
      return {
        ...exerciseToSave,
        sets: ex.sets.map(s => {
          const { isProvisional, ...restOfSet } = s;
        
          // reps: 0..99 integer
          const repsNum = Number(restOfSet.reps);
          const reps =
            Number.isFinite(repsNum) ? clamp(Math.trunc(Math.abs(repsNum)), 0, 99) : 0;
        
          // weight: 0..999 snapped to .0/.5 only
          const wNum = Number(restOfSet.weight);
          let weight = Number.isFinite(wNum) ? clamp(Math.abs(wNum), 0, 999) : 0;
          weight = snapToHalf(weight) ?? 0;
        
          return {
            id: restOfSet.id,
            reps,
            weight,
          };
        })
      } as LoggedExercise;
    })
  };

  // Clean up optional fields on the root log object before saving
  if (payloadForFirestore.routineId === undefined || payloadForFirestore.routineId === null) delete (payloadForFirestore as any).routineId;
  if (payloadForFirestore.routineName === undefined || payloadForFirestore.routineName === null) delete (payloadForFirestore as any).routineName;
  if (payloadForFirestore.duration === undefined || payloadForFirestore.duration === null) delete (payloadForFirestore as any).duration;
  
  // Always set isDeload to a boolean for consistent querying
  payloadForFirestore.isDeload = !!payloadForFirestore.isDeload;
  if (!payloadForFirestore.isDeload) {
    delete (payloadForFirestore as any).deloadParams;
  }

  payloadForFirestore.notes = payloadForFirestore.notes || '';


  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const sanitizedPayload = stripUndefinedDeep(payloadForFirestore);
    await setDoc(logDocRef, sanitizedPayload, { merge: true }); 
  } catch (error: any) {
    console.error(`[SERVICE] Error saving workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to save workout log. ${error.message}`);
  }
};

export const saveSingleExerciseToLogService = async (userId: string, date: string, workoutLogPayload: WorkoutLog): Promise<void> => {
  await saveWorkoutLog(userId, date, workoutLogPayload);
};


export const getWorkoutLog = async (userId: string, date: string): Promise<WorkoutLog | null> => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  if (!date) {
    throw new Error("Date is required to fetch a workout log.");
  }
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const docSnap = await getDoc(logDocRef);
    if (docSnap.exists()) {
      const logData = docSnap.data() as WorkoutLog;
      // Normalize exercises for backward compatibility (and UI)
      const exercisesNormalized = (logData.exercises || []).map(ex => ({
        ...ex,
        isProvisional: ex.isProvisional ?? false,
        setStructure: ex.setStructure ?? 'normal',
        setStructureOverride: ex.setStructureOverride ?? null,
      }));
      return { ...logData, exercises: exercisesNormalized };
    }
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error fetching workout log for userId: ${userId}, date: ${date}:`, error);
    throw new Error(`Failed to fetch workout log. ${error.message}`);
  }
};


export const deleteWorkoutLog = async (userId: string, date: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to delete a workout log.");

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    await deleteFirestoreDoc(logDocRef);
  } catch (error: any) {
    console.error(`[SERVICE] Error deleting workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to delete workout log. ${error.message}`);
  }
};

export const getLoggedDateStrings = async (userId: string): Promise<string[]> => {
  if (!userId) {
    console.error("[SERVICE] getLoggedDateStrings: User ID is required.");
    return [];
  }
  const logsCollectionRef = collection(db, getUserWorkoutLogsCollectionPath(userId));
  try {
    const querySnapshot = await getDocs(logsCollectionRef);
    const dates: string[] = [];
    querySnapshot.forEach((doc) => {
      dates.push(doc.id); 
    });
    return dates;
  } catch (error: any) {
    console.error(`[SERVICE] getLoggedDateStrings: Error fetching logged dates for userId ${userId}:`, error);
    return []; 
  }
};

// New: fetch only the log doc IDs (yyyy-MM-dd) inside a given month.
export const getLoggedDateStringsInMonth = async (
  userId: string,
  month: Date
): Promise<string[]> => {
  if (!userId) return [];
  const logsCollectionRef = collection(db, getUserWorkoutLogsCollectionPath(userId));

  // IDs are 'yyyy-MM-dd', so we can use lexicographic range on the "date" field.
  const start = fmt(startOfMonth(month), 'yyyy-MM-dd');
  const end = fmt(endOfMonth(month), 'yyyy-MM-dd');

  try {
    const q = query(
      logsCollectionRef,
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'asc')
    );
    const snap = await getDocs(q);
    const dates: string[] = [];
    snap.forEach(doc => dates.push(doc.id));
    return dates;
  } catch (e) {
    console.error('[SERVICE] getLoggedDateStringsInMonth error:', e);
    return [];
  }
};

export type MonthLogFlags = {
  logged: string[];  // non-deload days (isDeload !== true)
  deload: string[];  // deload days (isDeload === true)
};

export const getMonthLogFlags = async (
  userId: string,
  month: Date
): Promise<MonthLogFlags> => {
  if (!userId) return { logged: [], deload: [] };

  const logsCollectionRef = collection(db, getUserWorkoutLogsCollectionPath(userId));
  const start = fmt(startOfMonth(month), 'yyyy-MM-dd');
  const end = fmt(endOfMonth(month), 'yyyy-MM-dd');

  try {
    const q = query(
      logsCollectionRef,
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'asc')
    );
    const snap = await getDocs(q);

    const logged: string[] = [];
    const deload: string[] = [];

    snap.forEach(docSnap => {
      const id = docSnap.id; // "yyyy-MM-dd"
      const data = docSnap.data() as WorkoutLog;
      if (data?.isDeload === true) {
        deload.push(id);
      } else {
        logged.push(id);
      }
    });

    return { logged, deload };
  } catch (e) {
    console.error('[SERVICE] getMonthLogFlags error:', e);
    return { logged: [], deload: [] };
  }
};

export const saveExercisePerformanceEntry = async (
  userId: string,
  exerciseId: string,
  currentSessionSets: LoggedSet[],
  logDate: string 
): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");
  if (!logDate) throw new Error("Log date is required for PR tracking.");
  
  const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    const bestToday = pickBestSet(currentSessionSets);
    const currentPR = existingEntryData?.personalRecord ?? null;
    const achievedAtMs = Timestamp.fromDate(parseISO(logDate)).toMillis();
    
    const updatePayload: Partial<ExercisePerformanceEntry> & { lastPerformedDate?: number } = {
        lastPerformedSets: validWorkingSets(currentSessionSets),
        lastPerformedDate: achievedAtMs
    };
    
    if (isBetterPR(bestToday, currentPR)) {
        updatePayload.personalRecord = {
            reps: bestToday!.reps,
            weight: bestToday!.weight,
            date: achievedAtMs, 
            logId: logDate, 
        };
    }

    const sanitizedPayload = stripUndefinedDeep(updatePayload);

    if (existingDocSnap.exists()) {
        await setDoc(performanceEntryDocRef, sanitizedPayload, { merge: true });
    } else {
        await setDoc(performanceEntryDocRef, sanitizedPayload);
    }

  } catch (error: any) {
    console.error(`[SERVICE] saveExercisePerformanceEntry: Error saving/updating exercise performance entry for exerciseId=${exerciseId}:`, error);
    throw new Error(`Failed to save performance entry for ${exerciseId}. ${error.message}`);
  }
};


export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  if (!exerciseId) {
    throw new Error("Exercise ID is required.");
  }
  const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
  try {
    const docSnap = await getDoc(performanceEntryDocRef);
    if (docSnap.exists()) {
      return docSnap.data() as ExercisePerformanceEntry;
    }
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error getLastLoggedPerformance for exerciseId=${exerciseId}:`, error);
    return null; 
  }
};

export const getLastNonDeloadPerformance = async (userId: string, exerciseId: string, routineId?: string): Promise<ExercisePerformanceEntry | null> => {
    if (!userId || !exerciseId) return null;

    try {
        // First, get the overall performance entry which holds the definitive PR
        const overallPerformanceEntry = await getLastLoggedPerformance(userId, exerciseId);

        // Next, find the sets from the most recent non-deload day to use for pre-filling
        const logsColRef = collection(db, getUserWorkoutLogsCollectionPath(userId));
        const q = query(
            logsColRef,
            where("exerciseIds", "array-contains", exerciseId),
            orderBy("date", "desc"),
            limit(10) // Fetch a few recent logs to find a non-deload one
        );
        const logsSnap = await getDocs(q);
        const lastNonDeloadLogDoc = logsSnap.docs.find(doc => doc.data()?.isDeload !== true);

        let lastSets: LoggedSet[] = [];
        let lastDate: number | null = null;

        if (lastNonDeloadLogDoc) {
            const logData = lastNonDeloadLogDoc.data() as WorkoutLog;
            const exerciseInLog = logData.exercises.find(e => e.exerciseId === exerciseId);
            if (exerciseInLog) {
                lastSets = exerciseInLog.sets;
                lastDate = Timestamp.fromDate(parseISO(logData.date)).toMillis();
            }
        } else if (overallPerformanceEntry?.lastPerformedSets) {
            // Fallback to the overall last performance if no specific non-deload log is found
            lastSets = overallPerformanceEntry.lastPerformedSets;
            lastDate = overallPerformanceEntry.lastPerformedDate;
        }

        // If neither source gives us anything, return null
        if (!overallPerformanceEntry && lastSets.length === 0) {
            return null;
        }

        // Combine the definitive PR with the last non-deload sets
        return {
            personalRecord: overallPerformanceEntry?.personalRecord || null,
            lastPerformedSets: lastSets,
            lastPerformedDate: lastDate,
        };

    } catch (e) {
        console.error("Error fetching non-deload performance; falling back to overall last performance.", e);
        // Fallback to the simplest fetch in case of query errors
        return await getLastLoggedPerformance(userId, exerciseId);
    }
};


export const deleteAllPerformanceEntriesForExercise = async (userId: string, exerciseId: string): Promise<void> => {
    if (!userId) throw new Error("User ID is required.");
    if (!exerciseId) throw new Error("Exercise ID is required.");
    const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
    try {
        await deleteFirestoreDoc(performanceEntryDocRef);
    } catch (error: any) {
        console.error(`Error deleting performance entry for exercise ${exerciseId}:`, error);
    }
};

export const updatePerformanceEntryOnLogDelete = async (
  userId: string,
  exerciseId: string,
  deletedLogId: string
): Promise<void> => {
  if (!userId || !exerciseId || !deletedLogId) {
    console.error("[SERVICE] updatePerformanceEntryOnLogDelete: Missing parameters.");
    throw new Error("Missing parameters in updatePerformanceEntryOnLogDelete");
  }
  const perfRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
  const perfSnap = await getDoc(perfRef);

  if (!perfSnap.exists()) {
    return;
  }
  
  const logsCol = collection(db, getUserWorkoutLogsCollectionPath(userId));
  let logsQuery = query(
    logsCol,
    where("exerciseIds", "array-contains", exerciseId),
    orderBy("date", "desc")
  );
  
  let logsSnap = await getDocs(logsQuery);
  let fallbackLogDoc: typeof logsSnap.docs[0] | undefined;

  // Find the next most recent log that isn't the one being deleted
  for (const doc of logsSnap.docs) {
    if (doc.id !== deletedLogId) { 
        fallbackLogDoc = doc;
        break;
    }
  }

  // If no other logs exist for this exercise, delete the performance entry
  if (!fallbackLogDoc) { 
    await deleteFirestoreDoc(perfRef);
    return;
  }

  const fallbackLogData = fallbackLogDoc.data() as WorkoutLog;
  const exerciseInFallbackLog = fallbackLogData.exercises.find(e => e.exerciseId === exerciseId);

  // If the fallback log doesn't actually contain the exercise or its sets are empty, delete
  if (!exerciseInFallbackLog || exerciseInFallbackLog.sets.length === 0 || exerciseInFallbackLog.sets.every(s => (s.reps ?? 0) === 0 && (s.weight ?? 0) === 0)) {
    await deleteFirestoreDoc(perfRef);
    return;
  }
  
  const bestSetInFallback = pickBestSet(exerciseInFallbackLog.sets);

  const newEntryDataToSet: ExercisePerformanceEntry = { 
    lastPerformedDate: Timestamp.fromDate(parseISO(fallbackLogData.id)).toMillis(),
    lastPerformedSets: exerciseInFallbackLog.sets.map(s => ({
      id: s.id, 
      reps: Number(s.reps ?? 0),
      weight: Number(s.weight ?? 0),
    })),
    personalRecord: bestSetInFallback
      ? {
          reps: bestSetInFallback.reps,
          weight: bestSetInFallback.weight,
          date: Timestamp.fromDate(parseISO(fallbackLogData.id)).toMillis(),
          logId: fallbackLogData.id,
        }
      : null,
  };
  
  const isFallbackEntryEmpty = !newEntryDataToSet.personalRecord && 
                                (!newEntryDataToSet.lastPerformedDate || newEntryDataToSet.lastPerformedSets.length === 0);

  if (isFallbackEntryEmpty) {
      await deleteFirestoreDoc(perfRef);
  } else {
    const finalData = {...newEntryDataToSet};
    if (finalData.personalRecord === null) {
      delete (finalData as any).personalRecord;
      await setDoc(perfRef, {
          lastPerformedDate: finalData.lastPerformedDate,
          lastPerformedSets: finalData.lastPerformedSets,
          personalRecord: deleteField() 
      });
    } else {
        await setDoc(perfRef, finalData); 
    }
  }
};
