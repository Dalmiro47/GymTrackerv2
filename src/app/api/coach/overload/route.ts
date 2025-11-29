import { NextResponse } from 'next/server';
import { SYSTEM_PROMPT, OVERLOAD_ADVICE_SCHEMA } from '@/lib/ai/overloadPrompt'; 
import { callGeminiOnce } from '@/lib/ai/gemini-utils';
import type { WorkoutLog, LoggedSet } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helper to convert the Gemini response string into JSON
function tryParseJSON(s: string) { 
    try { 
        // Remove code fences if the model erroneously includes them
        const t = s.trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
        return JSON.parse(t); 
    } catch { 
        return null; 
    } 
}

function extractJsonFromCandidates(data: any) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;

  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (typeof p?.text === 'string' && p.text.trim()) {
        const parsed = tryParseJSON(p.text);
        if (parsed) return parsed;
      }
    }
  }
  throw new Error(`EMPTY_RESPONSE_PARTS: ${JSON.stringify(data).slice(0, 500)}`);
}

// POST handler for the API route
export async function POST(req: Request) {
    try {
        const { 
            exerciseId, 
            exerciseName,
            currentSets, 
            history,
            targetRange
        }: { 
            exerciseId: string;
            exerciseName: string; 
            currentSets: LoggedSet[]; 
            history: WorkoutLog[];
            targetRange?: string;
        } = await req.json();

        if (!exerciseId || !exerciseName || !currentSets || !history) {
            return NextResponse.json({ 
                ok: false, 
                error: 'Missing required payload fields.' 
            }, { status: 400 });
        }

        // 1. Prepare the Data Payload for the AI
        const inputData = {
            exerciseName: exerciseName,
            targetRepRange: targetRange ? targetRange : "Default (8-12)",
            currentLogSets: currentSets.map((s, i) => 
                `Set ${i + 1}: ${s.weight ?? 0}kg x ${s.reps ?? 0} reps`
            ).join('\n'),
            historicalLogs: history.map((log, index) => {
                const ex = log.exercises.find(e => e.exerciseId === exerciseId);
                if (!ex) return `Log #${index + 1} (Date: ${log.date}): Exercise not found.`;
                
                const setSummary = ex.sets.map(s => 
                    `${s.weight ?? 0}kg x ${s.reps ?? 0} reps`
                ).join(' | ');

                return `Log #${index + 1} (Date: ${log.date})\nSets: ${setSummary}`;
            }).join('\n\n')
        };


        // 2. Construct the final prompt
        const userPrompt = `
        EXERCISE NAME: ${inputData.exerciseName}
        TARGET REP RANGE: ${inputData.targetRepRange}
        
        CURRENT SETS (In Progress):
        ${inputData.currentLogSets}

        RECENT HISTORY (Last ${history.length} Logs):
        ${inputData.historicalLogs}

        Based on the current sets, history, and the TARGET REP RANGE, provide a progressive overload recommendation.
        `;

        // 3. Call the Gemini API
        const aiConfig = {
            response_schema: OVERLOAD_ADVICE_SCHEMA,
            maxOutputTokens: 512,
        };

        const model = 'gemini-2.5-flash-lite';
        const aiResponse = await callGeminiOnce(model, SYSTEM_PROMPT, userPrompt, aiConfig);
        
        const parsed = extractJsonFromCandidates(aiResponse);

        if (!parsed || !parsed.advice) {
             console.error("AI returned unparseable or empty response:", aiResponse);
             return NextResponse.json({ 
                ok: false, 
                error: 'AI failed to generate valid advice.' 
            }, { status: 500 });
        }

        return NextResponse.json({ 
            ok: true, 
            advice: parsed.advice,
            rationale: parsed.rationale,
            action: parsed.action
        });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ 
            ok: false, 
            error: error.message || 'Internal server error.' 
        }, { status: 500 });
    }
}
