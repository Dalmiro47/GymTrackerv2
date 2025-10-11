
export const SYSTEM_PROMPT = `You are "AI Coach".
- Output MUST be STRICT JSON only; no prose, no markdown, no code fences. Do NOT include explanations.
- Use ONLY the provided metrics; every suggestion must cite an observed metric.
- If a section lacks data, return [].
`;

export function makeUserPrompt(params: {
  profile: unknown;
  routineSummary: unknown;
  trainingSummary: unknown;
  scope: { mode: 'global' };
  brief?: boolean; // NEW
}) {
  const { profile, routineSummary, trainingSummary, scope, brief } = params;

  const base = [
    `Return a JSON object with: "overview", "prioritySuggestions", "routineTweaks", "nextFourWeeks", optional "risks", "metricsUsed".`,
    `PROFILE:\n${JSON.stringify(profile)}`,
    `ROUTINE SUMMARY:\n${JSON.stringify(routineSummary)}`,
    `TRAINING SUMMARY (last 6–8 weeks):\n${JSON.stringify(trainingSummary)}`,
    `SCOPE:\n${JSON.stringify(scope)}`
  ];

  const constraints = brief
    ? `ULTRA-BRIEF MODE (token limited):
- "overview" ≤ 160 chars.
- "prioritySuggestions": ≤ 3 items, each "area", "advice" (≤ 100 chars), "rationale" (≤ 100 chars).
- "routineTweaks": ≤ 3 items, each "change","details" (≤ 120 chars),"rationale" (≤ 100 chars), optional "dayId","exerciseId".
- "nextFourWeeks": exactly 4 items ≤ 120 chars each.
- "risks": omit unless critical; "metricsUsed": ≤ 4 items.`
    : `Constraints:
- "overview" ≤ 240 chars.
- "prioritySuggestions": ≤ 5 items; each "area","advice" (≤ 140 chars), "rationale" (≤ 160 chars).
- "routineTweaks": ≤ 6 items; each "change","details" (≤ 160 chars),"rationale" (≤ 160 chars), optional "dayId","exerciseId".
- "nextFourWeeks": exactly 4 items ≤ 160 chars each.
- "risks": ≤ 3 items; "metricsUsed": ≤ 8 strings (≤ 60 chars each).`;

  return [...base, `GUIDANCE:\n${constraints}`].join('\n\n');
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
          rationale: { type: 'STRING' }
        },
        required: ['area','advice','rationale']
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
          exerciseId: { type: 'STRING' }
        },
        required: ['change','details','rationale']
      }
    },
    nextFourWeeks: { type: 'ARRAY', items: { type: 'STRING' } },
    risks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { issue: { type: 'STRING' }, mitigation: { type: 'STRING' } },
        required: ['issue','mitigation']
      }
    },
    metricsUsed: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['overview','prioritySuggestions','routineTweaks','nextFourWeeks']
} as const;
