
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

// --- Types stay the same ---
export type CoachAdvice = {
  overview: string;
  priorities: string[];
  nextFourWeeks: string[];
  // optional, used by the inline coach or richer UIs
  routineTweaks?: Array<{
    change: 'Add' | 'Reduce' | 'Swap' | 'Tempo' | 'Rest';
    where: { day: string, slot?: number };
    details: string;
    rationale: string;
    setsReps?: { sets: number; repsRange: string; rir?: number };
  }>;
};

// Helper
const pct = (v: number) => `${Math.round(v * 100)}%`;
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

// Build a per-muscle ordered list of gaps from your summary
function findVolumeGaps(summary: any, topN = 3) {
  // Expect something like: summary.muscleVolumes = { Chest: { weeklyAvgSets: 10 }, ... }
  const vols = summary?.muscleVolumes ?? {};
  const entries = Object.entries(vols).map(([mg, v]: any) => ({
    muscle: mg,
    sets: Number(v?.weeklyAvgSets ?? 0),
  }));
  // Find muscles below 8–10 sets/week baseline
  return entries
    .sort((a, b) => a.sets - b.sets)
    .filter(x => x.sets < 8)
    .slice(0, topN);
}

function findStalls(summary: any, topN = 3) {
  // Expect: summary.liftTrends = { "Bench Press": { weeks: [{e1rm}], slope }, ... }
  const trends = summary?.liftTrends ?? {};
  const items = Object.entries(trends).map(([name, t]: any) => ({
    name,
    slope: Number(t?.slope ?? 0),
    lastE1RM: Number(t?.weeks?.at(-1)?.e1rm ?? 0),
  }));
  // slope close to 0 ⇒ stall
  return items
    .filter(x => Math.abs(x.slope) < 0.25)
    .sort((a, b) => b.lastE1RM - a.lastE1RM)
    .slice(0, topN)
    .map(x => x.name);
}

// NEW: Helper to safely get the most recent week's data.
function getRecentWeek(weeks: any[]) {
    if (!Array.isArray(weeks) || weeks.length === 0) {
        return { sessions: 0, avgIntensity: 0, plannedSessions: 0 };
    }
    const latest = weeks[weeks.length - 1]; // .at(-1)
    return {
        sessions: Number(latest?.sessions ?? 0),
        avgIntensity: Number(latest?.avgIntensity ?? latest?.avgRpe ?? 0),
        plannedSessions: Number(latest?.plannedSessions ?? 0)
    };
}


function adherence(summary: any) {
  const recentWeek = getRecentWeek(summary?.weeks);
  const done = recentWeek.sessions;
  const planned = recentWeek.plannedSessions > 0 ? recentWeek.plannedSessions : (summary?.planSessions ?? 0);
  const ratio = planned > 0 ? Math.min(1, done / planned) : (done >= 3 ? 1 : done / 3);
  return { planned, done, ratio };
}

function avgIntensity(summary: any) {
  const recentWeek = getRecentWeek(summary?.weeks);
  const ai = recentWeek.avgIntensity;
  return Math.round((ai + Number.EPSILON) * 10) / 10;
}


function daySlots(routineSummary: any, dayId?: string) {
  // Expect: routineSummary.days = [{ id, name, slots: [{ slot, exercise, muscleGroup }] }]
  const days = routineSummary?.days ?? [];
  const day  = dayId ? days.find((d: any) => d.id === dayId) : null;
  return { days, day };
}

