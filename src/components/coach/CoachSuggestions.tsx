'use client';
import React from 'react';
import type { CoachAdvice } from '@/lib/coach.schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CoachSuggestions({ advice }: { advice: CoachAdvice }) {
  return (
    <Card>
      <CardHeader><CardTitle>Priority suggestions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(advice.routineTweaks || []).map((t,i)=>(
          <div key={i} className="text-sm">
            <div className="font-medium">{t.change} — {t.where.day}{typeof t.where.slot==='number' ? ` (slot ${t.where.slot})` : ''}</div>
            <div>{t.details}</div>
            {t.setsReps && <div className="text-muted-foreground">Sets/Reps: {t.setsReps.sets} × {t.setsReps.repsRange}{t.setsReps.rir?` (RIR ${t.setsReps.rir})`:''}</div>}
            <div className="text-muted-foreground">{t.rationale}</div>
          </div>
        ))}
        {(!advice.routineTweaks || advice.routineTweaks.length === 0) && (
            (advice as any).priorities.map((p:string, i:number)=>(<p key={i}>{p}</p>))
        )}
      </CardContent>
    </Card>
  );
}
