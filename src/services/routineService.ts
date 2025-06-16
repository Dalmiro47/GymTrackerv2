
import { db } from '@/lib/firebaseConfig';
import type { Routine, RoutineData, RoutineExercise } from '@/types';
import {
  collection,
  addDoc, // Keep for reference, but we'll use setDoc with specific ID
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc, // Import setDoc
  query,
  orderBy,
  Timestamp // For potential future use with timestamps
} from 'firebase/firestore';
import { slugify } from '@/lib/utils'; // Import slugify

const getUserRoutinesCollectionPath = (userId: string) => `users/${userId}/routines`;

// Add a new routine for a user
export const addRoutine = async (userId: string, routineData: RoutineData): Promise<Routine> => {
  if (!userId) throw new Error("User ID is required to add a routine.");
  try {
    const simplifiedExercises = routineData.exercises.map(ex => ({
        id: ex.id, 
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        targetNotes: ex.targetNotes || '',
        exerciseSetup: ex.exerciseSetup || '',
        dataAiHint: ex.dataAiHint || ''
    }));

    const dataToSave = {
      ...routineData,
      exercises: simplifiedExercises,
    };

    // Generate a slug from the routine name to use as the document ID
    const routineIdSlug = slugify(routineData.name); 
    if (!routineIdSlug) {
        // Fallback for empty or invalid names, though form validation should prevent this
        throw new Error("Routine name is invalid and cannot be used to generate an ID.");
    }

    const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));
    // Use doc() with the generated slug to create a reference to a specific document ID
    const routineDocRef = doc(userRoutinesColRef, routineIdSlug); 
    
    // Use setDoc to create or overwrite the document with the specified ID
    await setDoc(routineDocRef, dataToSave); 

    return { id: routineIdSlug, ...dataToSave } as Routine;
  } catch (error: any) {
    console.error("Detailed error adding routine to Firestore: ", error);
    throw new Error(`Failed to add routine. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

// Get all routines for a user
export const getRoutines = async (userId: string): Promise<Routine[]> => {
  if (!userId) throw new Error("User ID is required to get routines.");
  try {
    const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));
    const querySnapshot = await getDocs(userRoutinesColRef); 
    const routines: Routine[] = [];
    querySnapshot.forEach((doc) => {
      routines.push({ id: doc.id, ...(doc.data() as RoutineData) });
    });
    return routines;
  } catch (error: any) {
    console.error("Error fetching routines from Firestore: ", error);
    throw new Error(`Failed to fetch routines. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

// Get a single routine by ID
export const getRoutineById = async (userId: string, routineId: string): Promise<Routine | null> => {
    if (!userId) throw new Error("User ID is required.");
    if (!routineId) throw new Error("Routine ID is required.");
    try {
        const routineDocRef = doc(db, getUserRoutinesCollectionPath(userId), routineId);
        const docSnap = await getDoc(routineDocRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...(docSnap.data() as RoutineData) };
        }
        return null;
    } catch (error: any) {
        console.error("Error fetching routine by ID:", error);
        throw new Error(`Failed to fetch routine. Firestore error: ${error.message || 'Unknown error'}`);
    }
};

// Update an existing routine for a user
export const updateRoutine = async (userId: string, routineId: string, routineData: Partial<RoutineData>): Promise<void> => {
  if (!userId) throw new Error("User ID is required to update a routine.");
  if (!routineId) throw new Error("Routine ID is required to update a routine.");
  try {
    const routineDocRef = doc(db, getUserRoutinesCollectionPath(userId), routineId);
    
    let dataToUpdate: Partial<RoutineData> = { ...routineData };
    if (routineData.exercises) {
        dataToUpdate.exercises = routineData.exercises.map(ex => ({
            id: ex.id,
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            targetNotes: ex.targetNotes || '',
            exerciseSetup: ex.exerciseSetup || '',
            dataAiHint: ex.dataAiHint || ''
        }));
    }

    await updateDoc(routineDocRef, dataToUpdate);
  } catch (error: any) {
    console.error("Error updating routine in Firestore: ", error);
    throw new Error(`Failed to update routine. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

// Delete a routine for a user
export const deleteRoutine = async (userId: string, routineId: string): Promise<void> => {
  if (!userId) throw new Error("User ID is required to delete a routine.");
  if (!routineId) throw new Error("Routine ID is required to delete a routine.");
  try {
    const routineDocRef = doc(db, getUserRoutinesCollectionPath(userId), routineId);
    await deleteDoc(routineDocRef);
  } catch (error: any) {
    console.error("Error deleting routine from Firestore: ", error);
    throw new Error(`Failed to delete routine. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

