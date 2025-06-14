
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves a performance snapshot for an exercise.
 * - getLastLoggedPerformance: Retrieves the most recent performance snapshot for an exercise.
 */
import { db } from '@/lib/firebaseConfig';
import type { WorkoutLog, LoggedSet, ExercisePerformanceEntry } from '@/types';
import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  deleteDoc,
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
  if (workoutLogPayload.id !== date || workoutLogPayload.date !== date) {
    console.error("Mismatched date information in workoutLogPayload:", workoutLogPayload, "Expected date:", date);
    throw new Error("Log data integrity issue: ID and date fields must match the provided date parameter.");
  }
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);

  try {
    await setDoc(logDocRef, workoutLogPayload, { merge: true }); 
  } catch (error: any) {
    console.error("Error saving workout log:", error);
    throw new Error(`Failed to save workout log. ${error.message}`);
  }
};

/**
 * Fetches the workout log for a specific date.
 * The log ID is the date string in 'YYYY-MM-DD' format.
 */
export const getWorkoutLog = async (userId: string, date: string): Promise<WorkoutLog | null> => {
  if (!userId) {
    console.error("[trainingLogService] getWorkoutLog called with no userId");
    throw new Error("User ID is required.");
  }
  if (!date) {
    console.error("[trainingLogService] getWorkoutLog called with no date");
    throw new Error("Date is required to fetch a workout log.");
  }
  // console.log(`[trainingLogService] Attempting to fetch log for userId: ${userId}, date: ${date}`);

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const docSnap = await getDoc(logDocRef);
    if (docSnap.exists()) {
      // console.log(`[trainingLogService] Log found for userId: ${userId}, date: ${date}`, docSnap.data());
      return docSnap.data() as WorkoutLog;
    }
    // console.log(`[trainingLogService] No log found for userId: ${userId}, date: ${date}`);
    return null;
  } catch (error: any) {
    console.error(`[trainingLogService] Error fetching workout log for userId: ${userId}, date: ${date}:`, error);
    throw new Error(`Failed to fetch workout log. ${error.message}`);
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

  if (validSets.length === 0) return; 

  const entry: ExercisePerformanceEntry = {
    date: Timestamp.now().toMillis(), 
    sets: validSets,
  };
  try {
    const performanceEntriesColRef = collection(db, getExercisePerformanceEntriesCollectionPath(userId, exerciseId));
    await addDoc(performanceEntriesColRef, entry);
  } catch (error: any) {
    console.error("Error saving exercise performance entry:", error);
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
    } catch (error: any) {
        console.error(`Error deleting performance entries for exercise ${exerciseId}:`, error);
        throw new Error(`Failed to delete performance entries. ${error.message}`);
    }
};
