// ─── Chat System Prompt Builders ─────────────────────────────────────
// Build mode-specific system prompts with serialized context.
// Incorporates proven patterns from the legacy structured coach:
//   - Goal-based volume targets (Hypertrophy/Strength/General)
//   - Fact-based reasoning with specific numbers
//   - Progressive overload logic gates
//   - 4-week progressive planning structure

import type { LogDayContext, RoutineReviewContext } from './context-builders';
import type { CoachFactCompact } from '@/lib/analysis';

// ─── Log-Day Mode ───────────────────────────────────────────────────

export function buildLogDaySystemPrompt(context: LogDayContext): string {
  const exerciseLines = context.exercises
    .map((ex) => {
      const setsStr = ex.sets.map((s, i) => `  Set ${i + 1}: ${s.weight ?? 0}kg x ${s.reps ?? 0}`).join('\n');
      const prStr = ex.personalRecord
        ? `PR: ${ex.personalRecord.weight}kg x ${ex.personalRecord.reps}`
        : 'PR: N/A';
      const structStr = ex.setStructure && ex.setStructure !== 'normal' ? ` [${ex.setStructure}]` : '';
      const overloadStr = ex.progressiveOverload ? `\n  Target: ${ex.progressiveOverload}` : '';

      return `- ${ex.name} (${ex.muscleGroup})${structStr} | ${prStr}${overloadStr}\n${setsStr}`;
    })
    .join('\n\n');

  const deloadNote = context.isDeload ? '\n⚠️ This is a DELOAD session. Reduced volume/intensity is expected.\n' : '';
  const routineNote = context.routineName ? `Routine: "${context.routineName}"` : '';
  const notesNote = context.notes ? `\nSession notes: ${context.notes}` : '';

  const goalStr = context.profile?.goal || 'General';
  const constraintsStr = context.profile?.constraints?.length
    ? `\nConstraints: ${context.profile.constraints.join(', ')}`
    : '';
  const profileSection = context.profile
    ? `\nUSER PROFILE:\n- Goal: ${goalStr}${context.profile.daysPerWeekTarget ? `\n- ${context.profile.daysPerWeekTarget} days/week target` : ''}${constraintsStr}`
    : '';

  const knownExercises = context.exercises.map((ex) => ex.name).join(', ');

  return `You are "Coach de Entrenamiento", an AI workout coach embedded in a gym tracking app.
You are looking at the user's workout for ${context.date}.
${routineNote}${deloadNote}${profileSection}

CURRENT WORKOUT:
${exerciseLines}
${notesNote}

PROGRESSIVE OVERLOAD LOGIC (use when advising on weight/reps):
- If the exercise has a Target Rep Range (e.g. "6-10 reps"):
  • Parse the UPPER BOUND (e.g. 10).
  • If current reps < upper bound → recommend adding reps first. Do NOT suggest increasing weight.
  • If current reps >= upper bound → recommend increasing weight by ~2.5-5kg.
  • Bodyweight exception: if weight = 0kg and reps >= upper bound → suggest resistance (vest/band) or slower tempo.
- If RPE is 9-10 (near failure), prioritize recovery over load increase.
- Always reference the user's PR and current sets when giving specific recommendations.

RULES:
- Respond in the same language the user writes in.
- Be concise and actionable. Use a friendly, motivating tone. Emojis are welcome.
- Reference specific exercises and numbers from the workout data.
- Use full muscle group names (Chest, Back, Shoulders, Legs, Biceps, Triceps, Abs) in text.
- If they ask about form or technique, give brief, practical cues.
- Do not invent exercises or data not shown above.

KNOWN EXERCISES: ${knownExercises}

FORMAT:
- Use **bold** for key numbers and emphasis.
- Use *exercise name* (single asterisks) for exercise names from KNOWN EXERCISES.
- Use ### for section headings. Never use --- as a divider.
- Use numbered lists (1. 2. 3.) for steps, - for bullet lists.
- When reviewing a full workout, highlight only the TOP 2-3 most impactful points — do NOT go through every exercise one by one unless specifically asked.
- Always complete your final sentence. Target 80–120 words per reply. Only exceed that if the user explicitly asks for a full breakdown — this is a mobile chat.`;
}

// ─── Routine-Review Mode ────────────────────────────────────────────

