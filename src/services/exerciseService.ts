
import { db } from '@/lib/firebaseConfig';
import type { Exercise, ExerciseData } from '@/types';
import { 
  collection, 
  getDocs, 
  doc, 
  deleteDoc, 
  writeBatch, 
  setDoc,
  query,
  orderBy,
  getDoc,
} from 'firebase/firestore';
import { deleteAllPerformanceEntriesForExercise } from './trainingLogService'; 
import { stripUndefinedDeep } from '@/lib/sanitize';
import { buildExerciseDocId } from '@/lib/ids';

const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;

/**
 * Create a new exercise with a deterministic, human-readable document ID
 * based on the exercise name + muscle group, with collision suffixes (-2, -3, ...).
 */
export async function addExercise(userId: string, data: ExerciseData): Promise<Exercise> {
  if (!userId) throw new Error('User ID is required.');
  if (!data?.name || data.name.trim().length < 2) {
    throw new Error('Exercise name must be at least 2 characters.');
  }
  if (!data?.muscleGroup) {
    throw new Error('Muscle group is required.');
  }

  const colPath = getUserExercisesCollectionPath(userId);
  const baseId = buildExerciseDocId(data.name, data.muscleGroup);
  let candidateId = baseId;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ref = doc(db, colPath, candidateId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // Build payload and remove ALL undefined deeply
      const raw = {
        name: data.name.trim(),
        muscleGroup: data.muscleGroup,
        targetNotes: data.targetNotes || '',
        exerciseSetup: data.exerciseSetup || '',
        progressiveOverload: data.progressiveOverload || '',
        instructions: data.instructions || '',
        dataAiHint: data.dataAiHint || '',
        // warmup is optional; only include defined fields
        warmup: data.warmup
          ? {
              template: data.warmup.template,
              isWeightedBodyweight: data.warmup.isWeightedBodyweight,
              roundingIncrementKg: data.warmup.roundingIncrementKg,
              overrideSteps: data.warmup.overrideSteps?.map(s => ({
                type: s.type,
                percent: s.type === 'PERCENT' ? s.percent : undefined,
                reps: s.reps,
                rest: s.rest,
                appliesTo: s.appliesTo,
                note: s.note,
                label: s.type === 'LABEL' ? s.label : undefined,
              })),
            }
          : undefined,
      };

      const payload = stripUndefinedDeep(raw); // <-- KEY LINE

      await setDoc(ref, payload);
      return { id: candidateId, ...(payload as ExerciseData) };
    }
    candidateId = `${baseId}-${suffix++}`;
  }
}

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
