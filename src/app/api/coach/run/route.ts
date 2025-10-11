
import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt } from '@/lib/ai/coachPrompt';
import { normalizeAdviceUI } from '@/lib/coachNormalize';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { FunctionDeclarationsTool } from '@google/generative-ai';

// Ensure no static caching of this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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


type CoachAdviceOut = any; // your typed shape if you have it

async function callModel(modelName: string, userText: string): Promise<{ advice: CoachAdviceOut, raw: any }> {
    const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('NO_API_KEY');

    const genAI = new GoogleGenerativeAI(apiKey);
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

    const result = await model.generateContent(userText);
    const call = result?.response?.functionCalls?.[0];
    const advice = call?.name === 'CoachAdvice' ? call.args : undefined;
    return { advice, raw: result };
}


export async function POST(req: Request) {
  try {
    const { profile, routineSummary, trainingSummary } = await req.json();
    const scope = { mode: 'global' as const };

    const userPrompt = makeUserPrompt({
      profile, routineSummary, trainingSummary, scope
    });

    let raw: CoachAdviceOut | null = null;
    let used: string | null = null;
    let lastErr: unknown = null;

    for (const m of MODEL_CANDIDATES) {
      try {
        const out = await callModel(m, userPrompt);
        raw = out.advice;
        used = m;
        if (raw) break;
      } catch (e: any) {
        lastErr = e;
        const msg = `${e?.message || e}`.toLowerCase();
        // Try next model on 404 / unsupported / rate-limit
        if (msg.includes('404') || msg.includes('not found') || msg.includes('unsupported') || msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
          continue;
        }
        // Other errors are fatal
        throw e;
      }
    }

    if (!raw) {
      throw new Error(`NO_MODEL_WORKED: ${String((lastErr as any)?.message || lastErr)}`);
    }

    // normalize for UI safety
    const advice = normalizeAdviceUI(raw);
    return NextResponse.json({ ok: true, engine: 'gemini', modelUsed: used, advice });
  } catch (e: any) {
    console.error('AI Coach error', e);
    return NextResponse.json(
      { ok: false, engine: 'none', error: e?.message ?? 'Unknown server error' },
      { status: 502 }
    );
  }
}
