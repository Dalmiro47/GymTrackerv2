
"use client";

import type { RoutineExercise } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, ListChecks, GripVertical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SelectedRoutineExercisesListProps {
  selectedExercises: RoutineExercise[];
  onRemoveExercise: (exerciseId: string) => void;
  // onReorderExercise?: (exerciseId: string, direction: 'up' | 'down') => void; // For future reordering
}

export function SelectedRoutineExercisesList({
  selectedExercises,
  onRemoveExercise,
}: SelectedRoutineExercisesListProps) {
  return (
    <div className="space-y-3">
        <h3 className="text-lg font-medium flex items-center">
            Selected Exercises for Routine ({selectedExercises.length})
            <ListChecks className="ml-2 h-5 w-5 text-primary" />
        </h3>
      
        <Card className="min-h-[365px] bg-muted/30">
            <CardContent className="p-4">
                {selectedExercises.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
                    <ListChecks className="w-16 h-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground font-semibold">No exercises selected yet.</p>
                    <p className="text-sm text-muted-foreground">
                    Check exercises from the "Available Exercises" list to add them here.
                    </p>
                </div>
                ) : (
                <ScrollArea className="h-[330px] pr-3">
                    <ul className="space-y-2">
                    {selectedExercises.map((exercise, index) => (
                        <li
                        key={exercise.id}
                        className="flex items-center justify-between p-2.5 rounded-md border bg-card shadow-sm"
                        >
                        {/* Drag handle for future reordering 
                        {onReorderExercise && (
                            <Button variant="ghost" size="icon" className="cursor-grab mr-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                            </Button>
                        )}
                        */}
                        <div className="flex-1">
                            <p className="text-sm font-medium">{exercise.name}</p>
                            <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
                        </div>
                        {/* Inputs for sets/reps/notes could go here in future */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveExercise(exercise.id)}
                            aria-label={`Remove ${exercise.name}`}
                            className="text-destructive hover:text-destructive/90"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        </li>
                    ))}
                    </ul>
                </ScrollArea>
                )}
            </CardContent>
        </Card>
    </div>
  );
}
