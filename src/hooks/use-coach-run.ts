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

export function useCoachRun({
  profile,
  routineSummary,
  trainingSummary,
  scope = { mode: 'global' },
  preload = false, // NEW
}: {
  profile: UserProfile | null;
  routineSummary: any;
  trainingSummary: any;
  scope?: CoachScope;
  preload?: boolean;
}) {
  const { user } = useAuth();
  const [isRunning, setRunning] = useState(false);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);

  const weekKey = format(new Date(), 'RRRR-ww');
  const scopeKey = scope.mode === 'day' ? `day-${scope.dayId}` : 'global';
  const docId = `${weekKey}-${scopeKey}`;

  const inputHash = useMemo(
    () => hashString(JSON.stringify({ profile, routineSummary, trainingSummary, scope })),
    [profile, routineSummary, trainingSummary, scope]
  );

  // NEW: preload cached advice when arriving on the page
  useEffect(() => {
    (async () => {
      if (!preload || !user || !profile) return;
      const uid = user.id;
      const ref = doc(collection(db, 'users', uid, 'coachAdvice'), docId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data: any = snap.data();
        if (data?.advice) {
          setAdvice(normalizeAdviceUI(data.advice) as CoachAdvice);
          setCreatedAt(data.createdAt ?? null);
        }
      }
    })();
  }, [preload, user, profile, docId]);

  const run = useCallback(async () => {
    if (!user || !profile) return;
    setRunning(true);
    const uid = user.id;
    const ref = doc(collection(db, 'users', uid, 'coachAdvice'), docId);

    // cache
    const cached = await getDoc(ref);
    if (cached.exists()) {
      const data: any = cached.data();
      if (data.inputHash === inputHash && data.advice) {
        setAdvice(normalizeAdviceUI(data.advice) as CoachAdvice);
        setCreatedAt(data.createdAt ?? null);
        setRunning(false);
        return;
      }
    }

    // run
    const res = await fetch('/api/coach/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, routineSummary, trainingSummary, scope }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Coach API error:', res.status, err?.error);
      setRunning(false);
      return;
    }

    const json = await res.json();
    if (json?.advice) {
      const now = Date.now();
      const normalized = normalizeAdviceUI(json.advice);
      setAdvice(normalized as CoachAdvice);
      setCreatedAt(now);
      await setDoc(ref, { inputHash, createdAt: now, advice: normalized }, { merge: true });
    }
    setRunning(false);
  }, [user, profile, inputHash, routineSummary, trainingSummary, scope, docId]);

  return { advice, run, isRunning, inputHash, weekKey, createdAt };
}
