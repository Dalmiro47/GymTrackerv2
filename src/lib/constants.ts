import type { MuscleGroup, WarmupTemplate } from '@/types';
import type { LucideIcon } from 'lucide-react';
import { UserCircle, PersonStanding, Footprints, Shield, Zap, MoveVertical, Waves, HeartPulse, HelpCircle } from 'lucide-react';

export const MUSCLE_GROUPS_LIST: MuscleGroup[] = [
  "Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Abs", "Cardio", "Other"
];

export const MUSCLE_GROUP_ICONS: Record<MuscleGroup, LucideIcon> = {
  Chest: UserCircle,
  Back: PersonStanding,
  Legs: Footprints,
  Shoulders: Shield,
  Biceps: Zap,
  Triceps: MoveVertical,
  Abs: Waves,
  Cardio: HeartPulse,
  Other: HelpCircle,
};

export const WARMUP_TEMPLATES: WarmupTemplate[] = ['HEAVY_BARBELL', 'HEAVY_DB', 'MACHINE_COMPOUND', 'BODYWEIGHT', 'ISOLATION', 'NONE'];
