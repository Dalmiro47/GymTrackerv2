// Spanish (Latin American) labels for the seeded default exercises.
//
// The stored data stays English (see defaultExercises.ts): the deterministic doc
// ids, every denormalized copy in logs/routines/history, and the warm-up
// heuristics all key off the English name. These labels are applied at DISPLAY
// time only, and only to fields the user has not edited — see
// src/lib/exerciseDisplay.ts. Keyed by `${englishName}::${muscleGroup}`.

export type LocalizedDefaultFields = {
  name: string;
  targetNotes: string;
  exerciseSetup: string;
  progressiveOverload: string;
};

const AMRAP = 'Máximas repeticiones';

export const DEFAULT_EXERCISES_ES: Record<string, LocalizedDefaultFields> = {
  // Chest
  'Incline chest w/dumbbells::Chest': { name: 'Press inclinado con mancuernas', targetNotes: 'Pecho superior', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Incline chest w/ Smith Machine::Chest': { name: 'Press inclinado en máquina Smith', targetNotes: 'Pecho superior', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Machine Chest Press::Chest': { name: 'Press de pecho en máquina', targetNotes: 'Pecho medio', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Bench Press::Chest': { name: 'Press de banca', targetNotes: 'Pecho medio', exerciseSetup: '', progressiveOverload: '5-8 reps' },
  'Seated Cable Pec Flye::Chest': { name: 'Aperturas en polea sentado', targetNotes: 'Pecho inferior', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Dips::Chest': { name: 'Fondos', targetNotes: 'Pecho inferior', exerciseSetup: 'Enfoque en pecho', progressiveOverload: AMRAP },

  // Back
  'Wide-Grip Pull ups::Back': { name: 'Dominadas agarre amplio', targetNotes: 'Dorsales y espalda media', exerciseSetup: '', progressiveOverload: AMRAP },
  'Chest-Supported Row::Back': { name: 'Remo con apoyo en pecho', targetNotes: 'Espalda alta y media', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Wide-Grip Lat Pull down::Back': { name: 'Jalón al pecho agarre amplio', targetNotes: 'Dorsales y espalda media', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Neutral-Grip Lat Pull down::Back': { name: 'Jalón al pecho agarre neutro', targetNotes: 'Dorsales y redondo mayor', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Half-Kneeling 1-Arm Lat Pulldown::Back': { name: 'Jalón a un brazo semiarrodillado', targetNotes: 'Dorsales y redondo mayor', exerciseSetup: '', progressiveOverload: '12-15 reps por lado' },
  'Barbell Rows::Back': { name: 'Remo con barra', targetNotes: 'Espalda alta y media', exerciseSetup: '', progressiveOverload: '6-10 reps' },

  // Shoulders
  'Standing Overhead Press::Shoulders': { name: 'Press militar de pie', targetNotes: 'Deltoides anterior', exerciseSetup: '', progressiveOverload: '6-10 reps' },
  'Dumbbell Overhead Press::Shoulders': { name: 'Press de hombros con mancuernas', targetNotes: 'Deltoides anterior', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Machine Shoulder Press::Shoulders': { name: 'Press de hombros en máquina', targetNotes: 'Deltoides anterior', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Lateral Raise Machine::Shoulders': { name: 'Elevaciones laterales en máquina', targetNotes: 'Deltoides lateral', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Lateral Raise Dumbbell::Shoulders': { name: 'Elevaciones laterales con mancuernas', targetNotes: 'Deltoides lateral', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Cable Lateral Raise::Shoulders': { name: 'Elevaciones laterales en polea', targetNotes: 'Deltoides lateral', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Reverse Peck Deck::Shoulders': { name: 'Peck deck inverso', targetNotes: 'Deltoides posterior', exerciseSetup: '', progressiveOverload: '15-25 reps' },
  'Seated Reverse Dumbbell Flye::Shoulders': { name: 'Aperturas inversas sentado con mancuernas', targetNotes: 'Deltoides posterior', exerciseSetup: '', progressiveOverload: '15-25 reps' },

  // Legs
  'Barbell Back Squat::Legs': { name: 'Sentadilla con barra', targetNotes: 'Cuádriceps, glúteos, isquiotibiales', exerciseSetup: '', progressiveOverload: '5-8 reps' },
  'Hack Squat::Legs': { name: 'Sentadilla hack', targetNotes: 'Cuádriceps', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Leg Extension::Legs': { name: 'Extensión de piernas', targetNotes: 'Cuádriceps', exerciseSetup: '', progressiveOverload: '15-20 reps' },
  'Leg Press Machine::Legs': { name: 'Prensa de piernas', targetNotes: 'Cuádriceps, glúteos', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Leg Curl Machine::Legs': { name: 'Curl femoral en máquina', targetNotes: 'Isquiotibiales', exerciseSetup: '', progressiveOverload: '12-18 reps' },
  'Romanian Dead Lift::Legs': { name: 'Peso muerto rumano', targetNotes: 'Isquiotibiales, glúteos', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Hip Thrust::Legs': { name: 'Hip thrust', targetNotes: 'Glúteos', exerciseSetup: '', progressiveOverload: '8-15 reps' },
  'Abductor Machine::Legs': { name: 'Máquina de abductores', targetNotes: 'Glúteos', exerciseSetup: '', progressiveOverload: '15-25 reps' },
  'Standing Calves::Legs': { name: 'Elevación de talones de pie', targetNotes: 'Gastrocnemio', exerciseSetup: '', progressiveOverload: '10-20 reps' },

  // Triceps
  'Dips::Triceps': { name: 'Fondos', targetNotes: 'Cabeza lateral', exerciseSetup: 'Enfoque en tríceps', progressiveOverload: AMRAP },
  'Cable Triceps Kickback::Triceps': { name: 'Patada de tríceps en polea', targetNotes: 'Cabeza lateral', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Overhead Cable Triceps Extension::Triceps': { name: 'Extensión de tríceps sobre la cabeza en polea', targetNotes: 'Cabeza larga', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Skullcrusher::Triceps': { name: 'Press francés (skullcrusher)', targetNotes: 'Cabeza larga', exerciseSetup: '', progressiveOverload: '8-12 reps' },

  // Biceps
  'EZ Bar Curl::Biceps': { name: 'Curl con barra EZ', targetNotes: 'Cabeza corta (interna)', exerciseSetup: '', progressiveOverload: '8-12 reps' },
  'Chinup::Biceps': { name: 'Dominadas supinas (chin-up)', targetNotes: 'Cabeza corta y cabeza larga', exerciseSetup: '', progressiveOverload: AMRAP },
  'Incline Dumbbell Curl::Biceps': { name: 'Curl inclinado con mancuernas', targetNotes: 'Cabeza larga (externa)', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Face Away Bayesian Cable Curl::Biceps': { name: 'Curl bayesiano en polea', targetNotes: 'Cabeza larga (externa)', exerciseSetup: '', progressiveOverload: '10-15 reps' },
  'Hammer Curl::Biceps': { name: 'Curl martillo', targetNotes: 'Braquial', exerciseSetup: '', progressiveOverload: '10-15 reps' },

  // Abs
  'Cable Crunch::Abs': { name: 'Crunch en polea', targetNotes: 'Superior', exerciseSetup: '', progressiveOverload: '15-25 reps' },
  'Crunch Machine::Abs': { name: 'Crunch en máquina', targetNotes: 'Superior', exerciseSetup: '', progressiveOverload: '15-25 reps' },
  'Candlestick::Abs': { name: 'Candlestick (vela)', targetNotes: 'Superior e inferior', exerciseSetup: '', progressiveOverload: AMRAP },
  'Hanging Leg Raise::Abs': { name: 'Elevación de piernas colgado', targetNotes: 'Inferior', exerciseSetup: '', progressiveOverload: '12-20 reps' },
  'Back-Supported Leg Raise::Abs': { name: 'Elevación de piernas con apoyo de espalda', targetNotes: 'Inferior', exerciseSetup: '', progressiveOverload: '15-25 reps' },
  'Super Range Motion Crunch::Abs': { name: 'Crunch de rango completo', targetNotes: 'Superior e inferior', exerciseSetup: '', progressiveOverload: AMRAP },
  'Abs Wheel/Rollout::Abs': { name: 'Rueda abdominal (rollout)', targetNotes: 'Estabilidad del core', exerciseSetup: '', progressiveOverload: AMRAP },

  // Other
  'Foam Rolling::Other': { name: 'Foam roller', targetNotes: 'Liberación miofascial', exerciseSetup: '', progressiveOverload: '30-60 s por zona' },
  'Stretching::Other': { name: 'Estiramientos', targetNotes: 'Flexibilidad general', exerciseSetup: '', progressiveOverload: 'Mantener 20-30 s' },
};
