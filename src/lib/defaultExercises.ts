
import type { Exercise } from '@/types'; 
import { slugify } from '@/lib/utils';

// Helper to add ID to exercise data
const createDefaultExercise = (name: Exercise['name'], muscleGroup: Exercise['muscleGroup'], targetNotes: Exercise['targetNotes'], dataAiHint: Exercise['dataAiHint'], exerciseSetup?: Exercise['exerciseSetup'], progressiveOverload?: Exercise['progressiveOverload']): Exercise => {
  return {
    id: slugify(name, muscleGroup), // Generate deterministic ID based on name and muscle group
    name,
    muscleGroup,
    targetNotes,
    dataAiHint,
    exerciseSetup: exerciseSetup || '',
    progressiveOverload: progressiveOverload || '',
  };
};

// Default exercises - ID is now pre-defined
export const defaultExercises: Exercise[] = [
  // Chest
  createDefaultExercise("Incline chest w/dumbbells", "Chest", "Upper Chest", "dumbbell press", "", "8-12 reps"),
  createDefaultExercise("Incline chest w/ Smith Machine", "Chest", "Upper Chest", "smith machine", "", "8-12 reps"),
  createDefaultExercise("Machine Chest Press", "Chest", "Middle Chest", "chest machine", "", "10-15 reps"),
  createDefaultExercise("Bench Press", "Chest", "Middle Chest", "bench press", "", "5-8 reps"),
  createDefaultExercise("Seated Cable Pec Flye", "Chest", "Lower Chest", "cable fly", "", "12-20 reps"),
  createDefaultExercise("Dips", "Chest", "Lower Chest", "dips fitness", "Chest Focus", "As many as possible"), 

  // Back
  createDefaultExercise("Wide-Grip Pull ups", "Back", "Lats and Middle Back", "pull up", "", "As many as possible"),
  createDefaultExercise("Chest-Supported Row", "Back", "Upper Back and Middle Back", "row machine", "", "8-12 reps"),
  createDefaultExercise("Wide-Grip Lat Pull down", "Back", "Lats and Middle Back", "lat pulldown", "", "10-15 reps"),
  createDefaultExercise("Neutral-Grip Lat Pull down", "Back", "Lats and Teres Major", "lat pulldown", "", "10-15 reps"),
  createDefaultExercise("Half-Kneeling 1-Arm Lat Pulldown", "Back", "Lats and Teres Major", "lat pulldown cable", "", "12-15 reps per side"),
  createDefaultExercise("Barbell Rows", "Back", "Upper Back and Middle Back", "barbell row", "", "6-10 reps"),

  // Shoulders
  createDefaultExercise("Standing Overhead Press", "Shoulders", "Anterior deltoid", "overhead press", "", "6-10 reps"),
  createDefaultExercise("Dumbbell Overhead Press", "Shoulders", "Anterior deltoid", "dumbbell press", "", "8-12 reps"),
  createDefaultExercise("Machine Shoulder Press", "Shoulders", "Anterior deltoid", "shoulder machine", "", "10-15 reps"),
  createDefaultExercise("Lateral Raise Machine", "Shoulders", "Lateral deltoid", "lateral raise machine", "", "12-20 reps"),
  createDefaultExercise("Lateral Raise Dumbbell", "Shoulders", "Lateral deltoid", "dumbbell raise", "", "12-20 reps"),
  createDefaultExercise("Cable Lateral Raise", "Shoulders", "Lateral deltoid", "cable raise", "", "12-20 reps"),
  createDefaultExercise("Reverse Peck Deck", "Shoulders", "Posterior deltoid", "reverse fly machine", "", "15-25 reps"),
  createDefaultExercise("Seated Reverse Dumbbell Flye", "Shoulders", "Posterior deltoid", "dumbbell fly", "", "15-25 reps"),

  // Legs
  createDefaultExercise("Barbell Back Squat", "Legs", "Quadriceps, glutes, hamstrings", "barbell squat", "", "5-8 reps"),
  createDefaultExercise("Hack Squat", "Legs", "Quadriceps", "hack squat", "", "8-12 reps"),
  createDefaultExercise("Leg Extension", "Legs", "Quadriceps", "leg extension machine", "", "15-20 reps"),
  createDefaultExercise("Leg Press Machine", "Legs", "Quadriceps, glutes", "leg press machine", "", "10-15 reps"),
  createDefaultExercise("Leg Curl Machine", "Legs", "Hamstrings", "leg curl machine", "", "12-18 reps"),
  createDefaultExercise("Romanian Dead Lift", "Legs", "Hamstrings, glutes", "romanian deadlift", "", "8-12 reps"),
  createDefaultExercise("Hip Thrust", "Legs", "Glutes", "hip thrust exercise", "", "8-15 reps"),
  createDefaultExercise("Abductor Machine", "Legs", "Glutes", "abductor machine", "", "15-25 reps"),
  createDefaultExercise("Standing Calves", "Legs", "Gastrocnemius", "calf raise", "", "10-20 reps"),

  // Triceps
  createDefaultExercise("Dips", "Triceps", "Lateral head", "tricep dips", "Triceps Focus", "As many as possible"), 
  createDefaultExercise("Cable Triceps Kickback", "Triceps", "Lateral head", "tricep kickback", "", "12-20 reps"),
  createDefaultExercise("Overhead Cable Triceps Extension", "Triceps", "Long head", "tricep extension cable", "", "10-15 reps"),
  createDefaultExercise("Skullcrusher", "Triceps", "Long head", "skullcrusher exercise", "", "8-12 reps"),

  // Biceps
  createDefaultExercise("EZ Bar Curl", "Biceps", "Short Head-Inner", "ez bar curl", "", "8-12 reps"),
  createDefaultExercise("Chinup", "Biceps", "Short-Inner and Long-Outer", "chin up", "", "As many as possible"),
  createDefaultExercise("Incline Dumbbell Curl", "Biceps", "Long Head-Outer", "incline curl", "", "10-15 reps"),
  createDefaultExercise("Face Away Bayesian Cable Curl", "Biceps", "Long Head-Outer", "cable curl", "", "10-15 reps"),
  createDefaultExercise("Hammer Curl", "Biceps", "Brachialis", "hammer curl", "", "10-15 reps"),

  // Abs
  createDefaultExercise("Cable Crunch", "Abs", "Upper", "cable crunch abs", "", "15-25 reps"),
  createDefaultExercise("Crunch Machine", "Abs", "Upper", "abs machine", "", "15-25 reps"),
  createDefaultExercise("Candlestick", "Abs", "Upper & Lower", "candlestick abs", "", "As many as possible"),
  createDefaultExercise("Hanging Leg Raise", "Abs", "Lower", "leg raise hanging", "", "12-20 reps"),
  createDefaultExercise("Back-Supported Leg Raise", "Abs", "Lower", "leg raise support", "", "15-25 reps"),
  createDefaultExercise("Super Range Motion Crunch", "Abs", "Upper & Lower", "abs crunch", "", "As many as possible"),
  createDefaultExercise("Abs Wheel/Rollout", "Abs", "Core Stability", "ab wheel", "", "As many as possible"),
  
  // Other (Example, can be expanded)
  createDefaultExercise("Foam Rolling", "Other", "Myofascial release", "foam roller", "", "30-60s per area"),
  createDefaultExercise("Stretching", "Other", "General flexibility", "stretching fitness", "", "Hold for 20-30s"),
];
