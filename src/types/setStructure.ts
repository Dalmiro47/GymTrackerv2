
export type SetStructure = 'normal' | 'superset' | 'triset' | 'dropSet' | 'restPause';

export const SET_STRUCTURE_OPTIONS: SetStructure[] = ['normal', 'superset', 'triset', 'dropSet', 'restPause'];

export const SET_STRUCTURE_LABEL: Record<SetStructure, string> = {
  normal: 'Normal',
  superset: 'Superset',
  triset: 'Triset',
  dropSet: 'Drop Set',
  restPause: 'Rest-Pause',
};

// Using HSL values from globals.css for consistency where possible, with some adjustments
export const SET_STRUCTURE_COLORS: Record<SetStructure, { bg: string; border: string; text: string }> = {
  normal:    { bg: 'hsl(var(--muted) / 0.5)', border: 'hsl(var(--border))', text: 'hsl(var(--muted-foreground))' },
  superset:  { bg: 'hsla(244, 100%, 95%, 1)', border: 'hsla(244, 100%, 85%, 1)', text: 'hsla(244, 70%, 45%, 1)' }, // Indigo-like
  triset:    { bg: 'hsla(45, 100%, 95%, 1)', border: 'hsla(45, 100%, 80%, 1)', text: 'hsla(35, 80%, 40%, 1)' },    // Amber-like
  dropSet:   { bg: 'hsla(355, 100%, 96%, 1)', border: 'hsla(355, 100%, 88%, 1)', text: 'hsla(347, 89%, 35%, 1)' },   // Rose-like
  restPause: { bg: 'hsla(168, 95%, 96%, 1)', border: 'hsla(168, 86%, 83%, 1)', text: 'hsla(170, 71%, 35%, 1)' },   // Teal-like
};
