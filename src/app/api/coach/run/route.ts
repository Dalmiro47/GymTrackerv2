
import { NextResponse } from 'next/server';
import { stripUndefinedDeep } from '@/lib/sanitize';
import type { FunctionDeclarationsTool } from '@google/generative-ai';
import { summarizeLogs, buildCoachAdviceLite, normalizeAdviceShape } from '@/lib/analysis';
import type { CoachAdvice } from '@/lib/analysis';
import { SYSTEM_PROMPT, makeUserPrompt } from '@/lib/ai/coachPrompt';

// Optional import only if you have the SDK installed
let GoogleGenerativeAI: any, HarmCategory: any, HarmBlockThreshold: any;
try {
  // Avoid module load crash on edge runtimes without SDK
  ({ GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai'));
} catch {}


const MODEL_CANDIDATES = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
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
        systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
        tools: [tool],
        generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 900
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
    const { profile, routineSummary, trainingSummary, logs, scope } = await req.json();

    const summary = trainingSummary ?? summarizeLogs(routineSummary?.days, logs);

    const apiKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    const canUseGemini = Boolean(apiKey && GoogleGenerativeAI);

    if (!canUseGemini) {
      // ✅ Free path
      const lite = buildCoachAdviceLite(summary, profile, { scope, routineSummary });
      const advice: CoachAdvice = normalizeAdviceShape(lite);
      return NextResponse.json({ advice, engine: 'lite' });
    }

    const genAI = new GoogleGenerativeAI(apiKey!);
    const prompt = makeUserPrompt({ profile, routineSummary, trainingSummary: summary, scope });

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
        if (msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) {
            console.warn(`Model ${modelName} rate-limited, trying next...`);
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
    console.error('AI Coach error:', err);
    return NextResponse.json(
      { error: err?.message || 'AI Coach failed.' },
      { status: 500 }
    );
  }
}
