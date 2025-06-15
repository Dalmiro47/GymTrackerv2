
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
 */
import { db } from '@/lib/firebaseConfig';
import type { WorkoutLog, LoggedSet, ExercisePerformanceEntry, PersonalRecord } from '@/types';
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
  updateDoc,
  orderBy,
  limit,
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
  
  // Populate the denormalized exerciseIds array
  const exerciseIds = workoutLogPayload.exercises.map(ex => ex.exerciseId);
  const payloadToSave: WorkoutLog = {
    ...workoutLogPayload,
    exerciseIds: exerciseIds,
  };

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  console.log(`[SERVICE] saveWorkoutLog: Document reference path: ${logDocRef.path}`);


  try {
    await setDoc(logDocRef, payloadToSave, { merge: true }); 
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
      return docSnap.data() as WorkoutLog;
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
  logDate: string // YYYY-MM-DD string
): Promise<void> => {
  console.log(`[SERVICE] saveExercisePerformanceEntry: Initiated for userId=${userId}, exerciseId=${exerciseId}, logDate=${logDate}`);
  
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
  
  console.log(`[SERVICE] saveExercisePerformanceEntry: Processed validCurrentSessionSets for ${exerciseId}:`, JSON.stringify(validCurrentSessionSets, null, 2));

  const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);
  
  let newPersonalRecord: PersonalRecord | null = null;
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    console.log(`[SERVICE] saveExercisePerformanceEntry: Existing performance entry data for ${exerciseId}:`, existingEntryData ? JSON.stringify(existingEntryData, null, 2) : "null");

    newPersonalRecord = existingEntryData?.personalRecord || null;
    console.log(`[SERVICE] saveExercisePerformanceEntry: Initial newPersonalRecord for ${exerciseId} (from existing or null):`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");

    if (validCurrentSessionSets.length > 0) {
        const bestSetThisSession = findBestSetInSetsArray(validCurrentSessionSets);
        console.log(`[SERVICE] saveExercisePerformanceEntry: Best set this session for ${exerciseId}:`, bestSetThisSession ? JSON.stringify(bestSetThisSession, null, 2) : "null");

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
            console.log(`[SERVICE] saveExercisePerformanceEntry: New PR identified for ${exerciseId}:`, JSON.stringify(newPersonalRecord, null, 2));
          } else {
            console.log(`[SERVICE] saveExercisePerformanceEntry: Existing PR for ${exerciseId} (${JSON.stringify(newPersonalRecord, null, 2)}) is better/equal.`);
          }
        } else {
            console.log(`[SERVICE] saveExercisePerformanceEntry: No valid best set found this session for ${exerciseId}. PR object remains as:`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");
        }
    } else {
        console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets in current session for ${exerciseId}. PR will not be updated from this session's data.`);
    }

    const entryDataToSave: ExercisePerformanceEntry = {
      lastPerformedDate: validCurrentSessionSets.length > 0 ? Timestamp.now().toMillis() : (existingEntryData?.lastPerformedDate || null),
      lastPerformedSets: validCurrentSessionSets.length > 0 ? validCurrentSessionSets : (existingEntryData?.lastPerformedSets || []), 
      personalRecord: newPersonalRecord,
    };

    console.log(`[SERVICE] saveExercisePerformanceEntry: Final entryDataToSave for ${exerciseId}:`, JSON.stringify(entryDataToSave, null, 2));
    await setDoc(performanceEntryDocRef, entryDataToSave, { merge: true }); 
    console.log(`[SERVICE] saveExercisePerformanceEntry: Successfully saved/updated performance entry for exerciseId=${exerciseId}.`);

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
      const data = docSnap.data() as ExercisePerformanceEntry;
      return data;
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
    throw new Error("Missing parameters in updatePerformanceEntryOnLogDelete");
  }

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Processing delete of log ${deletedLogId} for exercise ${exerciseId}, user ${userId}`);

  const perfRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);

  const perfSnap = await getDoc(perfRef);
  if (!perfSnap.exists()) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No performance entry found for exercise ${exerciseId}. No action needed.`);
    return;
  }

  const entryData = perfSnap.data() as ExercisePerformanceEntry;
  let needsFallbackRecalculation = false;
  let updatedPersonalRecord: PersonalRecord | null = entryData.personalRecord;
  let updatedLastPerformedDate: number | null = entryData.lastPerformedDate;
  let updatedLastPerformedSets: LoggedSet[] = entryData.lastPerformedSets;

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Existing entryData for exercise ${exerciseId}:`, JSON.stringify(entryData));

  if (entryData.personalRecord && entryData.personalRecord.logId === deletedLogId) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR for exercise ${exerciseId} was sourced from deleted log ${deletedLogId}. Clearing PR and marking for fallback.`);
    updatedPersonalRecord = null;
    needsFallbackRecalculation = true;
  } else {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR source log ID (${entryData.personalRecord?.logId}) does not match deleted log ID (${deletedLogId}).`);
  }

  if (entryData.lastPerformedDate) {
    const lastPerformedDateString = format(new Date(entryData.lastPerformedDate), "yyyy-MM-dd");
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Checking lastPerformedDate. Formatted DB date: '${lastPerformedDateString}', Deleted Log ID: '${deletedLogId}'`);
    if (lastPerformedDateString === deletedLogId) {
      console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Match! LastPerformedSets & Date for exercise ${exerciseId} were sourced from deleted log ${deletedLogId}. Clearing them and marking for fallback.`);
      updatedLastPerformedDate = null;
      updatedLastPerformedSets = [];
      needsFallbackRecalculation = true;
    } else {
      console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No match for lastPerformedDate. Formatted DB date: '${lastPerformedDateString}', Deleted Log ID: '${deletedLogId}'`);
    }
  } else {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No valid lastPerformedDate (number) found in entry for exercise ${exerciseId}. Current value:`, entryData.lastPerformedDate);
  }

  if (!needsFallbackRecalculation) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No updates deemed necessary for performance entry of exercise ${exerciseId} based on deleted log ${deletedLogId}. Existing data will be preserved.`);
    // If only the PR was cleared but last performed sets are from a different day, we still save the cleared PR.
    // The check for needsFallbackRecalculation primarily determines if we query for other logs.
    // If PR was cleared, and last performed sets are still valid (from another day), we should save the cleared PR.
    if (entryData.personalRecord?.logId === deletedLogId) { // Check if only PR was affected
         await updateDoc(perfRef, { personalRecord: null });
         console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Only PR was from deleted log. PR cleared. lastPerformedSets remain.`);
    }
    return;
  }

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Fallback recalculation needed for ${exerciseId}. Querying for newest remaining log.`);
  
  const logsCol = collection(db, getUserWorkoutLogsCollectionPath(userId));
  // Optimized query using the denormalized 'exerciseIds' field
  const logsQuery = query(
    logsCol,
    where("exerciseIds", "array-contains", exerciseId), // Use the new denormalized field
    orderBy("date", "desc"),
    limit(1)
  );
  
  const logsSnap = await getDocs(logsQuery);

  if (logsSnap.empty) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No remaining logs found for exercise ${exerciseId}. Performance entry will be fully cleared.`);
    await updateDoc(perfRef, {
      personalRecord: null,
      lastPerformedDate: null,
      lastPerformedSets: [],
    });
    return;
  }

  const fallbackLogDoc = logsSnap.docs[0];
  const fallbackLogData = fallbackLogDoc.data() as WorkoutLog;
  const exerciseInFallbackLog = fallbackLogData.exercises.find(e => e.exerciseId === exerciseId);

  if (!exerciseInFallbackLog) {
    console.error(`[SERVICE] updatePerformanceEntryOnLogDelete: Exercise ${exerciseId} not found in fallback log ${fallbackLogDoc.id}, though it was expected based on exerciseIds array. Clearing performance entry.`);
    await updateDoc(perfRef, {
      personalRecord: null,
      lastPerformedDate: null,
      lastPerformedSets: [],
    });
    return;
  }
  
  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Found fallback log ${fallbackLogDoc.id} for exercise ${exerciseId}.`);

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
  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Fallback rebuild complete for ${exerciseId}:`, JSON.stringify(newEntryData));
};

// Original console logs from user:
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Initiated for userId=${userId}, exerciseId=${exerciseId}, deletedLogId=${deletedLogId}`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Existing entryData for exercise ${exerciseId}:`, JSON.stringify(entryData));
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Checking PR. PR Log ID: '${entryData.personalRecord.logId}', Deleted Log ID: '${deletedLogId}'`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR for exercise ${exerciseId} was sourced from deleted log ${deletedLogId}. Clearing PR.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR source log ID does not match deleted log ID.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No PR or PR logId found for exercise ${exerciseId}.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Checking lastPerformedDate. DB timestamp: ${entryData.lastPerformedDate}, JS Date: ${jsDate.toISOString()}, Formatted: '${lastPerformedDateString}', Deleted Log ID: '${deletedLogId}'`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Match! LastPerformedSets & Date for exercise ${exerciseId} were sourced from deleted log ${deletedLogId}. Clearing them.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No match for lastPerformedDate. Formatted DB date: '${lastPerformedDateString}', Deleted Log ID: '${deletedLogId}'`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No valid lastPerformedDate (number) found in entry for exercise ${exerciseId}. Current value:`, entryData.lastPerformedDate);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Updating performance entry for ${exerciseId} with:`, JSON.stringify(fieldsToUpdate));
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Successfully updated performance entry for exercise ${exerciseId}.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No updates deemed necessary for performance entry of exercise ${exerciseId} based on deleted log ${deletedLogId}.`);
// console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No performance entry found for exercise ${exerciseId}. No action taken.`);
// console.error(`[SERVICE] updatePerformanceEntryOnLogDelete: Error processing performance entry for exerciseId=${exerciseId}:`, error);
// throw new Error(`Failed to update performance entry for ${exerciseId}. ${error.message}`);
// Helper function to find best set within an array of sets (used internally)
// const findBestSetInSetsArray = (sets: LoggedSet[]): { reps: number; weight: number } | null => { ... }; // Defined above

