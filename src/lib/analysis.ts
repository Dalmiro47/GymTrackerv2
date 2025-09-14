import { parseISO, startOfISOWeek, formatISO } from 'date-fns';

type SetLike = { reps: number; weight: number };
type LogExercise = { name: string; muscleGroup?: string; sets: SetLike[] };
type WorkoutLog = { id: string; date?: string; exercises: LogExercise[] };

export interface WeeklyVolume {
  week: string; muscleGroup: string; hardSets: number; estTonnage: number;
}
export interface LiftTrend {
  name: string; last3: { date: string; topSetWeight: number; reps: number }[]; stalled: boolean;
}

export function estimate1RM(weight:number, reps:number){
  return reps > 1 ? weight * (1 + reps / 30) : weight;
}

export function summarizeLogs(routines:any[], logs:WorkoutLog[], weeks=8) {
  const weekly: WeeklyVolume[] = [];
  const byWeek: Record<string, Record<string,{hardSets:number; tonnage:number}>> = {};

  const lastLogs = logs.map(l => ({ ...l, date: l.date ?? l.id }));

  for (const log of lastLogs) {
    const wk = formatISO(startOfISOWeek(parseISO(log.date!)), { representation: 'date' });
    for (const ex of log.exercises ?? []) {
      const mg = ex.muscleGroup || 'Unknown';
      const hardSets = (ex.sets || []).filter(s => s.reps >= 5 && s.reps <= 30).length;
      const tonnage = (ex.sets || []).reduce((t,s)=>t + s.weight*s.reps, 0);
      byWeek[wk] = byWeek[wk] || {};
      byWeek[wk][mg] = byWeek[wk][mg] || { hardSets:0, tonnage:0 };
      byWeek[wk][mg].hardSets += hardSets;
      byWeek[wk][mg].tonnage += tonnage;
    }
  }
  Object.entries(byWeek).forEach(([wk, groups])=>{
    Object.entries(groups).forEach(([mg, v])=>{
      weekly.push({ week: wk, muscleGroup: mg, hardSets: v.hardSets, estTonnage: v.tonnage });
    });
  });

  const buckets: Record<string, number> = {};
  const map: Record<string,'push'|'pull'|'legs'|'hinge'|'core'> = {
    Chest:'push', Shoulders:'push', Triceps:'push',
    Back:'pull', Biceps:'pull',
    Quads:'legs', Glutes:'legs', Calves:'legs',
    Hamstrings:'hinge',
    Core:'core', Abs:'core'
  };
  for (const w of weekly) {
    const b = map[w.muscleGroup] || 'core';
    buckets[b] = (buckets[b] || 0) + w.hardSets;
  }
  const totalSets = Object.values(buckets).reduce((a,b)=>a+b,0) || 1;
  const balance = {
    pushPct: (buckets.push||0)/totalSets,
    pullPct: (buckets.pull||0)/totalSets,
    legsPct: (buckets.legs||0)/totalSets,
    hingePct:(buckets.hinge||0)/totalSets,
    corePct: (buckets.core||0)/totalSets,
  };

  const trendMap: Record<string, LiftTrend['last3']> = {};
  for (const log of lastLogs) {
    for (const ex of log.exercises ?? []) {
      const top = (ex.sets||[]).slice().sort((a,b)=> (b.weight*(b.reps||1)) - (a.weight*(a.reps||1)))[0];
      if (!top) continue;
      const arr = trendMap[ex.name] = (trendMap[ex.name]||[]);
      arr.push({ date: log.date!, topSetWeight: top.weight, reps: top.reps });
      if (arr.length > 3) arr.shift();
    }
  }
  const liftTrends: LiftTrend[] = Object.entries(trendMap).map(([name,last3])=>{
    const stalled = last3.length===3 && !(last3[2].topSetWeight>last3[1].topSetWeight || last3[2].reps>last3[1].reps);
    return { name, last3, stalled };
  });

  const planned = routines.reduce((a,r)=>a + (r.exercises?.length||0), 0);
  const completed = lastLogs.reduce((a,l)=>a+(l.exercises?.length||0),0);
  const adherence = { plannedExercises: planned, completed, adherencePct: planned? completed/planned : 1 };

  return { weeksConsidered: weeks, weeklyVolume: weekly.slice(-weeks*10), balance, liftTrends: liftTrends.slice(0,10), adherence };
}
