
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
  setDoc, 
  query,
  orderBy,
  writeBatch, 
  Timestamp 
} from 'firebase/firestore';
import { slugify } from '@/lib/utils'; 

const getUserRoutinesCollectionPath = (userId: string) => `users/${userId}/routines`;

// Add a new routine for a user
export const addRoutine = async (userId: string, routineData: Omit<RoutineData, 'order'>): Promise<Routine> => {
  if (!userId) throw new Error("User ID is required to add a routine.");
  try {
    const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));
    
    // Determine the order for the new routine
    const routinesSnapshot = await getDocs(query(userRoutinesColRef, orderBy("order", "desc"), limit(1)));
    let newOrder = 0;
    if (!routinesSnapshot.empty) {
      const lastRoutine = routinesSnapshot.docs[0].data() as Routine;
      newOrder = (lastRoutine.order || 0) + 1;
    }

    const simplifiedExercises = routineData.exercises.map(ex => ({
        id: ex.id, 
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        targetNotes: ex.targetNotes || '',
        exerciseSetup: ex.exerciseSetup || '',
        dataAiHint: ex.dataAiHint || ''
    }));

    const dataToSave: RoutineData = {
      ...routineData,
      exercises: simplifiedExercises,
      order: newOrder, 
    };

    const routineIdSlug = slugify(routineData.name); 
    if (!routineIdSlug) {
        throw new Error("Routine name is invalid and cannot be used to generate an ID.");
    }

    const routineDocRef = doc(userRoutinesColRef, routineIdSlug); 
    
    await setDoc(routineDocRef, dataToSave); 

    return { id: routineIdSlug, ...dataToSave } as Routine;
  } catch (error: any) {
    console.error("Detailed error adding routine to Firestore: ", error);
    throw new Error(`Failed to add routine. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

// Get all routines for a user, ordered by 'order'
export const getRoutines = async (userId: string): Promise<Routine[]> => {
  if (!userId) throw new Error("User ID is required to get routines.");
  try {
    const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));
    // Query to order routines by the 'order' field
    const q = query(userRoutinesColRef, orderBy("order", "asc"));
    const querySnapshot = await getDocs(q); 
    const routines: Routine[] = [];
    querySnapshot.forEach((doc) => {
      routines.push({ id: doc.id, ...(doc.data() as RoutineData) });
    });
    return routines;
  } catch (error: any) {
    console.error("Error fetching routines from Firestore: ", error);
    throw new Error(`Failed to fetch routines. Firestore error: ${error.message || 'Unknown error'}. Ensure 'order' field index is created in Firestore for users/{userId}/routines.`);
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
export const updateRoutine = async (userId: string, routineId: string, routineData: Partial<Omit<RoutineData, 'order'>>): Promise<void> => {
  if (!userId) throw new Error("User ID is required to update a routine.");
  if (!routineId) throw new Error("Routine ID is required to update a routine.");
  try {
    const routineDocRef = doc(db, getUserRoutinesCollectionPath(userId), routineId);
    
    let dataToUpdate: Partial<Omit<RoutineData, 'order'>> = { ...routineData };
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
    // Note: The 'order' field is managed by updateRoutinesOrder, not here.
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
    // Note: After deleting, you might want to re-order remaining routines. 
    // This can be complex (e.g., if you delete from the middle).
    // For now, it will leave gaps in 'order' numbers, which getRoutines handles fine.
    // A more robust solution might re-run updateRoutinesOrder on the remaining items.
  } catch (error: any) {
    console.error("Error deleting routine from Firestore: ", error);
    throw new Error(`Failed to delete routine. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

// New function to update the order of all routines
export const updateRoutinesOrder = async (userId: string, orderedRoutineIds: string[]): Promise<void> => {
  if (!userId) throw new Error("User ID is required to update routine orders.");
  if (!Array.isArray(orderedRoutineIds)) throw new Error("Ordered routine IDs must be an array.");

  const batch = writeBatch(db);
  const userRoutinesColRef = collection(db, getUserRoutinesCollectionPath(userId));

  orderedRoutineIds.forEach((routineId, index) => {
    const routineDocRef = doc(userRoutinesColRef, routineId);
    batch.update(routineDocRef, { order: index });
  });

  try {
    await batch.commit();
  } catch (error: any) {
    console.error("Error updating routines order in Firestore:", error);
    throw new Error(`Failed to update routines order. Firestore error: ${error.message || 'Unknown error'}`);
  }
};

