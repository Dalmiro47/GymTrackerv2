'use client';
import { useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import {
  collection, doc, onSnapshot, query, where, orderBy, limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { summarizeLogs } from '@/lib/analysis';
import type { UserProfile } from '@/lib/types.gym';
import { useAuth } from '@/contexts/AuthContext';


type CoachData = {
  isLoading: boolean;
  profile: any;
  routineSummary: any;
  summary: any;               // your existing weekly summary object
  stamps: {
    profileUpdatedAt: number;
    routinesUpdatedAt: number;
    logsUpdatedAt: number;
  };
};

// This is a placeholder for your actual implementation
function buildWeeklySummaryFromLogs(logs: any[]): any {
    // In a real scenario, you'd call your comprehensive summary function
    // For now, we'll just pass a shape the hook expects.
    return summarizeLogs([], logs);
}


export function useCoachData(opts: { weeks: number }): CoachData {
  const [isLoading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [routines, setRoutines] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const { user } = useAuth();


  // realtime subscribe
  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }

    const unsubs: Array<() => void> = [];
    const uid = user.id;

    // Profile
    unsubs.push(onSnapshot(doc(db, 'users', uid, 'profile', 'profile'), (snap) => {
      setProfile(snap.exists() ? { ...snap.data(), id: snap.id } : { goal: 'General Fitness' });
    }));

    // Routines
    unsubs.push(onSnapshot(collection(db, 'users', uid, 'routines'), (qs) => {
      setRoutines(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    }));

    // Recent logs window
    const startIso = new Date(Date.now() - opts.weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const logsQ = query(
      collection(db, 'users', uid, 'workoutLogs'),
      where('date', '>=', startIso),
      orderBy('date', 'desc'),
      limit(800) // safety
    );
    unsubs.push(onSnapshot(logsQ, (qs) => {
      setLogs(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }));

    return () => unsubs.forEach((u) => u());
  }, [user?.id, opts.weeks]);

  // your existing summary builders here (volume per MG, stalls, etc.)
  const routineSummary = useMemo(() => {
    // build compact routine summary from `routines`
    // keep only ids, names, and muscle groups (you already do this)
    return {
      days: (routines ?? []).map((r: any) => ({
        id: r?.id,
        name: r?.name,
        exercises: (r?.exercises ?? []).map((e: any) => ({ muscleGroup: e?.muscleGroup })),
      })),
    };
  }, [routines]);

  const trainingSummary = useMemo(() => {
    // build your weekly summary from `logs`
    return buildWeeklySummaryFromLogs(logs); // pseudo; call your real function
  }, [logs]);

  // robust change stamps for hashing (fallback to 0)
  const stamps = useMemo(() => {
    const p = (profile?.updatedAt as Timestamp)?.toMillis?.() ?? (profile?.createdAt as Timestamp)?.toMillis?.() ?? 0;
    const r = Math.max(0, ...routines.map((x: any) =>
      (x.updatedAt as Timestamp)?.toMillis?.() ?? (x.createdAt as Timestamp)?.toMillis?.() ?? 0
    ));
    const l = Math.max(0, ...logs.map((x: any) =>
      (x.updatedAt as Timestamp)?.toMillis?.() ?? (x.createdAt as Timestamp)?.toMillis?.() ?? 0
    ));
    return { profileUpdatedAt: p, routinesUpdatedAt: r, logsUpdatedAt: l };
  }, [profile, routines, logs]);

  return { isLoading, profile, routineSummary, summary: trainingSummary, stamps };
}
