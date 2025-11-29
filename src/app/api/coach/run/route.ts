

import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, makeUserPrompt, COACH_RESPONSE_SCHEMA } from '@/lib/ai/coachPrompt';
import { buildCoachFactsCompact } from '@/lib/analysis';
import { normalizeAdviceUI } from '@/lib/coachNormalize';
import { callGeminiOnce } from '@/lib/ai/gemini-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MODEL_CANDIDATES = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
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
  
// try candidates in order until one works
async function generateWithFallback(systemText: string, userText: string, config?: any) {
    let lastErr: any = null;
    for (const m of MODEL_CANDIDATES) {
      try {
        const json = await callGeminiOnce(m, systemText, userText, config);
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
    // Simplified for string array
    if (plan.some(item => typeof item !== 'string' || item.trim() === '')) {
        return 'SHAPE';
    }
    return null;
}


function compactFactsForRetry(facts:any[]) {
  const top = (facts ?? []).slice(0, 10);
  return top.map((f:any) => {
    const copy = { ...f };
    for (const k of Object.keys(copy)) {
      if (typeof copy[k] === 'string' && copy[k].length > 140) {
        copy[k] = copy[k].slice(0, 140);
      }
    }
    return copy;
  });
}

const BRIEF_REPAIR_HINT = `
Return a VERY COMPACT JSON. Keep strings under 140 characters.
For nextFourWeeks: array of 4 simple strings.
Only include required fields from the schema; omit any optional commentary.
`;

function looksLikeMaxTokens(apiJson:any) {
  try {
    const cand = apiJson?.candidates?.[0];
    const finish = cand?.finishReason || apiJson?.finishReason;
    const parts = cand?.content?.parts;
    return (finish === 'MAX_TOKENS') || !parts || parts.length === 0;
  } catch { return false; }
}

async function generateWithRetry(systemText: string, userText: string, config: { facts: any[], maxOutputTokens?: number }) {
    const { json: firstJson, modelUsed } = await generateWithFallback(systemText, userText, { ...config, response_schema: COACH_RESPONSE_SCHEMA });
  
    if (!looksLikeMaxTokens(firstJson)) {
      return { json: firstJson, modelUsed };
    }
  
    const compactedFacts = compactFactsForRetry(config.facts);
    const briefUserText = makeUserPrompt({
        facts: compactedFacts,
        brief: true,
        profile: {},
        routineSummary: {},
        trainingSummary: {},
        scope: { mode: 'global' },
      }) + '\n\n' + BRIEF_REPAIR_HINT;
  
    const repairJson = await callGeminiOnce(modelUsed, systemText, briefUserText, { ...config, response_schema: COACH_RESPONSE_SCHEMA });
    return { json: repairJson, modelUsed };
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

    const userPrompt = makeUserPrompt({ ...compact, scope, facts, brief: false });
    
    const aiConfig = {
        facts: facts,
        maxOutputTokens: 2048, 
    };
    
    const { json, modelUsed } = await generateWithRetry(SYSTEM_PROMPT, userPrompt, aiConfig);
    
    let p1 = extractJsonFromCandidates(json);
    
    let badNum = verifyNumbers(p1);
    if (badNum.length) {
        const repair = `REPAIR: These items lacked numeric rationale: ${badNum.join(', ')}. Include exact numbers from FACTS in each rationale.`;
        const promptBrief = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair;
        const p2Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief, aiConfig);
        p1 = extractJsonFromCandidates(p2Json);
    }

    const offenders = verifyPrescriptions(p1, factIdx);
    if (offenders.length) {
        const repair2 = `REPAIR: Fix prescription fields for ${offenders.join(', ')} so that:
- setsDelta is an integer; targetSets is 0..20
- If a v: fact is cited, targetSets = current(w) + setsDelta
- Text matches sign (add vs reduce).`;
        const promptBrief2 = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair2;
        const p3Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief2, aiConfig);
        p1 = extractJsonFromCandidates(p3Json);
    }

    const chronoErr = verifyChronology(p1.nextFourWeeks);
    if (chronoErr) {
        const repair3 = `REPAIR: Fix the 4-week plan (error: ${chronoErr}). Must be array of 4 simple strings.`;
        const promptBrief3 = makeUserPrompt({ ...compact, scope, facts, brief: true }) + '\n\n' + repair3;
        const p4Json = await callGeminiOnce(modelUsed, SYSTEM_PROMPT, promptBrief3, aiConfig);
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
