
"use client";

import type { RoutineExercise } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, ListChecks, GripVertical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import React, { useState } from 'react'; // Import React and useState

interface SelectedRoutineExercisesListProps {
  selectedExercises: RoutineExercise[];
  onRemoveExercise: (exerciseId: string) => void;
  onReorderExercises: (reorderedExercises: RoutineExercise[]) => void;
}

export function SelectedRoutineExercisesList({
  selectedExercises,
  onRemoveExercise,
  onReorderExercises,
}: SelectedRoutineExercisesListProps) {
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [dragOverItemIndex, setDragOverItemIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    setDraggedItemIndex(index);
    // Optional: Add a class to the dragged element or use e.dataTransfer for effects
    // e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault(); // Necessary to allow dropping
    if (index !== draggedItemIndex) {
        setDragOverItemIndex(index);
    }
    // e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent<HTMLLIElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === dropIndex) {
      setDraggedItemIndex(null);
      setDragOverItemIndex(null);
      return;
    }

    const items = [...selectedExercises];
    const draggedItem = items.splice(draggedItemIndex, 1)[0];
    items.splice(dropIndex, 0, draggedItem);
    
    onReorderExercises(items);
    setDraggedItemIndex(null);
    setDragOverItemIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedItemIndex(null);
    setDragOverItemIndex(null);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLLIElement>) => {
    // Check if the mouse is truly leaving the droppable area, not just moving over a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDragOverItemIndex(null);
    }
  };


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
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragLeave={handleDragLeave}
                        className={`flex items-center justify-between p-2.5 rounded-md border bg-card shadow-sm cursor-grab ${
                            draggedItemIndex === index ? 'opacity-50 ring-2 ring-primary' : ''
                        } ${dragOverItemIndex === index && draggedItemIndex !== index ? 'border-primary border-dashed border-2' : ''}`}
                        >
                        <div className="flex items-center flex-1">
                            <GripVertical className="h-5 w-5 text-muted-foreground mr-2 cursor-grab" />
                            <div>
                                <p className="text-sm font-medium">{exercise.name}</p>
                                <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
                            </div>
                        </div>
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
