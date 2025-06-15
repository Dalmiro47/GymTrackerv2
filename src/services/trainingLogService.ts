
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves/updates the single latest performance snapshot for an exercise.
 * - getLastLoggedPerformance: Retrieves the latest performance snapshot for an exercise.
 * - deleteAllPerformanceEntriesForExercise: Deletes the performance entry for a specific exercise.
 */
import { db } from '@/lib/firebaseConfig';
import type { WorkoutLog, LoggedSet, ExercisePerformanceEntry } from '@/types';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc as deleteFirestoreDoc, 
  collection,
  // addDoc, // No longer used for performance entries as we setDoc with exerciseId
  // query, // No longer used for performance entries as we getDoc by exerciseId
  // orderBy, // No longer used for performance entries
  // limit, // No longer used for performance entries
  // getDocs, // No longer used for performance entries
  Timestamp,
  // writeBatch // Only needed if deleting multiple specific performance entries, not the case for deleteAllPerformanceEntriesForExercise now
} from 'firebase/firestore';

const getUserWorkoutLogsCollectionPath = (userId: string) => `users/${userId}/workoutLogs`;
// New path for the top-level performanceEntries collection per user
const getUserPerformanceEntriesCollectionPath = (userId: string) => `users/${userId}/performanceEntries`;


/**
 * Saves or updates the workout log for a specific date.
 * The log ID is the date string in 'YYYY-MM-DD' format.
 */
export const saveWorkoutLog = async (userId: string, date: string, workoutLogPayload: WorkoutLog): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to save a workout log.");
  
  // Safeguard against mismatched dates
  if (workoutLogPayload.id !== date || workoutLogPayload.date !== date) {
    console.warn("[SERVICE] saveWorkoutLog: Mismatched date information in workoutLogPayload.", 
                  "Expected date based on doc ID:", date, 
                  "Payload ID:", workoutLogPayload.id, 
                  "Payload date:", workoutLogPayload.date);
    workoutLogPayload.id = date;
    workoutLogPayload.date = date;
  }
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);

  try {
    await setDoc(logDocRef, workoutLogPayload, { merge: true }); 
    // console.log(`[SERVICE] Workout log for ${date} saved successfully for user ${userId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] Error saving workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to save workout log. ${error.message}`);
  }
};

/**
 * Fetches the workout log for a specific date.
 * The log ID is the date string in 'YYYY-MM-DD' format.
 */
