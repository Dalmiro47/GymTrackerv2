// Offline eval for the Exercise Library coach (`exercise-library` mode).
//
// Generates replies with the REAL prompt builder and the REAL GroqProvider
// (streamed, same params as src/app/api/coach/chat/route.ts), then grades each
// reply with Jev (TypeSafe decision model, via OpenRouter). Claude Sonnet 5
// explains only the replies Jev fails, so a failure comes with a reason.
//
// Why Jev: on 29 hand-labelled replies (2026-09) it agreed with the labels
// 25/29 vs Sonnet's 18/29 (Sonnet over-applies the rubric), at ~1/100 the cost
// and ~330 ms vs ~8 s per grade. It returns only a probability, never a reason.
//
// Usage:  npm run coach:eval -- [caseIdFilter] [--repeat=N] [--no-explain]
// Needs GROQ_API_KEY and OPEN_ROUTER_API_KEY in .env.local (dev-only key).
// Writes the full report to scripts/coach-eval/last-run.txt (gitignored).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(REPO, rel)).href);
const { buildExerciseLibrarySystemPrompt } = await load('src/lib/ai/chat-prompts.ts');
const { GroqProvider } = await load('src/lib/ai/llm-provider.ts');
const { DEFAULT_EXERCISES_ES } = await load('src/lib/defaultExercises.es.ts');

