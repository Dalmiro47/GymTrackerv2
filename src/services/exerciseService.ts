
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
  arrayUnion,
  updateDoc,
  arrayRemove,
} from 'firebase/firestore';
import { deleteAllPerformanceEntriesForExercise } from './trainingLogService'; 
import { stripUndefinedDeep } from '@/lib/sanitize';
import { buildExerciseDocId } from '@/lib/ids';
import { defaultExercises } from '@/lib/defaultExercises';

const getUserExercisesCollectionPath = (userId: string) => `users/${userId}/exercises`;
const CURRENT_SEED_VERSION = 2;

export type SeedResult = { addedCount: number; bumpedSeedVersion: boolean };

/**
 * Ensures the user's exercise library is seeded with default exercises.
 * This function is idempotent and versioned. It will:
 * 1. Check a `seedVersion` on the user's profile.
 * 2. Only run if the user's version is less than the current version or if new defaults are missing.
 * 3. Respect a `deletedDefaultIds` array ("tombstones") in the user's profile to not re-add deleted defaults.
 * 4. Fetch all existing exercise IDs to avoid overwriting.
 * 5. Create only the default exercises that are missing and not tombstoned.
 * 6. Update the `seedVersion` on the user's profile if necessary.
 */
export async function ensureExercisesSeeded(userId: string): Promise<SeedResult> {
  if (!userId) throw new Error("User ID is required for seeding.");

  const profileRef = doc(db, 'users', userId, 'profile', 'profile');
  const exercisesCol = collection(db, 'users', userId, 'exercises');

  try {
    const profileSnap = await getDoc(profileRef);
    const profile = profileSnap.exists() ? profileSnap.data() : {};
    const prevSeedVersion: number = profile.seedVersion ?? 0;
    const deletedDefaultIds: string[] = profile.deletedDefaultIds ?? [];

    const existingIds = new Set<string>();
    const existingSnap = await getDocs(exercisesCol);
    existingSnap.forEach(d => existingIds.add(d.id));

    const missing = defaultExercises.filter(
      ex => !existingIds.has(ex.id) && !deletedDefaultIds.includes(ex.id)
    );

    const bumpedSeedVersion = prevSeedVersion < CURRENT_SEED_VERSION;

    if (missing.length === 0 && !bumpedSeedVersion) {
      return { addedCount: 0, bumpedSeedVersion: false };
    }

    const batch = writeBatch(db);

    for (const ex of missing) {
      const { id, ...payload } = ex;
      const ref = doc(exercisesCol, id);
      batch.set(ref, stripUndefinedDeep(payload));
    }
    
    if (bumpedSeedVersion) {
      batch.set(profileRef, { seedVersion: CURRENT_SEED_VERSION }, { merge: true });
    }

    await batch.commit();
    return { addedCount: missing.length, bumpedSeedVersion };

  } catch (error: any) {
    console.error("Error during idempotent exercise seeding:", error);
    throw new Error("Library sync failed.");
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
  
  const exerciseDocRef = doc(db, getUserExercisesCollectionPath(userId), exerciseId);
  await deleteDoc(exerciseDocRef);
  await deleteAllPerformanceEntriesForExercise(userId, exerciseId);

  const isDefault = defaultExercises.some(ex => ex.id === exerciseId);
  if (isDefault) {
    const profileRef = doc(db, 'users', userId, 'profile', 'profile');
    try {
      await setDoc(
        profileRef,
        { deletedDefaultIds: arrayUnion(exerciseId) },
        { merge: true }
      );
    } catch (error: any) {
      console.error(`Failed to tombstone deleted default exercise ${exerciseId}:`, error);
    }
  }
};

type HiddenDefault = { id: string; name: string; muscleGroup: string };

export async function getHiddenDefaultExercises(userId: string): Promise<HiddenDefault[]> {
  const profileRef = doc(db, 'users', userId, 'profile', 'profile');
  const snap = await getDoc(profileRef);
  const deleted: string[] = snap.exists() ? (snap.data().deletedDefaultIds ?? []) : [];

  const byId = new Map(defaultExercises.map(ex => [ex.id, ex]));
  return deleted
    .map(id => byId.get(id))
    .filter((ex): ex is Exercise => !!ex)
    .map(ex => ({ id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup }));
}

export async function restoreHiddenDefaults(
  userId: string,
  exerciseIds: string[]
): Promise<SeedResult> {
  if (exerciseIds.length === 0) return { addedCount: 0, bumpedSeedVersion: false };

  const profileRef = doc(db, 'users', userId, 'profile', 'profile');
  
  await updateDoc(profileRef, {
    deletedDefaultIds: arrayRemove(...exerciseIds)
  });

  const result = await ensureExercisesSeeded(userId);
  return result;
}

export async function restoreAllHiddenDefaults(userId: string): Promise<SeedResult> {
  const hidden = await getHiddenDefaultExercises(userId);
  return restoreHiddenDefaults(userId, hidden.map(h => h.id));
}
