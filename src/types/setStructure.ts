
export type SetStructure = 'normal' | 'superset' | 'triset' | 'dropSet' | 'restPause';

export const SET_STRUCTURE_OPTIONS: SetStructure[] = ['normal', 'superset', 'triset', 'dropSet', 'restPause'];

export const SET_STRUCTURE_LABEL: Record<SetStructure, string> = {
  normal: 'Normal',
  superset: 'Superset',
  triset: 'Triset',
  dropSet: 'Drop Set',
  restPause: 'Rest-Pause',
};

// Categorical palette sourced from the --ss-* design tokens in globals.css
export const SET_STRUCTURE_COLORS: Record<SetStructure, { bg: string; border: string; text: string }> = {
  normal:    { bg: 'hsl(var(--muted) / 0.5)', border: 'hsl(var(--border))', text: 'hsl(var(--muted-foreground))' },
  superset:  { bg: 'hsl(var(--ss-superset-bg))', border: 'hsl(var(--ss-superset-border))', text: 'hsl(var(--ss-superset-text))' },
  triset:    { bg: 'hsl(var(--ss-triset-bg))', border: 'hsl(var(--ss-triset-border))', text: 'hsl(var(--ss-triset-text))' },
  dropSet:   { bg: 'hsl(var(--ss-dropset-bg))', border: 'hsl(var(--ss-dropset-border))', text: 'hsl(var(--ss-dropset-text))' },
  restPause: { bg: 'hsl(var(--ss-restpause-bg))', border: 'hsl(var(--ss-restpause-border))', text: 'hsl(var(--ss-restpause-text))' },
};
