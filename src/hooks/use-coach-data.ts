'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { formatISO, subWeeks } from 'date-fns';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile } from '@/lib/types.gym';
import { summarizeLogs } from '@/lib/analysis';

export function useCoachData({ weeks = 6 }:{weeks?:number}) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [routines, setRoutines] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const uid = user.id;

      // profile (fixed id 'profile')
      const profRef = doc(db, 'users', uid, 'profile', 'profile');
      const profSnap = await getDoc(profRef);
      setProfile((profSnap.data() as UserProfile) ?? { goal: 'General Fitness' });

      // routines
      const rSnap = await getDocs(query(collection(db,'users',uid,'routines')));
      setRoutines(rSnap.docs.map(d=>({ id: d.id, ...d.data() })));

      // recent logs (order by documentId)
      const start = formatISO(subWeeks(new Date(), weeks), { representation:'date' });
      const logsSnap = await getDocs(
        query(collection(db,'users',uid,'workoutLogs'), orderBy(documentId(), 'desc'), limit(80))
      );
      const logData = logsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.id >= start);
      setLogs(logData);

      setLoading(false);
    })();
  }, [user, weeks]);

  const routineSummary = useMemo(() => ({
    days: routines.map((r:any)=>({
      id: r.id,
      name: r.name || r.id,
      exercises: (r.exercises||[]).map((e:any)=>({ name:e.name, muscleGroup:e.muscleGroup }))
    }))
  }), [routines]);

  const summary = useMemo(() => summarizeLogs(routines, logs as any[], weeks), [routines, logs, weeks]);

  return { isLoading, profile, routines, logs, routineSummary, summary };
}
