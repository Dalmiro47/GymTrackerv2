import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  label?: string;
  disabled?: boolean;
  external?: boolean;
};

export const MUSCLE_GROUPS = [
  "Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Abs", "Cardio", "Other"
] as const;

export type MuscleGroup = typeof MUSGLE_GROUPS[number];

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  description?: string;
  image?: string; // URL to image
  instructions?: string;
  dataAiHint?: string; // Hint for AI image generation if applicable
}

export interface RoutineExercise extends Exercise {
  sets?: number;
  reps?: string; // e.g., "8-12" or "AMRAP"
  restTime?: string; // e.g., "60s"
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  exercises: RoutineExercise[];
  // createdBy: string; // User ID
  // createdAt: Date;
}

export interface LoggedSet {
  reps: number;
  weight: number;
  // notes?: string;
}

export interface LoggedExercise {
  exerciseId: string; // Reference to Exercise.id
  exerciseName: string; // Denormalized for easy display
  sets: LoggedSet[];
  // notes?: string;
}

export interface WorkoutLog {
  id: string;
  date: string; // ISO string or timestamp
  routineId?: string; // Optional: if workout was based on a routine
  routineName?: string; // Denormalized
  exercises: LoggedExercise[];
  duration?: number; // in minutes
  notes?: string;
  // userId: string;
}

export interface UserProfile {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}
