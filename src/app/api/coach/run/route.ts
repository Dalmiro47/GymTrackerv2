
import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
  type Schema,
} from '@google/generative-ai';

export const runtime = 'nodejs';

// CoachAdvice schema (tool parameters). Keep this aligned with src/lib/coach.schema.ts
const CoachAdviceParams: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    overview: { type: SchemaType.STRING, description: 'Short high-level summary.' },
    priorityScore: { type: SchemaType.NUMBER, description: '1–100 priority of these changes.' },
    risks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    routineTweaks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          where: {
            type: SchemaType.OBJECT,
            properties: {
              day: { type: SchemaType.STRING },
              slot: { type: SchemaType.NUMBER },
            },
            required: ['day'],
          },
          change: {
            type: SchemaType.STRING,
            enum: [
              'Replace Exercise',
              'Add Exercise',
              'Remove Exercise',
              'Change Sets/Reps',
              'Change Frequency',
            ],
          },
          details: { type: SchemaType.STRING },
          setsReps: {
            type: SchemaType.OBJECT,
            properties: {
              sets: { type: SchemaType.NUMBER },
              repsRange: { type: SchemaType.STRING },
              rir: { type: SchemaType.STRING },
            },
            required: ['sets', 'repsRange'],
          },
          exampleExercises: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          rationale: { type: SchemaType.STRING },
        },
        required: ['where', 'change', 'details', 'rationale'],
      },
    },
    nextFourWeeks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          week: { type: SchemaType.NUMBER },
          focus: { type: SchemaType.STRING },
          notes: { type: SchemaType.STRING },
        },
        required: ['week', 'focus', 'notes'],
      },
    },
    meta: {
      type: SchemaType.OBJECT,
      properties: {
        stalledLifts: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING },
              reason: { type: SchemaType.STRING },
            },
            required: ['name', 'reason'],
          },
        },
        volumeGaps: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              muscleGroup: { type: SchemaType.STRING },
              weeklySets: { type: SchemaType.NUMBER },
              targetRange: { type: SchemaType.STRING },
            },
            required: ['muscleGroup', 'weeklySets', 'targetRange'],
          },
        },
        balance: {
          type: SchemaType.OBJECT,
          properties: {
            pushPct: { type: SchemaType.NUMBER },
            pullPct: { type: SchemaType.NUMBER },
            legsPct: { type: SchemaType.NUMBER },
            hingePct: { type: SchemaType.NUMBER },
            corePct: { type: SchemaType.NUMBER },
          },
        },
        confidence: { type: SchemaType.NUMBER },
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

    const parts = result.response?.candidates?.[0]?.content?.parts ?? [];
    const fn = parts.find((p: any) => p?.functionCall)?.functionCall;
    let advice = fn?.name === 'CoachAdvice' ? fn?.args : undefined;

    // belt-and-suspenders fallback for odd responses
    if (!advice && typeof result.response?.text === 'function') {
      try {
        advice = JSON.parse(result.response.text());
      } catch {}
    }

    if (!advice) {
      console.error('CoachAdvice function was not called or parsed. Raw:', JSON.stringify(result.response, null, 2));
      return NextResponse.json({ error: 'Invalid response structure from model' }, { status: 502 });
    }

    return NextResponse.json({ advice }, { status: 200 });

  } catch (e: any) {
    console.error('Coach route error:', e);
    return NextResponse.json({ error: e?.message ?? 'coach_error' }, { status: 500 });
  }
}
