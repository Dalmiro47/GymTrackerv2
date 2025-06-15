
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves/updates the performance snapshot (last session & PR) for an exercise.
 * - getLastLoggedPerformance: Retrieves the performance snapshot for an exercise.
 * - deleteAllPerformanceEntriesForExercise: Deletes the performance entry for a specific exercise.
 * - getLoggedDateStrings: Fetches all dates ("yyyy-MM-dd") that have workout logs.
 * - updatePerformanceEntryOnLogDelete: Updates an exercise's performance entry (PR, last sets) if sourced from a deleted log.
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
} from 'firebase/firestore';
import { format as formatDateFns, fromUnixTime } from 'date-fns'; // Added fromUnixTime for timestamp conversion

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

const findBestSet = (sets: LoggedSet[]): { reps: number; weight: number } | null => {
  if (!sets || sets.length === 0) return null;

  let bestSet: { reps: number; weight: number } | null = null;

  for (const set of sets) {
    const weight = typeof set.weight === 'number' ? set.weight : 0;
    const reps = typeof set.reps === 'number' ? set.reps : 0;

    if (weight <= 0 && reps <= 0) continue; 

    if (!bestSet) {
      bestSet = { weight, reps };
    } else if (weight > bestSet.weight) {
      bestSet = { weight, reps };
    } else if (weight === bestSet.weight && reps > bestSet.reps) {
      bestSet = { weight, reps };
    }
  }
  return bestSet;
};

export const saveExercisePerformanceEntry = async (
  userId: string,
  exerciseId: string,
  currentSessionSets: LoggedSet[],
  logDate: string // YYYY-MM-DD of the current log being saved
): Promise<void> => {
  console.log(`[SERVICE] saveExercisePerformanceEntry: Initiated for userId=${userId}, exerciseId=${exerciseId}, logDate=${logDate}`);
  console.log(`[SERVICE] saveExercisePerformanceEntry: Received currentSessionSets:`, JSON.stringify(currentSessionSets, null, 2));

  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");
  if (!logDate) throw new Error("Log date (logId) is required for PR tracking.");

  const validCurrentSessionSets = currentSessionSets
    .map(s => ({
      id: s.id || `set-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
      weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
    }))
    .filter(s => s.reps > 0 || s.weight > 0);
  
  console.log(`[SERVICE] saveExercisePerformanceEntry: Processed validCurrentSessionSets:`, JSON.stringify(validCurrentSessionSets, null, 2));

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
  
  let newPersonalRecord: PersonalRecord | null = null;
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    console.log(`[SERVICE] saveExercisePerformanceEntry: Existing performance entry data for ${exerciseId}:`, existingEntryData ? JSON.stringify(existingEntryData, null, 2) : "null");

    newPersonalRecord = existingEntryData?.personalRecord || null;
    console.log(`[SERVICE] saveExercisePerformanceEntry: Initial newPersonalRecord (from existing or null):`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");

    if (validCurrentSessionSets.length > 0) {
        const bestSetThisSession = findBestSet(validCurrentSessionSets);
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
            console.log(`[SERVICE] saveExercisePerformanceEntry: Existing PR for ${exerciseId} (${JSON.stringify(newPersonalRecord, null, 2)}) is better/equal. PR value itself not updated. Saving object.`);
          }
        } else {
            console.log(`[SERVICE] saveExercisePerformanceEntry: No valid best set found this session for ${exerciseId}. PR object remains as:`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");
        }
    } else {
        console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets in current session for ${exerciseId}. PR will not be updated from this session.`);
    }


    const entryDataToSave: ExercisePerformanceEntry = {
      lastPerformedDate: validCurrentSessionSets.length > 0 ? Timestamp.now().toMillis() : (existingEntryData?.lastPerformedDate || Timestamp.now().toMillis()),
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

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);

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

    const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
    const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
    try {
        await deleteFirestoreDoc(performanceEntryDocRef);
    } catch (error: any) {
        console.error(`Error deleting performance entry for exercise ${exerciseId}:`, error);
    }
};

export const updatePerformanceEntryOnLogDelete = async (userId: string, exerciseId: string, deletedLogId: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");
  if (!deletedLogId) throw new Error("Deleted Log ID is required.");

  console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Initiated for userId=${userId}, exerciseId=${exerciseId}, deletedLogId=${deletedLogId}`);
  const performanceEntryDocRef = doc(db, getUserPerformanceEntriesCollectionPath(userId), exerciseId);

  try {
    const docSnap = await getDoc(performanceEntryDocRef);
    if (docSnap.exists()) {
      const entryData = docSnap.data() as ExercisePerformanceEntry;
      const fieldsToUpdate: Partial<ExercisePerformanceEntry> = {};
      let needsUpdate = false;

      // Check Personal Record
      if (entryData.personalRecord && entryData.personalRecord.logId === deletedLogId) {
        console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: PR for exercise ${exerciseId} was sourced from deleted log ${deletedLogId}. Clearing PR.`);
        fieldsToUpdate.personalRecord = null;
        needsUpdate = true;
      }

      // Check Last Performed Sets and Date
      if (entryData.lastPerformedDate) {
        // Convert Firestore timestamp (milliseconds) to Date object, then format
        const lastPerformedDateString = formatDateFns(fromUnixTime(entryData.lastPerformedDate / 1000), 'yyyy-MM-dd');
        if (lastPerformedDateString === deletedLogId) {
          console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: LastPerformedSets for exercise ${exerciseId} were sourced from deleted log ${deletedLogId}. Clearing them.`);
          fieldsToUpdate.lastPerformedSets = [];
          fieldsToUpdate.lastPerformedDate = null; // Or keep existing and rely on empty sets? Clearing seems cleaner.
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Updating performance entry for ${exerciseId} with:`, fieldsToUpdate);
        await updateDoc(performanceEntryDocRef, fieldsToUpdate); // updateDoc merges by default with non-nested fields
        console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: Successfully updated performance entry for exercise ${exerciseId}.`);
      } else {
        console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No updates needed for performance entry of exercise ${exerciseId} based on deleted log ${deletedLogId}.`);
      }

    } else {
      console.log(`[SERVICE] updatePerformanceEntryOnLogDelete: No performance entry found for exercise ${exerciseId}. No action taken.`);
    }
  } catch (error: any) {
    console.error(`[SERVICE] updatePerformanceEntryOnLogDelete: Error processing PR/last sets for exerciseId=${exerciseId}:`, error);
    throw new Error(`Failed to update performance entry for ${exerciseId}. ${error.message}`);
  }
};

