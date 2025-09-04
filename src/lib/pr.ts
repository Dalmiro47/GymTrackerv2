
import type { LoggedSet } from '@/types';

// keep only valid working sets
export function validWorkingSets(sets: LoggedSet[]): { reps: number; weight: number }[] {
  return (sets ?? [])
    .filter(s => !(s as any)?.isWarmup) // exclude warmups
    .map(s => ({
      reps: Number(s?.reps ?? NaN),
      weight: Number(s?.weight ?? NaN),
    }))
    .filter(s => Number.isFinite(s.reps) && Number.isFinite(s.weight) && s.reps > 0 && s.weight > 0);
}

// pick the best set of a session: higher weight wins; if same weight, higher reps wins
export function pickBestSet(sets: LoggedSet[]): { reps: number; weight: number } | null {
  const arr = validWorkingSets(sets);
  if (!arr.length) return null;
  return arr.reduce((best, cur) => {
    if (cur.weight > best.weight) return cur;
    if (cur.weight === best.weight && cur.reps > best.reps) return cur;
    return best;
  });
}

// compare two sets for PR purposes
export function isBetterPR(candidate: { reps: number; weight: number } | null,
                    current: { reps: number; weight: number } | null): boolean {
  if (!current) return !!candidate;
  if (!candidate) return false;
  if (candidate.weight > current.weight) return true;
  if (candidate.weight === current.weight && candidate.reps > current.reps) return true;
  return false;
}

// format for the badge
export function formatPR(set: { reps: number; weight: number } | null): string {
  return set ? `PR: ${set.reps}x${Number(set.weight).toString()}kg` : 'PR: N/A';
}
