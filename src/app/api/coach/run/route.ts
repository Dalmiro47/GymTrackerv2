
import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  Schema,
  FunctionDeclarationsTool,
} from '@google/generative-ai';
import { stripUndefinedDeep } from '@/lib/sanitize';

export const runtime = 'nodejs';

// Re-defining a simplified schema here to ensure it's self-contained.
// Keep this aligned with src/lib/coach.schema.ts
const CoachAdviceParams: Schema = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING', description: 'Short high-level summary.' },
    priorityScore: { type: 'NUMBER', description: '1–100 priority of these changes.' },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    routineTweaks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          where: {
            type: 'OBJECT',
            properties: {
              day: { type: 'STRING' },
              slot: { type: 'NUMBER' },
            },
            required: ['day'],
          },
          change: {
            type: 'STRING',
            enum: [
              'Replace Exercise',
              'Add Exercise',
              'Remove Exercise',
              'Change Sets/Reps',
              'Change Frequency',
            ],
          },
          details: { type: 'STRING' },
          setsReps: {
            type: 'OBJECT',
            properties: {
              sets: { type: 'NUMBER' },
              repsRange: { type: 'STRING' },
              rir: { type: 'STRING' },
            },
            required: ['sets', 'repsRange'],
          },
          exampleExercises: { type: 'ARRAY', items: { type: 'STRING' } },
          rationale: { type: 'STRING' },
        },
        required: ['where', 'change', 'details', 'rationale'],
      },
    },
    nextFourWeeks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          week: { type: 'NUMBER' },
          focus: { type: 'STRING' },
          notes: { type: 'STRING' },
        },
        required: ['week', 'focus', 'notes'],
      },
    },
    meta: {
      type: 'OBJECT',
      properties: {
        stalledLifts: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              reason: { type: 'STRING' },
            },
            required: ['name', 'reason'],
          },
        },
        volumeGaps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              muscleGroup: { type: 'STRING' },
              weeklySets: { type: 'NUMBER' },
              targetRange: { type: 'STRING' },
            },
            required: ['muscleGroup', 'weeklySets', 'targetRange'],
          },
        },
        balance: {
          type: 'OBJECT',
          properties: {
            pushPct: { type: 'NUMBER' },
            pullPct: { type: 'NUMBER' },
            legsPct: { type: 'NUMBER' },
            hingePct: { type: 'NUMBER' },
            corePct: { type: 'NUMBER' },
          },
        },
        confidence: { type: 'NUMBER' },
      },
    },
  },
  required: ['overview', 'priorityScore', 'routineTweaks', 'nextFourWeeks'],
};

const SYSTEM_INSTRUCTION = `
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

const tool: FunctionDeclarationsTool = {
  functionDeclarations: [
    {
      name: 'CoachAdvice',
      description: 'Return structured coaching advice.',
      parameters: CoachAdviceParams,
    },
  ],
};


export async function POST(req: NextRequest) {
  try {
    const { profile, routineSummary, trainingSummary, scope } = await req.json();
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API Key for AI service' }, { status: 503 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: { role: 'model', parts: [{ text: SYSTEM_INSTRUCTION }] },
      tools: [tool],
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

    const prompt = `
CONTEXT
UserProfile: ${JSON.stringify(stripUndefinedDeep(profile))}
RoutineSummary: ${JSON.stringify(routineSummary)}
TrainingSummary: ${JSON.stringify(trainingSummary)}
SCOPE: ${JSON.stringify(scope)}

TASK
Call the CoachAdvice function with your structured advice.
`;

    const result = await model.generateContent(prompt);
    
    // ✅ New, correct way to access function call output
    const call = result.response.functionCalls()?.[0];
    const advice = call?.name === 'CoachAdvice' ? call.args : undefined;

    if (!advice) {
      console.error('CoachAdvice function was not called or parsed. Raw response:', JSON.stringify(result.response, null, 2));
      let errorMessage = 'Invalid response structure from model.';
      if (result.response.promptFeedback?.blockReason) {
        errorMessage = `Request blocked: ${result.response.promptFeedback.blockReason}`;
      }
      return NextResponse.json({ error: errorMessage }, { status: 502 });
    }

    return NextResponse.json({ advice }, { status: 200 });

  } catch (e: any) {
    console.error('Coach route error:', e);
    return NextResponse.json({ error: e?.message ?? 'coach_error' }, { status: 500 });
  }
}