export function buildCoachAdviceLite(
  summary: any,
  profile: any,
  opts?: { scope?: { mode: 'global' } | { mode: 'day', dayId: string, dayName?: string }, routineSummary?: any }
): CoachAdvice {
  const goal = (profile?.goal || '').toLowerCase();
  const { planned, done, ratio } = adherence(summary);
  const intensity = avgIntensity(summary);
  const gaps = findVolumeGaps(summary, 3);
  const stalls = findStalls(summary, 3);

  const goalLine =
    goal.includes('hypertrophy') ? 'Hypertrophy focus: 6–12 reps, 10–20 tough sets per muscle weekly.' :
    goal.includes('strength')    ? 'Strength focus: 3–6 reps on primaries, ample rest, quality singles/doubles when fresh.' :
                                   'Balanced focus: moderate reps, progressive overload, even volume across muscle groups.';

  const consistency =
    planned > 0
      ? `Planned ${planned}, completed ${done} (${pct(ratio)} adherence).`
      : `Completed ${done} session(s) last week.`;

  const overview = [
    goalLine,
    consistency,
    `Avg intensity index ≈ ${intensity}. Keep technique-first; increase when bar speed & ROM are solid.`,
  ].join(' ');

  // Priorities (global)
  const priorities: string[] = [];
  if (gaps.length) {
    priorities.push(
      `Low weekly sets: ${gaps.map(g => `${g.muscle} (${g.sets})`).join(', ')}. Add 4–8 quality sets/week across those muscles.`
    );
  } else {
    priorities.push('Volume distribution looks balanced. Maintain across muscles.');
  }

  if (stalls.length) {
    priorities.push(
      `Potential stalls: ${stalls.join(', ')}. Try micro-loading (+1.25–2.5 kg), or reset reps/RIR by −1 and re-build.`
    );
  } else {
    priorities.push('No obvious stalls. Keep adding a rep or small load each week.');
  }

  if (ratio < 0.6) priorities.push('Adherence is the #1 lever: lock 2–3 fixed training slots this week and guard them.');

  // Next four weeks (global)
  const nextFourWeeks: string[] = [
    'Weeks 1–2: Add +1–2 sets on the weakest muscle group(s) and hold others steady.',
    'Week 3: Add 2.5–5% load on primary lifts if last week ended with ≥1 RIR and reps were clean.',
    'Week 4: If fatigue builds, deload volume by ~30–40%; if not, repeat week 3.',
    'Keep warm-ups consistent; track top sets + backoffs for clear progression.',
  ];

  // Day-scoped tweaks (inline coach)
  let routineTweaks: CoachAdvice['routineTweaks'] = [];
  if (opts?.scope?.mode === 'day' && opts?.routineSummary) {
    const { day } = daySlots(opts.routineSummary, opts.scope.dayId);
    if (day?.slots?.length) {
      // If day has no movement for a low-volume muscle → add one
      const lowMuscles = new Set(gaps.map(g => g.muscle));
      const presentMGs = new Set((day.slots ?? []).map((s: any) => s.muscleGroup));
      const missing = Array.from(lowMuscles).filter(mg => !presentMGs.has(mg)).slice(0, 1);

      if (missing.length) {
        routineTweaks.push({
          change: 'Add',
          where: { day: day.name ?? 'This day' },
          details: `Add 1 accessory for ${missing[0]} (e.g., cable/DB variation).`,
          rationale: 'Close weekly volume gap for undertrained muscle.',
          setsReps: { sets: 3, repsRange: goal.includes('strength') ? '6–8' : '8–12', rir: 1 },
        });
      }

      // If a stall lift is on this day → tweak rep target
      const stallOnDay = (day.slots ?? []).find((s: any) => stalls.includes(s.exercise));
      if (stallOnDay) {
        routineTweaks.push({
          change: 'Tempo',
          where: { day: day.name ?? 'This day', slot: stallOnDay.slot },
          details: `Use a 2–3s eccentric on ${stallOnDay.exercise} for all working sets.`,
          rationale: 'Increase time under tension and control to break the plateau.',
        });
      }

      // Suggest rest management for very dense days
      if ((day.slots ?? []).length >= 6) {
        routineTweaks.push({
          change: 'Rest',
          where: { day: day.name ?? 'This day' },
          details: 'Cap accessories at 90–120s rest; keep primaries at 2–3 min.',
          rationale: 'Balance density and quality; avoid junk fatigue.',
        });
      }
    }
  }

  return { overview, priorities, nextFourWeeks, routineTweaks };
}


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
    routineTweaks: Array.isArray(input?.routineTweaks) ? input.routineTweaks : [],
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
      trendMap[ex.name] = trendMap[ex.name] || [];
      trendMap[ex.name].push({ date: log.date!, topSetWeight: top.weight, reps: top.reps });
    }
  }
  const trends: Record<string, LiftTrend> = {};
  for(const [name, lastN] of Object.entries(trendMap)) {
    const last3 = lastN.slice(-3);
    const e1rm = last3.map(l => estimate1RM(l.topSetWeight, l.reps));
    const stalled = e1rm.length > 1 && (e1rm.at(-1)! - e1rm[0]) < 2.5;
    trends[name] = { name, last3, stalled };
  }

  return { weekly, balance, trends };
}

