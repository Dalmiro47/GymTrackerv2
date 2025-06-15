
/**
 * @fileOverview Service functions for interacting with Firestore for training logs.
 * - saveWorkoutLog: Saves or updates the workout log for a specific date.
 * - getWorkoutLog: Fetches the workout log for a specific date.
 * - deleteWorkoutLog: Deletes the workout log for a specific date.
 * - saveExercisePerformanceEntry: Saves/updates the performance snapshot (last session & PR) for an exercise.
 * - getLastLoggedPerformance: Retrieves the performance snapshot for an exercise.
 * - deleteAllPerformanceEntriesForExercise: Deletes the performance entry for a specific exercise.
 * - getLoggedDateStrings: Fetches all dates ("yyyy-MM-dd") that have workout logs.
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
    // Ensure payload ID and date match the document ID being saved to
    workoutLogPayload.id = date;
    workoutLogPayload.date = date;
  }
  
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  console.log(`[SERVICE] saveWorkoutLog: Document reference path: ${logDocRef.path}`);
  // console.log(`[SERVICE] saveWorkoutLog: Payload to save:`, JSON.stringify(workoutLogPayload, null, 2));


  try {
    // Using setDoc with merge:true will create or update the document.
    await setDoc(logDocRef, workoutLogPayload, { merge: true }); 
    console.log(`[SERVICE] Workout log for ${date} saved successfully for user ${userId}.`);
  } catch (error: any) {
    console.error(`[SERVICE] Error saving workout log for ${date}, user ${userId}:`, error);
    throw new Error(`Failed to save workout log. ${error.message}`);
  }
};


export const getWorkoutLog = async (userId: string, date: string): Promise<WorkoutLog | null> => {
  if (!userId) {
    // console.error("[SERVICE] getWorkoutLog: User ID is required.");
    throw new Error("User ID is required.");
  }
  if (!date) {
    // console.error("[SERVICE] getWorkoutLog: Date is required.");
    throw new Error("Date is required to fetch a workout log.");
  }
  const logDocRef = doc(db, getUserWorkoutLogsCollectionPath(userId), date);
  try {
    const docSnap = await getDoc(logDocRef);
    if (docSnap.exists()) {
      return docSnap.data() as WorkoutLog;
    }
    // console.log(`[SERVICE] getWorkoutLog: No log found for userId: ${userId}, date: ${date}`);
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
      // Assuming doc.id is the date string "YYYY-MM-DD"
      dates.push(doc.id); 
    });
    // console.log(`[SERVICE] getLoggedDateStrings: Found ${dates.length} logged dates for userId ${userId}.`);
    return dates;
  } catch (error: any) {
    console.error(`[SERVICE] getLoggedDateStrings: Error fetching logged dates for userId ${userId}:`, error);
    // It's often better to throw or let the caller handle UI for error states,
    // but returning empty array might be acceptable depending on requirements.
    return []; 
  }
};

// Helper to find the best set (highest weight, then highest reps)
const findBestSet = (sets: LoggedSet[]): { reps: number; weight: number } | null => {
  if (!sets || sets.length === 0) return null;

  let bestSet: { reps: number; weight: number } | null = null;

  for (const set of sets) {
    // Ensure reps and weight are numbers, defaulting to 0 if null/undefined
    const weight = typeof set.weight === 'number' ? set.weight : 0;
    const reps = typeof set.reps === 'number' ? set.reps : 0;

    // Skip sets with no positive weight or reps, as they can't be a PR
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

export const saveExercisePerformanceEntry = async (userId: string, exerciseId: string, currentSessionSets: LoggedSet[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");

  // Ensure sets are valid numbers, defaulting nulls to 0. Filter out sets that are entirely empty.
  const validCurrentSessionSets = currentSessionSets
    .map(s => ({
      id: s.id || `set-${Date.now()}`, // Ensure ID exists
      reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
      weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
    }))
    .filter(s => s.reps > 0 || s.weight > 0); // Only consider sets with actual work done

  // If no actual work was done in this session for this exercise, don't update performance entry
  if (validCurrentSessionSets.length === 0) {
    console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets in current session for exerciseId=${exerciseId}. Skipping performance entry update.`);
    return;
  }

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
  
  let newPersonalRecord: PersonalRecord | null = null;
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    // Start with existing PR, or null if none
    newPersonalRecord = existingEntryData?.personalRecord || null;

    const bestSetThisSession = findBestSet(validCurrentSessionSets); // Use valid sets
    // console.log(`[SERVICE] saveExercisePerformanceEntry: Best set this session for ${exerciseId}:`, bestSetThisSession);


    if (bestSetThisSession) { // If there was a valid best set this session
      if (!newPersonalRecord || 
          bestSetThisSession.weight > newPersonalRecord.weight ||
          (bestSetThisSession.weight === newPersonalRecord.weight && bestSetThisSession.reps > newPersonalRecord.reps)) {
        newPersonalRecord = {
          reps: bestSetThisSession.reps,
          weight: bestSetThisSession.weight,
          date: Timestamp.now().toMillis(), // Record when this PR was achieved
        };
        console.log(`[SERVICE] saveExercisePerformanceEntry: New PR identified for ${exerciseId}: ${newPersonalRecord.reps}x${newPersonalRecord.weight}kg`);
      } else {
        // console.log(`[SERVICE] saveExercisePerformanceEntry: Existing PR for ${exerciseId} (${newPersonalRecord?.reps}x${newPersonalRecord?.weight}kg) is better or equal. Not updating PR.`);
      }
    } else {
        // console.log(`[SERVICE] saveExercisePerformanceEntry: No valid best set found this session for ${exerciseId}. PR remains unchanged.`);
    }

    const entryDataToSave: ExercisePerformanceEntry = {
      lastPerformedDate: Timestamp.now().toMillis(),
      lastPerformedSets: validCurrentSessionSets, // Save the actual valid sets performed
      personalRecord: newPersonalRecord,
    };

    await setDoc(performanceEntryDocRef, entryDataToSave); 
    // console.log(`[SERVICE] saveExercisePerformanceEntry: Successfully saved/updated performance entry for exerciseId=${exerciseId}. PR: ${newPersonalRecord ? JSON.stringify(newPersonalRecord) : 'N/A'}`);

  } catch (error: any) {
    console.error(`[SERVICE] saveExercisePerformanceEntry: Error saving/updating exercise performance entry for exerciseId=${exerciseId}:`, error);
    throw new Error(`Failed to save performance entry for ${exerciseId}. ${error.message}`);
  }
};


// Fetches the entire performance entry for an exercise (includes last sets and PR)
export const getLastLoggedPerformance = async (userId: string, exerciseId: string): Promise<ExercisePerformanceEntry | null> => {
  if (!userId) {
    // console.error("[SERVICE] getLastLoggedPerformance: User ID is required.");
    throw new Error("User ID is required.");
  }
  if (!exerciseId) {
    // console.error("[SERVICE] getLastLoggedPerformance: Exercise ID is required.");
    throw new Error("User ID is required.");
  }

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);

  try {
    const docSnap = await getDoc(performanceEntryDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as ExercisePerformanceEntry;
      // console.log(`[SERVICE] getLastLoggedPerformance for exerciseId=${exerciseId}:`, data);
      return data;
    }
    // console.log(`[SERVICE] getLastLoggedPerformance: No performance entry found for exerciseId=${exerciseId}`);
    return null;
  } catch (error: any) {
    console.error(`[SERVICE] Error getLastLoggedPerformance for exerciseId=${exerciseId}:`, error);
    // Depending on use case, might be better to throw or return a specific error state.
    return null; 
  }
};


// Function to delete all performance entries for a specific exercise (e.g., when an exercise is deleted from library)
export const deleteAllPerformanceEntriesForExercise = async (userId: string, exerciseId: string): Promise<void> => {
    if (!userId) throw new Error("User ID is required.");
    if (!exerciseId) throw new Error("Exercise ID is required.");

    const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
    const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
    try {
        await deleteFirestoreDoc(performanceEntryDocRef);
        // console.log(`[SERVICE] Performance entry for exercise ${exerciseId} deleted successfully.`);
    } catch (error: any) {
        console.error(`Error deleting performance entry for exercise ${exerciseId}:`, error);
        // Optionally re-throw or handle as appropriate for your app's error strategy
    }
};


// Firestore security rules should be updated to allow access to these paths:
// match /users/{userId}/workoutLogs/{date} {
//   allow read, write, delete: if request.auth.uid == userId;
// }
// match /users/{userId}/performanceEntries/{exerciseId} {
//  allow read, write, delete: if request.auth.uid == userId;
// }
// match /users/{userId}/exercises/{exerciseDocId} {
//   allow read, write, delete: if request.auth.uid == userId;
// }
// match /users/{userId}/routines/{routineDocId} {
//   allow read, write, delete: if request.auth.uid == userId;
// }
