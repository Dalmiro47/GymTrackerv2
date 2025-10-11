
type RoutineSummary = { days?: Array<{ id: string; name: string }> };

const arr = (x:any) => Array.isArray(x) ? x : [];
const str = (x:any) => typeof x === 'string' ? x : '';
const num = (x:any) => Number.isFinite(x) ? Number(x) : undefined;

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

export function normalizeAdviceUI(adviceIn: any, routineSummary?: RoutineSummary, facts?: any[]) {
  const getDay = dayLookup(routineSummary);
  const advice = adviceIn ?? {};
  const factIdx = new Map<string, any>((facts ?? []).map(f=>[String(f.id), f]));

  const mapEvidence = (ids: string[]) =>
    ids.map(id => labelFromFact(factIdx.get(id))).filter(Boolean) as string[];

  const prioritySrc = advice.prioritySuggestions ?? advice.priorities;
  const prioritySuggestions = arr(prioritySrc).map((i:any) => ({
    area: str(i?.area),
    advice: str(i?.advice),
    rationale: str(i?.rationale),
    factIds: arr(i?.factIds).map(str),
    setsDelta: num(i?.setsDelta),
    targetSets: num(i?.targetSets),
    evidence: mapEvidence(arr(i?.factIds).map(str)),
  }));

  const routineTweaks = arr(advice?.routineTweaks).map((i:any) => {
    const dayId = str(i?.dayId);
    const day = i?.day && typeof i.day === 'object'
      ? { id: str(i.day.id), name: str(i.day.name) }
      : getDay(dayId);
    return {
      change: str(i?.change),
      details: str(i?.details),
      rationale: str(i?.rationale),
      dayId,
      exerciseId: str(i?.exerciseId),
      day,
      factIds: arr(i?.factIds).map(str),
      evidence: mapEvidence(arr(i?.factIds).map(str)),
      setsDelta: num(i?.setsDelta),
      targetSets: num(i?.targetSets),
    };
  });

  return {
    overview: str(advice?.overview),
    prioritySuggestions,
    routineTweaks,
    nextFourWeeks: arr(advice?.nextFourWeeks).map(str),
    risks: arr(advice?.risks).map(str),
    metricsUsed: arr(advice?.metricsUsed).map(str),
  };
}

    