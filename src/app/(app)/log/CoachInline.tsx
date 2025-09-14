'use client';
import React from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { useCoachRun } from '@/hooks/use-coach-run';
import { useCoachData } from '@/hooks/use-coach-data';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function CoachInline({
  routineContext,
}: {
  routineContext?: { dayId: string; dayName?: string } | null;
}) {
  // Always call hooks in the same order to satisfy React rules:
  const data = useCoachData({ weeks: 6 });
  const isDay = Boolean(routineContext?.dayId);
  const scope = isDay
    ? ({ mode: 'day', dayId: routineContext!.dayId, dayName: routineContext!.dayName } as const)
    : ({ mode: 'global' } as const);

  const { advice, run, isRunning } = useCoachRun({
    profile: data.profile,
    routineSummary: data.routineSummary,
    trainingSummary: data.summary,
    scope,
    preload: false, // don't auto-load in the log sidebar
  });

  // If no routine is selected, show disabled button + tooltip hint
  if (!isDay) {
    return (
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* wrap disabled button so hover/focus can trigger tooltip */}
            <span
              className="inline-flex"
              tabIndex={0}
              role="button"
              aria-disabled="true"
            >
              <Button variant="outline" size="sm" disabled>
                <Sparkles className="mr-2 h-4 w-4" />
                Coach
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            <p>
              Select a routine to get day-specific tips, or open{" "}
              <Link href="/coach" className="underline font-medium">
                AI Coach
              </Link>{" "}
              for full-plan guidance.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }


  // Day-scoped sheet
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
            Coach – top suggestions for {routineContext?.dayName ?? 'this day'}
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
              {/* No "Open full report" in day scope */}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
