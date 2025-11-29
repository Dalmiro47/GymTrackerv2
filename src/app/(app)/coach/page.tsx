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
  const handleRunCoach = React.useCallback(async () => {
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
  }, [isRunning, data, runCoach]);

  const normalized = React.useMemo(() => advice ? normalizeAdviceUI(advice, data.routineSummary, []) : null, [advice, data.routineSummary]);


  // Helper component for the control area
  const CoachControlArea = React.useMemo(() => {
    if (isRunning || data.isLoading) {
      // Priority 1: Loading/Running state
      return (
        <Button disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {isRunning ? 'Analyzing…' : 'Loading Data…'}
        </Button>
      );
    }
    
    // Scenario 1: No analysis done (no advice, but data loaded)
    if (loaded && !advice) {
      return (
        <Button onClick={handleRunCoach}>
          Run AI Coach
        </Button>
      );
    }

    // Scenario 2: Existing analysis is stale (new data detected)
    if (loaded && isStale) {
      return (
        <div className="flex items-center">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mr-4">
                New training logs or profile changes detected.
            </p>
            <Button onClick={handleRunCoach} variant="outline" className="text-yellow-700 hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-900/50">
                <Sparkles className="mr-2 h-4 w-4" />
                Re-analyze Now
            </Button>
        </div>
      );
    }

    // Scenario 3: Existing analysis is up-to-date
    if (loaded && !isStale && advice) {
      return (
        <div className="p-2 px-3 border border-green-500/50 bg-green-500/10 rounded-md">
            <p className="text-sm text-green-800 dark:text-green-200">
                Analysis is up to date.
            </p>
        </div>
      );
    }
    
    // Fallback (e.g., waiting for initial load)
    return null;

  }, [isRunning, data.isLoading, loaded, advice, isStale, handleRunCoach]);


  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            <Sparkles className="inline-block mr-2 h-5 w-5 text-yellow-500" />
            AI Coach
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Last analyzed: {lastAnalyzedAt ? lastAnalyzedAt.toLocaleString() : '—'}
          </p>
        </div>
        {/* Render the control area instead of separate buttons */}
        {CoachControlArea} 
      </div>
      
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Render Advice/Empty message based on state */}
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
          <p className="text-sm text-muted-foreground">
            {/* Display message if loaded but no advice exists (Scenario 1 state) */}
            Run the coach to generate your first report.
          </p>
        )
      )}
    </div>
  );
}