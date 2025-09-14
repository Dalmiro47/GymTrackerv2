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
}
