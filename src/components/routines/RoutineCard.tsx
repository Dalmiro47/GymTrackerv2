
import type { Routine } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit3, Trash2, ListChecks, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

interface RoutineCardProps {
  routine: Routine;
  onEdit: (routine: Routine) => void;
  onDelete: (routineId: string) => void;
}

export function RoutineCard({ routine, onEdit, onDelete }: RoutineCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: routine.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "flex h-full flex-col overflow-hidden shadow-lg transition-shadow hover:shadow-xl",
        isDragging && "ring-2 ring-primary ring-offset-2"
      )}
    >
      <CardHeader className="pb-2 relative">
        {/* This div now has pr-10 to make space for the absolute drag handle */}
        <div className="flex items-start justify-between pr-10"> 
            <CardTitle className="font-headline text-xl leading-tight">
            {routine.name}
            </CardTitle>
            <ListChecks className="h-5 w-5 text-primary flex-shrink-0" />
        </div>
        <CardDescription className="text-xs text-muted-foreground">
            {routine.exercises.length} exercise{routine.exercises.length === 1 ? '' : 's'}
        </CardDescription>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute top-2 right-2 p-1.5 cursor-grab text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded-md"
          aria-label={`Drag to reorder ${routine.name}`}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      </CardHeader>
      <CardContent className="flex-grow pb-3">
        <CardDescription className="line-clamp-3 text-sm">
          {routine.description || "No description available."}
        </CardDescription>
        {routine.exercises.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Exercises:</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5 max-h-48 overflow-y-auto">
              {routine.exercises.slice(0, 8).map(ex => (
                <li key={ex.id} className="truncate">{ex.name}</li>
              ))}
              {routine.exercises.length > 8 && <li>...and {routine.exercises.length - 8} more</li>}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2 border-t pt-3 pb-3">
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
