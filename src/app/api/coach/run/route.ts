import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Schema, // Depending on SDK version, this type may exist. If TS complains, remove and keep plain objects.
} from '@google/generative-ai';

export const runtime = 'nodejs';

// CoachAdvice schema (tool parameters). Keep this aligned with src/lib/coach.schema.ts
const CoachAdviceParams: Schema = {
  type: 'object',
  properties: {
    overview: { type: 'string', description: 'Short high-level summary.' },
    priorityScore: { type: 'number', description: '1–100 priority of these changes.' },
    risks: { type: 'array', items: { type: 'string' } },
    routineTweaks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          where: {
            type: 'object',
            properties: {
              day: { type: 'string' },
              slot: { type: 'number' },
            },
            required: ['day'],
          },
          change: {
            type: 'string',
            enum: [
              'Replace Exercise',
              'Add Exercise',
              'Remove Exercise',
              'Change Sets/Reps',
              'Change Frequency',
            ],
          },
          details: { type: 'string' },
          setsReps: {
            type: 'object',
            properties: {
              sets: { type: 'number' },
              repsRange: { type: 'string' },
              rir: { type: 'string' },
            },
            required: ['sets', 'repsRange'],
          },
          exampleExercises: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['where', 'change', 'details', 'rationale'],
      },
    },
    nextFourWeeks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          week: { type: 'number' },
          focus: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['week', 'focus', 'notes'],
      },
    },
    meta: {
      type: 'object',
      properties: {
        stalledLifts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['name', 'reason'],
          },
        },
        volumeGaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              muscleGroup: { type: 'string' },
              weeklySets: { type: 'number' },
              targetRange: { type: 'string' },
            },
            required: ['muscleGroup', 'weeklySets', 'targetRange'],
          },
        },
        balance: {
          type: 'object',
          properties: {
            pushPct: { type: 'number' },
            pullPct: { type: 'number' },
            legsPct: { type: 'number' },
            hingePct: { type: 'number' },
            corePct: { type: 'number' },
          },
        },
        confidence: { type: 'number' },
      },
    },
  },
  required: ['overview', 'priorityScore', 'routineTweaks', 'nextFourWeeks'],
} as const;

const SYSTEM = `
You are a certified strength & conditioning coach. Provide safe, conservative, evidence-based guidance.
- Respect user constraints and sessionTimeTargetMin (time per session).
- Treat training as mostly gender-neutral; only adjust where clearly relevant.
- Map guidance to goals (Hypertrophy, Strength, Strength+Hypertrophy, Fat Loss, General Fitness).
- Respect daysPerWeekTarget and ensure weekly balance (squat/hinge/horizontal+vertical push/pull/core).
- Suggest 1–3 high-impact tweaks with rationale; be cautious on thin data.
- Use TrainingSummary to note stalled lifts & volume gaps (fill meta.*).
- If scope.mode === "day": only tweak that day and keep within sessionTimeTargetMin.
- If scope.mode === "global": analyze the entire plan.
- Your response MUST be a function call to CoachAdvice with valid data.
`;

export async function POST(req: NextRequest) {
  try {
    const { profile, routineSummary, trainingSummary, scope } = await req.json();
    const apiKey = process.env.GOOGLE_API_KEY || '';
    if (!apiKey) return NextResponse.json({ error: 'Missing GOOGLE_API_KEY' }, { status: 503 });

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: SYSTEM,
      tools: [
        {
          functionDeclarations: [
            {
              name: 'CoachAdvice',
              description: 'Return structured coaching advice.',
              parameters: CoachAdviceParams,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ],
    });

    // Only the dynamic data lives in the prompt
    const prompt = `
CONTEXT
UserProfile: ${JSON.stringify(profile)}
RoutineSummary: ${JSON.stringify(routineSummary)}
TrainingSummary: ${JSON.stringify(trainingSummary)}
SCOPE: ${JSON.stringify(scope)}

TASK
Call the CoachAdvice function with your structured advice.
`;

    const result = await model.generateContent(prompt);

    // Extract function call
    const parts = result.response?.candidates?.[0]?.content?.parts ?? [];
    const fn = parts.find((p: any) => p.functionCall)?.functionCall;
    if (fn?.name === 'CoachAdvice' && fn?.args) {
      // fn.args is already a JS object matching the schema
      return NextResponse.json({ advice: fn.args }, { status: 200 });
    }

    console.error('CoachAdvice function was not called. Raw:', JSON.stringify(result.response, null, 2));
    return NextResponse.json({ error: 'Invalid response structure from model' }, { status: 502 });
  } catch (e: any) {
    console.error('Coach route error:', e);
    return NextResponse.json({ error: e?.message ?? 'coach_error' }, { status: 500 });
  }
}
