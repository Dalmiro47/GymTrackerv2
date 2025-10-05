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
  priorities: string[];
  nextFourWeeks: string[];
};

// helpful when LLM returns strings instead of arrays
export function normalizeAdviceShape(input: any): CoachAdvice {
  const toList = (v: any): string[] => {
    if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
    const s = String(v ?? '');
    // split by newline or bullet/numbered lists
    return s
      .split(/\r?\n|·|- |\* |\d+\.\s/g)
      .map(t => t.trim())
      .filter(Boolean);
  };

  return {
    overview: String(input?.overview ?? '').trim(),
    priorities: toList(input?.priorities),
    nextFourWeeks: toList(input?.nextFourWeeks),
  };
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
  const weeklySessions = summary?.weeks?.[0]?.sessions ?? 0;
  const avgIntensity = Math.round(((summary?.weeks?.[0]?.avgIntensity ?? 0) + Number.EPSILON) * 10) / 10;
  const stallLifts = (summary?.stalledLifts ?? []).slice(0, 3);
  const lowVolumeGroups = (summary?.volumeGaps ?? []).slice(0, 3);

  const goalLine =
    goal.includes('hypertrophy') ? 'Prioritize moderate reps (6–12) and weekly volume.' :
    goal.includes('strength')    ? 'Prioritize lower reps (3–6) with adequate rest.' :
                                   'Maintain a balanced approach with progressive overload.';

  const consistency =
    weeklySessions >= 4 ? 'Great consistency — keep that cadence.' :
    weeklySessions >= 3 ? 'Solid consistency — one extra session could accelerate progress.' :
                          'Aim for ≥3 weekly sessions for meaningful progress.';

  const overview = [
    goalLine,
    `Last week: ${weeklySessions} sessions, avg load index ≈ ${avgIntensity}.`,
    consistency,
  ].join(' ');

  const priorities: string[] = [
    lowVolumeGroups.length
      ? `Underserved muscle groups: ${lowVolumeGroups.join(', ')} → add 4–8 quality sets/week.`
      : 'Volume distribution looks balanced across muscle groups.',
    stallLifts.length
      ? `Possible stalls: ${stallLifts.join(', ')} → micro-load or reset reps/RIR targets.`
      : 'No clear stalls detected — continue progressive loading.',
    'Keep 1–2 RIR on first sets of key lifts; add load or reps weekly if bar speed and form allow.',
  ];

  const nextFourWeeks: string[] = [
    'Weeks 1–2: Add +1–2 sets on the weakest muscle group; hold others steady.',
    'Week 3: Increase load ≈2.5–5% on primaries if you finished ≥1 RIR last week.',
    'Week 4: Deload if fatigue accumulates (−30–40% volume) or repeat week 3 if fresh.',
    'Track top set + backoff sets; keep warm-ups consistent.',
  ];

  return { overview, priorities, nextFourWeeks };
}
