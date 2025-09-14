'use client';
import { useCallback, useMemo, useState } from 'react';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { hashString } from '@/lib/hash';
import type { CoachAdvice } from '@/lib/coach.schema';
import type { UserProfile } from '@/lib/types.gym';

export function useCoachRun({ profile, routineSummary, trainingSummary }:{
  profile: UserProfile | null, routineSummary:any, trainingSummary:any
}) {
  const { user } = useAuth();
  const [isRunning, setRunning] = useState(false);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const weekKey = format(new Date(), 'RRRR-ww');
  const inputHash = useMemo(() => hashString(JSON.stringify({ profile, routineSummary, trainingSummary })), [profile, routineSummary, trainingSummary]);

  const run = useCallback(async () => {
    if (!user || !profile) return;
    setRunning(true);
    const uid = user.id;
    const ref = doc(collection(db, 'users', uid, 'coachAdvice'), weekKey);
    const cached = await getDoc(ref);
    if (cached.exists()) {
      const data:any = cached.data();
      if (data.inputHash === inputHash && data.advice) {
        setAdvice(data.advice as CoachAdvice);
        setRunning(false);
        return;
      }
    }
    const res = await fetch('/api/coach/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, routineSummary, trainingSummary }),
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Coach API error:', res.status, err?.error);
      setRunning(false);
      return; 
    }

    const json = await res.json();
    if (json?.advice) {
      setAdvice(json.advice as CoachAdvice);
      await setDoc(ref, { inputHash, createdAt: Date.now(), advice: json.advice }, { merge: true });
    }
    setRunning(false);
  }, [user, profile, inputHash, routineSummary, trainingSummary, weekKey]);

  return { advice, run, isRunning, inputHash, weekKey };
}
