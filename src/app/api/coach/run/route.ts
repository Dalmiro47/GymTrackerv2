
import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt } from '@/lib/ai/coachPrompt';
import { normalizeAdviceUI } from '@/lib/coachNormalize';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

// New, safer extractor for JSON from Gemini REST API response
function extractJsonFromResponse(apiResponse: any): any {
  const parts = apiResponse?.candidates?.[0]?.content?.parts ?? [];
  if (parts.length === 0) {
    throw new Error('EMPTY_RESPONSE_PARTS');
  }

  // Case 1: JSON is in a single `text` part
  if (parts[0]?.text) {
    const combinedText = parts.map((p: any) => p.text || '').join('');
    try {
      return JSON.parse(combinedText);
    } catch (e) {
      throw new Error(`NON_JSON_IN_TEXT: ${String(e)}`);
    }
  }

  // Case 2: JSON is in `inlineData` (base64 encoded)
  if (parts[0]?.inlineData?.data) {
    try {
      const base64Data = parts[0].inlineData.data;
      // Buffer.from is available in Node.js environment
      const decodedJson = Buffer.from(base64Data, 'base64').toString('utf-8');
      return JSON.parse(decodedJson);
    } catch (e) {
      throw new Error(`FAILED_TO_DECODE_INLINEDATA: ${String(e)}`);
    }
  }

  // If neither case matches, throw a diagnostic error
  throw new Error(`UNHANDLED_RESPONSE_SHAPE: ${JSON.stringify(parts).slice(0, 300)}`);
}


async function callGeminiREST(model: string, apiKey: string, systemText: string, userText: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemText }] },
    contents: [
      { role: 'user', parts: [{ text: userText }] }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 900,
      response_mime_type: 'application/json'
    }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const rawText = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP_${r.status}: ${rawText.slice(0, 500)}`);
  }
  
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`NON_JSON_HTTP_RESPONSE: ${rawText.slice(0, 300)}`);
  }

  return extractJsonFromResponse(data);
}

export async function POST(req: Request) {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, engine: 'none', error: 'MISSING_API_KEY' }, { status: 500 });
  }

  try {
    const { profile, routineSummary, trainingSummary } = await req.json();
    const scope = { mode: 'global' as const };
    const userPrompt = makeUserPrompt({ profile, routineSummary, trainingSummary, scope });

    let raw: any = null;
    let used: string | null = null;
    let lastErr: string | null = null;

    for (const model of MODEL_CANDIDATES) {
      try {
        const out = await callGeminiREST(model, apiKey, SYSTEM_PROMPT, userPrompt);
        raw = out;
        used = model;
        break;
      } catch (e: any) {
        const msg = String(e?.message || e);
        lastErr = msg;
        // try the next model on common transient/compat errors
        const m = msg.toLowerCase();
        if (m.includes('404') || m.includes('not found') || m.includes('unsupported') ||
            m.includes('429') || m.includes('rate') || m.includes('quota') ||
            m.includes('preview')) {
          continue;
        }
        // otherwise bubble up
        throw e;
      }
    }

    if (!raw) {
      return NextResponse.json(
        { ok: false, engine: 'none', modelTried: MODEL_CANDIDATES, error: `NO_MODEL_WORKED: ${lastErr}` },
        { status: 502 }
      );
    }

    const advice = normalizeAdviceUI(raw);
    return NextResponse.json({ ok: true, engine: 'gemini', modelUsed: used, advice });
  } catch (e: any) {
    return NextResponse.json({ ok: false, engine: 'none', error: String(e?.message || e) }, { status: 502 });
  }
}
