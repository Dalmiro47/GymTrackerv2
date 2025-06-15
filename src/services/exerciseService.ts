
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
import { deleteAllPerformanceEntriesForExercise } from './trainingLogService'; 

const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;

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

export const addDefaultExercisesBatch = async (userId: string, defaultExercisesWithIds: Exercise[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required to add default exercises.");
  if (!defaultExercisesWithIds || defaultExercisesWithIds.length === 0) return;

  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    const batch = writeBatch(db);

    defaultExercisesWithIds.forEach((exercise) => {
      const { id, ...exercisePayload } = exercise; 
      if (!id) {
        console.warn("Skipping default exercise due to missing ID:", exercise.name);
        return;
      }
      // Use the predefined ID from exercise.id for the document reference
      const exerciseDocRef = doc(userExercisesColRef, id); 
      // The exercisePayload (which excludes the id) is set as the document data
      batch.set(exerciseDocRef, exercisePayload); 
    });

    await batch.commit();
  } catch (error: any) {
    console.error("Error adding/updating default exercises batch in Firestore: ", error);
    throw new Error("Failed to add/update default exercises.");
  }
};


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

export const deleteExercise = async (userId: string, exerciseId: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required to delete an exercise.");
  if (!exerciseId) throw new Error("Exercise ID is required to delete an exercise.");
  try {
    const exerciseDocRef = doc(db, getUserExercisesCollectionPath(userId), exerciseId);
    await deleteDoc(exerciseDocRef);
    await deleteAllPerformanceEntriesForExercise(userId, exerciseId);
  } catch (error: any) {
    console.error("Error deleting exercise from Firestore: ", error);
    throw new Error("Failed to delete exercise.");
  }
};
