export type Goal = 'Hypertrophy' | 'Strength' | 'Fat Loss' | 'General Fitness';

export interface UserProfile {
  gender?: 'Male' | 'Female' | 'Other';
  age?: number;
  heightCm?: number;
  weightKg?: number;
  trainingAge?: 'Beginner' | 'Intermediate' | 'Advanced';
  daysPerWeekTarget?: number;
  goal: Goal;
  constraints?: string[];
}
