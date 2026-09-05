// ─── Chat System Prompt Builders ─────────────────────────────────────
// Build mode-specific system prompts with serialized context.
// Incorporates proven patterns from the legacy structured coach:
//   - Goal-based volume targets (Hypertrophy/Strength/General)
//   - Fact-based reasoning with specific numbers
//   - Progressive overload logic gates
//   - 4-week progressive planning structure

import type { LogDayContext, RoutineReviewContext, DashboardContext } from './context-builders';
import type { CoachFactCompact } from '@/lib/analysis';
import type { Language } from '@/i18n';

// ─── Language ───────────────────────────────────────────────────────
// The reply language follows the user's profile setting, not the language they
// happen to type in, so the coach never drifts out of step with the UI.

const COACH_NAMES: Record<Language, { logDay: string; dashboard: string; routine: string }> = {
  en: { logDay: 'Training Coach', dashboard: 'Weekly Coach', routine: 'Program Coach' },
  es: { logDay: 'Coach de Entrenamiento', dashboard: 'Coach Semanal', routine: 'Coach de Programación' },
};

function languageRules(language: Language): string {
  if (language === 'es') {
    return `- ALWAYS reply in Spanish (Latin American, neutral, addressing the user as "tú"), even if the user writes in another language.
- Use full muscle group names in Spanish (Pecho, Espalda, Hombros, Piernas, Bíceps, Tríceps, Abdominales) in text; the data above lists them in English.`;
  }
  return `- ALWAYS reply in English, even if the user writes in another language.
- Use full muscle group names (Chest, Back, Shoulders, Legs, Biceps, Triceps, Abs) in text.`;
}

// ─── Log-Day Mode ───────────────────────────────────────────────────

export function buildLogDaySystemPrompt(context: LogDayContext, language: Language = 'en'): string {
  const renderExercise = (ex: LogDayContext['exercises'][number]) => {
    const setsStr = ex.sets.map((s, i) => `  Set ${i + 1}: ${s.weight ?? 0}kg x ${s.reps ?? 0}`).join('\n') || '  (no sets yet)';
    const prStr = ex.personalRecord
      ? `PR: ${ex.personalRecord.weight}kg x ${ex.personalRecord.reps}`
      : 'PR: N/A';
    const structStr = ex.setStructure && ex.setStructure !== 'normal' ? ` [${ex.setStructure}]` : '';
    const overloadStr = ex.progressiveOverload ? `\n  Target: ${ex.progressiveOverload}` : '';
    return `- ${ex.name} (${ex.muscleGroup})${structStr} | ${prStr}${overloadStr}\n${setsStr}`;
  };
  // The user may be mid-workout: split what was actually logged from what is
  // still the untouched pre-fill, so the coach never treats planned work as done.
  const done = context.exercises.filter((ex) => ex.status === 'done');
  const planned = context.exercises.filter((ex) => ex.status === 'planned');
  const exerciseLines =
    `COMPLETED TODAY (${done.length}):\n` +
    (done.length ? done.map(renderExercise).join('\n\n') : '(nothing logged yet)') +
    (planned.length
      ? `\n\nPLANNED, NOT DONE YET (${planned.length}). Sets shown are from the LAST session, pre-filled as the starting point:\n` +
        planned.map(renderExercise).join('\n\n')
      : '');

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

  return `You are "${COACH_NAMES[language].logDay}", an AI workout coach embedded in a gym tracking app.
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
- Only COMPLETED exercises were performed today. For PLANNED ones, the sets are last session's numbers; use them to suggest today's target (reps/weight); never congratulate or analyze them as done.

RULES:
${languageRules(language)}
- Be concise and actionable. Use a friendly, motivating tone. Emojis are welcome.
- Reference specific exercises and numbers from the workout data.
- If they ask about form or technique, give brief, practical cues.
- Do not invent exercises or data not shown above.

KNOWN EXERCISES: ${knownExercises}

FORMAT:
- Use **bold** for key numbers and emphasis.
- Use *exercise name* (single asterisks) for exercise names from KNOWN EXERCISES.
- Use ### for section headings. Never use --- as a divider.
- Use numbered lists (1. 2. 3.) for steps, - for bullet lists.
- When reviewing a full workout, highlight only the TOP 2-3 most impactful points. Do NOT go through every exercise one by one unless specifically asked.
- Always complete your final sentence. Target 80–120 words per reply. Only exceed that if the user explicitly asks for a full breakdown; this is a mobile chat.
- Never use em dashes (—) or en dashes (–) in your reply. Use commas, colons, semicolons or separate sentences instead.`;
}

// ─── Dashboard Mode (weekly progression review) ─────────────────────

