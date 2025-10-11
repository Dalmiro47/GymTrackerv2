
type RoutineSummary = {
  days?: Array<{ id: string; name: string }>;
};

const arr = (x: any) => (Array.isArray(x) ? x : []);
const str = (x: any) => (typeof x === 'string' ? x : '');

function dayLookup(routineSummary?: RoutineSummary) {
  const map = new Map<string, string>();
  if (routineSummary?.days) {
    for (const d of routineSummary.days) map.set(String(d.id), String(d.name));
  }
  return (dayId?: string) =>
    dayId ? { id: dayId, name: map.get(dayId) ?? '' } : { id: '', name: '' };
}

/**
 * Normalize AI advice for UI rendering.
 * - Adds missing fields
 * - Aliases "priorities" -> "prioritySuggestions"
 * - Resolves dayId -> day {id, name}
 */
export function normalizeAdviceUI(adviceIn: any, routineSummary?: RoutineSummary) {
  const getDay = dayLookup(routineSummary);
  const advice = adviceIn ?? {};

  // alias: priorities -> prioritySuggestions
  const prioritySrc = advice.prioritySuggestions ?? advice.priorities;

  const prioritySuggestions = arr(prioritySrc).map((i: any) => ({
    area: str(i?.area),
    advice: str(i?.advice),
    rationale: str(i?.rationale),
    factIds: arr(i?.factIds).map(str),
    setsDelta: Number.isFinite(i?.setsDelta) ? i.setsDelta : undefined,
    targetSets: Number.isFinite(i?.targetSets) ? i.targetSets : undefined,
  }));

  const routineTweaks = arr(advice?.routineTweaks).map((i: any) => {
    const dayId = str(i?.dayId);
    const day = i?.day && (typeof i.day === 'object')
      ? { id: str(i.day.id), name: str(i.day.name) }
      : getDay(dayId);
    return {
      change: str(i?.change),
      details: str(i?.details),
      rationale: str(i?.rationale),
      dayId,
      exerciseId: str(i?.exerciseId),
      day, // <-- guaranteed object
    };
  });

  const nextFourWeeks = arr(advice?.nextFourWeeks).slice(0, 4).map(str);

  const risks = arr(advice?.risks).map((r: any) => ({
    issue: str(r?.issue),
    mitigation: str(r?.mitigation),
  }));

  const metricsUsed = arr(advice?.metricsUsed).map(str);

  return {
    overview: str(advice?.overview),
    prioritySuggestions,
    routineTweaks,
    nextFourWeeks,
    risks,
    metricsUsed,
  };
}
