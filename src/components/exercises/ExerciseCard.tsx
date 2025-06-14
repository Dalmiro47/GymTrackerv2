
import type { Exercise } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MuscleGroupIcon } from './MuscleGroupIcon';
import { Edit3, Trash2, Info, Settings2 } from 'lucide-react'; // Added Settings2 for setup

interface ExerciseCardProps {
  exercise: Exercise;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exerciseId: string) => void;
  onViewDetails?: (exercise: Exercise) => void; // Optional: if details view is separate
}

export function ExerciseCard({ exercise, onEdit, onDelete, onViewDetails }: ExerciseCardProps) {
  console.log('ExerciseCard received exercise:', exercise); // DEBUGGING LINE
  return (
    <Card className="flex h-full flex-col overflow-hidden shadow-lg transition-shadow hover:shadow-xl">
      <CardHeader className="pb-2">
        <CardTitle className="font-headline text-xl leading-tight">
          {exercise.name}
        </CardTitle>
        <div className="flex items-center text-sm text-muted-foreground">
          <MuscleGroupIcon muscleGroup={exercise.muscleGroup} className="mr-1.5 text-primary" />
          {exercise.muscleGroup}
        </div>
      </CardHeader>
      <CardContent className="flex-grow pb-3 space-y-1.5">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Target/Notes:</p>
          <CardDescription className="line-clamp-3 text-sm">
            {exercise.targetNotes || "No specific target notes."}
          </CardDescription>
        </div>
        {exercise.exerciseSetup && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground flex items-center">
              <Settings2 className="h-3 w-3 mr-1" />
              Setup:
            </p>
            <CardDescription className="line-clamp-2 text-sm">
              {exercise.exerciseSetup}
            </CardDescription>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2 border-t pt-3 pb-3">
        {onViewDetails && (
           <Button variant="outline" size="sm" onClick={() => onViewDetails(exercise)} aria-label={`View details for ${exercise.name}`}>
            <Info className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onEdit(exercise)} aria-label={`Edit ${exercise.name}`}>
          <Edit3 className="h-4 w-4" />
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(exercise.id)} aria-label={`Delete ${exercise.name}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
