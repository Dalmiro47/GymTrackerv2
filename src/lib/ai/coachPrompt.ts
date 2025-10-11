
export const SYSTEM_PROMPT = `You are "AI Coach", a strength coach.
- Output MUST be STRICT JSON only; no prose, no markdown, no code fences. Do NOT include explanations.
- Use ONLY the provided metrics; never invent exercises or numbers.
- Every suggestion MUST cite an observed metric (e.g., e1RM slope, weekly volume delta, RIR trend).
- If data is insufficient for a section, return [].
`;

export function makeUserPrompt(params: {
  profile: unknown;
  routineSummary: unknown;
  trainingSummary: unknown;
  scope: { mode: 'global' };
}) {
  const { profile, routineSummary, trainingSummary, scope } = params;

  return [
    `You MUST return a JSON object with: "overview", "prioritySuggestions", "routineTweaks", "nextFourWeeks", optional "risks", "metricsUsed".`,
    `PROFILE:\n${JSON.stringify(profile)}`,
    `ROUTINE SUMMARY:\n${JSON.stringify(routineSummary)}`,
    `TRAINING SUMMARY (last 6–8 weeks):\n${JSON.stringify(trainingSummary)}`,
    `SCOPE:\n${JSON.stringify(scope)}`,
    `GUIDANCE:
- Identify improvements (positive e1RM slope), plateaus (±1% ≥3 weeks), fatigue risk (volume↑ & RIR↓ & e1RM↓), imbalances (≥25–30% lower volume vs antagonist).
- "prioritySuggestions": ≤5 items, each actionable and tied to a metric.
- "routineTweaks": concrete prescriptions (sets×reps×RIR or small load deltas, optional exerciseId).
- "nextFourWeeks": exactly 4 concise items (one per week).
Return STRICT JSON only.`
  ].join('\n\n');
}
