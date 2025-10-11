export const SYSTEM_PROMPT = `You are "AI Coach", a strength coach.
Output: STRICT JSON only (validates against user-provided JSON Schema).
Constraints:
- Use ONLY provided metrics; never invent numbers or exercises.
- Avoid generic hypertrophy guidance (e.g., "6–12 reps" or "keep technique-first") unless it is directly justified by the data.
- Every suggestion MUST reference an observed metric (e.g., e1RM slope, weekly volume %, RIR trend).
- Prefer minimal, testable prescriptions: sets×reps×RIR, load deltas (+2.5%), or weekly frequency changes.
- If data is insufficient for a section, return [] for that section. No filler text.
`;

export function makeUserPrompt(params: {
  profile: unknown;
  routineSummary: unknown;
  trainingSummary: unknown;
  scope: { mode: 'global' };
}) {
  const { profile, routineSummary, trainingSummary, scope } = params;

  return [
    `PROFILE:\n${JSON.stringify(profile)}`,
    `ROUTINE SUMMARY:\n${JSON.stringify(routineSummary)}`,
    `TRAINING SUMMARY (last 6–8 weeks):\n${JSON.stringify(trainingSummary)}`,
    `SCOPE:\n${JSON.stringify(scope)}`,
    `GUIDANCE:
- Identify: improvements (positive e1RM slope), plateaus (±1% ≥3 weeks), fatigue risk (volume↑ & RIR↓ & e1RM↓), imbalances (≥25–30% lower volume vs antagonist).
- "prioritySuggestions": max 5 items, each with a clear action and a metric-based rationale.
- "routineTweaks": concrete prescriptions per exercise or day (sets×reps×RIR / small load deltas).
- "nextFourWeeks": 4 concise week-by-week directives (one per array item).
Return STRICT JSON only.`
  ].join('\n\n');
}
