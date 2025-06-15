
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
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  console.log(`[SERVICE] saveWorkoutLog: Document reference path: ${logDocRef.path}`);


  try {
    await setDoc(logDocRef, workoutLogPayload, { merge: true }); 
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
  logDate: string 
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

  // 1) Load the existing performance entry
  const perfSnap = await getDoc(perfRef);
  if (!perfSnap.exists()) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No performance entry found for exercise ${exerciseId}. No action needed.`);
    return;
  }

  const entry = perfSnap.data() as ExercisePerformanceEntry;
  let needsRecalc = false;
  let currentPersonalRecord = entry.personalRecord;
  let currentLastPerformedDate = entry.lastPerformedDate;
  let currentLastPerformedSets = entry.lastPerformedSets;

  // 2) If PR came from that log, clear it
  if (currentPersonalRecord?.logId === deletedLogId) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR for ${exerciseId} was from deleted log ${deletedLogId}; marking for recalc.`);
    currentPersonalRecord = null; // Prepare to clear or recalculate
    needsRecalc = true;
  }

  // 3) If lastPerformedDate matches, clear it
  if (currentLastPerformedDate) {
    const formattedLastDate = format(new Date(currentLastPerformedDate), "yyyy-MM-dd");
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Comparing lastPerformedDate. Formatted DB date: '${formattedLastDate}', Deleted Log ID: '${deletedLogId}'`);
    if (formattedLastDate === deletedLogId) {
      console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: lastPerformedDate for ${exerciseId} was from deleted log ${deletedLogId}; marking for recalc.`);
      currentLastPerformedDate = null; // Prepare to clear or recalculate
      currentLastPerformedSets = [];  // Prepare to clear or recalculate
      needsRecalc = true;
    }
  }

  // 4) If nothing was sourced from the deleted log, we might not need to do anything further than saving current state, unless PR was nullified and we want to find any PR.
  // The logic below will always try to find the best available record if needsRecalc is true.
  if (!needsRecalc) {
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Neither PR nor lastPerformedDate for ${exerciseId} were sourced from deleted log ${deletedLogId}. No recalculation initiated by this delete.`);
    // Even if not directly sourced, if the PR was already null, we might still want to ensure it's up-to-date.
    // However, the current logic is to only recalc if a field *was* sourced from the deleted log.
    // To always recalc a null PR, needsRecalc should be true if entry.personalRecord is null.
    // For now, sticking to user's proposal: only recalc if something was *cleared* due to this deletion.
    return;
  }

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Recalculation needed for ${exerciseId}. Querying for fallback log.`);
  // 5) Query for the newest remaining log that contains this exercise
  const logsCol = collection(db, getUserWorkoutLogsCollectionPath(userId));
  // Note: Firestore requires a composite index for this query on (exercises.exerciseId ASC, date DESC) or similar.
  // The query below implies a structure where `exercises` is an array of objects, and each object has `exerciseId`.
  // This type of query ("array-contains" like behavior for a field within an array of maps, combined with orderBy/limit)
  // might be complex or not directly supported without specific data modeling or more complex querying.
  // A common pattern is to have a subcollection of exercises per log, or denormalize exercise IDs at the top level of the log for easier querying.
  // For now, assuming `workoutLog.exercises` contains `{ exerciseId: string, ... }` and hoping Firestore can handle it or user has an index.
  // A safer query if `exercises` is an array of objects might involve fetching more logs and filtering client-side, or restructuring.
  // However, proceeding with the query as proposed for now.
  // A simple query might be to find logs that have this exercise, then sort by date client side if complex server sort fails.
  // Let's try querying for all logs and finding the best one client-side IF the direct query is problematic.
  // For now, let's use a simpler query to get all logs and then filter. This is less efficient but more robust if the complex query fails.
  
  // Revised strategy: Get ALL logs, then find the latest containing the exercise.
  const allLogsSnap = await getDocs(query(logsCol, orderBy("date", "desc")));
  let fallbackLog: WorkoutLog | null = null;
  let fallbackLogDocId: string | null = null;

  for (const doc of allLogsSnap.docs) {
    const logData = doc.data() as WorkoutLog;
    if (logData.exercises.some(ex => ex.exerciseId === exerciseId)) {
      fallbackLog = logData;
      fallbackLogDocId = doc.id; // This is the date string YYYY-MM-DD
      break; 
    }
  }

  if (!fallbackLog || !fallbackLogDocId) {
    // no remaining logs for this exercise OR query failed to find one
    await updateDoc(perfRef, {
      personalRecord: null,
      lastPerformedDate: null,
      lastPerformedSets: [],
    });
    console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No remaining logs found containing exercise ${exerciseId}; performance entry fully cleared.`);
    return;
  }

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Found fallback log ${fallbackLogDocId} for exercise ${exerciseId}.`);
  // 6) Rebuild from that single fallback log
  const exInFallbackLog = fallbackLog.exercises.find((e) => e.exerciseId === exerciseId)!;

  const bestSetInFallback = findBestSetInSetsArray(exInFallbackLog.sets);

  const newEntryData: Partial<ExercisePerformanceEntry> = {
    lastPerformedDate: Timestamp.fromDate(parseISO(fallbackLogDocId)).toMillis(),
    lastPerformedSets: exInFallbackLog.sets.map((s) => ({
      id: s.id,
      reps: Number(s.reps ?? 0),
      weight: Number(s.weight ?? 0),
    })),
    personalRecord: bestSetInFallback
      ? {
          reps: bestSetInFallback.reps,
          weight: bestSetInFallback.weight,
          date: Timestamp.fromDate(parseISO(fallbackLogDocId)).toMillis(), // Date of the PR is date of this fallback log
          logId: fallbackLogDocId, // Log ID of this fallback log
        }
      : null, // If fallback log has no valid sets for this exercise, PR is null
  };

  // 7) Write the rebuilt entry back
  await updateDoc(perfRef, newEntryData);
  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Fallback rebuild complete for ${exerciseId}:`, JSON.stringify(newEntryData, null, 2));
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
