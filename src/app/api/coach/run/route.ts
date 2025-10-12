
import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt, COACH_RESPONSE_SCHEMA } from '@/lib/ai/coachPrompt';
import { buildCoachFactsCompact } from '@/lib/analysis';
import { normalizeAdviceUI } from '@/lib/coachNormalize';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
] as const;

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

const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
};
  
// helper: one request to a specific model
async function callGeminiOnce(model: string, systemText: string, userText: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY}`;
    
    const body = {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          ...generationConfig,
          response_schema: COACH_RESPONSE_SCHEMA,
        }
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  
    if (r.status === 404) {
      // model not found for this API version → signal the caller to try next model
      const err = new Error('MODEL_404');
      (err as any).code = 404;
      throw err;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP_${r.status}: ${body}`);
    }
    return r.json();
}
  
// try candidates in order until one works
async function generateWithFallback(systemText: string, userText: string) {
    let lastErr: any = null;
    for (const m of MODEL_CANDIDATES) {
      try {
        const json = await callGeminiOnce(m, systemText, userText);
        return { json, modelUsed: m };
      } catch (e: any) {
        lastErr = e;
        // 404 → try next candidate
        if (e?.code === 404) continue;
        // 429/403 quota → also try next
        if (String(e.message || '').startsWith('HTTP_429') || String(e.message || '').startsWith('HTTP_403')) continue;
        // other error → stop early to avoid burning through all models
        break;
      }
    }
    throw new Error(`NO_MODEL_WORKED: ${lastErr?.message || lastErr}`);
}


function lacksNumbers(s?: string) { return !/\d/.test(String(s ?? '')); }

// Build a facts index and human labels (for UI evidence)
function indexFacts(facts: any[] = []) {
  const idx: Record<string, any> = {};
  for (const f of facts) {
    idx[f.id] = {
      ...f,
      label:
        f.t === 'v' ? `${mgName(f.g)} last week = ${f.w} sets` :
        f.t === 'i' ? `${mgName(f.hi)} vs ${mgName(f.lo)} diff = ${f.d} sets` :
        f.t === 's' ? `Stall: ${f.n} (${f.w} wk, slope ${f.sl})` :
        f.t === 'a' ? `Adherence: ${f.w} weeks logged (target ${f.targ}/wk)` :
        f.id
    };
  }
  return idx;
}

function mgName(code: string) {
  const map: Record<string,string> = { CH:'Chest', BK:'Back', SH:'Shoulders', LE:'Legs', BI:'Biceps', TR:'Triceps', AB:'Abs' };
  return map[code] ?? code;
}

// Prefer gaps/low-volume strongly over plain adherence
function scoreFromFactIds(factIds: string[] = [], idx: Record<string, any>) {
  let score = 0;
  let hasIv = false;
  for (const id of factIds) {
    const f = idx[id];
    if (!f) continue;
    if (f.t === 'i') { score = Math.max(score, Number(f.d || 0)); hasIv = true; }
    else if (f.t === 'v') { score = Math.max(score, Math.max(0, 20 - (f.w || 0))); hasIv = true; }
    else if (f.t === 's') { score = Math.max(score, 5 + Math.min(5, Math.abs(f.sl || 0))); }
    else if (f.t === 'a') { score = Math.max(score, 1); }
  }
  // Ensure any item with i/v outranks pure adherence
  return hasIv ? score + 100 : score;
}

