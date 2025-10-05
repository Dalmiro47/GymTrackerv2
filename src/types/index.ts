
import type { LucideIcon } from 'lucide-react';
import type { SetStructure } from './setStructure';
import type { MuscleGroup } from '@/lib/constants';

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  label?: string;
  disabled?: boolean;
  external?: boolean;
};

// --- Warm-up Types ---
export type WarmupTemplate = 'HEAVY_BARBELL' | 'HEAVY_DB' | 'MACHINE_COMPOUND' | 'BODYWEIGHT' | 'ISOLATION' | 'NONE';

export type WarmupStepSpec = {
  type: 'PERCENT' | 'LABEL';
  percent?: number; // 0.4 = 40% (required if type='PERCENT')
  reps: string; // "12", "6-8", "5", etc.
  rest: string; // "45s", "60-75s"
  appliesTo?: 'TOTAL' | 'ADDED'; // for BODYWEIGHT; default TOTAL for others
  note?: string; // optional UI note
  label?: string; // required if type='LABEL'
};

export interface WarmupConfig {
  template: WarmupTemplate;
  isWeightedBodyweight?: boolean;
  roundingIncrementKg?: number; // optional, e.g., 2.5; defaults by template/unit
  overrideSteps?: WarmupStepSpec[]; // optional per-exercise override of steps
}
// --- End Warm-up Types ---

export interface Exercise {
  id: string; // Firestore document ID
  name: string;
  muscleGroup: MuscleGroup;
  targetNotes?: string;
  exerciseSetup?: string; 
  progressiveOverload?: string;
  instructions?: string; 
  dataAiHint?: string;
  warmup?: WarmupConfig;
  userEdited?: boolean; // NEW: flag to indicate user has modified this exercise
}

export type ExerciseData = Omit<Exercise, 'id'>;


export interface RoutineExercise extends Exercise {
  setStructure?: SetStructure;
  isMissing?: boolean; // Flag for UI if exercise was deleted from main library
}

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
  progressiveOverload?: string;   // NEW (copied from Exercise at insert time)
  sets: LoggedSet[];
  notes?: string;
  personalRecordDisplay?: string; // e.g., "PR: 1x5 @ 100kg" or "PR: N/A"
  currentPR: { reps: number, weight: number } | null; // Numeric PR for reliable logic
  isProvisional?: boolean; // True if auto-populated and not yet interacted with/saved
  warmupConfig?: WarmupConfig; // Pass along for warmup calculation
  setStructure?: SetStructure; // Default from the routine
  setStructureOverride?: SetStructure | null; // User override for this specific log
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
  isDeload?: boolean; // True if this log was a deload session
  deloadParams?: {
    volumeMultiplier: number;
    intensityMultiplier: number;
  };
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
  seedVersion?: number; // NEW: track exercise seed version
}
