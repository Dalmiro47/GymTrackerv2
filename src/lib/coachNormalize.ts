
type RoutineSummary = { days?: Array<{ id: string; name: string }> };

const arr = (x:any) => Array.isArray(x) ? x : [];
const str = (x:any) => typeof x === 'string' ? x : '';
const num = (x:any) => Number.isFinite(x) ? Number(x) : undefined;

const CLEAN_PATTERNS = [
  /\(\s*no\s*factid\s*available\s*\)/gi,
  /\(\s*no\s*fact\s*id\s*available\s*\)/gi,
  /\(\s*no\s*facts?\s*available\s*\)/gi,
  /\(\s*no\s*evidence\s*\)/gi,
  /\[\s*no\s*facts?\s*\]/gi,
];

function cleanText(s?: string) {
  let t = String(s ?? '');
  for (const re of CLEAN_PATTERNS) t = t.replace(re, '');
  // collapse spaces & tidy punctuation
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return t;
}

const FACT_CODE = /\b[vi]:[A-Z]{2}(?::[A-Z]{2})?\b/gi;             // v:TR  or  i:AB:TR
const FACT_CODE_PARENS = /\(\s*[vi]:[A-Z]{2}(?::[A-Z]{2})?\s*\)/gi; // (v:TR) etc.
const WEEKDAY_PHRASE = /\b(?:on\s+)?(?:Mon(day)?s?|Tue(s(day)?)?s?|Wed(nesday)?s?|Thu(rsday)?s?|Fri(day)?s?|Sat(urday)?s?|Sun(day)?s?)\b/gi;

function stripCodes(s?: string) {
  return String(s ?? '')
    .replace(FACT_CODE_PARENS, '')
    .replace(FACT_CODE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripWeekdays(s?: string) {
  return String(s ?? '').replace(WEEKDAY_PHRASE, '').replace(/\s{2,}/g, ' ').trim();
}

function dayLookup(routineSummary?: RoutineSummary) {
  const m = new Map<string,string>();
  routineSummary?.days?.forEach(d => m.set(String(d.id), String(d.name)));
  return (dayId?: string) => dayId ? { id: dayId, name: m.get(dayId) ?? '' } : { id:'', name:'' };
}

function labelFromFact(f:any) {
  if (!f) return undefined;
  if (f.t === 'v') return `${f.g} last week = ${f.w} sets`;
  if (f.t === 'i') return `${f.hi} vs ${f.lo} diff = ${f.d} sets`;
  if (f.t === 's') return `Stall: ${f.n} (${f.w} wk)`;
  if (f.t === 'a') return `Adherence ${f.w}w (target ${f.targ})`;
  return f.id;
}

function formatWeek(w: any): string | null {
    if (!w || !Array.isArray(w.actions)) return null;
    const actions = w.actions.map((a: any) => {
      const bits: string[] = [a.muscleGroup];
      if (typeof a.setsDelta === 'number')   bits.push(`${a.setsDelta >= 0 ? '+' : ''}${a.setsDelta} sets`);
      if (typeof a.targetSets === 'number')  bits.push(`→ target ${a.targetSets} sets`);
      if (typeof a.loadDeltaPct === 'number') bits.push(`+${a.loadDeltaPct}% load`);
      return `• ${bits.join(', ')}`;
    }).join(' ');
    return `${w.theme}. ${actions}`;
  }
  

export function normalizeAdviceUI(adviceIn: any, routineSummary?: RoutineSummary, facts?: any[]) {
  const getDay = dayLookup(routineSummary);
  const advice = adviceIn ?? {};
  const factIdx = new Map<string, any>((facts ?? []).map(f=>[String(f.id), f]));

  const mapEvidence = (ids: string[]) =>
    ids.map(id => labelFromFact(factIdx.get(id))).filter(Boolean) as string[];

  const prioritySrc = advice.prioritySuggestions ?? advice.priorities;
  const prioritySuggestions = arr(prioritySrc).map((i:any) => {
    const area = str(i?.area);
    const adviceTxt = stripWeekdays(stripCodes(i?.advice));
    const rationaleTxt = stripCodes(cleanText(i?.rationale));

    return {
      area,
      advice: adviceTxt,
      rationale: rationaleTxt,
      factIds: arr(i?.factIds).map(str),
      setsDelta: num(i?.setsDelta),
      targetSets: num(i?.targetSets),
      evidence: mapEvidence(arr(i?.factIds).map(str)),
    };
  });

  const routineTweaks = arr(advice?.routineTweaks).map((i:any) => {
    const dayId = str(i?.dayId);
    const day = i?.day && typeof i.day === 'object'
      ? { id: str(i.day.id), name: str(i.day.name) }
      : getDay(dayId);
    return {
      change: str(i?.change),
      details: stripCodes(cleanText(i?.details)),
      rationale: stripCodes(cleanText(i?.rationale)),
      dayId,
      exerciseId: str(i?.exerciseId),
      day,
      factIds: arr(i?.factIds).map(str),
      evidence: mapEvidence(arr(i?.factIds).map(str)),
      setsDelta: num(i?.setsDelta),
      targetSets: num(i?.targetSets),
    };
  });

  // Handle both new structured and old string-array format for nextFourWeeks
  let nextFourWeeksText: string[] = [];
  if (Array.isArray(advice?.nextFourWeeks)) {
    const firstItem = advice.nextFourWeeks[0];
    if (typeof firstItem === 'object' && firstItem !== null && 'week' in firstItem && 'theme' in firstItem) {
      // New structured format
      nextFourWeeksText = advice.nextFourWeeks.map(formatWeek).filter((w): w is string => w !== null);
    } else {
      // Old string array format
      nextFourWeeksText = advice.nextFourWeeks.map(str);
    }
  }

  return {
    overview: str(advice?.overview),
    prioritySuggestions,
    routineTweaks,
    nextFourWeeks: nextFourWeeksText,
    risks: arr(advice?.risks).map(str),
    metricsUsed: arr(advice?.metricsUsed).map(str),
  };
}
