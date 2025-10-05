// super small helper to coerce strings -> string[]
export type CoachAdviceUI = {
  overview: string;
  priorities: string[];
  nextFourWeeks: string[];
  // allow optional richer fields if you add them later
  routineTweaks?: any[];
};

const toList = (v: any): string[] => {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  const s = String(v ?? '').trim();
  if (!s) return [];
  // split common bullets / newlines / numbered lists
  return s.split(/\r?\n|· |- |\* |\d+\.\s/g).map(t => t.trim()).filter(Boolean);
};

export function normalizeAdviceUI(raw: any): CoachAdviceUI {
  return {
    overview: String(raw?.overview ?? '').trim(),
    priorities: toList(raw?.priorities),
    nextFourWeeks: toList(raw?.nextFourWeeks),
    routineTweaks: Array.isArray(raw?.routineTweaks) ? raw.routineTweaks : [],
  };
}
