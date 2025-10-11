
import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// tiny stable hash
function hash(obj: any) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 0; for (let i = 0; i < json.length; i++) h = (h*31 + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

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
      const uid = getAuth().currentUser?.uid;
      const inputHash = hash({ profile: payload.profile, routineSummary: payload.routineSummary, trainingSummary: payload.trainingSummary });

      // 1) Fast-path: reuse latest if same input
      if (uid) {
        const latestRef = doc(db, 'users', uid, 'coachAdvice', 'latest-global');
        const snap = await getDoc(latestRef);
        const cached = snap.exists() ? snap.data() : null;
        if (cached?.inputHash === inputHash && cached?.advice) {
          return cached.advice; // instant
        }
      }

      // 2) Otherwise call API (compact payload already used on the server)
      const r = await fetch('/api/coach/run', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: payload.profile, routineSummary: payload.routineSummary, trainingSummary: payload.trainingSummary, scope: { mode: 'global' } })
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);

      // 3) Save result (+ inputHash) for next instant run
      if (uid) {
        const nowKey = new Date().toISOString().slice(0,10); // or your week key
        const base: any = {
          advice: data.advice,
          engine: data.engine,
          modelUsed: data.modelUsed,
          inputHash,
          createdAt: serverTimestamp(),
        };

        if (Array.isArray(data.facts)) {
            base.facts = data.facts;
        }

        await setDoc(doc(db, 'users', uid, 'coachAdvice', 'latest-global'), base, { merge: true });
        await setDoc(doc(db, 'users', uid, 'coachAdvice', `${nowKey}-global`), base, { merge: true });
      }

      return data.advice;
    } catch (e:any) {
      setError(e.message ?? 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { runCoach, loading, error };
}
