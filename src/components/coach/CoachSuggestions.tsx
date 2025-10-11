
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
      <CardContent className="space-y-4">
        {suggestions.map((item: any, i: number) => (
          <div key={i} className="text-sm border-b border-border/50 pb-3 last:border-b-0 last:pb-0">
            {item.change ? ( // It's a 'tweak'
              <div className="space-y-1">
                <div className="font-medium">{item.change}{item.day?.name ? ` on ${item.day.name}` : ''}</div>
                <div>{item.details}</div>
                <div className="text-xs text-muted-foreground">Rationale: {item.rationale}</div>
                {item.evidence?.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">Based on: {item.evidence.join('; ')}</div>
                )}
              </div>
            ) : ( // It's a 'priority'
              <div className="space-y-1">
                <div className="font-medium">
                  {item.area?.trim() ? item.area : 'Suggestion'}
                </div>
                <div>{item.advice}</div>
                {typeof item.setsDelta === 'number' && typeof item.targetSets === 'number' && (
                  <div className="text-xs text-muted-foreground">
                    Prescription: {item.setsDelta > 0 ? '+' : ''}{item.setsDelta} sets → target {item.targetSets}/wk
                  </div>
                )}
                <div className="text-xs text-muted-foreground">Rationale: {item.rationale}</div>
                {item.evidence?.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">Based on: {item.evidence.join('; ')}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
