
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

async function callGeminiREST(model: string, apiKey: string, systemText: string, userText: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    // safest: embed system into top-level + also in the first user message if needed
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
    // IMPORTANT: stringify
    body: JSON.stringify(body)
  });

  const text = await r.text();
  if (!r.ok) {
    // surface server error details
    throw new Error(`HTTP_${r.status}: ${text.slice(0, 500)}`);
  }
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`NON_JSON_HTTP_${r.status}: ${text.slice(0, 300)}`); }

  const out =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('')?.trim() || '';

  if (!out) throw new Error('EMPTY_RESPONSE');

  let parsed: any;
  try { parsed = JSON.parse(out); }
  catch { throw new Error(`NON_JSON_MODEL_OUTPUT: ${out.slice(0, 300)}`); }

  return parsed;
}

export async function POST(req: Request) {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, engine: 'none', error: 'MISSING_API_KEY' },
      { status: 500 }
    );
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
        lastErr = String(e?.message || e);
        // try next model on typical transient/compat errors
        const m = lastErr.toLowerCase();
        if (m.includes('404') || m.includes('not found') || m.includes('unsupported') ||
            m.includes('429') || m.includes('rate') || m.includes('quota') ||
            m.includes('preview') ) {
          continue;
        }
        // anything else is fatal
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
    return NextResponse.json(
      { ok: false, engine: 'none', error: String(e?.message || e) },
      { status: 502 }
    );
  }
}
