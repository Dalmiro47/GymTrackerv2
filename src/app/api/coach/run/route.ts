
import { NextResponse } from 'next/server';
import { stripUndefinedDeep } from '@/lib/sanitize';
import type { FunctionDeclarationsTool } from '@google/generative-ai';
import { summarizeLogs, buildCoachAdviceLite, normalizeAdviceShape } from '@/lib/analysis';
import type { CoachAdvice } from '@/lib/analysis';

// Optional import only if you have the SDK installed
let GoogleGenerativeAI: any, HarmCategory: any, HarmBlockThreshold: any;
try {
  // Avoid module load crash on edge runtimes without SDK
  ({ GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai'));
} catch {}


const MODEL_CANDIDATES = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
];

const CoachAdviceParams = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING', description: 'Short high-level summary.' },
    priorities: { type: 'ARRAY', items: { type: 'STRING' } },
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
  required: ['overview', 'routineTweaks', 'nextFourWeeks'],
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
      parameters: CoachAdviceParams as any,
    },
  ],
};


async function runWithModel(genAI: any, modelName: string, promptText: string) {
    const model = genAI.getGenerativeModel({
        model: modelName,
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

    const result = await model.generateContent(promptText);
    const call = result?.response?.functionCalls?.[0];
    const advice = call?.name === 'CoachAdvice' ? call.args : undefined;
    return { advice, raw: result };
}

export async function POST(req: Request) {
  try {
    const { profile, routineSummary, trainingSummary, scope, routines, logs } = await req.json();

    const summary = trainingSummary ?? summarizeLogs(routines, logs);

    const apiKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    const canUseGemini = Boolean(apiKey && GoogleGenerativeAI);

    if (!canUseGemini) {
      // ✅ Free path
      const lite = buildCoachAdviceLite(summary, profile, { scope, routineSummary });
      const advice: CoachAdvice = normalizeAdviceShape(lite);
      return NextResponse.json({ advice, engine: 'lite' });
    }

    const genAI = new GoogleGenerativeAI(apiKey!);
    const prompt = `
CONTEXT
UserProfile: ${JSON.stringify(stripUndefinedDeep(profile))}
RoutineSummary: ${JSON.stringify(routineSummary)}
TrainingSummary: ${JSON.stringify(summary)}
SCOPE: ${JSON.stringify(scope)}

TASK
Call the CoachAdvice function with your structured advice.
`.trim();

    let rawAdvice: any;
    let lastErr: any;

    for (const modelName of MODEL_CANDIDATES) {
      try {
        const out = await runWithModel(genAI, modelName, prompt);
        rawAdvice = out.advice;
        if (rawAdvice) break;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        if (
          msg.includes('not found') ||
          msg.includes('is not supported') ||
          msg.includes('404')
        ) {
          console.warn(`Model ${modelName} not found, trying next...`);
          continue; 
        }
        throw e;
      }
    }

    if (!rawAdvice) {
      const lite = buildCoachAdviceLite(summary, profile, { scope, routineSummary });
      const advice: CoachAdvice = normalizeAdviceShape(lite);
      return NextResponse.json({ advice: advice, engine: 'lite', note: lastErr?.message ?? 'LLM unavailable, used lite' }, { status: 200 });
    }
    
    const advice = normalizeAdviceShape(rawAdvice);
    return NextResponse.json({ advice, engine: 'gemini' });

  } catch (err: any) {
    console.error('AI Coach route error:', err);
    return NextResponse.json(
      { error: err?.message || 'AI Coach failed.' },
      { status: 500 }
    );
  }
}
