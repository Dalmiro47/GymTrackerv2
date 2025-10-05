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

export type CoachAdvice = {
  overview: string;
  priorityScore: number;
  routineTweaks: any[];
  nextFourWeeks: Array<{ week: number; focus: string; notes: string }>;
};

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
    const b = map[w.muscleGroup as keyof typeof map] || 'core';
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

// You already have summarizeTrainingData(...)
export function buildCoachAdviceLite(summary: any, profile: any): CoachAdvice {
  const goal = (profile?.goal || '').toLowerCase();
  const stallLifts = (summary?.stalledLifts || []).map((l: any) => l.name).slice(0, 2);
  const lowVolumeGroups = (summary?.volumeGaps || []).map((g: any) => g.muscleGroup).slice(0, 2);

  const goalLine =
    goal.includes('hypertrophy') ? 'Prioritize moderate reps (6–12) and weekly volume.'
    : goal.includes('strength')  ? 'Prioritize lower reps (3–6) with adequate rest.'
    : 'Maintain a balanced approach with progressive overload.';

  const overview = `Based on your goal of ${profile?.goal || 'General Fitness'}, your summary shows a solid foundation. ${goalLine}`;

  const tweaks: any[] = [];
  if (stallLifts.length > 0) {
    tweaks.push({
      where: { day: 'Any' },
      change: 'Change Sets/Reps',
      details: `On stalled lifts like ${stallLifts.join(' & ')}, consider a brief deload or switching to a slightly different rep range (e.g., 5x5 instead of 3x8).`,
      rationale: 'Breaks through plateaus by changing the stimulus.'
    });
  }
  if (lowVolumeGroups.length > 0) {
    tweaks.push({
      where: { day: 'Any' },
      change: 'Add Exercise',
      details: `Your volume for ${lowVolumeGroups.join(' & ')} is low. Add 1-2 exercises targeting these areas per week.`,
      rationale: 'Ensures balanced muscle development and prevents weaknesses.'
    });
  }
  if (tweaks.length === 0) {
    tweaks.push({
      where: { day: 'All' },
      change: 'Change Sets/Reps',
      details: 'Your plan looks balanced. To progress, focus on adding a small amount of weight or one rep to your main lifts each week.',
      rationale: 'Progressive overload is the primary driver of long-term gains.'
    });
  }

  const nextFourWeeks = [
    { week: 1, focus: 'Consistency', notes: 'Focus on hitting all your planned sessions and maintaining form.' },
    { week: 2, focus: 'Progressive Overload', notes: 'Try to add a small amount of weight or one rep to your primary lifts.' },
    { week: 3, focus: 'Volume Adjustment', notes: 'Assess recovery. If feeling good, add one set to a lagging body part.' },
    { week: 4, focus: 'Deload or Push', notes: 'If you feel fatigued, reduce volume by 30%. If you feel strong, repeat week 3.' }
  ];

  return {
    overview,
    priorityScore: 75,
    routineTweaks: tweaks,
    nextFourWeeks
  };
}
