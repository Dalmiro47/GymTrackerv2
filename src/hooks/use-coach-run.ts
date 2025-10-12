import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

function hash(obj: any) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 0; for (let i = 0; i < json.length; i++) h = (h*31 + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function pickProfileForHash(p: any) {
  return {
    goal: p?.goal ?? null,
    daysPerWeekTarget: p?.daysPerWeekTarget ?? null,
    sessionTimeTargetMin: p?.sessionTimeTargetMin ?? null,
  };
}
function pickRoutineForHash(rs: any) {
  return {
    days: (rs?.days ?? []).map((d: any) => ({
      id: d?.id,
      exercises: (d?.exercises ?? []).map((e: any) => e?.muscleGroup ?? null),
    })),
  };
}

export function useCoachRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function runCoach(payload: {
    profile: any;
    routineSummary: any;
    trainingSummary: any;
    stamps?: { profileUpdatedAt:number; routinesUpdatedAt:number; logsUpdatedAt:number };
    scope?: { mode: 'global'|'day'; dayId?:string; dayName?:string };
  }) {
    setLoading(true); setError(null);
    try {
      const uid = getAuth().currentUser?.uid;

      // 🔑 The cache key now includes only relevant fields + realtime stamps
      const inputHash = hash({
        profile: pickProfileForHash(payload.profile),
        routine: pickRoutineForHash(payload.routineSummary),
        training: payload.trainingSummary,
        stamps: payload.stamps ?? null,
      });
      
      const latestChangedAt =
        Math.max(
          payload.stamps?.profileUpdatedAt ?? 0,
          payload.stamps?.routinesUpdatedAt ?? 0,
          payload.stamps?.logsUpdatedAt ?? 0,
        );

      // Fast-path reuse
      if (uid) {
        const latestRef = doc(db, 'users', uid, 'coachAdvice', 'latest-global');
        const snap = await getDoc(latestRef);
        const cached = snap.exists() ? snap.data() : null;

        const cachedAtMs = (cached?.createdAt as Timestamp)?.toMillis?.() ?? 0;
        const sameHash   = cached?.inputHash === inputHash;
        const freshEnough = cachedAtMs >= latestChangedAt;

        if (sameHash && freshEnough && cached?.advice) {
          return cached.advice;
        }
      }

      // API call
      const r = await fetch('/api/coach/run', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: payload.profile,
          routineSummary: payload.routineSummary,
          trainingSummary: payload.trainingSummary,
          scope: { mode: 'global' }
        })
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);

      if (uid) {
        const todayKey = new Date().toISOString().slice(0,10);
        const base: any = {
          advice: data.advice,
          engine: data.engine,
          modelUsed: data.modelUsed,
          inputHash,
          createdAt: serverTimestamp(),
        };
        if (Array.isArray(data.facts)) base.facts = data.facts;

        await setDoc(doc(db, 'users', uid, 'coachAdvice', 'latest-global'), base, { merge: true });
        await setDoc(doc(db, 'users', uid, 'coachAdvice', `${todayKey}-global`), base, { merge: true });
      }

      return data.advice;
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { runCoach, loading, error };
}
