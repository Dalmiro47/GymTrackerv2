
import { db } from '@/lib/firebaseConfig';
import type { Exercise, ExerciseData, MuscleGroup } from '@/types';
import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  writeBatch, 
  Timestamp 
} from 'firebase/firestore';
import { deleteAllPerformanceEntriesForExercise } from './trainingLogService'; // Import the new function

// Firestore collection path for a user's exercises
const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;

// Add a new exercise for a user
export const addExercise = async (userId: string, exerciseData: ExerciseData): Promise<Exercise> => {
  if (!userId) throw new Error("User ID is required to add an exercise.");
  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    const docRef = await addDoc(userExercisesColRef, exerciseData);
    return { id: docRef.id, ...exerciseData };
  } catch (error: any) {
    console.error("Detailed error adding exercise to Firestore: ", error); 
    throw new Error(`Failed to add exercise. Firestore error: ${error.message || error}`);
  }
};

// Add a batch of default exercises for a user
export const addDefaultExercisesBatch = async (userId: string, defaultExercises: ExerciseData[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required to add default exercises.");
  if (!defaultExercises || defaultExercises.length === 0) return;

  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    const batch = writeBatch(db);

    defaultExercises.forEach((exerciseData) => {
      const newExerciseRef = doc(userExercisesColRef); 
      batch.set(newExerciseRef, exerciseData);
    });

    await batch.commit();
  } catch (error: any) {
    console.error("Error adding default exercises batch to Firestore: ", error);
    throw new Error("Failed to add default exercises.");
  }
};


// Get all exercises for a user
export const getExercises = async (userId: string): Promise<Exercise[]> => {
  if (!userId) throw new Error("User ID is required to get exercises.");
  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    const querySnapshot = await getDocs(userExercisesColRef);
    const exercises: Exercise[] = [];
    querySnapshot.forEach((doc) => {
      exercises.push({ id: doc.id, ...(doc.data() as ExerciseData) });
    });
    return exercises;
  } catch (error: any) {
    console.error("Error fetching exercises from Firestore: ", error);
    throw new Error("Failed to fetch exercises.");
  }
};

// Update an existing exercise for a user
export const updateExercise = async (userId: string, exerciseId: string, exerciseData: Partial<ExerciseData>): Promise<void> => {
  if (!userId) throw new Error("User ID is required to update an exercise.");
  if (!exerciseId) throw new Error("Exercise ID is required to update an exercise.");
  try {
    const exerciseDocRef = doc(db, getUserExercisesCollectionPath(userId), exerciseId);
    await updateDoc(exerciseDocRef, exerciseData);
  } catch (error: any) {
    console.error("Error updating exercise in Firestore: ", error);
    throw new Error("Failed to update exercise.");
  }
};

// Delete an exercise for a user
export const deleteExercise = async (userId: string, exerciseId: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required to delete an exercise.");
  if (!exerciseId) throw new Error("Exercise ID is required to delete an exercise.");
  try {
    const exerciseDocRef = doc(db, getUserExercisesCollectionPath(userId), exerciseId);
    await deleteDoc(exerciseDocRef);

    // Also delete all performance entries for this exercise
    await deleteAllPerformanceEntriesForExercise(userId, exerciseId);

  } catch (error: any) {
    console.error("Error deleting exercise from Firestore: ", error);
    throw new Error("Failed to delete exercise.");
  }
};

