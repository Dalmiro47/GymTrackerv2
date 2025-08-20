
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { WarmupTemplate, WarmupStepSpec, Exercise } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const slugify = (text: string, context: string = ''): string => {
  const S = '-'; // separator
  const NC_RE = /[^\w\s-]/g; // non-alphanumeric, non-whitespace, non-hyphen
  const WS_RE = /\s+/g;      // whitespace
  const MULTI_S_RE = new RegExp(`${S}${S}+`, 'g'); // multiple separators

  let slug = text.toString().toLowerCase().trim();
  slug = slug.replace(NC_RE, '');      // Remove special characters
  slug = slug.replace(WS_RE, S);       // Replace whitespace with separator
  slug = slug.replace(MULTI_S_RE, S);  // Replace multiple separators with single

  if (context) {
    const contextSlug = context.toString().toLowerCase().trim()
      .replace(NC_RE, '')
      .replace(WS_RE, S)
      .replace(MULTI_S_RE, S);
    return `${slug}_${contextSlug}`; // Use underscore to differentiate parts if needed
  }
  return slug;
};

// --- Rounding Logic ---
export function roundToNearestIncrement(value: number, increment: number): number {
    if (increment <= 0) return value;
    const inverse = 1 / increment;
    return Math.round(value * inverse) / inverse;
}

// --- WARMUP LOGIC ---

// --- TEMPLATES ---
const BUILT_IN_TEMPLATES: Record<WarmupTemplate, WarmupStepSpec[]> = {
  HEAVY_BARBELL: [
    { type: 'PERCENT', percent: 0.40, reps: '12', rest: '30-45s' },
    { type: 'PERCENT', percent: 0.65, reps: '8', rest: '60s' },
    { type: 'PERCENT', percent: 0.80, reps: '4-6', rest: '90s' },
  ],
  HEAVY_DB: [
    { type: 'PERCENT', percent: 0.50, reps: '12', rest: '45s' },
    { type: 'PERCENT', percent: 0.70, reps: '6-8', rest: '60-75s' },
  ],
  MACHINE_COMPOUND: [
    { type: 'PERCENT', percent: 0.50, reps: '12', rest: '45s' },
    { type: 'PERCENT', percent: 0.70, reps: '6-8', rest: '60-75s' },
  ],
  BODYWEIGHT: [
    { type: 'LABEL', label: 'Bodyweight', reps: '8-10', rest: '60s' },
    { type: 'PERCENT', percent: 0.50, reps: '5', rest: '90s', appliesTo: 'ADDED' },
  ],
  ISOLATION: [
    { type: 'PERCENT', percent: 0.50, reps: '10-12', rest: '30s' },
  ],
  NONE: [],
};

// --- HEURISTICS ---
export const inferWarmupTemplate = (exerciseName: string): { template: WarmupTemplate; isLowerBodyBarbell: boolean; isWeightedBodyweight: boolean } => {
  const name = exerciseName.toLowerCase();
  
  // Dumbbells first
  if (name.includes('dumbbell') || name.includes('db')) {
    return { template: 'HEAVY_DB', isLowerBodyBarbell: false, isWeightedBodyweight: false };
  }
  // Then bodyweight
  if (name.includes('pull-up') || name.includes('chin-up') || name.includes('dip') || name.includes('push-up') || name.includes('leg raise')) {
    return { template: 'BODYWEIGHT', isLowerBodyBarbell: false, isWeightedBodyweight: true };
  }
  // Then barbell
  if (name.includes('barbell') || name.includes('squat') || name.includes('deadlift') || name.includes('rdl') || name.includes('ohp') || name.includes('bench')) {
    const isLowerBody = name.includes('squat') || name.includes('deadlift') || name.includes('rdl');
    return { template: 'HEAVY_BARBELL', isLowerBodyBarbell: isLowerBody, isWeightedBodyweight: false };
  }
  // Then machines
  if (name.includes('machine') || name.includes('smith') || name.includes('leg press') || name.includes('chest press') || name.includes('seated row') || name.includes('shoulder press') || name.includes('hack squat')) {
    return { template: 'MACHINE_COMPOUND', isLowerBodyBarbell: false, isWeightedBodyweight: false };
  }
  // Default to isolation
  return { template: 'ISOLATION', isLowerBodyBarbell: false, isWeightedBodyweight: false };
};


// --- MAIN CALCULATION FUNCTION ---
export interface WarmupInput {
  template: WarmupTemplate;
  workingWeight: number;
  isLowerBodyBarbell?: boolean;
  isWeightedBodyweight?: boolean;
  overrideSteps?: WarmupStepSpec[];
}

export interface WarmupStep {
  label: string;
  reps: string;
  rest: string;
  weightTotal: number;
  note?: string;
}

export function computeWarmup(input: WarmupInput): WarmupStep[] {
  const { template, workingWeight, isLowerBodyBarbell, isWeightedBodyweight, overrideSteps } = input;

  if (template === 'NONE') return [];

  const stepsSpec = overrideSteps && overrideSteps.length > 0 ? overrideSteps : BUILT_IN_TEMPLATES[template];
  if (!stepsSpec) return [];

  const results: WarmupStep[] = [];
  const roundingIncrement = (template === 'HEAVY_DB' || template === 'ISOLATION') ? 2.5 : 5;

  const round = (weight: number): number => {
    if (weight <= 0) return 0;
    const base = Math.floor(weight);
    const decimal = weight - base;

    // Custom rounding rule
    if (decimal >= 0.8) { // .8, .9 -> round up to next whole number
      return base + 1;
    }
    if (decimal > 0.5) { // .6, .7 -> round down to .5
      return base + 0.5;
    }
    if (decimal > 0.2) { // .3, .4 -> round up to .5
      return base + 0.5;
    }
    if (decimal > 0) { // .1, .2 -> round down to whole number
      return base;
    }
    return weight; // .0 and .5 remain unchanged
  };


  // Special "Empty Bar" step for lower body barbell exercises
  if (template === 'HEAVY_BARBELL' && isLowerBodyBarbell) {
    results.push({
      label: 'Empty Bar',
      weightTotal: 20,
      reps: '10-15',
      rest: '45s'
    });
  }

  stepsSpec.forEach(spec => {
    if (spec.type === 'LABEL') {
      // Bodyweight case
      if (template === 'BODYWEIGHT' && !isWeightedBodyweight) {
        results.push({ label: 'Light/assisted', weightTotal: 0, reps: '10-12', rest: '45s', note: spec.note });
      } else {
        results.push({ label: spec.label || 'Bodyweight', weightTotal: 0, reps: spec.reps, rest: spec.rest, note: spec.note });
      }
      return;
    }

    if (spec.type === 'PERCENT' && spec.percent) {
      let baseWeight = workingWeight;
      let label = `${Math.round(spec.percent * 100)}%`;
      let note = spec.note;
      
      if (template === 'BODYWEIGHT' && spec.appliesTo === 'ADDED') {
        if (workingWeight <= 0) return; // Skip if no added weight
        baseWeight = workingWeight; // Assume workingWeight IS the added weight
        note = `(of ${workingWeight}kg added)`;
      }
      
      const rawWeight = baseWeight * spec.percent;
      let finalWeightTotal = round(rawWeight);

      // Clamp to a minimum value if rounding results in zero
      if (finalWeightTotal <= 0) {
        finalWeightTotal = roundingIncrement;
      }


      results.push({ label, weightTotal: finalWeightTotal, reps: spec.reps, rest: spec.rest, note });
    }
  });

  return results.filter(r => r.weightTotal < workingWeight);
}