// Note on query for step 5:
// The user's original proposal for the query was:
// const logsQuery = query(
//   logsCol,
//   where("exercises.exerciseId", "==", exerciseId), // This can be problematic with arrays of objects
//   orderBy("date", "desc"),
//   limit(1)
// );
// Firestore queries on fields within an array of objects (like `exercises.exerciseId`) are limited.
// "array-contains" can find if an array contains a specific WHOLE object, but not a partial match on a field within objects in an array.
// The safest client-side way without complex indexing or data duplication is to fetch logs ordered by date and filter client-side.
// The current implementation fetches all logs ordered by date desc, then iterates to find the first one. This is less efficient for many logs.
// If the number of logs is small, it's acceptable. For large numbers of logs, a Cloud Function or denormalization would be better.
// I've kept the client-side full fetch and filter as it's more robust than a potentially failing complex query.

// The findBestSetInSetsArray helper was added above, it was missing in the user's snippet but needed.
// The import for `format` was changed from `format as formatDateFns` to `format` to match user's snippet.
// Ensured `parseISO` is imported.
// Ensured `fromUnixTime` is imported if needed (not directly in this function but good to have in the file).
// Corrected the console logs to match the new flow.
// Ensured the types for `newEntryData` align with `ExercisePerformanceEntry`.
// Addressed the case where `exInFallbackLog.sets` might be empty, in which case `bestSetInFallback` would be `null`, correctly leading to `personalRecord: null`.