export type CoachFactCompact =
  | { id: string; t: 'v'; g: string; w: number } // volume: group code, last week sets
  | { id: string; t: 'i'; hi: string; lo: string; d: number } // imbalance: hi vs lo (diff sets)
  | { id: string; t: 's'; n: string; w: number; sl: number } // stall: name, weeks, slope
  | { id: string; t: 'a'; w: number; targ: number } // adherence
  | { id: string; t: 'g'; goal: 'Strength' | 'Hypertrophy' | 'General' }; // NEW: goal

const MG = (s: string) => {
  const k = s.toLowerCase();
  if (k.startsWith('ch')) return 'CH';
  if (k.startsWith('ba')) return 'BK';
  if (k.startsWith('sh')) return 'SH';
  if (k.startsWith('le')) return 'LE';
  if (k.startsWith('bi')) return 'BI';
  if (k.startsWith('tr')) return 'TR';
  if (k.startsWith('ab')) return 'AB';
  return s.slice(0,2).toUpperCase();
};

export function buildCoachFactsCompact(profile: any, _routineSummary: any, trainingSummary: any) {
  const facts: CoachFactCompact[] = [];

  // Last week by muscle group (sort asc → low first). Limit to 7.
  const lastWeek = (trainingSummary?.weekly ?? []).filter(Boolean)
    .reduce((acc: Record<string, number>, r: any) => {
      if (!acc.__week) acc.__week = r.week; // take the first week in list
      if (r.week === acc.__week) acc[r.muscleGroup] = Number(r.hardSets || 0);
      return acc;
    }, {} as any);

  const mgPairs = Object.entries(lastWeek).filter(([k])=>k!=='__week') as [string, number][];
  mgPairs.sort((a,b)=>a[1]-b[1]);
  for (const [mg, w] of mgPairs.slice(0,7)) {
    const g = MG(mg);
    facts.push({ id: `v:${g}`, t: 'v', g, w });
  }

  // Biggest imbalances vs max. Limit to 4 with diff ≥ 4 sets.
  if (mgPairs.length) {
    const [hiMg, hiVal] = [...mgPairs].sort((a,b)=>b[1]-a[1])[0];
    for (const [mg, sets] of mgPairs) {
      const diff = hiVal - sets;
      if (diff >= 4 && mg !== hiMg) {
        facts.push({ id: `i:${MG(hiMg)}:${MG(mg)}`, t: 'i', hi: MG(hiMg), lo: MG(mg), d: diff });
      }
      if (facts.filter(f=>f.t==='i').length >= 4) break;
    }
  }

  // Stalls (if available). Limit to 2 and shorten slope precision.
  for (const s of (trainingSummary?.stalls ?? []).slice(0,2)) {
    facts.push({ id: `s:${(s.name||'').slice(0,10)}`, t: 's', n: s.name, w: Number(s.weeks||0), sl: Number((s.slope||0).toFixed(2)) });
  }

  // Adherence: 1 fact
  const weeksLogged = new Set((trainingSummary?.weekly ?? []).map((w:any)=>w.week)).size;
  facts.push({ id: 'a', t: 'a', w: weeksLogged, targ: Number(profile?.daysPerWeekTarget || 0) });

  // NEW: goal fact (kept tiny and explicit)
  const rawGoal = String(profile?.goal || '').toLowerCase();
  const goal: 'Strength' | 'Hypertrophy' | 'General' =
    rawGoal.includes('strength') ? 'Strength' :
    rawGoal.includes('hyper')    ? 'Hypertrophy' : 'General';
  facts.push({ id: 'g', t: 'g', goal });

  // Hard cap to ~14 facts total
  return { facts: facts.slice(0,15) }; // Bumped to 15 to ensure goal is not cut off
}
