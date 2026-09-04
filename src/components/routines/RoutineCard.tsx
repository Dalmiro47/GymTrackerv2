
import type { Routine } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit3, Trash2, GripVertical, History } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

interface RoutineCardProps {
  routine: Routine;
  onEdit: (routine: Routine) => void;
  onDelete: (routineId: string) => void;
  onViewHistory: (routine: Routine) => void;
}

export function RoutineCard({ routine, onEdit, onDelete, onViewHistory }: RoutineCardProps) {
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
        "flex h-full flex-col overflow-hidden rounded-lg transition-colors hover:border-primary/40",
        isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <CardHeader className="relative space-y-1 pb-2">
        <div className="flex items-start justify-between pr-10">
            <CardTitle className="font-headline text-[20px] leading-tight">
            {routine.name}
            </CardTitle>
            {/* ListChecks icon removed */}
        </div>
        <CardDescription className="text-[12px] text-muted-foreground">
            {routine.exercises.length} exercise{routine.exercises.length === 1 ? '' : 's'}
        </CardDescription>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute right-2 top-2 flex h-10 w-10 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Drag to reorder ${routine.name}`}
        >
          <GripVertical className="h-[18px] w-[18px]" />
        </button>
      </CardHeader>
      <CardContent className="flex-grow pb-3">
        <CardDescription className="line-clamp-3 text-[13px] leading-snug">
          {routine.description || "No description available."}
        </CardDescription>
        {routine.exercises.length > 0 && (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">Exercises</p>
            <ul className="space-y-1 text-[13px] text-muted-foreground">
              {routine.exercises.slice(0, 8).map(ex => (
                <li key={ex.id} className="truncate">{ex.name}</li>
              ))}
              {routine.exercises.length > 8 && <li>…and {routine.exercises.length - 8} more</li>}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-1 border-t p-2">
        <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onViewHistory(routine)} aria-label={`History for ${routine.name}`}>
          <History className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onEdit(routine)} aria-label={`Edit ${routine.name}`}>
          <Edit3 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(routine.id)} aria-label={`Delete ${routine.name}`} className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
