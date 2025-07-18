
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
  updateDoc,
  deleteDoc as deleteFirestoreDoc,
  Timestamp,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  FieldValue,
  deleteField,
} from 'firebase/firestore';
import { format, parseISO, fromUnixTime } from 'date-fns';

const getUserWorkoutLogsCollectionPath = (userId: string) => `users/${userId}/workoutLogs`;
const getUserPerformanceEntriesCollectionPath = (userId: string) => `users/${userId}/performanceEntries`;


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
      const { personalRecordDisplay, ...restOfEx } = ex; // Remove UI-only fields
      return {
        ...restOfEx,
        sets: ex.sets.map(s => {
          // const { isProvisional: setIsProvisional, ...restOfSet } = s; // This is now handled on the parent
          return { 
             id: s.id,
             reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
             weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
          };
        })
      };
    })
  };

  // Clean up optional fields before saving
  if (payloadForFirestore.routineId === undefined || payloadForFirestore.routineId === null) delete (payloadForFirestore as any).routineId;
  if (payloadForFirestore.routineName === undefined || payloadForFirestore.routineName === null) delete (payloadForFirestore as any).routineName;
  if (payloadForFirestore.duration === undefined || payloadForFirestore.duration === null) delete (payloadForFirestore as any).duration;
  payloadForFirestore.notes = payloadForFirestore.notes || '';


  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    await setDoc(logDocRef, payloadForFirestore, { merge: true }); 
  } catch (error: any) {
    console.error(`[SERVICE] Error saving workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to save workout log. ${error.message}`);
  }
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
      // When fetching, ensure isProvisional is present on exercises for the UI
      const exercisesWithProvisional = logData.exercises.map(ex => ({
        ...ex,
        isProvisional: ex.isProvisional ?? false,
      }));
      return { ...logData, exercises: exercisesWithProvisional };
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

const findBestSetInSetsArray = (sets: LoggedSet[]): { reps: number; weight: number } | null => {
  if (!sets || sets.length === 0) return null;
  let bestSet: { reps: number; weight: number } | null = null;
  for (const set of sets) {
    const weight = typeof set.weight === 'number' ? set.weight : 0;
    const reps = typeof set.reps === 'number' ? set.reps : 0;

    if (weight <= 0 && reps <= 0) continue;

    if (!bestSet || weight > bestSet.weight || (weight === bestSet.weight && reps > bestSet.reps)) {
      bestSet = { weight, reps };
    }
  }
  return bestSet;
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

  const validCurrentSessionSets = currentSessionSets
    .map(s => ({
      id: s.id || `set-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
      reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
      weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
    }))
    .filter(s => s.reps > 0 || s.weight > 0); 
  
  const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
  
  let newPersonalRecord: PersonalRecord | null = null;
  let newLastPerformedDate: number | null = null;
  let newLastPerformedSets: LoggedSet[] = [];
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    newPersonalRecord = existingEntryData?.personalRecord || null;

    if (validCurrentSessionSets.length > 0) {
        newLastPerformedDate = Timestamp.now().toMillis();
        newLastPerformedSets = validCurrentSessionSets;

        const bestSetThisSession = findBestSetInSetsArray(validCurrentSessionSets);
        if (bestSetThisSession) {
          if (!newPersonalRecord || 
              bestSetThisSession.weight > newPersonalRecord.weight ||
              (bestSetThisSession.weight === newPersonalRecord.weight && bestSetThisSession.reps > newPersonalRecord.reps)) {
            newPersonalRecord = {
              reps: bestSetThisSession.reps,
              weight: bestSetThisSession.weight,
              date: newLastPerformedDate, 
              logId: logDate, 
            };
          }
        }
    } else {
        newLastPerformedDate = existingEntryData?.lastPerformedDate || null;
        newLastPerformedSets = existingEntryData?.lastPerformedSets || [];
    }

    const isEntryEffectivelyEmpty = !newPersonalRecord && (!newLastPerformedDate || newLastPerformedSets.length === 0);

    if (isEntryEffectivelyEmpty) {
      if (existingDocSnap.exists()) {
        await deleteFirestoreDoc(performanceEntryDocRef);
      }
    } else {
      const entryDataToSave: Partial<ExercisePerformanceEntry> = {};
      if (newPersonalRecord) {
        entryDataToSave.personalRecord = newPersonalRecord;
      } else {
        entryDataToSave.personalRecord = deleteField() as any;
      }
      if (newLastPerformedDate && newLastPerformedSets.length > 0) {
        entryDataToSave.lastPerformedDate = newLastPerformedDate;
        entryDataToSave.lastPerformedSets = newLastPerformedSets;
      } else {
        entryDataToSave.lastPerformedDate = deleteField() as any;
        entryDataToSave.lastPerformedSets = []; 
      }
      await setDoc(performanceEntryDocRef, entryDataToSave, { merge: true });
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

  for (const doc of logsSnap.docs) {
    if (doc.id !== deletedLogId) { 
        fallbackLogDoc = doc;
        break;
    }
  }

  if (!fallbackLogDoc) { 
    await deleteFirestoreDoc(perfRef);
    return;
  }

  const fallbackLogData = fallbackLogDoc.data() as WorkoutLog;
  const exerciseInFallbackLog = fallbackLogData.exercises.find(e => e.exerciseId === exerciseId);

  if (!exerciseInFallbackLog || exerciseInFallbackLog.sets.length === 0 || exerciseInFallbackLog.sets.every(s => (s.reps ?? 0) === 0 && (s.weight ?? 0) === 0)) {
    await deleteFirestoreDoc(perfRef);
    return;
  }
  
  const bestSetInFallback = findBestSetInSetsArray(exerciseInFallbackLog.sets);

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


/**
 * @deprecated This function is deprecated and should not be used. Use saveWorkoutLog instead.
 */
export const saveSingleExerciseToLogService = async (): Promise<void> => {
  console.warn("saveSingleExerciseToLogService is deprecated. Use saveWorkoutLog for all log saving operations.");
  return Promise.resolve();
};
