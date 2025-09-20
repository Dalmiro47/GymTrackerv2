
import type { LucideIcon } from 'lucide-react';
import { UserCircle, PersonStanding, Footprints, Shield, Zap, MoveVertical, Waves, HeartPulse, HelpCircle } from 'lucide-react';
import { Dumbbell } from 'lucide-react';

export const MUSCLE_GROUPS_LIST = [
  "Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Abs", "Cardio", "Other"
] as const;

export type MuscleGroup = typeof MUSCLE_GROUPS_LIST[number];

export const MUSCLE_GROUP_ICONS: Record<MuscleGroup, LucideIcon> = {
  Chest: Dumbbell,
  Back: Dumbbell,
  Legs: Dumbbell,
  Shoulders: Dumbbell,
  Biceps: Dumbbell,
  Triceps: Dumbbell,
  Abs: Dumbbell,
  Cardio: HeartPulse,
  Other: HelpCircle,
};

export const WARMUP_TEMPLATES = ['HEAVY_BARBELL', 'HEAVY_DB', 'MACHINE_COMPOUND', 'BODYWEIGHT', 'ISOLATION', 'NONE'] as const;
