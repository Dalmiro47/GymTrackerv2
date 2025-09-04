// src/lib/ids.ts
export function toSlug(input: string): string {
  return (input || '')
    .normalize('NFKD')                     // split accents
    .replace(/[\u0300-\u036f]/g, '')      // remove diacritics
    .replace(/[^a-zA-Z0-9]+/g, '-')       // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '')              // trim hyphens
    .replace(/-{2,}/g, '-')               // collapse
    .toLowerCase();
}

// We include muscle group to match your existing convention (see screenshot).
export function buildExerciseDocId(name: string, muscleGroup: string): string {
  const base = toSlug(name);
  const mg = (muscleGroup || '').toLowerCase();
  return mg ? `${base}_${mg}` : base; // fallback if MG is ever missing
}
