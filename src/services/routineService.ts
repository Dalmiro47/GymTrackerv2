
import { db } from '@/lib/firebaseConfig';
import type { Routine, RoutineData, RoutineExercise } from '@/types';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  orderBy,
  Timestamp // For potential future use with timestamps
} from 'firebase/firestore';

const getUserRoutinesCollectionPath = (userId: string) => `users/${userId}/routines`;

// Add a new routine for a user
export const addRoutine = async (userId: string, routineData: RoutineData): Promise<Routine> => {
  if (!userId) throw new Error("User ID is required to add a routine.");
  try {
    // Filter out any full Exercise objects if only IDs are needed, or ensure they are plain objects
    const simplifiedExercises = routineData.exercises.map(ex => ({
        id: ex.id, // Storing ID is crucial
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        description: ex.description || '',
        dataAiHint: ex.dataAiHint || ''
        // Add other essential fields from Exercise that you want to store in the routine
    }));

    const dataToSave = {
      ...routineData,
      exercises: simplifiedExercises,
      // createdAt: Timestamp.now(), // Optional: add server timestamp
      // updatedAt: Timestamp.now(), // Optional: add server timestamp
    };

    const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));
    const docRef = await addDoc(userRoutinesColRef, dataToSave);
    return { id: docRef.id, ...dataToSave } as Routine; // Cast needed if timestamps differ
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
    // const q = query(userRoutinesColRef, orderBy("createdAt", "desc")); // Optional: order by creation time
    const querySnapshot = await getDocs(userRoutinesColRef); // Use userRoutinesColRef directly if not ordering
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

// Get a single routine by ID (not strictly needed for list view, but useful)
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
            description: ex.description || '',
            dataAiHint: ex.dataAiHint || ''
        }));
    }
    // dataToUpdate.updatedAt = Timestamp.now(); // Optional: update timestamp

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
