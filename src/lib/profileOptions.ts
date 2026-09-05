// Option maps for the coach profile — shared by the settings form and the
// first-run onboarding wizard.
//
// Stored values stay ENGLISH: they are data keys the coach prompts read.
// Only the labels go through i18n.
import type { TranslationKey } from '@/i18n';
import type { Goal, GenderOption } from '@/lib/types.gym';

export const GOAL_OPTIONS: Array<{ value: Goal; label: TranslationKey; description: TranslationKey }> = [
  { value: 'Hypertrophy', label: 'goal.hypertrophy', description: 'onb.goal.hypertrophyDesc' },
  { value: 'Strength', label: 'goal.strength', description: 'onb.goal.strengthDesc' },
  { value: 'Strength+Hypertrophy', label: 'goal.strengthHypertrophy', description: 'onb.goal.strengthHypertrophyDesc' },
  { value: 'Fat Loss', label: 'goal.fatLoss', description: 'onb.goal.fatLossDesc' },
  { value: 'General Fitness', label: 'goal.general', description: 'onb.goal.generalDesc' },
];

export const GENDER_OPTIONS: Array<{ value: GenderOption; label: TranslationKey }> = [
  { value: 'Man', label: 'gender.man' },
  { value: 'Woman', label: 'gender.woman' },
  { value: 'Nonbinary', label: 'gender.nonbinary' },
  { value: 'Self-describe', label: 'gender.selfDescribe' },
  { value: 'Prefer not to say', label: 'gender.declineToState' },
];
