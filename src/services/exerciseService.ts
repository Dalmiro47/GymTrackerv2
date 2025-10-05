
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
import { defaultExercises } from '@/lib/defaultExercises';

const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;
const CURRENT_SEED_VERSION = 2; // Bump this when you add/change default exercises

/**
 * Ensures the user's exercise library is seeded with default exercises.
 * This function is idempotent and versioned. It will:
 * 1. Check a `seedVersion` on the user's profile.
 * 2. Only run if the user's version is less than the current version.
 * 3. Fetch all existing exercise IDs to avoid overwriting.
 * 4. Create only the default exercises that are missing.
 * 5. Update the `seedVersion` on the user's profile.
 * This prevents accidental overwriting of user-edited exercises.
 */
export async function ensureExercisesSeeded(userId: string): Promise<void> {
  if (!userId) throw new Error("User ID is required for seeding.");

  const profileRef = doc(db, 'users', userId, 'profile', 'profile');
  const exercisesCol = collection(db, 'users', userId, 'exercises');

  try {
    // 1. Check seed version first
    const profileSnap = await getDoc(profileRef);
    const prevSeedVersion = profileSnap.exists() ? (profileSnap.data().seedVersion ?? 0) : 0;

    if (prevSeedVersion >= CURRENT_SEED_VERSION) {
      return; // Already seeded with the current or a newer version
    }

    // 2. Load existing exercise IDs once to prevent overwrites
    const existingIds = new Set<string>();
    const existingSnap = await getDocs(exercisesCol);
    existingSnap.forEach(d => existingIds.add(d.id));

    // 3. Create only missing default exercises
    const batch = writeBatch(db);
    let exercisesAdded = 0;
    for (const ex of defaultExercises) {
      if (!existingIds.has(ex.id)) {
        const { id, ...payload } = ex;
        const ref = doc(exercisesCol, id);
        batch.set(ref, stripUndefinedDeep(payload)); // Never merge, only create
        exercisesAdded++;
      }
    }
    
    // Only commit if there are changes to make
    if (exercisesAdded > 0) {
        // 4. Write new seed version atomically with the exercise batch
        batch.set(profileRef, { seedVersion: CURRENT_SEED_VERSION }, { merge: true });
        await batch.commit();
    } else {
        // If no exercises were added but the version was old, just update the version
        await setDoc(profileRef, { seedVersion: CURRENT_SEED_VERSION }, { merge: true });
    }

  } catch (error: any) {
    console.error("Error during idempotent exercise seeding:", error);
    // Don't re-throw, to avoid crashing the UI on a non-critical background task
  }
}

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
      const raw = {
        name: data.name.trim(),
        muscleGroup: data.muscleGroup,
        targetNotes: data.targetNotes || '',
        exerciseSetup: data.exerciseSetup || '',
        progressiveOverload: data.progressiveOverload || '',
        instructions: data.instructions || '',
        dataAiHint: data.dataAiHint || '',
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

      const payload = stripUndefinedDeep(raw);

      await setDoc(ref, payload);
      return { id: candidateId, ...(payload as ExerciseData) };
    }
    candidateId = `${baseId}-${suffix++}`;
  }
}

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
    
    // Add a flag to indicate user has edited this, to prevent future accidental overwrites
    const dataToUpdate = stripUndefinedDeep({
        ...exerciseData,
        userEdited: true, 
        updatedAt: new Date(),
    });
    
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
