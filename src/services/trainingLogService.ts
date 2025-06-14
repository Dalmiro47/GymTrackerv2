
'use server';
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
export const saveWorkoutLog = async (userId: string, date: string, logData: Omit<WorkoutLog, 'id' | 'date' >): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to save a workout log.");
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  const dataToSave: WorkoutLog = {
    id: date,
    date: date,
    ...logData,
    exercises: logData.exercises.map(ex => ({
      ...ex,
      sets: ex.sets.map(s => ({
        id: s.id,
        reps: s.reps === null || isNaN(s.reps) ? 0 : Number(s.reps),
        weight: s.weight === null || isNaN(s.weight) ? 0 : Number(s.weight),
      })).filter(s => s.reps > 0 || s.weight > 0) // Only save sets with actual values
    }))
  };

  try {
    await setDoc(logDocRef, dataToSave, { merge: true }); // Use merge to update if exists, or create
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
  if (!userId) throw new Error("User ID is required.");
  if (!date) throw new Error("Date is required to fetch a workout log.");

  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const docSnap = await getDoc(logDocRef);
    if (docSnap.exists()) {
      return docSnap.data() as WorkoutLog;
    }
    return null;
  } catch (error: any) {
    console.error("Error fetching workout log:", error);
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

  if (validSets.length === 0) return; // Don't save empty performance

  const entry: ExercisePerformanceEntry = {
    date: Timestamp.now().toMillis(), // Store as milliseconds for ordering
    sets: validSets,
  };
  try {
    const performanceEntriesColRef = collection(db, getExercisePerformanceEntriesCollectionPath(userId, exerciseId));
    await addDoc(performanceEntriesColRef, entry);
  } catch (error: any) {
    console.error("Error saving exercise performance entry:", error);
    // Non-critical, so don't throw, just log. The main log save is more important.
  }
};

/**
 * Retrieves the most recent logged performance for a specific exercise.
 */
export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");

  const performanceEntriesColRef = collection(db, getExercisePerformanceEntriesCollectionPath(userId, exerciseId));
  const q = query(performanceEntriesColRef, orderBy("date", "desc"), limit(1));
  try {
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].data() as ExercisePerformanceEntry;
    }
    return null;
  } catch (error: any) {
    console.error("Error fetching last logged performance:", error);
    // Don't throw, let UI handle missing last performance gracefully
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
