
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves a performance snapshot for an exercise.
 * - getLastLoggedPerformance: Retrieves the most recent performance snapshot for an exercise.
 */
import { db } from '@/lib/firebaseConfig';
import type { WorkoutLog, LoggedSet, ExercisePerformanceEntry } from '@/types';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc as deleteFirestoreDoc, // Renamed to avoid conflict
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  writeBatch
} from 'firebase/firestore';

const getUserWorkoutLogsCollectionPath = (userId: string) => `users/${userId}/workoutLogs`;
const getExercisePerformanceEntriesCollectionPath = (userId: string, exerciseId: string) => `users/${userId}/exercises/${exerciseId}/performanceEntries`;

/**
 * Saves or updates the workout log for a specific date.
 * The log ID is the date string in 'YYYY-MM-DD' format.
 */
export const saveWorkoutLog = async (userId: string, date: string, workoutLogPayload: WorkoutLog): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to save a workout log.");
  
  // Safeguard against mismatched dates
  if (workoutLogPayload.id !== date || workoutLogPayload.date !== date) {
    console.error("[SERVICE] saveWorkoutLog: Mismatched date information in workoutLogPayload.", 
                  "Expected date based on doc ID:", date, 
                  "Payload ID:", workoutLogPayload.id, 
                  "Payload date:", workoutLogPayload.date);
    // It's critical that the payload's ID and date match the document ID being written to.
    // Forcing consistency:
    workoutLogPayload.id = date;
    workoutLogPayload.date = date;
  }
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);

  try {
    await setDoc(logDocRef, workoutLogPayload, { merge: true }); 
    console.log(`[SERVICE] Workout log for ${date} saved successfully for user ${userId}.`);
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
    console.error("[SERVICE] getWorkoutLog called with no userId");
    throw new Error("User ID is required.");
  }
  if (!date) {
    console.error("[SERVICE] getWorkoutLog called with no date");
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
    console.log(`[SERVICE] Workout log for ${date} deleted successfully for user ${userId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] Error deleting workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to delete workout log. ${error.message}`);
  }
};


/**
 * Saves a performance entry for a specific exercise. This is used to track "last performance".
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
    console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets with reps/weight > 0 to save for exerciseId=${exerciseId}. Skipping performance entry.`);
    return; 
  }

  const entry: ExercisePerformanceEntry = {
    date: Timestamp.now().toMillis(), 
    sets: validSets,
  };
  
  const performanceEntriesColPath = getExercisePerformanceEntriesCollectionPath(userId, exerciseId);
  console.log(`[SERVICE] saveExercisePerformanceEntry: Attempting to save performance entry for exerciseId=${exerciseId} to path: ${performanceEntriesColPath} with data:`, JSON.stringify(entry));

  try {
    const performanceEntriesColRef = collection(db, performanceEntriesColPath);
    await addDoc(performanceEntriesColRef, entry);
    console.log(`[SERVICE] saveExercisePerformanceEntry: Successfully saved performance entry for exerciseId=${exerciseId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] saveExercisePerformanceEntry: Error saving exercise performance entry for exerciseId=${exerciseId} to path ${performanceEntriesColPath}:`, error);
    throw new Error(`Failed to save performance entry for ${exerciseId}. ${error.message}`);
  }
};

/**
 * Retrieves the most recent logged performance for a specific exercise.
 */
export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) {
    console.error("[SERVICE] getLastLoggedPerformance called with no userId");
    throw new Error("User ID is required.");
  }
  if (!exerciseId) {
    console.error("[SERVICE] getLastLoggedPerformance called with no exerciseId");
    throw new Error("Exercise ID is required.");
  }
  console.log(`[SERVICE] getLastLoggedPerformance: userId=${userId}, exerciseId=${exerciseId}`);

  const performanceEntriesColRef = collection(db, getExercisePerformanceEntriesCollectionPath(userId, exerciseId));
  console.log(`[SERVICE] Querying path: ${performanceEntriesColRef.path}`);
  const q = query(performanceEntriesColRef, orderBy("date", "desc"), limit(1));
  try {
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const data = querySnapshot.docs[0].data() as ExercisePerformanceEntry;
      console.log(`[SERVICE] Last performance FOUND for exerciseId=${exerciseId}:`, JSON.stringify(data));
      return data;
    }
    console.log(`[SERVICE] No last performance found for exerciseId=${exerciseId}`);
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error getLastLoggedPerformance for exerciseId=${exerciseId}:`, error);
    return null; 
  }
};

/**
 * Deletes all performance entries for a given exercise.
 * Useful if an exercise is deleted entirely.
 */
export const deleteAllPerformanceEntriesForExercise = async (userId: string, exerciseId: string): Promise<void> => {
    if (!userId) throw new Error("User ID is required.");
    if (!exerciseId) throw new Error("Exercise ID is required.");

    const performanceEntriesColRef = collection(db, getExercisePerformanceEntriesCollectionPath(userId, exerciseId));
    try {
        const querySnapshot = await getDocs(performanceEntriesColRef);
        const batch = writeBatch(db);
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`[SERVICE] Successfully deleted all performance entries for exerciseId=${exerciseId}`);
    } catch (error: any) {
        console.error(`Error deleting performance entries for exercise ${exerciseId}:`, error);
        throw new Error(`Failed to delete performance entries. ${error.message}`);
    }
};

