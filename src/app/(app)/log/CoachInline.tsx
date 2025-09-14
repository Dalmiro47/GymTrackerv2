'use client';
import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { useCoachRun } from '@/hooks/use-coach-run';
import { useCoachData } from '@/hooks/use-coach-data';
import { useRouter } from 'next/navigation';

export function CoachInline({
  routineContext,
}: {
  routineContext?: { dayId: string; dayName?: string } | null;
}) {
  const router = useRouter();

  // No routine selected → route to global Coach
  if (!routineContext) {
    return (
      <Button variant="outline" size="sm" onClick={() => router.push('/coach')}>
        <Sparkles className="mr-2 h-4 w-4" />
        AI Coach
      </Button>
    );
  }

  // Day-scoped coach
  const data = useCoachData({ weeks: 6 });
  const scope = { mode: 'day' as const, dayId: routineContext.dayId, dayName: routineContext.dayName };
  const { advice, run, isRunning } = useCoachRun({
    profile: data.profile,
    routineSummary: data.routineSummary,
    trainingSummary: data.summary,
    scope,
  });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="mr-2 h-4 w-4" />
          Coach
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px]">
        <SheetHeader>
          <SheetTitle>
            Coach – top suggestions for {routineContext.dayName ?? 'this day'}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <Button disabled={isRunning || data.isLoading} onClick={() => run()} className="w-full">
            {isRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing…</> : 'Run coach'}
          </Button>
          {!advice && <p className="text-sm text-muted-foreground">Run the coach to see suggestions.</p>}
          {advice && (
            <div className="space-y-3 text-sm">
              <p>{advice.overview}</p>
              <ul className="list-disc ml-5 space-y-2">
                {advice.routineTweaks.slice(0, 3).map((t, i) => (
                  <li key={i}><b>{t.change}</b>: {t.details} <span className="text-muted-foreground">({t.rationale})</span></li>
                ))}
              </ul>
              {/* No "Open full report" here for day scope */}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
