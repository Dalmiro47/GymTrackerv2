
import { useState } from 'react';

export function useCoachRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function runCoach(payload: {
    profile: any;
    routineSummary: any;
    trainingSummary: any;
    scope?: { mode: 'global' | 'day'; dayId?: string; dayName?: string };
  }) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/coach/run', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, scope: { mode: 'global' as const } })
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      console.info('AI Coach:', { engine: data.engine, modelUsed: data.modelUsed });
      return data.advice;
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { runCoach, loading, error };
}
