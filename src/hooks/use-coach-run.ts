
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { hashString } from '@/lib/hash';
import type { CoachAdvice } from '@/lib/coach.schema';
import type { UserProfile } from '@/lib/types.gym';
import { normalizeAdviceUI } from '@/lib/coachNormalize';

export type CoachScope =
  | { mode: 'global' }
  | { mode: 'day'; dayId: string; dayName?: string };

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
      // FORCE API CALL (no cache short-circuit)
      const r = await fetch('/api/coach/run', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          // keep global scope to avoid drillback
          scope: { mode: 'global' as const }
        })
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      // Log which engine/model produced the output
      console.info('AI Coach response:', { engine: data.engine, modelUsed: data.modelUsed });
      return data.advice; // already normalized by server
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { runCoach, loading, error };
}
