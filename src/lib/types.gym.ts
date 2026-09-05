import type { Language } from '@/i18n';

export type Goal =
  | 'Hypertrophy'
  | 'Strength'
  | 'Strength+Hypertrophy' // NEW
  | 'Fat Loss'
  | 'General Fitness';

export type GenderOption =
  | 'Man'
  | 'Woman'
  | 'Nonbinary'
  | 'Self-describe'
  | 'Prefer not to say';

export interface UserProfile {
  gender?: GenderOption;
  genderSelfDescribe?: string; // used when gender === 'Self-describe'
  age?: number;
  heightCm?: number;
  weightKg?: number;
  trainingAge?: 'Beginner' | 'Intermediate' | 'Advanced';
  daysPerWeekTarget?: number;
  /** NEW: target session duration in minutes (e.g. 60) */
  sessionTimeTargetMin?: number;
  goal: Goal;
  constraints?: string[];
  /** UI + AI Coach language. Absent = English. */
  language?: Language;
  /** Set once the first-run onboarding wizard is finished or skipped.
   *  Its presence is what stops the wizard from ever showing again. */
  onboardedAt?: unknown;
}
