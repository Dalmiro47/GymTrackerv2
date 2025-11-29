
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

// Set a minimum delay between successful runs (in milliseconds)
const RUN_COACH_DELAY_MS = 30000; // 30 seconds

// New function to calculate cache status and retrieve advice
async function getCoachCacheStatus(payload: {
    profile: any;
    routineSummary: any;
    trainingSummary: any;
    stamps?: { profileUpdatedAt:number; routinesUpdatedAt:number; logsUpdatedAt:number };
}) {
    const auth = getAuth();
    const uid = auth.currentUser?.uid;
    if (!uid) return { mustRun: false, cachedAdvice: null, cachedAdviceAt: null, inputHash: '' };

    // 1. Creates a unique hash of all current data + timestamps.
    const inputHash = hash({
      profile: pickProfileForHash(payload.profile),
      routine: pickRoutineForHash(payload.routineSummary),
      training: payload.trainingSummary,
      stamps: payload.stamps ?? null,
    });

    // 2. Calculates the most recent time ANY of the data changed.
    const latestChangedAt = Math.max(
      payload.stamps?.profileUpdatedAt ?? 0,
      payload.stamps?.routinesUpdatedAt ?? 0,
      payload.stamps?.logsUpdatedAt ?? 0,
    );

    // 3. Checks for a cached result.
    const latestRef = doc(db, 'users', uid, 'coachAdvice', 'latest-global');
    const snap = await getDoc(latestRef);
    const cached = snap.exists() ? snap.data() : null;

    const cachedAtMs = (cached?.createdAt as Timestamp)?.toMillis?.() ?? 0;
    const sameHash = cached?.inputHash === inputHash;
    const freshEnough = cachedAtMs >= latestChangedAt;
    
    // The coach MUST run if the hash is different OR the cache is not fresh.
    const mustRun = !sameHash || !freshEnough;

    return { 
      mustRun,
      cachedAdvice: cached?.advice || null,
      cachedAdviceAt: cachedAtMs > 0 ? new Date(cachedAtMs) : null,
      inputHash,
    };
}


export function useCoachRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Expose the status check function
  async function checkCacheStatus(payload: Parameters<typeof runCoach>[0]) {
    return getCoachCacheStatus(payload);
  }

  async function runCoach(payload: {
    profile: any;
    routineSummary: any;
    trainingSummary: any;
    stamps?: { profileUpdatedAt:number; routinesUpdatedAt:number; logsUpdatedAt:number };
    scope?: { mode: 'global'|'...' };
  }) {
    setLoading(true);
    setError(null);
    const auth = getAuth();
    const uid = auth.currentUser?.uid;

    if (!uid) {
      setLoading(false);
      setError('User not authenticated.');
      return;
    }

    try {
      // Check for a recent run to enforce a client-side rate limit
      const lastRunKey = `coach-last-run-${uid}`;
      const lastRunTime = localStorage.getItem(lastRunKey);
      const now = Date.now();
      
      if (lastRunTime && now - parseInt(lastRunTime, 10) < RUN_COACH_DELAY_MS) {
        const remaining = Math.ceil((RUN_COACH_DELAY_MS - (now - parseInt(lastRunTime, 10))) / 1000);
        throw new Error(`Please wait ${remaining} seconds before running the coach again.`);
      }

      // 1. Check cache status using the new unified function
      const { mustRun, cachedAdvice, inputHash } = await getCoachCacheStatus(payload);

      // 2. Fast-path: return cache if fresh (Note: mustRun is the inverse of the original logic)
      if (!mustRun && cachedAdvice) {
        // Update last run time in local storage on success (cache hit counts as success)
        localStorage.setItem(lastRunKey, now.toString());
        setLoading(false);
        return cachedAdvice; // ✅ CACHE HIT
      }
      
      let adviceToReturn = null;

      // 3. If cache is stale or missing, call the backend API.
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
      
      adviceToReturn = data.advice;

      // 4. Save the new result and hash for next time.
      const latestRef = doc(db, 'users', uid, 'coachAdvice', 'latest-global');
      const todayKey = new Date().toISOString().slice(0,10);
      const base: any = {
        advice: data.advice,
        engine: data.engine,
        modelUsed: data.modelUsed,
        inputHash,
        createdAt: serverTimestamp(),
      };
      if (Array.isArray(data.facts)) base.facts = data.facts;

      await setDoc(latestRef, base, { merge: true });
      await setDoc(doc(db, 'users', uid, 'coachAdvice', `${todayKey}-global`), base, { merge: true });
      
      // Update last run time in local storage on success
      localStorage.setItem(lastRunKey, now.toString());
      return adviceToReturn;
      
    } catch (e: any) {
      setError(e.message || 'An unknown error occurred during coach analysis.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Expose the new function for UI status checks
  return { runCoach, checkCacheStatus, loading, error };
}
