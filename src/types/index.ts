
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

export type MuscleGroup = typeof MUSCLE_GROUPS[number];

export interface Exercise {
  id: string; // Firestore document ID
  name: string;
  muscleGroup: MuscleGroup;
  targetNotes?: string;
  exerciseSetup?: string; 
  instructions?: string; 
  dataAiHint?: string;
}

export type ExerciseData = Omit<Exercise, 'id'>;


export interface RoutineExercise extends Exercise {
  // order?: number; // To maintain order in the routine
}

export interface Routine {
  id: string; // Firestore document ID
  name: string;
  description?: string;
  exercises: RoutineExercise[]; 
  order: number; // For drag-and-drop ordering
}

export type RoutineData = Omit<Routine, 'id'>;


export interface LoggedSet {
  id: string; // Unique ID for the set (e.g., UUID or timestamp-based)
  reps: number | null; // Allow null for empty input
  weight: number | null; // Allow null for empty input
  isProvisional?: boolean; // Added for UI indication, not for Firestore storage within Set
}

export interface LoggedExercise {
  id: string; // Unique ID for this instance in the log (e.g., UUID, useful for dnd-kit)
  exerciseId: string; // Reference to the Exercise document ID
  name: string;
  muscleGroup: MuscleGroup; // Copied for convenience if needed
  exerciseSetup?: string; // Copied from the base exercise definition
  sets: LoggedSet[];
  notes?: string;
  personalRecordDisplay?: string; // e.g., "PR: 1x5 @ 100kg" or "PR: N/A"
  isProvisional?: boolean; // True if auto-populated and not yet interacted with/saved
}

// Represents the entire workout log for a specific day
export interface WorkoutLog {
  id: string; // Typically the date string "YYYY-MM-DD"
  date: string; // "YYYY-MM-DD"
  routineId?: string; 
  routineName?: string;
  exercises: LoggedExercise[]; // The actual exercises logged for this day
  exerciseIds: string[]; // NEW: Denormalized array of exercise IDs in this log
  duration?: number; 
  notes?: string; // Overall notes for the workout session
  // userId: string; // Implicitly known by collection path
}

// For storing the single, latest performance entry per exercise.
// The document ID in Firestore (users/{userId}/performanceEntries/{exerciseId}) *is* the exerciseId.

export interface PersonalRecord {
  reps: number;
  weight: number;
  date: number; // Timestamp (milliseconds) of when PR was achieved
  logId: string; // ID of the WorkoutLog (YYYY-MM-DD) from which this PR was achieved
}

export interface ExercisePerformanceEntry {
  lastPerformedDate: number | null; // Timestamp (milliseconds) of when sets were last performed, or null
  lastPerformedSets: LoggedSet[]; // The sets recorded for the last performance for pre-filling
  personalRecord: PersonalRecord | null; // The best single set ever
}


export interface UserProfile {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

