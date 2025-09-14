'use client';
import React from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { useCoachRun } from '@/hooks/use-coach-run';
import { useCoachData } from '@/hooks/use-coach-data';

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
                                            
                                              // If no routine is selected, show disabled button + helper text (no sheet)
                                                if (!isDay) {
                                                    return (
                                                          <div className="flex items-center gap-3">
                                                                  <Button variant="outline" size="sm" disabled title="Select a routine day to get day-specific tips">
                                                                            <Sparkles className="mr-2 h-4 w-4" />
                                                                                      Coach
                                                                                              </Button>
                                                                                                      <p className="text-xs sm:text-sm text-muted-foreground">
                                                                                                                Select a routine to get day-specific tips, or open{' '}
                                                                                                                          <Link href="/coach" className="underline">AI Coach</Link> for full-plan guidance.
                                                                                                                                  </p>
                                                                                                                                        </div>
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