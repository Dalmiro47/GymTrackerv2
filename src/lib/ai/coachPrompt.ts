
export const SYSTEM_PROMPT = `You are "AI Coach".
- Output MUST be STRICT JSON only; no prose/markdown/fences.
- Every suggestion MUST cite one or more factIds from the provided "FACTS" list.
- For every item, the "rationale" MUST include the exact numeric values from the cited factIds (e.g., "CH=3 sets vs BI=10 (−7) last week"). If you cannot cite a number, omit the item.
- Do not produce duplicate advice for the same muscle group/day; merge them.
- Prioritize the largest imbalances (highest "i.d") and lowest volumes ("v.w"); return the top 3 only.
- Include "setsDelta" (int, e.g., +2 or -2) and "targetSets" (int) in each item.
`;

export function makeUserPrompt(params: {
  profile: unknown;
  routineSummary: unknown;
  trainingSummary: unknown;
  scope: { mode: 'global' };
  facts: any[];
  brief?: boolean;
}) {
  const { profile, routineSummary, trainingSummary, scope, facts, brief } = params;

  const caps = brief ? `
ULTRA-BRIEF:
- overview ≤ 140 chars
- prioritySuggestions ≤ 3
- routineTweaks ≤ 3
- nextFourWeeks: 4 items ≤ 110 chars
- metricsUsed ≤ 4` : `
Limits:
- overview ≤ 220 chars
- prioritySuggestions ≤ 4
- routineTweaks ≤ 4
- nextFourWeeks: 4 items ≤ 150
- metricsUsed ≤ 6`;

  const factsSpec = `
FACT FORMAT (COMPACT):
- Volume: {"id":"v:CH","t":"v","g":"CH","w":3}  // last-week sets for group CH (Chest)
- Imbalance: {"id":"i:BI:CH","t":"i","hi":"BI","lo":"CH","d":7} // BI had 7 sets more than CH
- Stall: {"id":"s:InclineD","t":"s","n":"Incline Dumbbell","w":3,"sl":-0.8}
- Adherence: {"id":"a","t":"a","w":5,"targ":4}
Use these IDs in factIds.`;

  return [
    `Return a JSON object with: "overview","prioritySuggestions","routineTweaks","nextFourWeeks", optional "risks","metricsUsed".`,
    caps,
    factsSpec,
    `PROFILE:\n${JSON.stringify({ daysPerWeekTarget: (profile as any)?.daysPerWeekTarget, goal: (profile as any)?.goal })}`,
    `ROUTINE SUMMARY (names only):\n${JSON.stringify({ days: (routineSummary as any)?.days?.map((d:any)=>({id:d.id,name:d.name})) ?? [] })}`,
    `TRAINING SUMMARY (compact):\n${JSON.stringify({ weekly: (trainingSummary as any)?.weekly ?? [] })}`,
    `FACTS:\n${JSON.stringify(facts)}`,
    `SCOPE:\n${JSON.stringify(scope)}`,
    `Constraints: Include "setsDelta" (int, e.g., +2 or -2) and "targetSets" (int) in each priority suggestion.`
  ].join('\n\n');
}

// Gemini structured output schema (NOT JSON Schema draft; this is Gemini's schema type)
export const COACH_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING' },
    prioritySuggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area: { type: 'STRING' },
          advice: { type: 'STRING' },
          rationale: { type: 'STRING' },
          factIds: { type: 'ARRAY', items: { type: 'STRING' } },
          setsDelta: { type: 'NUMBER' },
          targetSets: { type: 'NUMBER' }
        },
        required: ['area','advice','rationale','factIds']
      }
    },
    routineTweaks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          change: { type: 'STRING' },
          details: { type: 'STRING' },
          rationale: { type: 'STRING' },
          dayId: { type: 'STRING' },
          exerciseId: { type: 'STRING' },
          factIds: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['change','details','rationale','factIds']
      }
    },
    nextFourWeeks: { type: 'ARRAY', items: { type: 'STRING' } },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    metricsUsed: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['overview','prioritySuggestions','routineTweaks','nextFourWeeks']
} as const;
