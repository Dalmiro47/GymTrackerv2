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
  goal: Goal;
  constraints?: string[];
}
