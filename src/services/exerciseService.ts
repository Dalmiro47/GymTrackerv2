
import { db } from '@/lib/firebaseConfig';
import type { Exercise, ExerciseData } from '@/types';
import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  deleteDoc, 
  writeBatch, 
  setDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { deleteAllPerformanceEntriesForExercise } from './trainingLogService'; 
import { stripUndefinedDeep } from '@/lib/sanitize';

const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;

export const addExercise = async (userId: string, exerciseData: ExerciseData): Promise<Exercise> => {
  if (!userId) throw new Error("User ID is required to add an exercise.");
  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    
    // Sanitize the object to remove any `undefined` values before sending to Firestore
    const dataToSave = stripUndefinedDeep(exerciseData);

    const docRef = await addDoc(userExercisesColRef, dataToSave); 
    return { id: docRef.id, ...dataToSave as ExerciseData };
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
      
      const dataToSave = stripUndefinedDeep(exercisePayload);
      
      const exerciseDocRef = doc(userExercisesColRef, id); 
      batch.set(exerciseDocRef, dataToSave); 
    });

    await batch.commit();
  } catch (error: any)
  {
    console.error("Error adding/updating default exercises batch in Firestore: ", error);
    throw new Error("Failed to add/update default exercises.");
  }
};


export const getExercises = async (userId: string): Promise<Exercise[]> => {
  if (!userId) throw new Error("User ID is required to get exercises.");
  try {
    const userExercisesColRef = collection(db, getUserExercisesCollectionPath(userId));
    const q = query(userExercisesColRef, orderBy('name'));
    const querySnapshot = await getDocs(q);
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
    
    // Sanitize the object to remove any `undefined` values before sending to Firestore
    const dataToUpdate = stripUndefinedDeep(exerciseData);
    
    await setDoc(exerciseDocRef, dataToUpdate, { merge: true });
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
