
"use client";

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { WarmupTemplate, WarmupStepSpec } from '@/types';

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

// Rounds to 0.0 / 0.5 / 1.0 using the rule:
// .1 .2 → down to .0
// .3 .4 → up to .5
// .5     → stays .5
// .6 .7 → down to .5
// .8 .9 → up to next .0
export function roundToGymHalf(value: number): number {
  if (!isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const base = Math.floor(abs);
  // normalize to 1 decimal to avoid 0.2999999 type artifacts
  const dec = Math.round((abs - base) * 10) / 10;

  let out = abs;
  if (dec === 0.5) {
    out = base + 0.5;
  } else if (dec > 0.0 && dec <= 0.2) {
    out = base;
  } else if (dec > 0.2 && dec < 0.5) {
    out = base + 0.5;
  } else if (dec > 0.5 && dec <= 0.7) {
    out = base + 0.5;
  } else if (dec > 0.7) {
    out = base + 1;
  }
  return sign * out;
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
    // Note: We always return false for isWeightedBodyweight now, as it's determined dynamically by the logged weight.
    return { template: 'BODYWEIGHT', isLowerBodyBarbell: false, isWeightedBodyweight: false };
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
  isWeightedBodyweight?: boolean; // @deprecated - Logic is now inferred from workingWeight
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
  const { template, workingWeight, isLowerBodyBarbell, overrideSteps } = input;

  if (template === 'NONE') return [];

  const stepsSpec = overrideSteps && overrideSteps.length > 0 ? overrideSteps : BUILT_IN_TEMPLATES[template];
  if (!stepsSpec) return [];

  const results: WarmupStep[] = [];
  const roundingIncrement = (template === 'HEAVY_DB' || template === 'ISOLATION') ? 2.5 : 5;


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
      // Logic for BODYWEIGHT label
      if (template === 'BODYWEIGHT') {
         if (workingWeight === 0) {
            // Rule 1: No weight logged -> Simple variation (Light/assisted)
            results.push({ label: 'Light/assisted', weightTotal: 0, reps: '10-12', rest: '45s', note: spec.note });
         } else {
             // Rule 2: Weight is logged -> Standard "Bodyweight" set before adding load
             results.push({ label: spec.label || 'Bodyweight', weightTotal: 0, reps: spec.reps, rest: spec.rest, note: spec.note });
         }
         return;
      }
      
      // Default for other templates
      results.push({ label: spec.label || 'Bodyweight', weightTotal: 0, reps: spec.reps, rest: spec.rest, note: spec.note });
      return;
    }

    if (spec.type === 'PERCENT' && spec.percent) {
      let baseWeight = workingWeight;
      let label = `${Math.round(spec.percent * 100)}%`;
      let note = spec.note;
      
      if (template === 'BODYWEIGHT' && spec.appliesTo === 'ADDED') {
        // Rule 2 continued: If weight logged, apply percentage to added weight
        if (workingWeight <= 0) return; // Skip added weight sets if no weight is logged
        baseWeight = workingWeight; // The logged weight IS the added weight
        note = `(of ${workingWeight}kg added)`;
      }
      
      const rawWeight = baseWeight * spec.percent;
      let finalWeightTotal = roundToGymHalf(rawWeight);

      // Clamp to a minimum value if rounding results in zero
      if (finalWeightTotal <= 0) {
        finalWeightTotal = roundingIncrement;
      }


      results.push({ label, weightTotal: finalWeightTotal, reps: spec.reps, rest: spec.rest, note });
    }
  });

  // CRITICAL FIX: If we are doing unweighted bodyweight, allow the 0kg "Light/assisted" step.
  // Standard logic filters out steps where stepWeight >= workingWeight (0 >= 0).
  if (template === 'BODYWEIGHT' && workingWeight === 0) {
    return results;
  }

  return results.filter(r => r.weightTotal < workingWeight);
}
