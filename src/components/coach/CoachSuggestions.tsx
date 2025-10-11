
'use client';
import React from 'react';
import type { normalizeAdviceUI } from '@/lib/coachNormalize';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CoachSuggestions({ advice }: { advice: ReturnType<typeof normalizeAdviceUI> }) {
  const tweaks = advice.routineTweaks ?? [];
  const priorities = advice.prioritySuggestions ?? [];

  const suggestions = (tweaks.length > 0 ? tweaks : priorities);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader><CardTitle>Priority suggestions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((item: any, i: number) => (
          <div key={i} className="text-sm">
            {item.change ? ( // It's a 'tweak'
              <>
                <div className="font-medium">{item.change}{item.day?.name ? ` on ${item.day.name}` : ''}</div>
                <div>{item.details}</div>
                {item.setsReps && <div className="text-muted-foreground">Sets/Reps: {item.setsReps.sets} × {item.setsReps.repsRange}{item.setsReps.rir ? ` (RIR ${item.setsReps.rir})` : ''}</div>}
                <div className="text-muted-foreground">{item.rationale}</div>
              </>
            ) : ( // It's a 'priority'
              <>
                <div className="font-medium">{item.area}</div>
                <div>{item.advice}</div>
                <div className="text-muted-foreground">{item.rationale}</div>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
