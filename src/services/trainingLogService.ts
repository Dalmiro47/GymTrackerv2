
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

export const saveExercisePerformanceEntry = async (userId: string, exerciseId: string, currentSessionSets: LoggedSet[]): Promise<void> => {
  console.log(`[SERVICE] saveExercisePerformanceEntry: Initiated for userId=${userId}, exerciseId=${exerciseId}`);
  console.log(`[SERVICE] saveExercisePerformanceEntry: Received currentSessionSets:`, JSON.stringify(currentSessionSets, null, 2));

  if (!userId) throw new Error("User ID is required.");
  if (!exerciseId) throw new Error("Exercise ID is required.");

  const validCurrentSessionSets = currentSessionSets
    .map(s => ({
      id: s.id || `set-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      reps: s.reps === null || isNaN(Number(s.reps)) ? 0 : Number(s.reps),
      weight: s.weight === null || isNaN(Number(s.weight)) ? 0 : Number(s.weight),
    }))
    .filter(s => s.reps > 0 || s.weight > 0);
  
  console.log(`[SERVICE] saveExercisePerformanceEntry: Processed validCurrentSessionSets:`, JSON.stringify(validCurrentSessionSets, null, 2));

  if (validCurrentSessionSets.length === 0) {
    console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets in current session for exerciseId=${exerciseId}.`);
    // Check if an entry exists. If not, don't create one. If it does, we might only update lastPerformedDate if we wanted to signify an attempt without PR change.
    // For now, if no valid work, we don't update the performance entry unless it already exists and we want to clear lastPerformedSets or similar.
    // The current logic implies that if there are no valid sets, nothing is written to performanceEntries, which might be okay.
    // However, if an entry ALREADY exists, we might want to update its lastPerformedDate at least.
    // Let's refine this: if valid sets are empty, we still update lastPerformedDate IF the document exists.
    // But we will NOT create a new document if there are no valid sets and no existing document.
    
    const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
    const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
    const existingDocSnap = await getDoc(performanceEntryDocRef);

    if (existingDocSnap.exists()) {
      // Entry exists, but current session has no valid sets.
      // We could update lastPerformedDate and keep existing PR, clear lastPerformedSets.
      // For simplicity now, let's say if no new valid work, we don't aggressively update PR or last sets.
      // This means if user logs all 0s, the old PR and lastPerformedSets stick. This might be fine.
      console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets, existing entry found. Not modifying PR or lastPerformedSets based on this session.`);
      // Optionally, update only lastPerformedDate if needed:
      // await setDoc(performanceEntryDocRef, { lastPerformedDate: Timestamp.now().toMillis() }, { merge: true });
      return; 
    } else {
      console.log(`[SERVICE] saveExercisePerformanceEntry: No valid sets and no existing entry. No action taken for performance entry.`);
      return; // Do not create a new performance entry if there's no valid work done.
    }
  }

  const performanceEntriesColPath = getUserPerformanceEntriesCollectionPath(userId);
  const performanceEntryDocRef = doc(db, performanceEntriesColPath, exerciseId);
  
  let newPersonalRecord: PersonalRecord | null = null;
  
  try {
    const existingDocSnap = await getDoc(performanceEntryDocRef);
    const existingEntryData = existingDocSnap.exists() ? existingDocSnap.data() as ExercisePerformanceEntry : null;
    
    console.log(`[SERVICE] saveExercisePerformanceEntry: Existing performance entry data for ${exerciseId}:`, existingEntryData ? JSON.stringify(existingEntryData, null, 2) : "null");

    newPersonalRecord = existingEntryData?.personalRecord || null;
    console.log(`[SERVICE] saveExercisePerformanceEntry: Initial newPersonalRecord (from existing or null):`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");

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
        };
        console.log(`[SERVICE] saveExercisePerformanceEntry: New PR identified for ${exerciseId}:`, JSON.stringify(newPersonalRecord, null, 2));
      } else {
        console.log(`[SERVICE] saveExercisePerformanceEntry: Existing PR for ${exerciseId} (${JSON.stringify(newPersonalRecord, null, 2)}) is better/equal. PR value itself not updated. Saving object.`);
      }
    } else {
        console.log(`[SERVICE] saveExercisePerformanceEntry: No valid best set found this session for ${exerciseId}. PR object remains as:`, newPersonalRecord ? JSON.stringify(newPersonalRecord, null, 2) : "null");
    }

    const entryDataToSave: ExercisePerformanceEntry = {
      lastPerformedDate: Timestamp.now().toMillis(),
      lastPerformedSets: validCurrentSessionSets, 
      personalRecord: newPersonalRecord, // This should save the new or existing PR object, or null
    };

    console.log(`[SERVICE] saveExercisePerformanceEntry: Final entryDataToSave for ${exerciseId}:`, JSON.stringify(entryDataToSave, null, 2));
    await setDoc(performanceEntryDocRef, entryDataToSave); 
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
