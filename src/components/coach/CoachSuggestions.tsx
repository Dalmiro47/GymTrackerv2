'use client';
import React from 'react';
import type { CoachAdviceUI } from '@/lib/coachNormalize';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CoachSuggestions({ advice }: { advice: CoachAdviceUI }) {
  const tweaks = advice.routineTweaks ?? [];
  const priorities = advice.priorities ?? [];

  return (
    <Card>
      <CardHeader><CardTitle>Priority suggestions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {tweaks.length > 0 ? (
          tweaks.map((t: any, i: number) => (
            <div key={i} className="text-sm">
              <div className="font-medium">{t.change} — {t.where.day}{typeof t.where.slot === 'number' ? ` (slot ${t.where.slot})` : ''}</div>
              <div>{t.details}</div>
              {t.setsReps && <div className="text-muted-foreground">Sets/Reps: {t.setsReps.sets} × {t.setsReps.repsRange}{t.setsReps.rir ? ` (RIR ${t.setsReps.rir})` : ''}</div>}
              <div className="text-muted-foreground">{t.rationale}</div>
            </div>
          ))
        ) : (
          priorities.map((p: string, i: number) => (<p key={i} className="text-sm">{p}</p>))
        )}
      </CardContent>
    </Card>
  );
}