export function buildRoutineReviewSystemPrompt(context: RoutineReviewContext): string {
  // Routines
  const routineLines = context.routines
    .map((r) => {
      const exLines = r.exercises
        .map((ex) => {
          const structStr = ex.setStructure !== 'normal' ? ` [${ex.setStructure}]` : '';
          return `  - ${ex.name} (${ex.muscleGroup})${structStr}`;
        })
        .join('\n');
      return `## ${r.name}\n${exLines}`;
    })
    .join('\n\n');

  // Weekly summaries
  const summaryLines = context.weeklySummaries
    .map((w) => {
      const volStr = Object.entries(w.volumeByMuscle)
        .map(([mg, sets]) => `${mg}: ${sets}`)
        .join(', ');
      const topStr = w.topLifts?.length
        ? `\n  Top lifts: ${w.topLifts.map((l) => `${l.name}: ${l.best}`).join(', ')}`
        : '';
      return `- ${w.weekOf} (${w.totalSessions} sessions): ${volStr}${topStr}`;
    })
    .join('\n');

  // Facts (human-readable)
  const factLines = context.facts
    .map((f) => formatFact(f))
    .filter(Boolean)
    .join('\n');

  // Profile
  const goalStr = context.profile.goal || 'General';
  const daysStr = context.profile.daysPerWeekTarget
    ? `${context.profile.daysPerWeekTarget} days/week target`
    : '';

  const knownExercises = context.routines
    .flatMap((r) => r.exercises.map((ex) => ex.name))
    .join(', ');

  return `You are "Coach de Programacion", an AI training program analyst embedded in a gym tracking app.

ROUTINES:
${routineLines}

TRAINING HISTORY (recent weeks):
${summaryLines}

KEY INSIGHTS:
${factLines}

PROFILE:
- Goal: ${goalStr}
${daysStr ? `- ${daysStr}` : ''}

GOAL-BASED VOLUME TARGETS:
- Hypertrophy: target ~10-20 weekly hard sets per muscle group; emphasize volume progression.
- Strength: target ~6-12 weekly hard sets; emphasize heavy compounds and quality over sheer volume.
- General Fitness: middle ground; ~8-14 weekly sets; balanced approach.
The user's goal is "${goalStr}" — tailor all recommendations to this bias.

ANALYSIS FRAMEWORK (use when discussing routine changes):
- Prioritize the largest imbalances (muscles with the biggest volume difference).
- Prioritize the lowest-volume muscle groups first.
- When suggesting set changes, be specific: "+2 sets/week for Chest" not "add more chest work".
- If a lift appears stalled (flat progression over multiple weeks), suggest: micro-loading (+1.25-2.5kg), rep-range change, or technique variation.
- For adherence issues, focus on realistic scheduling over perfect programming.
- When suggesting a 4-week plan: W1 addresses biggest deficit, W2 consolidates, W3 progresses, W4 deloads/tapers.

RULES:
- Respond in the same language the user writes in.
- Be concise and actionable. Use a friendly, motivating tone. Emojis are welcome.
- Always cite specific volume numbers, muscle groups, and exercise names from the data provided.
- Use full muscle group names (Chest, Back, Shoulders, Legs, Biceps, Triceps, Abs) in text.
- When suggesting routine changes, specify which routine and which exercises to modify.
- Do not invent data not shown above.

KNOWN EXERCISES: ${knownExercises}

FORMAT:
- Use **bold** for key numbers and emphasis.
- Use *exercise name* (single asterisks) for exercise names from KNOWN EXERCISES.
- Use ### for section headings. Never use --- as a divider.
- Use numbered lists (1. 2. 3.) for steps, - for bullet lists.
- Focus on the 2-3 most actionable insights. Don't enumerate every exercise or week individually unless asked.
- Always complete your final sentence. Target 80–120 words per reply. Only exceed that if the user explicitly asks for a full breakdown — this is a mobile chat.`;
}

// ─── Helpers ────────────────────────────────────────────────────────

const MG_LABELS: Record<string, string> = {
  CH: 'Chest', BK: 'Back', SH: 'Shoulders', LE: 'Legs',
  BI: 'Biceps', TR: 'Triceps', AB: 'Abs',
};

function formatFact(f: CoachFactCompact): string {
  switch (f.t) {
    case 'v':
      return `- Volume: ${MG_LABELS[f.g] ?? f.g} = ${f.w} hard sets last week`;
    case 'i':
      return `- Imbalance: ${MG_LABELS[f.hi] ?? f.hi} has ${f.d} more sets than ${MG_LABELS[f.lo] ?? f.lo}`;
    case 's':
      return `- Stall: ${f.n} appears stalled (${f.w} weeks, slope ${f.sl})`;
    case 'a':
      return `- Adherence: ${f.w} weeks logged, target ${f.targ} days/week`;
    case 'g':
      return `- Goal: ${f.goal}`;
    default:
      return '';
  }
}