const env = readFileSync(path.join(REPO, '.env.local'), 'utf8');
const readEnv = (name: string) => new RegExp(`^${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(env)?.[1];
const GROQ_KEY = readEnv('GROQ_API_KEY');
const OR_KEY = readEnv('OPEN_ROUTER_API_KEY');
if (!GROQ_KEY) throw new Error('GROQ_API_KEY missing from .env.local');
if (!OR_KEY) throw new Error('OPEN_ROUTER_API_KEY missing from .env.local (needed for the Jev judge)');

// Keep in step with the exercise-library branch of route.ts.
const COACH_OPTS = { temperature: 0.4, maxTokens: 4000, reasoning: true };
const JEV_MODEL = 'typesafe/jev-1.13';
const EXPLAIN_MODEL = 'anthropic/claude-sonnet-5';
const FAIL_THRESHOLD = 0.5;

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--'));
const repeat = Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? 1);
const explain = !args.includes('--no-explain');

// ─── Fixture library ─────────────────────────────────────────────────
// A reconstruction of a real user's library (defaults + custom exercises).
// Names are the stored English ones; Spanish cases display seeded defaults
// through DEFAULT_EXERCISES_ES, like exerciseDisplay.ts does in the app.

type Ex = { name: string; focus?: string; target?: string; inRoutines: string[]; lastDone?: string };
type Lib = Record<string, { sets: number; ex: Ex[] }>;
const u = (name: string, focus?: string, target?: string): Ex => ({ name, focus, target, inRoutines: [] });
const r = (name: string, routine: string, focus?: string, target?: string): Ex =>
  ({ name, focus, target, inRoutines: [routine], lastDone: '2026-09-22' });

const FULL: Lib = {
  Chest: { sets: 2, ex: [
    u('Bench Press', 'Middle Chest', '6-10 reps'), u('Dips', 'Lower Chest', '8-12 reps'),
    u('Incline chest w/ Smith Machine', 'Upper Chest', '8-12 reps'), r('Incline chest w/dumbbells', 'Day 1', 'Upper Chest', '6-10 reps'),
    u('Machine Chest Press', 'Middle Chest', '8-12 reps'), r('Machine Flye (Pec Deck)', 'Day 2', undefined, '8-12'),
    u('Seated Cable Pec Flye', 'Lower Chest', '8-12 reps'), u('Standing Pec Fly', 'Lower Chest', '8-12 reps'),
  ] },
  Back: { sets: 4, ex: [
    u('Barbell Rows'), u('Half-Kneeling 1-Arm Lat Pulldown'), u('Neutral-Grip Lat Pull down'), u('Seated Row'), u('T-Bar Row'),
    r('Wide-Grip Lat Pull down', 'Day 1'), r('Chest-Supported Row', 'Day 2'), r('Wide-Grip Pull ups', 'Day 3'),
  ] },
  Legs: { sets: 7.5, ex: [
    u('Hip Thrust'), u('Leg Press Machine'), u('Nordic Curl'),
    r('Barbell Back Squat', 'Day 3'), r('Hack Squat', 'Day 3'), r('Romanian Dead Lift', 'Day 3'), r('Leg Extension', 'Day 3'),
    r('Leg Curl Machine', 'Day 3'), r('Bulgarian Split Squat', 'Day 3'), r('Standing Calves', 'Day 3'),
  ] },
  Shoulders: { sets: 2, ex: [
    u('Dumbbell Overhead Press'), u('Lateral Raise Dumbbell'), u('Machine Shoulder Press'), u('Standing Overhead Press'),
    u('Super-Rom lateral raise'), r('Cable Lateral Raise', 'Day 2'), r('Reverse Peck Deck', 'Day 1'),
  ] },
  Biceps: { sets: 2, ex: [u('Chinup'), u('EZ Bar Curl'), r('Hammer Curl', 'Day 1'), r('Incline Dumbbell Curl', 'Day 2')] },
  Triceps: { sets: 1, ex: [u('Cable Triceps Kickback'), u('Skullcrusher'), r('Overhead Cable Triceps Extension', 'Day 2'), r('Dips', 'Day 1')] },
  Abs: { sets: 1, ex: [
    u('Abs Wheel/Rollout'), u('Abs combo'), u('Back-Supported Leg Raise'), u('Candlestick'), u('Crunch Machine'),
    u('Pallof Press'), r('Cable Crunch', 'Day 3'),
  ] },
  Cardio: { sets: 0, ex: [] },
  Other: { sets: 0, ex: [
    u('Explosive Step-Up (Low Box)'), u('Hamstring Isometric Bridge'), u('Nordic Hamstring Curl (Assisted)'),
    u('Single-Leg Glute Bridge'), u('Single-Leg Romanian Deadlift'), u('Step-Up (Low Box, Controlled)'),
  ] },
};

// Same user with real gaps: no rows, no rear delts, triceps without an overhead/stretch movement.
const GAPS: Lib = structuredClone(FULL);
GAPS.Back.ex = GAPS.Back.ex.filter((e) => !/row/i.test(e.name));
GAPS.Shoulders.ex = GAPS.Shoulders.ex.filter((e) => !/reverse|rear/i.test(e.name));
GAPS.Triceps.ex = GAPS.Triceps.ex.filter((e) => /dips|kickback/i.test(e.name));

function toContext(lib: Lib, lang: 'en' | 'es', constraints: string[] = []) {
  return {
    windowWeeks: 4,
    profile: { goal: 'Strength+Hypertrophy', trainingAge: 'Intermediate', daysPerWeekTarget: 3, constraints },
    muscles: Object.entries(lib).map(([muscleGroup, g]) => ({
      muscleGroup,
      avgWeeklySets: g.sets,
      exercises: g.ex.map((e) => {
        const es = lang === 'es' ? DEFAULT_EXERCISES_ES[`${e.name}::${muscleGroup}`] : undefined;
        return { ...e, name: es?.name ?? e.name, focus: es?.targetNotes || e.focus };
      }),
    })),
  };
}

// ─── Cases ───────────────────────────────────────────────────────────

type Case = { id: string; lang: 'en' | 'es'; lib?: Lib; constraints?: string[]; turns: string[]; expect: string };
const CASES: Case[] = [
  { id: 'chest-en', lang: 'en', turns: ['what exercise could I add for chest?'], expect: 'says chest is covered; only NEW, non-duplicate picks' },
  { id: 'chest-es', lang: 'es', turns: ['qué ejercicio de pecho debería agregar?'], expect: 'same, in Spanish; no Spanish-named duplicates, no rambling' },
  { id: 'legs-es', lang: 'es', turns: ['qué ejercicio de piernas debería agregar?'], expect: 'no Step-Up / Hip Thrust / split-squat variants, no hedging' },
  { id: 'triceps-en', lang: 'en', turns: ['what could I add for triceps?'], expect: 'no pushdown/extension duplicates of existing ones' },
  { id: 'unused-en', lang: 'en', turns: ['which of my exercises am I not using?'], expect: 'lists library exercises not in any routine; invents none' },
  { id: 'push-en', lang: 'en', turns: ['Is my push day balanced?'], expect: 'short redirect to the Routines coach; no sets, no action plan' },
  { id: 'push-es', lang: 'es', turns: ['mi día de empuje está balanceado?'], expect: 'short redirect, in Spanish' },
  { id: 'gap-back-en', lang: 'en', lib: GAPS, turns: ['what am I missing for back?'], expect: 'names the missing horizontal row and suggests one' },
  { id: 'gap-shoulders-es', lang: 'es', lib: GAPS, turns: ['qué me falta para hombros?'], expect: 'names the missing rear delt work and suggests one' },
  { id: 'injury-en', lang: 'en', lib: GAPS, constraints: ['shoulder impingement'], turns: ['what could I add for shoulders?'], expect: 'rear delt pick; nothing that loads an impinged shoulder' },
  { id: 'overall-en', lang: 'en', lib: GAPS, turns: ['what am I missing overall?'], expect: 'names the real gaps (row, rear delt, triceps angle), concisely' },
  { id: 'explain-en', lang: 'en', turns: ['how do I do the Pallof Press?'], expect: 'explains form; no forced suggestions' },
  { id: 'multi-en', lang: 'en', turns: ['what exercise could I add for chest?', 'and for legs?'], expect: 'the legs turn also sticks to new, non-duplicate picks' },
];

// ─── Rubric (shared by Jev and the Sonnet explainer) ─────────────────

const RUBRIC = [
  'Presents as a NEW suggestion an exercise the user already has, including the same movement with only different equipment, grip, load, or body position (seated/lying/standing), or the same exercise named in another language.',
  'Calls an area "missing" that an exercise in the library already covers.',
  "Analyzes or prescribes changes to the user's routines or program (sets, days, splits) instead of redirecting to the Routines page coach.",
  'Attributes an exercise to a muscle it does not primarily train, or invents a non-existent exercise.',
  'Contradicts itself: proposes something and withdraws it, rambles through rejected options, or repeats the same pick.',
  'Replies in the wrong language, or runs well over ~160 words when the user did not ask for a full list.',
].map((rule, i) => `${i + 1}. ${rule}`).join('\n');

// The judge must know what the coach is GIVEN, or it flags legitimate uses of
// that data (weekly sets, the unused list) as fabricated routine analysis.
const ROLE = 'Reply from a gym app "Exercise Library" coach. It is given the user\'s exercise library, the average weekly hard sets per muscle group, and which library exercises are unused (in no routine, not done recently); citing those is allowed. It does NOT see the routines themselves. When asked what to add it must suggest only exercises the user does NOT have. A full list is expected when the user asks which exercises are unused.';

type Graded = { libraryText: string; lang: 'en' | 'es'; expect: string; question: string; reply: string };

async function openRouter(url: string, body: unknown) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://openrouter.ai/api/v1/${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error('OpenRouter unreachable');
}

/** Probability (0-1) that the reply breaks the rubric. */
async function jevFailProbability(g: Graded): Promise<{ p: number; cost: number }> {
  const j = await openRouter('systemone', {
    model: JEV_MODEL,
    state: {
      role: ROLE,
      user_library: g.libraryText,
      required_language: g.lang === 'es' ? 'Spanish' : 'English',
      test_expectation: g.expect,
      user_question: g.question,
      coach_reply: g.reply,
    },
    questions: { fails: { type: 'noul', instructions: `Does the coach REPLY break ANY of these rules?\n${RUBRIC}` } },
  });
  return { p: j.answers.fails.noul, cost: j.usage?.cost ?? 0 };
}

/** Why a reply failed, in one or two short lines (only called for Jev fails). */
async function explainFailure(g: Graded): Promise<{ why: string; cost: number }> {
  const j = await openRouter('chat/completions', {
    model: EXPLAIN_MODEL,
    temperature: 0,
    max_tokens: 1500,
    usage: { include: true },
    messages: [{ role: 'user', content: `${ROLE}

USER'S LIBRARY (the user HAS every one of these):
${g.libraryText}
Required reply language: ${g.lang === 'es' ? 'Spanish' : 'English'}
Test expectation: ${g.expect}

RULES:
${RUBRIC}

USER: ${g.question}

COACH REPLY:
${g.reply}

An automatic grader flagged this reply. In at most two short lines, say which rule it breaks and quote the offending part. If it breaks none, say "false alarm" and why.` }],
  });
  return { why: (j.choices?.[0]?.message?.content ?? '').trim(), cost: j.usage?.cost ?? 0 };
}

// ─── Coach call (production provider, streamed) ─────────────────────

const provider = new GroqProvider({ apiKey: GROQ_KEY });

async function coachReply(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
  const t0 = Date.now();
  const stream: ReadableStream<Uint8Array> = await provider.chatStream(messages, COACH_OPTS);
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let finish = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      const choice = JSON.parse(line.slice(6)).choices?.[0];
      text += choice?.delta?.content ?? '';
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  return { text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), finish, ms: Date.now() - t0 };
}

// ─── Run ─────────────────────────────────────────────────────────────

const report: string[] = [];
let total = 0;
let failed = 0;
let judgeCost = 0;

for (const c of CASES.filter((x) => !filter || x.id.includes(filter))) {
  for (let rep = 1; rep <= repeat; rep++) {
    const ctx = toContext(c.lib ?? FULL, c.lang, c.constraints);
    const libraryText = ctx.muscles.map((m) => `${m.muscleGroup}: ${m.exercises.map((e) => e.name).join(', ') || '(none)'}`).join('\n');
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> =
      [{ role: 'system', content: buildExerciseLibrarySystemPrompt(ctx, c.lang) }];

    for (const turn of c.turns) {
      messages.push({ role: 'user', content: turn });
      const { text, finish, ms } = await coachReply(messages);
      messages.push({ role: 'assistant', content: text });

      // Deterministic checks the judge would be wasted on.
      const words = text.split(/\s+/).filter(Boolean).length;
      const hard: string[] = [];
      if (finish !== 'stop') hard.push(`finish_reason=${finish}`);
      if (/[–—]/.test(text)) hard.push('uses an em/en dash');

      const g: Graded = { libraryText, lang: c.lang, expect: c.expect, question: turn, reply: text };
      const jev = await jevFailProbability(g);
      judgeCost += jev.cost;
      const pass = jev.p < FAIL_THRESHOLD && hard.length === 0;
      total++;
      let why = hard.join('; ');
      if (!pass) {
        failed++;
        if (explain && jev.p >= FAIL_THRESHOLD) {
          const e = await explainFailure(g);
          judgeCost += e.cost;
          why = [why, e.why].filter(Boolean).join(' | ');
        }
      }

      const status = pass ? 'PASS' : 'FAIL';
      console.log(`${status}  ${c.id} #${rep}${c.turns.length > 1 ? ` "${turn}"` : ''}  jev=${jev.p.toFixed(2)}  ${words}w ${ms}ms${why ? `\n      ${why.replace(/\n/g, ' ')}` : ''}`);
      report.push(`==================== ${status} ${c.id} #${rep}  jev=${jev.p.toFixed(2)}  ${words}w ${ms}ms\nexpect: ${c.expect}\nUSER: ${turn}\n${why ? `WHY: ${why}\n` : ''}\n${text}\n`);
    }
  }
}

const summary = `\n${total - failed}/${total} passed · judge cost $${judgeCost.toFixed(4)}`;
console.log(summary);
writeFileSync(path.join(REPO, 'scripts/coach-eval/last-run.txt'), report.join('\n') + summary + '\n', 'utf8');
