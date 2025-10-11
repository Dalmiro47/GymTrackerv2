
import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt, COACH_RESPONSE_SCHEMA } from '@/lib/ai/coachPrompt';
import { buildCoachFactsCompact } from '@/lib/analysis';
import { normalizeAdviceUI } from '@/lib/coachNormalize';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Fast first
const MODEL_CANDIDATES = ['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.0-flash'];

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
  return { data, parsed: extractJsonFromCandidates(data) };
}

export async function POST(req: Request) {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return NextResponse.json({ ok:false, engine:'none', error:'MISSING_API_KEY' }, { status:500 });

  try {
    const { profile, routineSummary, trainingSummary } = await req.json();
    const scope = { mode: 'global' as const };

    // already compacted training summary on your side; now build compact facts
    const { facts } = buildCoachFactsCompact(profile, routineSummary, trainingSummary);

    let used: string | null = null;
    let parsed: any | null = null;
    let lastErr: string | null = null;

    for (const model of MODEL_CANDIDATES) {
      try {
        const prompt = makeUserPrompt({ profile, routineSummary, trainingSummary, scope, facts, brief:false });
        try {
          const { parsed: p1 } = await callGeminiREST(model, apiKey, SYSTEM_PROMPT, prompt, 1200); // small bump
          parsed = p1; used = model; break;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes('MAX_TOKENS')) {
            const promptBrief = makeUserPrompt({ profile, routineSummary, trainingSummary, scope, facts, brief:true });
            const { parsed: p2 } = await callGeminiREST(model, apiKey, SYSTEM_PROMPT, promptBrief, 1400);
            parsed = p2; used = model; break;
          }
          const m = msg.toLowerCase();
          if (m.includes('404')||m.includes('unsupported')||m.includes('429')||m.includes('quota')||m.includes('rate')) {
            lastErr = msg; continue;
          }
          throw e;
        }
      } catch (e:any) {
        lastErr = String(e?.message || e);
        continue;
      }
    }

    if (!parsed) return NextResponse.json({ ok:false, engine:'none', error:`NO_MODEL_WORKED: ${lastErr}` }, { status:502 });

    const advice = normalizeAdviceUI(parsed, routineSummary);
    return NextResponse.json({ ok:true, engine:'gemini', modelUsed: used, advice });
  } catch (e:any) {
    return NextResponse.json({ ok:false, engine:'none', error:String(e?.message || e) }, { status:502 });
  }
}
