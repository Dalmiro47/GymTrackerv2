
'use client';
import React from 'react';
import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';
import { useCoachData } from '@/hooks/use-coach-data';
import { useCoachRun } from '@/hooks/use-coach-run';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CoachSuggestions } from '@/components/coach/CoachSuggestions';
import { normalizeAdviceUI } from '@/lib/coachNormalize';


function withWeekLabel(text: string, i: number) {
  if (!text) return '';
  // if the string already starts with "Week 1:", "week1:", etc., keep it as-is
  const alreadyLabeled = /^\s*week\s*\d+\s*:?/i.test(text);
  return alreadyLabeled ? text : `Week ${i + 1}: ${text}`;
}

export default function CoachPage() {
  const data = useCoachData({ weeks: 6 });
  // Destructure the new checkCacheStatus function
  const { runCoach, checkCacheStatus, loading: isRunning, error } = useCoachRun();

  const [advice, setAdvice] = React.useState<any | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = React.useState<Date | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  
  // New state to track if the data is newer than the cache
  const [isStale, setIsStale] = React.useState(false);


  // Effect to load initial advice and check staleness
  React.useEffect(() => {
    // Check status whenever data stamps update
    if (data.stamps) {
        checkCacheStatus({
            profile: data.profile,
            routineSummary: data.routineSummary,
            trainingSummary: data.summary,
            stamps: data.stamps,
        }).then(({ mustRun, cachedAdvice, cachedAdviceAt }) => {
            // 1. Set the initial advice and analysis time from cache if available
            if (!loaded && cachedAdvice) {
                setAdvice(cachedAdvice);
                setLastAnalyzedAt(cachedAdviceAt);
                setLoaded(true);
            }
            // 2. Set the staleness state
            setIsStale(mustRun);
            
            // If the user hasn't run it yet, but we have data, mark as loaded
            if (!loaded && !cachedAdvice && !data.isLoading) {
                 setLoaded(true);
            }
        });
    }
  }, [data.stamps, data.isLoading, loaded, checkCacheStatus, data.profile, data.routineSummary, data.summary]);


  // Handler function: removed the 500ms delay as the stale check is now explicit
  const handleRunCoach = async () => {
    if (isRunning || data.isLoading) return;
    
    // Pass the current data state directly
    const { profile, routineSummary, summary, stamps } = data;

    try {
        const result = await runCoach({
          profile: profile,
          routineSummary: routineSummary,
          trainingSummary: summary,
          stamps: stamps,
        });
        if (result) {
          setAdvice(result);
          setLastAnalyzedAt(new Date());
          setIsStale(false); // Analysis is now fresh
        }
    } catch (e: any) {
        // Error handling is inside useCoachRun, but good practice to catch here too
    }
  };

  const normalized = React.useMemo(() => advice ? normalizeAdviceUI(advice, data.routineSummary, []) : null, [advice, data.routineSummary]);


  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Coach
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Manage your profile in <Link href="/profile" className="underline">Profile</Link>.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Last analyzed: {lastAnalyzedAt ? lastAnalyzedAt.toLocaleString() : '—'}
          </p>
        </div>
        {/* Main Run Button - Hidden if stale data is detected */}
        {(!isStale || !loaded) && (
            <Button onClick={handleRunCoach} disabled={isRunning || data.isLoading}>
                {isRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing…</> : 'Run coach'}
            </Button>
        )}
      </div>

      {/* New Re-analyze Link (Visible when stale) */}
      {loaded && isStale && (
          <div className="flex items-center justify-between p-3 border border-yellow-500/50 bg-yellow-500/10 rounded-lg">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  New workout logs or profile changes detected.
              </p>
              <Button onClick={handleRunCoach} disabled={isRunning || data.isLoading} variant="outline" className="text-yellow-700 hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-900/50">
                  {isRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Re-analyzing…</> : 'Re-analyze now'}
              </Button>
          </div>
      )}


      {error && <p className="text-sm text-destructive">{error}</p>}

      {normalized && normalized.overview ? (
        <>
          <Card>
            <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
            <CardContent><p className="text-sm">{normalized.overview}</p></CardContent>
          </Card>

          <CoachSuggestions advice={normalized} />

          {normalized.nextFourWeeks?.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Next 4 weeks</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {normalized.nextFourWeeks.slice(0, 4).map((line: string, i: number) => (
                  <div key={i} className="text-sm" aria-label={`Week ${i + 1} plan`}>
                    {withWeekLabel(line, i)}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        !isRunning && loaded && (
          <p className="text-sm text-muted-foreground">Run the coach to generate your first report.</p>
        )
      )}
    </div>
  );
}
