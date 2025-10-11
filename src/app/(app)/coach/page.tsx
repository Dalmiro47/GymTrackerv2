'use client';
import React from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useCoachData } from '@/hooks/use-coach-data';
import { useCoachRun } from '@/hooks/use-coach-run';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
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
  const { runCoach, loading: isRunning, error } = useCoachRun();

  const [advice, setAdvice] = React.useState<any | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = React.useState<Date | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) { setLoaded(true); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'coachAdvice', 'latest-global'));
        if (snap.exists()) {
          const saved = snap.data();
          if (saved?.advice) setAdvice(saved.advice);
          // Firestore Timestamp → Date (defensive)
          const ts: any = saved?.createdAt;
          if (ts?.toDate) setLastAnalyzedAt(ts.toDate());
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const handleRunCoach = async () => {
    const result = await runCoach({
      profile: data.profile,
      routineSummary: data.routineSummary,
      trainingSummary: data.summary,
    });
    if (result) {
      setAdvice(result);
      setLastAnalyzedAt(new Date()); // we just wrote it server-side, show now
    }
  };

  const normalized = advice ? normalizeAdviceUI(advice, data.routineSummary) : null;

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
        <Button onClick={handleRunCoach} disabled={isRunning || data.isLoading}>
          {isRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing…</> : 'Run coach'}
        </Button>
      </div>

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
                  <div key={i} className="text-sm">
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
