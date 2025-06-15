
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
  Timestamp,
} from 'firebase/firestore';

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
  console.log(`[SERVICE] saveWorkoutLog: Payload to save:`, JSON.stringify(workoutLogPayload, null, 2));


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


export const deleteWorkoutLog = async (userId: string, date: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to delete a workout log.");

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    await deleteFirestoreDoc(logDocRef);
    // console.log(`[SERVICE] Workout log for ${date} deleted successfully for user ${userId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] Error deleting workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to delete workout log. ${error.message}`);
  }
};


export const saveExercisePerformanceEntry = async (userId: string, exerciseId: string, sets: LoggedSet[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");

  const validSets = sets.map(s => ({
    id: s.id,
    reps: s.reps === null || isNaN(s.reps) ? 0 : Number(s.reps),
    weight: s.weight === null || isNaN(s.weight) ? 0 : Number(s.weight),
  })).filter(s => s.reps > 0 || s.weight > 0);

  if (validSets.length === 0) {
    console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets with reps/weight > 0 to save for exerciseId=${exerciseId}. Skipping performance entry.`);
    return;
  }

  const entryData: ExercisePerformanceEntry = {
    date: Timestamp.now().toMillis(),
    sets: validSets,
  };

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);

  console.log(`[SERVICE] saveExercisePerformanceEntry: Attempting to save/update performance entry for exerciseId=${exerciseId} at path: ${performanceEntryDocRef.path} with data:`, JSON.stringify(entryData));

  try {
    await setDoc(performanceEntryDocRef, entryData);
    console.log(`[SERVICE] saveExercisePerformanceEntry: Successfully saved/updated performance entry for exerciseId=${exerciseId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] saveExercisePerformanceEntry: Error saving/updating exercise performance entry for exerciseId=${exerciseId} at path ${performanceEntryDocRef.path}:`, error);
    throw new Error(`Failed to save performance entry for ${exerciseId}. ${error.message}`);
  }
};


export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) {
    // console.error("[SERVICE] getLastLoggedPerformance called with no userId");
    throw new Error("User ID is required.");
  }
  if (!exerciseId) {
    console.error("[SERVICE] getLastLoggedPerformance called with no exerciseId");
    throw new Error("Exercise ID is required.");
  }
  // console.log(`[SERVICE] getLastLoggedPerformance: userId=${userId}, exerciseId=${exerciseId}`);

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
  // console.log(`[SERVICE] Querying path: ${performanceEntryDocRef.path}`);

  try {
    const docSnap = await getDoc(performanceEntryDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as ExercisePerformanceEntry;
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
        if (error.code === 'unavailable' || error.code === 'permission-denied') {
             throw new Error(`Failed to delete performance entry. ${error.message}`);
        }
    }
};

