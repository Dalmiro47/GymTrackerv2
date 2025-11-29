

export const SYSTEM_PROMPT = `You are "AI Coach".
- Output MUST be STRICT JSON only; no prose/markdown/fences.
- All strings must be concise (< 160 chars). Avoid narrative wording.
- Your response for 'nextFourWeeks' must be an array of 4 simple strings, one for each week.
- Limit prioritySuggestions to the top 2.
- Limit routineTweaks to the top 3.
- For every item, the "rationale" MUST include the exact numeric values from the cited factIds (e.g., "CH=3 sets vs BI=10 (−7) last week"). If you cannot cite a number, omit the item.
- Do not produce duplicate advice for the same muscle group/day; merge them.
- Prioritize the largest imbalances (highest "i.d") and lowest volumes ("v.w"); return the top 3 only.
- Never output placeholders like "(no factId available)", "(no evidence)", or "[no facts]". If you cannot cite valid facts with numbers, omit the item.
- Facts may include { t: "g", goal: "Strength" | "Hypertrophy" | "General" }. Use this to set the training bias:
  • Hypertrophy: target ~10–20 weekly hard sets per muscle group; emphasize volume progression.
  • Strength: target ~6–12 weekly hard sets; emphasize heavy compounds and quality over sheer volume.
  • General: middle ground; ~8–14 weekly sets.
- When your prescription (setsDelta, targetSets) is influenced by the goal, include "g" in factIds.
- Produce a 4-week progressive plan. Each week must be summarized in a single string, directly addressing the fact-based advice.`;

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
- prioritySuggestions ≤ 2
- routineTweaks ≤ 3
- nextFourWeeks: 4 items, each with 1 action
- metricsUsed ≤ 4` : `
Limits:
- overview ≤ 220 chars
- prioritySuggestions ≤ 2
- routineTweaks ≤ 3
- nextFourWeeks: a 4-week progressive plan, 1 action per week.
- metricsUsed ≤ 6`;

  const factsSpec = `
FACT FORMAT (COMPACT):
- Volume: {"id":"v:CH","t":"v","g":"CH","w":3}  // last-week sets for group CH (Chest)
- Imbalance: {"id":"i:BI:CH","t":"i","hi":"BI","lo":"CH","d":7} // BI had 7 sets more than CH
- Stall: {"id":"s:InclineD","t":"s","n":"Incline Dumbbell","w":3,"sl":-0.8}
- Adherence: {"id":"a","t":"a","w":5,"targ":4}
- Goal: {"id":"g","t":"g","goal":"Hypertrophy"}
Use these IDs in factIds.`;

  const extraConstraints = `
- Include "setsDelta" (int, e.g., +2 or -2) and "targetSets" (int) in each priority suggestion.
- Priority suggestions MUST NOT mention weekdays or day names. Keep them muscle-group level only. If you want a specific day change, put it in "routineTweaks" with a valid dayId from routineSummary.days.
- In human text ("advice", "rationale"), USE full muscle names (Chest, Back, Shoulders, Legs, Biceps, Triceps, Abs). DO NOT print fact-id codes like v:TR or i:AB:TR in the text. Keep codes only inside factIds[].
- nextFourWeeks: provide one-line plan theme. Sequence weeks: W1 addresses biggest deficit, W2 consolidates, W3 progresses, W4 deloads/tapers. Use facts and keep numbers realistic.
`;

  return [
    `Use short sentences; omit any explanations that aren’t required by the schema.`,
    `You MUST return a JSON object with: "overview","prioritySuggestions","routineTweaks","nextFourWeeks", optional "risks","metricsUsed".`,
    caps,
    factsSpec,
    `PROFILE:\n${JSON.stringify({ daysPerWeekTarget: (profile as any)?.daysPerWeekTarget, goal: (profile as any)?.goal })}`,
    `ROUTINE SUMMARY (names only):\n${JSON.stringify({ days: (routineSummary as any)?.days?.map((d:any)=>({id:d.id,name:d.name})) ?? [] })}`,
    `TRAINING SUMMARY (compact):\n${JSON.stringify({ weekly: (trainingSummary as any)?.weekly ?? [] })}`,
    `FACTS:\n${JSON.stringify(facts)}`,
    `SCOPE:\n${JSON.stringify(scope)}`,
    `Constraints:${extraConstraints}`
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
    // Simplified structure to save tokens
    nextFourWeeks: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'A list of 4 strings. Each string is a weekly plan (e.g., "Week 1: Add 1 set to chest press and lower biceps volume by 2 sets"). Must be 4 items.'
    },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    metricsUsed: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['overview','prioritySuggestions','routineTweaks','nextFourWeeks']
} as const;