export const getWorkoutLog = async (userId: string, date: string): Promise<WorkoutLog | null> => {
  if (!userId) {
    // console.error("[SERVICE] getWorkoutLog called with no userId");
    throw new Error("User ID is required.");
  }
  if (!date) {
    // console.error("[SERVICE] getWorkoutLog called with no date");
    throw new Error("Date is required to fetch a workout log.");
  }
  // console.log(`[SERVICE] Attempting to fetch log for userId: ${userId}, date: ${date}`);

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const docSnap = await getDoc(logDocRef);
    if (docSnap.exists()) {
      // console.log(`[SERVICE] Log found for userId: ${userId}, date: ${date}`, docSnap.data());
      return docSnap.data() as WorkoutLog;
    }
    // console.log(`[SERVICE] No log found for userId: ${userId}, date: ${date}`);
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error fetching workout log for userId: ${userId}, date: ${date}:`, error);
    throw new Error(`Failed to fetch workout log. ${error.message}`);
  }
};

/**
 * Deletes the workout log for a specific date.
 */
export const deleteWorkoutLog = async (userId: string, date: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to delete a workout log.");

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    await deleteFirestoreDoc(logDocRef);
    // console.log(`[SERVICE] Workout log for ${date} deleted successfully for user ${userId}.`);
  } catch (error: any)
{
    console.error(`[SERVICE] Error deleting workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to delete workout log. ${error.message}`);
  }
};


/**
 * Saves or updates the single latest performance entry for a specific exercise.
 * The document ID within performanceEntries collection will be the exerciseId.
 */
export const saveExercisePerformanceEntry = async (userId: string, exerciseId: string, sets: LoggedSet[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");

  const validSets = sets.map(s => ({
    id: s.id, 
    reps: s.reps === null || isNaN(s.reps) ? 0 : Number(s.reps),
    weight: s.weight === null || isNaN(s.weight) ? 0 : Number(s.weight),
  })).filter(s => s.reps > 0 || s.weight > 0); 

  if (validSets.length === 0) {
    // console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets with reps/weight > 0 to save for exerciseId=${exerciseId}. Skipping performance entry.`);
    return; 
  }

  const entryData: ExercisePerformanceEntry = {
    date: Timestamp.now().toMillis(), 
    sets: validSets,
  };
  
  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);

  // console.log(`[SERVICE] saveExercisePerformanceEntry: Attempting to save/update performance entry for exerciseId=${exerciseId} at path: ${performanceEntryDocRef.path} with data:`, JSON.stringify(entryData));
  
  try {
    // Using setDoc will create the document if it doesn't exist, or overwrite it if it does.
    // This ensures we always store only the *latest* performance for this exercise.
    await setDoc(performanceEntryDocRef, entryData); 
    // console.log(`[SERVICE] saveExercisePerformanceEntry: Successfully saved/updated performance entry for exerciseId=${exerciseId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] saveExercisePerformanceEntry: Error saving/updating exercise performance entry for exerciseId=${exerciseId} at path ${performanceEntryDocRef.path}:`, error);
    throw new Error(`Failed to save performance entry for ${exerciseId}. ${error.message}`);
  }
};

/**
 * Retrieves the latest logged performance for a specific exercise.
 * It fetches the single document keyed by exerciseId from the performanceEntries collection.
 */
export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) {
    // console.error("[SERVICE] getLastLoggedPerformance called with no userId");
    throw new Error("User ID is required.");
  }
  if (!exerciseId) {
    // console.error("[SERVICE] getLastLoggedPerformance called with no exerciseId");
    throw new Error("Exercise ID is required.");
  }
  // console.log(`[SERVICE] getLastLoggedPerformance: userId=${userId}, exerciseId=${exerciseId}`);

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
  // console.log(`[SERVICE] Querying path: ${performanceEntryDocRef.path}`);

  try {
    const docSnap = await getDoc(performanceEntryDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as ExercisePerformanceEntry; // Cast to the type, document has {date, sets}
      // console.log(`[SERVICE] Last performance FOUND for exerciseId=${exerciseId}:`, JSON.stringify(data));
      return data;
    }
    // console.log(`[SERVICE] No last performance found for exerciseId=${exerciseId} at path ${performanceEntryDocRef.path}`);
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error getLastLoggedPerformance for exerciseId=${exerciseId}:`, error);
    return null; 
  }
};

/**
 * Deletes the performance entry for a given exercise.
 */
export const deleteAllPerformanceEntriesForExercise = async (userId: string, exerciseId: string): Promise<void> => {
    if (!userId) throw new Error("User ID is required.");
    if (!exerciseId) throw new Error("Exercise ID is required.");

    const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
    const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
    try {
        await deleteFirestoreDoc(performanceEntryDocRef);
        // console.log(`[SERVICE] Successfully deleted performance entry for exerciseId=${exerciseId}`);
    } catch (error: any) {
        console.error(`Error deleting performance entry for exercise ${exerciseId}:`, error);
        // We might not want to throw an error if the doc doesn't exist, as the goal is to ensure it's gone.
        // If Firestore throws an error for other reasons (permissions, network), then it's valid.
        if (error.code === 'unavailable' || error.code === 'permission-denied') { // Example error codes
             throw new Error(`Failed to delete performance entry. ${error.message}`);
        }
        // console.log(`[SERVICE] No performance entry found to delete for exerciseId=${exerciseId}, or it was already deleted.`);
    }
};
