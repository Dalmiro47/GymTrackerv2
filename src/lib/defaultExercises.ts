
import type { Exercise } from '@/types'; 
import { slugify } from '@/lib/utils';

// Helper to add ID to exercise data
const createDefaultExercise = (name: Exercise['name'], muscleGroup: Exercise['muscleGroup'], targetNotes: Exercise['targetNotes'], dataAiHint: Exercise['dataAiHint'], exerciseSetup?: Exercise['exerciseSetup']): Exercise => {
  return {
    id: slugify(name, muscleGroup), // Generate deterministic ID based on name and muscle group
    name,
    muscleGroup,
    targetNotes,
    dataAiHint,
    exerciseSetup: exerciseSetup || '',
  };
};

// Default exercises - ID is now pre-defined
export const defaultExercises: Exercise[] = [
  // Chest
  createDefaultExercise("Incline chest w/dumbbells", "Chest", "Upper Chest", "dumbbell press"),
  createDefaultExercise("Incline chest w/ Smith Machine", "Chest", "Upper Chest", "smith machine"),
  createDefaultExercise("Machine Chest Press", "Chest", "Middle Chest", "chest machine"),
  createDefaultExercise("Bench Press", "Chest", "Middle Chest", "bench press"),
  createDefaultExercise("Seated Cable Pec Flye", "Chest", "Lower Chest", "cable fly"),
  createDefaultExercise("Dips", "Chest", "Lower Chest", "dips fitness", "Chest Focus"), 

  // Back
  createDefaultExercise("Wide-Grip Pull ups", "Back", "Lats and Middle Back", "pull up"),
  createDefaultExercise("Chest-Supported Row", "Back", "Upper Back and Middle Back", "row machine"),
  createDefaultExercise("Wide-Grip Lat Pull down", "Back", "Lats and Middle Back", "lat pulldown"),
  createDefaultExercise("Neutral-Grip Lat Pull down", "Back", "Lats and Teres Major", "lat pulldown"),
  createDefaultExercise("Half-Kneeling 1-Arm Lat Pulldown", "Back", "Lats and Teres Major", "lat pulldown cable"),
  createDefaultExercise("Barbell Rows", "Back", "Upper Back and Middle Back", "barbell row"),

  // Shoulders
  createDefaultExercise("Standing Overhead Press", "Shoulders", "Anterior deltoid", "overhead press"),
  createDefaultExercise("Dumbbell Overhead Press", "Shoulders", "Anterior deltoid", "dumbbell press"),
  createDefaultExercise("Machine Shoulder Press", "Shoulders", "Anterior deltoid", "shoulder machine"),
  createDefaultExercise("Lateral Raise Machine", "Shoulders", "Lateral deltoid", "lateral raise machine"),
  createDefaultExercise("Lateral Raise Dumbbell", "Shoulders", "Lateral deltoid", "dumbbell raise"),
  createDefaultExercise("Cable Lateral Raise", "Shoulders", "Lateral deltoid", "cable raise"),
  createDefaultExercise("Reverse Peck Deck", "Shoulders", "Posterior deltoid", "reverse fly machine"),
  createDefaultExercise("Seated Reverse Dumbbell Flye", "Shoulders", "Posterior deltoid", "dumbbell fly"),

  // Legs
  createDefaultExercise("Barbell Back Squat", "Legs", "Quadriceps, glutes, hamstrings", "barbell squat"),
  createDefaultExercise("Hack Squat", "Legs", "Quadriceps", "hack squat"),
  createDefaultExercise("Leg Extension", "Legs", "Quadriceps", "leg extension machine"),
  createDefaultExercise("Leg Press Machine", "Legs", "Quadriceps, glutes", "leg press machine"),
  createDefaultExercise("Leg Curl Machine", "Legs", "Hamstrings", "leg curl machine"),
  createDefaultExercise("Romanian Dead Lift", "Legs", "Hamstrings, glutes", "romanian deadlift"),
  createDefaultExercise("Hip Thrust", "Legs", "Glutes", "hip thrust exercise"),
  createDefaultExercise("Abductor Machine", "Legs", "Glutes", "abductor machine"),
  createDefaultExercise("Standing Calves", "Legs", "Gastrocnemius", "calf raise"),

  // Triceps
  createDefaultExercise("Dips", "Triceps", "Lateral head", "tricep dips", "Triceps Focus"), 
  createDefaultExercise("Cable Triceps Kickback", "Triceps", "Lateral head", "tricep kickback"),
  createDefaultExercise("Overhead Cable Triceps Extension", "Triceps", "Long head", "tricep extension cable"),
  createDefaultExercise("Skullcrusher", "Triceps", "Long head", "skullcrusher exercise"),

  // Biceps
  createDefaultExercise("EZ Bar Curl", "Biceps", "Short Head-Inner", "ez bar curl"),
  createDefaultExercise("Chinup", "Biceps", "Short-Inner and Long-Outer", "chin up"),
  createDefaultExercise("Incline Dumbbell Curl", "Biceps", "Long Head-Outer", "incline curl"),
  createDefaultExercise("Face Away Bayesian Cable Curl", "Biceps", "Long Head-Outer", "cable curl"),
  createDefaultExercise("Hammer Curl", "Biceps", "Brachialis", "hammer curl"),

  // Abs
  createDefaultExercise("Cable Crunch", "Abs", "Upper", "cable crunch abs"),
  createDefaultExercise("Crunch Machine", "Abs", "Upper", "abs machine"),
  createDefaultExercise("Candlestick", "Abs", "Upper & Lower", "candlestick abs"),
  createDefaultExercise("Hanging Leg Raise", "Abs", "Lower", "leg raise hanging"),
  createDefaultExercise("Back-Supported Leg Raise", "Abs", "Lower", "leg raise support"),
  createDefaultExercise("Super Range Motion Crunch", "Abs", "Upper & Lower", "abs crunch"),
  createDefaultExercise("Abs Wheel/Rollout", "Abs", "Core Stability", "ab wheel"),
  
  // Other (Example, can be expanded)
  createDefaultExercise("Foam Rolling", "Other", "Myofascial release", "foam roller"),
  createDefaultExercise("Stretching", "Other", "General flexibility", "stretching fitness"),
];
