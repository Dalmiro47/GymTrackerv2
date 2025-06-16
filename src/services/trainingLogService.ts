
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves/updates the performance snapshot (last session & PR) for an exercise.
 * - getLastLoggedPerformance: Retrieves the performance snapshot for an exercise.
 * - deleteAllPerformanceEntriesForExercise: Deletes the performance entry for a specific exercise.
 * - getLoggedDateStrings: Fetches all dates ("yyyy-MM-dd") that have workout logs.
 * - updatePerformanceEntryOnLogDelete: Updates an exercise's performance entry (PR, last sets) if sourced from a deleted log, attempting to fall back to the next newest log.
 * - saveSingleExerciseToLogService: Saves a single exercise to a specific day's workout log.
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
  arrayUnion, 
  arrayRemove
} from 'firebase/firestore';
import { format, parseISO, fromUnixTime } from 'date-fns';

const getUserWorkoutLogsCollectionPath = (userId: string) => `users/${userId}/workoutLogs`;
const getUserPerformanceEntriesCollectionPath = (userId: string) => `users/${userId}/performanceEntries`;


export const saveWorkoutLog = async (userId: string, date: string, workoutLogPayload: WorkoutLog): Promise<void> => {
  console.log(`[SERVICE] saveWorkoutLog: Initiated for userId: ${userId}, date: ${date}`);

  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to save a workout log.");

  if (workoutLogPayload.id !== date || workoutLogPayload.date !== date) {
    console.warn("[SERVICE] saveWorkoutLog: Mismatched date information in workoutLogPayload.",
                  "Expected date based on doc ID:", date,
                  "Payload ID:", workoutLogPayload.id,
                  "Payload date:", workoutLogPayload.date);
    workoutLogPayload.id = date;
    workoutLogPayload.date = date;
  }
  
  const exerciseIds = workoutLogPayload.exercises.map(ex => ex.exerciseId);
  
  const payloadForFirestore: Partial<WorkoutLog> = { 
    ...workoutLogPayload,
    exerciseIds: exerciseIds,
    exercises: workoutLogPayload.exercises.map(ex => { // Strip UI-only fields from exercises
      const { isProvisional, personalRecordDisplay, ...restOfEx } = ex;
      return {
        ...restOfEx,
        sets: ex.sets.map(s => {
          const { isProvisional: setIsProvisional, ...restOfSet } = s;
          return { // Ensure sets are numbers
             id: restOfSet.id,
             reps: restOfSet.reps === null || isNaN(Number(restOfSet.reps)) ? 0 : Number(restOfSet.reps),
             weight: restOfSet.weight === null || isNaN(Number(restOfSet.weight)) ? 0 : Number(restOfSet.weight),
          };
        })
      };
    })
  };

  if (payloadForFirestore.routineId === undefined) {
    delete payloadForFirestore.routineId;
  }
  if (payloadForFirestore.routineName === undefined) {
    delete payloadForFirestore.routineName;
  }
  if (payloadForFirestore.duration === undefined) {
    delete payloadForFirestore.duration;
  }

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  console.log(`[SERVICE] saveWorkoutLog: Document reference path: ${logDocRef.path}`);
  // console.log(`[SERVICE] saveWorkoutLog: Payload being saved to Firestore:`, JSON.stringify(payloadForFirestore, null, 2));

  try {
    await setDoc(logDocRef, payloadForFirestore, { merge: true }); 
    console.log(`[SERVICE] Workout log for ${date} saved successfully for user ${userId}.`);
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
      // Ensure exercises in the fetched log also get their sets' provisional flag defaulted if absent
      const exercisesWithSetProvisionalDefaults = logData.exercises.map(ex => ({
        ...ex,
        sets: ex.sets.map(s => ({
          ...s,
          isProvisional: s.isProvisional === undefined ? false : s.isProvisional
        }))
      }));
      return { ...logData, exercises: exercisesWithSetProvisionalDefaults };
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
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    newPersonalRecord = existingEntryData?.personalRecord || null;

    if (validCurrentSessionSets.length > 0) {
        const bestSetThisSession = findBestSetInSetsArray(validCurrentSessionSets);
        if (bestSetThisSession) {
          if (!newPersonalRecord || 
              bestSetThisSession.weight > newPersonalRecord.weight ||
              (bestSetThisSession.weight === newPersonalRecord.weight && bestSetThisSession.reps > newPersonalRecord.reps)) {
            newPersonalRecord = {
              reps: bestSetThisSession.reps,
              weight: bestSetThisSession.weight,
              date: Timestamp.now().toMillis(), 
              logId: logDate, 
            };
          }
        }
    }
    const entryDataToSave: ExercisePerformanceEntry = {
      lastPerformedDate: validCurrentSessionSets.length > 0 ? Timestamp.now().toMillis() : (existingEntryData?.lastPerformedDate || null),
      lastPerformedSets: validCurrentSessionSets.length > 0 ? validCurrentSessionSets : (existingEntryData?.lastPerformedSets || []), 
      personalRecord: newPersonalRecord,
    };
    await setDoc(performanceEntryDocRef, entryDataToSave, { merge: true });
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

  const entryData = perfSnap.data() as ExercisePerformanceEntry;
  let needsFallbackRecalculation = false;
  const updatedFields: Partial<ExercisePerformanceEntry> = {};

  if (entryData.personalRecord?.logId === deletedLogId) {
    updatedFields.personalRecord = null;
    needsFallbackRecalculation = true;
  } else {
    updatedFields.personalRecord = entryData.personalRecord;
  }

  if (entryData.lastPerformedDate) {
    const lastPerformedDateString = format(new Date(entryData.lastPerformedDate), "yyyy-MM-dd");
    if (lastPerformedDateString === deletedLogId) {
      updatedFields.lastPerformedDate = null;
      updatedFields.lastPerformedSets = [];
      needsFallbackRecalculation = true;
    } else {
      updatedFields.lastPerformedDate = entryData.lastPerformedDate;
      updatedFields.lastPerformedSets = entryData.lastPerformedSets;
    }
  } else {
    updatedFields.lastPerformedDate = null;
    updatedFields.lastPerformedSets = [];
  }

  if (!needsFallbackRecalculation) {
    if (entryData.personalRecord?.logId === deletedLogId && updatedFields.lastPerformedDate !== null) {
         await updateDoc(perfRef, { personalRecord: null });
    }
    return;
  }
  
  const logsCol = collection(db, getUserWorkoutLogsCollectionPath(userId));
  let logsQuery = query(
    logsCol,
    where("exerciseIds", "array-contains", exerciseId),
    orderBy("date", "desc"),
    limit(1) 
  );
  
  let logsSnap = await getDocs(logsQuery);
  let fallbackLogDoc: typeof logsSnap.docs[0] | undefined = logsSnap.docs[0];

  if (logsSnap.empty) {
    const fullLogsQuery = query(logsCol, orderBy("date", "desc"));
    const fullLogsSnap = await getDocs(fullLogsQuery);
    
    fallbackLogDoc = fullLogsSnap.docs.find(doc => {
        const logData = doc.data() as WorkoutLog;
        if (doc.id === deletedLogId) return false;
        if (logData.exerciseIds && logData.exerciseIds.includes(exerciseId)) {
            return true;
        }
        return logData.exercises.some(e => e.exerciseId === exerciseId);
    });
  }

  if (!fallbackLogDoc) {
    await updateDoc(perfRef, {
      personalRecord: null,
      lastPerformedDate: null,
      lastPerformedSets: [],
    });
    return;
  }

  const fallbackLogData = fallbackLogDoc.data() as WorkoutLog;
  const exerciseInFallbackLog = fallbackLogData.exercises.find(e => e.exerciseId === exerciseId);

  if (!exerciseInFallbackLog) {
    await updateDoc(perfRef, {
      personalRecord: null,
      lastPerformedDate: null,
      lastPerformedSets: [],
    });
    return;
  }
  
  const bestSetInFallback = findBestSetInSetsArray(exerciseInFallbackLog.sets);

  const newEntryData: Partial<ExercisePerformanceEntry> = {
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
  await updateDoc(perfRef, newEntryData);
};


export const saveSingleExerciseToLogService = async (
  userId: string,
  date: string, // YYYY-MM-DD
  loggedExerciseData: LoggedExercise
): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required.");
  if (!loggedExerciseData) throw new Error("Exercise data is required.");

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);

  // Prepare the exercise for storage (strip UI fields, ensure numeric sets)
  const { isProvisional, personalRecordDisplay, ...restOfEx } = loggedExerciseData;
  const exerciseToStore: LoggedExercise = {
    ...restOfEx,
    sets: loggedExerciseData.sets.map(s => {
      const { isProvisional: setIsProvisional, ...restOfSet } = s; // Remove isProvisional from set if it exists
      return {
        id: restOfSet.id,
        reps: restOfSet.reps === null || isNaN(Number(restOfSet.reps)) ? 0 : Number(restOfSet.reps),
        weight: restOfSet.weight === null || isNaN(Number(restOfSet.weight)) ? 0 : Number(restOfSet.weight),
      };
    }),
  };

  try {
    const docSnap = await getDoc(logDocRef);

    if (docSnap.exists()) {
      // Log exists, update it
      const existingLog = docSnap.data() as WorkoutLog;
      let exercises = [...existingLog.exercises];
      const exerciseIndex = exercises.findIndex(ex => ex.exerciseId === exerciseToStore.exerciseId);

      if (exerciseIndex > -1) {
        // Exercise already exists, replace it
        exercises[exerciseIndex] = exerciseToStore;
      } else {
        // Exercise is new to this log, add it
        exercises.push(exerciseToStore);
      }
      
      const updatedExerciseIds = Array.from(new Set(exercises.map(ex => ex.exerciseId)));

      await updateDoc(logDocRef, {
        exercises: exercises,
        exerciseIds: updatedExerciseIds,
        // Potentially update a 'lastModified' timestamp here if needed
      });
    } else {
      // Log doesn't exist, create it
      const newLog: WorkoutLog = {
        id: date,
        date: date,
        exercises: [exerciseToStore],
        exerciseIds: [exerciseToStore.exerciseId],
        notes: '', // Initialize with empty notes
        // routineId and routineName can be undefined
      };
      await setDoc(logDocRef, newLog);
    }
  } catch (error: any) {
    console.error(`[SERVICE] Error in saveSingleExerciseToLogService for date ${date}, exercise ${loggedExerciseData.name}:`, error);
    throw new Error(`Failed to save exercise to log. ${error.message}`);
  }
};
