
import { MUSCLE_GROUPS_LIST, type MuscleGroup } from './constants';

export function normalizeMuscleGroup(input: string): MuscleGroup | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  const m = MUSCLE_GROUPS_LIST.find(g => g.toLowerCase() === input.toLowerCase().trim());
  return m || null;
}

export function assertMuscleGroup(input: string): MuscleGroup {
    const normalized = normalizeMuscleGroup(input);
    if (!normalized) {
        console.warn(`Invalid muscle group provided: "${input}". Defaulting to "Other".`);
        return 'Other';
    }
    return normalized;
}