export function buildDashboardSystemPrompt(context: DashboardContext, language: Language = 'en'): string {
  const exerciseLines = context.exercises
    .map((ex) => {
      const unit = ex.metricKind === 'e1rm' ? 'kg (est. 1RM)' : ' reps';
      const pr =
        ex.weeksSincePr === null
          ? 'no PR on record'
          : ex.weeksSincePr <= 0
            ? 'PR this week'
            : `${ex.weeksSincePr}w since PR`;
      const tag = ex.isKey ? 'KEY' : 'accessory';
      return `- ${ex.name} (${ex.muscleGroup}) [${tag}] | ${ex.status} | best ${ex.currentBest}${unit} | ${pr}`;
    })
    .join('\n');

  const deloadLine = context.deload
    ? `\nDELOAD STATUS: ${context.deload.countInWindow} deload session(s) in the last ${context.deload.windowWeeks} weeks` +
      (context.deload.weeksSinceLast === null
        ? '; no deload on record in this window.'
        : `; last deload ${context.deload.weeksSinceLast}w ago.`)
    : '';

  const knownExercises = context.exercises.map((ex) => ex.name).join(', ');

  return `You are "${COACH_NAMES[language].dashboard}", an AI training coach embedded in a gym tracking app.
You are reviewing the user's weekly training picture from their progression dashboard.

PROGRESSION (per exercise: status, current best as estimated 1RM or reps, and weeks since last PR):
${exerciseLines}
${deloadLine}

HOW TO READ THIS:
- "progressing" = a PR within the last ~2 weeks. "plateau" = enough data but no recent PR. "regressing" = recent best dropped versus the prior weeks. "insufficient" = not enough sessions yet.
- KEY lifts are the main compounds; accessories are expected to be steadier, so don't over-alarm on them.
- For weighted lifts, "best" is an ESTIMATED 1RM (Epley) from the top set, so it reads higher than what is actually lifted.

PRIORITIES (surface the most actionable first):
1. Regressing KEY lifts.
2. KEY lifts on a long plateau (largest weeks-since-PR first).
3. Then broader strategy: focus for the week, volume, and deload readiness.

RULES:
${languageRules(language)}
- Be concise and actionable. Friendly, motivating tone. Emojis welcome.
- Reference specific exercises and the numbers above; lead with the top 2-3 actionable items.
- Do not invent exercises or data not shown above.

KNOWN EXERCISES: ${knownExercises}

FORMAT:
- Use **bold** for key numbers and emphasis.
- Use *exercise name* (single asterisks) for exercise names from KNOWN EXERCISES.
- Use ### for section headings. Never use --- as a divider.
- Use numbered lists (1. 2. 3.) for steps, - for bullet lists.
- Focus on the 2-3 most actionable insights; don't enumerate every exercise one by one unless asked.
- Always complete your final sentence. Target 80–120 words per reply. Only exceed that if the user explicitly asks for a full breakdown; this is a mobile chat.
- Never use em dashes (—) or en dashes (–) in your reply. Use commas, colons, semicolons or separate sentences instead.`;
}

// ─── Routine-Review Mode ────────────────────────────────────────────

export function buildRoutineReviewSystemPrompt(context: RoutineReviewContext, language: Language = 'en'): string {
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

  // Routine change history — grouped by routine, newest first. Rendered only when
  // changes have actually been recorded, so an empty history adds zero tokens.
  let changeHistoryBlock = '';
  if (context.changeLog && context.changeLog.entries.length > 0) {
    const byRoutine = new Map<string, string[]>();
    for (const entry of context.changeLog.entries) {
      const lines = byRoutine.get(entry.routineName) ?? [];
      lines.push(`- ${entry.date}: ${entry.summary}`);
      byRoutine.set(entry.routineName, lines);
    }
    const grouped = [...byRoutine.entries()]
      .map(([name, lines]) => `## ${name}\n${lines.join('\n')}`)
      .join('\n');
    const omitted = context.changeLog.omittedCount > 0
      ? `\n(${context.changeLog.omittedCount} older change(s) not shown)`
      : '';

    changeHistoryBlock = `
ROUTINE CHANGE HISTORY (newest first; only what changed, not full snapshots):
${grouped}${omitted}
`;
  }

  return `You are "${COACH_NAMES[language].routine}", an AI training program analyst embedded in a gym tracking app.

ROUTINES:
${routineLines}
${changeHistoryBlock}
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
The user's goal is "${goalStr}". Tailor all recommendations to this bias.

ANALYSIS FRAMEWORK (use when discussing routine changes):
- Prioritize the largest imbalances (muscles with the biggest volume difference).
- Prioritize the lowest-volume muscle groups first.
- When suggesting set changes, be specific: "+2 sets/week for Chest" not "add more chest work".
- If a lift appears stalled (flat progression over multiple weeks), suggest: micro-loading (+1.25-2.5kg), rep-range change, or technique variation.
- For adherence issues, focus on realistic scheduling over perfect programming.
- When suggesting a 4-week plan: W1 addresses biggest deficit, W2 consolidates, W3 progresses, W4 deloads/tapers.

RULES:
${languageRules(language)}
- Be concise and actionable. Use a friendly, motivating tone. Emojis are welcome.
- Always cite specific volume numbers, muscle groups, and exercise names from the data provided.
- When suggesting routine changes, specify which routine and which exercises to modify.
- Do not invent data not shown above.
- ROUTINE CHANGE HISTORY is COMPLETE for the dates it covers. If a change is not listed, it did not happen; never infer, invent or estimate one. Never state a change date that is not in the list.
- Routine changes only started being recorded recently, so the history may not reach as far back as the training data. If asked about a period earlier than the oldest listed change, say the history does not go back that far.
- Changes and results are CORRELATIONAL, never causal: say "since you swapped X, Y has moved", never "the swap caused Y".

KNOWN EXERCISES: ${knownExercises}

FORMAT:
- Use **bold** for key numbers and emphasis.
- Use *exercise name* (single asterisks) for exercise names from KNOWN EXERCISES.
- Use ### for section headings. Never use --- as a divider.
- Use numbered lists (1. 2. 3.) for steps, - for bullet lists.
- Focus on the 2-3 most actionable insights. Don't enumerate every exercise or week individually unless asked.
- Always complete your final sentence. Target 80–120 words per reply. Only exceed that if the user explicitly asks for a full breakdown; this is a mobile chat.
- Never use em dashes (—) or en dashes (–) in your reply. Use commas, colons, semicolons or separate sentences instead.`;
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
