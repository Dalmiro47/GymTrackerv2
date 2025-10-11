
import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((+date - +yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
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
      const r = await fetch('/api/coach/run', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, scope: { mode: 'global' as const } })
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);

      // --- Persist to Firestore ---
      const uid = getAuth().currentUser?.uid;
      if (uid) {
        const nowKey = isoWeekKey();
        const base = {
          advice: data.advice,
          engine: data.engine,
          modelUsed: data.modelUsed,
          createdAt: serverTimestamp(),
        };

        // latest
        await setDoc(doc(db, 'users', uid, 'coachAdvice', 'latest-global'), base, { merge: true });
        // weekly history (optional)
        await setDoc(doc(db, 'users', uid, 'coachAdvice', `${nowKey}-global`), base, { merge: true });
      }

      return data.advice; // already normalized on server
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { runCoach, loading, error };
}
