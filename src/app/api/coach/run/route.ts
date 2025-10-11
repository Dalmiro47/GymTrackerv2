
import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt, COACH_RESPONSE_SCHEMA } from '@/lib/ai/coachPrompt';
import { normalizeAdviceUI } from '@/lib/coachNormalize';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MODEL_CANDIDATES = [
  'gemini-2.5-flash-lite', // fastest first
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];


function stripFences(s: string) {
  const t = s.trim();
  if (t.startsWith('```')) return t.replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  return t;
}
function tryParseJSON(s: string) { try { return JSON.parse(s); } catch { return null; } }
function decodeInlineData(b64: string) {
  try { return Buffer.from(b64, 'base64').toString('utf-8'); } catch { return ''; }
}
function extractJsonFromCandidates(data: any) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;

  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (typeof p?.text === 'string' && p.text.trim()) {
        const parsed = tryParseJSON(stripFences(p.text));
        if (parsed) return parsed;
      }
    }
    for (const p of parts) {
      const id = p?.inline_data;
      if (id?.mime_type?.toLowerCase().includes('json') && typeof id?.data === 'string') {
        const parsed = tryParseJSON(decodeInlineData(id.data));
        if (parsed) return parsed;
      }
    }
    for (const p of parts) {
      const fc = p?.functionCall;
      if (fc?.args) return fc.args;
      if (typeof fc?.argsJson === 'string') {
        const parsed = tryParseJSON(fc.argsJson);
        if (parsed) return parsed;
      }
    }
  }

  const diag = {
    keys: Object.keys(cand ?? {}),
    partsType: Array.isArray(parts) ? 'array' : typeof parts,
    partsLen: Array.isArray(parts) ? parts.length : 0,
    finishReason: cand?.finishReason,
  };
  throw new Error(`EMPTY_RESPONSE_PARTS: ${JSON.stringify(diag)}`);
}

// compact the payload for retry
function compactPayload(profile: any, routineSummary: any, trainingSummary: any) {
  const ts = trainingSummary ?? {};
  // keep only last 8 "weekly" items if it's large
  const weekly = Array.isArray(ts.weekly) ? ts.weekly.slice(-8) : [];
  // drop any giant fields we don't need
  return {
    profile,
    routineSummary: {
      days: Array.isArray(routineSummary?.days)
        ? routineSummary.days.map((d: any) => ({
            id: d.id, name: d.name,
            exercises: Array.isArray(d.exercises) ? d.exercises.slice(0, 6) : []
          })).slice(0, 4)
        : []
    },
    trainingSummary: { weekly }
  };
}

async function callGeminiREST(model: string, apiKey: string, systemText: string, userText: string, maxTokens: number) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: maxTokens,
      response_mime_type: 'application/json',
      response_schema: COACH_RESPONSE_SCHEMA
    }
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const rawText = await r.text();
  if (!r.ok) throw new Error(`HTTP_${r.status}: ${rawText.slice(0,800)}`);
  const data = JSON.parse(rawText);
  const parsed = extractJsonFromCandidates(data);
  return { data, parsed };
}

export async function POST(req: Request) {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return NextResponse.json({ ok:false, engine:'none', error:'MISSING_API_KEY' }, { status:500 });

  try {
    const { profile, routineSummary, trainingSummary } = await req.json();
    const scope = { mode: 'global' as const };

    // always compact before prompting
    const compact = compactPayload(profile, routineSummary, trainingSummary);

    let adviceRaw: any = null;
    let used: string | null = null;
    let lastErr: string | null = null;

    for (const model of MODEL_CANDIDATES) {
      try {
        // 1) Fast path (slightly bigger budget than 800)
        try {
          const prompt = makeUserPrompt({ ...compact, scope, brief: false });
          const { parsed } = await callGeminiREST(model, apiKey, SYSTEM_PROMPT, prompt, 1100);
          adviceRaw = parsed; used = model; break;
        } catch (e: any) {
          const msg = String(e?.message || e);

          // 2) Retry ONCE if token-limited → brief mode + larger cap (rare)
          if (msg.includes('MAX_TOKENS')) {
            const promptBrief = makeUserPrompt({ ...compact, scope, brief: true });
            const { parsed } = await callGeminiREST(model, apiKey, SYSTEM_PROMPT, promptBrief, 1400);
            adviceRaw = parsed; used = model; break;
          }

          // try next model on 404/429 etc.
          const m = msg.toLowerCase();
          if (m.includes('404') || m.includes('not found') || m.includes('unsupported') ||
              m.includes('429') || m.includes('quota') || m.includes('rate') || m.includes('preview')) {
            lastErr = msg; continue;
          }
          throw e;
        }
      } catch (e:any) {
        lastErr = String(e?.message || e);
        continue;
      }
    }

    if (!adviceRaw) {
      return NextResponse.json({ ok:false, engine:'none', error:`NO_MODEL_WORKED: ${lastErr}` }, { status:502 });
    }

    const advice = normalizeAdviceUI(adviceRaw, routineSummary);
    return NextResponse.json({ ok:true, engine:'gemini', modelUsed: used, advice });
  } catch (e:any) {
    return NextResponse.json({ ok:false, engine:'none', error:String(e?.message || e) }, { status:502 });
  }
}
