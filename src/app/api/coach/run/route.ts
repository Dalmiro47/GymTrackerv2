
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

// ---- helpers at top-level (in the same file) ----
function stripFences(s: string) {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return t;
}

function tryParseJSON(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

function decodeInlineData(b64: string) {
  try { return Buffer.from(b64, "base64").toString("utf-8"); } catch { return ""; }
}

function extractJsonFromCandidates(data: any) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;

  // 1) text parts (also handle ```json fences)
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) {
        const text = stripFences(p.text);
        const parsed = tryParseJSON(text);
        if (parsed) return parsed;
      }
    }
  }

  // 2) inline_data (application/json, base64)
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const id = p?.inline_data;
      if (id?.mime_type?.toLowerCase().includes("json") && typeof id?.data === "string") {
        const decoded = decodeInlineData(id.data);
        const parsed = tryParseJSON(decoded);
        if (parsed) return parsed;
      }
    }
  }

  // 3) function call (if model used tool calling)
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const fc = p?.functionCall;
      if (fc?.args) return fc.args; // already JSON object
      if (typeof fc?.argsJson === "string") {
        const parsed = tryParseJSON(fc.argsJson);
        if (parsed) return parsed;
      }
    }
  }

  // nothing parsed → return a short diagnostic
  const diag = {
    keys: Object.keys(cand ?? {}),
    partsType: Array.isArray(parts) ? "array" : typeof parts,
    partsLen: Array.isArray(parts) ? parts.length : 0,
    finishReason: cand?.finishReason,
    promptFeedback: data?.promptFeedback
  };
  throw new Error(`EMPTY_RESPONSE_PARTS: ${JSON.stringify(diag).slice(0, 500)}`);
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
  
  const data = JSON.parse(rawText);
  const parsed = extractJsonFromCandidates(data);
  return parsed;
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
