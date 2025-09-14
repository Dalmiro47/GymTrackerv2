'use client';
import React from 'react';
import Link from 'next/link';
import { useCoachData } from '@/hooks/use-coach-data';
import { useCoachRun } from '@/hooks/use-coach-run';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CoachSuggestions } from '@/components/coach/CoachSuggestions';

export default function CoachPage() {
  const data = useCoachData({ weeks: 8 });
  const { advice, run, isRunning, createdAt } = useCoachRun({
    profile: data.profile, routineSummary: data.routineSummary, trainingSummary: data.summary,
  });

  const lastAnalyzed = advice ? new Date(createdAt ?? 0) : null;

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Coach
          </h1>
          {lastAnalyzed && Number.isFinite(lastAnalyzed.getTime()) && lastAnalyzed.getFullYear() > 2000 && (
            <div className="text-xs text-muted-foreground mt-1">
              Last analyzed: {lastAnalyzed.toLocaleString()}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            Manage your profile in{' '}
            <Link href="/settings/profile" className="underline">
              Settings → Profile
            </Link>.
          </p>
        </div>
        <Button onClick={run} disabled={isRunning || data.isLoading}>
          {isRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing…</> : 'Run coach'}
        </Button>
      </div>

      {advice ? (
        <>
          <Card><CardHeader><CardTitle>Overview</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{advice.overview}</p></CardContent></Card>
          <CoachSuggestions advice={advice} />
          <Card><CardHeader><CardTitle>Next 4 weeks</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {advice.nextFourWeeks.map((w,i)=>(
              <div key={i} className="text-sm">
                <div className="font-medium">Week {w.week}: {w.focus}</div>
                <div className="text-muted-foreground">{w.notes}</div>
              </div>
            ))}
          </CardContent></Card>
        </>
      ) : (!isRunning && <p className="text-sm text-muted-foreground">Run the coach to generate your first report.</p>)}
    </div>
  );
}
