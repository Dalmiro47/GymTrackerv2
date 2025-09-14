export interface CoachAdvice {
  overview: string;
  priorityScore: number; // 1–100
  risks?: string[];
  routineTweaks: Array<{
    where: { day: string; slot?: number };
    change: 'Replace Exercise' | 'Add Exercise' | 'Remove Exercise' | 'Change Sets/Reps' | 'Change Frequency';
    details: string;
    setsReps?: { sets: number; repsRange: string; rir?: string };
    exampleExercises?: string[];
    rationale: string;
  }>;
  nextFourWeeks: Array<{ week: number; focus: string; notes: string }>;
  // NEW (optional): gives you anchors to why the coach recommended changes
  meta?: {
    stalledLifts?: Array<{ name: string; reason: string }>;
    volumeGaps?: Array<{ muscleGroup: string; weeklySets: number; targetRange: string }>;
    balance?: { pushPct?: number; pullPct?: number; legsPct?: number; hingePct?: number; corePct?: number };
    confidence?: number; // 0–1
  };
}