// De-dupe using a more stable key (area + trimmed advice), allow top 4
function rankAndDedupe(list: any[] = [], idx: Record<string, any>, keyer: (i:any)=>string) {
  const seen = new Set<string>();
  return list
    .map((i) => ({ ...i, _score: scoreFromFactIds(i.factIds, idx) }))
    .sort((a,b) => b._score - a._score)
    .filter((i) => {
      const k = keyer(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4) // was 3
    .map(({ _score, ...i }) => i);
}

// Guardrails: numbers present + prescriptions make sense
function verifyNumbers(advice: any) {
  const bad: string[] = [];
  for (const [k, arr] of Object.entries({
    prioritySuggestions: advice?.prioritySuggestions ?? [],
    routineTweaks: advice?.routineTweaks ?? []
  })) {
    (arr as any[]).forEach((it, i) => {
      if (lacksNumbers(it?.rationale)) bad.push(`${k}[${i}]`);
    });
  }
  return bad;
}

function verifyPrescriptions(advice: any, idx: Record<string, any>) {
  const offenders: string[] = [];
  const check = (arr: any[], path: string) => {
    arr.forEach((it, i) => {
      const delta = Number(it?.setsDelta);
      const target = Number(it?.targetSets);
      if (!Number.isFinite(delta) || !Number.isFinite(target) || target < 0 || target > 20) {
        offenders.push(`${path}[${i}]:bad-numbers`); return;
      }
      // get a current volume if any v: fact is cited
      const v = (it.factIds || []).map((id: string) => idx[id]).find((f: any) => f?.t === 'v');
      const current = Number(v?.w);
      if (Number.isFinite(current)) {
        if (current + delta !== target) offenders.push(`${path}[${i}]:mismatch`);
      }
      // crude sign check against text
      const txt = String(it?.advice || '').toLowerCase();
      if (delta > 0 && txt.includes('reduce')) offenders.push(`${path}[${i}]:sign`);
      if (delta < 0 && txt.includes('add')) offenders.push(`${path}[${i}]:sign`);
    });
  };
  check(advice?.prioritySuggestions ?? [], 'prioritySuggestions');
  check(advice?.routineTweaks ?? [], 'routineTweaks');
  return offenders;
}

function verifyChronology(plan: any[]) {
  if (!Array.isArray(plan) || plan.length !== 4) return 'LEN';
  for (let i=0;i<4;i++){
    const w = plan[i];
    if (w.week !== i+1) return 'WEEK_INDEX';
    if (!w.theme || !Array.isArray(w.actions) || w.actions.length === 0) return 'SHAPE';
    for (const a of w.actions) {
      if (!a.muscleGroup) return 'NO_GROUP';
      if (a.setsDelta == null && a.targetSets == null && a.loadDeltaPct == null) return 'NO_METRIC';
    }
  }
  return null;
}

export async function POST(req: Request) {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return NextResponse.json({ ok:false, engine:'none', error:'MISSING_API_KEY' }, { status:500 });

  try {
    const { profile, routineSummary, trainingSummary } = await req.json();
    const scope = { mode: 'global' as const };
    
    const compact = compactPayload(profile, routineSummary, trainingSummary);
    const { facts } = buildCoachFactsCompact(profile, routineSummary, compact.trainingSummary);
    const factIdx = indexFacts(facts);

    const { json, modelUsed } = await generateWithFallback(SYSTEM_PROMPT, makeUserPrompt({ ...compact, scope, facts, brief: false }));
    let p1 = extractJsonFromCandidates(json);
    
    let badNum = verifyNumbers(p1);
    if (badNum.length) {
        const repair = `REPAIR: These items lacked numeric rationale: ${badNum.join(', ')}. Include exact numbers from FACTS in each rationale.`;
        const promptBrief = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair;
        const p2Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief);
        p1 = extractJsonFromCandidates(p2Json);
    }

    const offenders = verifyPrescriptions(p1, factIdx);
    if (offenders.length) {
        const repair2 = `REPAIR: Fix prescription fields for ${offenders.join(', ')} so that:
- setsDelta is an integer; targetSets is 0..20
- If a v: fact is cited, targetSets = current(w) + setsDelta
- Text matches sign (add vs reduce).`;
        const promptBrief2 = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair2;
        const p3Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief2);
        p1 = extractJsonFromCandidates(p3Json);
    }

    const chronoErr = verifyChronology(p1.nextFourWeeks);
    if (chronoErr) {
        const repair3 = `REPAIR: Fix the 4-week plan (error: ${chronoErr}). Weeks must be 1..4, each with 1–3 actions containing either setsDelta, targetSets, or loadDeltaPct.`;
        const promptBrief3 = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair3;
        const p4Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief3);
        p1 = extractJsonFromCandidates(p4Json);
    }

    const parsed = p1;

    parsed.prioritySuggestions = rankAndDedupe(
      parsed.prioritySuggestions,
      factIdx,
      (i) => (i.area || '').toLowerCase()
    );

    parsed.routineTweaks = rankAndDedupe(
      parsed.routineTweaks,
      factIdx,
      (i) => `${(i.dayId || '')}|${(i.change || '').toLowerCase()}|${String(i.details || '').toLowerCase().slice(0,40)}`
    );

    const validDayIds = new Set((routineSummary?.days ?? []).map((d:any)=>String(d.id)));
    parsed.routineTweaks = (parsed.routineTweaks ?? []).filter((t:any) =>
      !t?.dayId || validDayIds.has(String(t.dayId))
    );

    const advice = normalizeAdviceUI(parsed, routineSummary, facts);
    return NextResponse.json({
      ok: true,
      engine: 'gemini',
      modelUsed: modelUsed,
      advice,
      facts: Array.isArray(facts) ? facts : [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, engine: 'none', error: String(e?.message || e) }, { status: 502 });
  }
}

    