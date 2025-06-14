
import type { Routine } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit3, Trash2, ListChecks } from 'lucide-react';

interface RoutineCardProps {
  routine: Routine;
  onEdit: (routine: Routine) => void;
  onDelete: (routineId: string) => void;
  // onViewDetails?: (routine: Routine) => void; 
}

export function RoutineCard({ routine, onEdit, onDelete }: RoutineCardProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden shadow-lg transition-shadow hover:shadow-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
            <CardTitle className="font-headline text-xl leading-tight">
            {routine.name}
            </CardTitle>
            <ListChecks className="h-5 w-5 text-primary" />
        </div>
        <CardDescription className="text-xs text-muted-foreground">
            {routine.exercises.length} exercise{routine.exercises.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow pb-3">
        <CardDescription className="line-clamp-3 text-sm">
          {routine.description || "No description available."}
        </CardDescription>
        {routine.exercises.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Exercises:</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5 max-h-48 overflow-y-auto">
              {routine.exercises.slice(0, 8).map(ex => ( // Show first 8 exercises
                <li key={ex.id} className="truncate">{ex.name}</li>
              ))}
              {routine.exercises.length > 8 && <li>...and {routine.exercises.length - 8} more</li>}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2 border-t pt-3 pb-3">
        {/* {onViewDetails && (
           <Button variant="outline" size="sm" onClick={() => onViewDetails(routine)} aria-label={`View details for ${routine.name}`}>
            <Info className="h-4 w-4" />
          </Button>
        )} */}
        <Button variant="outline" size="sm" onClick={() => onEdit(routine)} aria-label={`Edit ${routine.name}`}>
          <Edit3 className="h-4 w-4" />
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(routine.id)} aria-label={`Delete ${routine.name}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
