
export const SYSTEM_PROMPT = `You are "AI Coach", a strength coach.
- Output MUST be STRICT JSON only; no prose/markdown/fences.
- Every suggestion MUST cite one or more factIds from the provided "FACTS" list.
- Use ONLY the provided facts/metrics; do not invent numbers or exercises.
- If a section lacks data, return [].`;

export function makeUserPrompt(params: {
  profile: unknown;
  routineSummary: unknown;
  trainingSummary: unknown;
  scope: { mode: 'global' };
  facts: any[];
  brief?: boolean;
}) {
  const { profile, routineSummary, trainingSummary, scope, facts, brief } = params;

  const limits = brief ? `
ULTRA-BRIEF MODE:
- "overview" ≤ 140 chars.
- "prioritySuggestions": ≤ 3 items.
- "routineTweaks": ≤ 3 items.
- "nextFourWeeks": 4 items, each ≤ 110 chars.
- "metricsUsed": ≤ 4 items.` : `
Constraints:
- "overview" ≤ 220 chars.
- "prioritySuggestions": ≤ 5 items.
- "routineTweaks": ≤ 6 items.
- "nextFourWeeks": exactly 4 items.
- "metricsUsed": ≤ 8 items.`;

  const fewShot = `
FACTS EXAMPLE:
[
  {"id":"mg_Chest_vol","type":"mg_volume","mg":"Chest","lastWeekSets":3},
  {"id":"imb_Biceps_Chest","type":"mg_imbalance","mgHi":"Biceps","mgLo":"Chest","diffSets":7}
]
GOOD prioritySuggestions ITEM:
{
  "area":"Chest",
  "advice":"Add 2–3 hard sets for Chest this week on Wednesday.",
  "rationale":"Chest was 3 sets vs Biceps 10 last week (–7).",
  "factIds":["mg_Chest_vol","imb_Biceps_Chest"]
}`;

  return [
    `You MUST return a JSON object with: "overview","prioritySuggestions","routineTweaks","nextFourWeeks", optional "risks","metricsUsed".`,
    limits,
    fewShot,
    `PROFILE:\n${JSON.stringify(profile)}`,
    `ROUTINE SUMMARY:\n${JSON.stringify(routineSummary)}`,
    `TRAINING SUMMARY:\n${JSON.stringify(trainingSummary)}`,
    `FACTS (use these ids in factIds):\n${JSON.stringify(facts)}`,
    `SCOPE:\n${JSON.stringify(scope)}`
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
          factIds: { type: 'ARRAY', items: { type: 'STRING' } }
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
