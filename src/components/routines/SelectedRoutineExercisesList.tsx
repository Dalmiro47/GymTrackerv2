
"use client";

import type { RoutineExercise } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, ListChecks, GripVertical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useIsMobile } from '@/hooks/use-mobile';

interface SortableExerciseItemProps {
  exercise: RoutineExercise;
  onRemoveExercise: (exerciseId: string) => void;
}

function SortableExerciseItem({ exercise, onRemoveExercise }: SortableExerciseItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 0,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-2.5 rounded-md border bg-card shadow-sm touch-none" // touch-none is important for PointerSensor
    >
      <div className="flex items-center flex-1">
        <button
          type="button" // This is the fix!
          {...attributes}
          {...listeners}
          className="p-1 cursor-grab mr-2 text-muted-foreground hover:text-foreground"
          aria-label={`Drag to reorder ${exercise.name}`}
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <div>
          <p className="text-sm font-medium">{exercise.name}</p>
          <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
        </div>
      </div>
      <Button
        type="button" // Also good practice for buttons not intended to submit
        variant="ghost"
        size="icon"
        onClick={() => onRemoveExercise(exercise.id)}
        aria-label={`Remove ${exercise.name}`}
        className="text-destructive hover:text-destructive/90"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}


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
  const isMobile = useIsMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile
        ? { delay: 200, tolerance: 8 }
        : undefined,
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = selectedExercises.findIndex((ex) => ex.id === active.id);
      const newIndex = selectedExercises.findIndex((ex) => ex.id === over.id);
      onReorderExercises(arrayMove(selectedExercises, oldIndex, newIndex));
    }
  }

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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <ScrollArea className="h-[330px] pr-3">
                <SortableContext
                  items={selectedExercises.map(ex => ex.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-2">
                    {selectedExercises.map((exercise) => (
                      <SortableExerciseItem
                        key={exercise.id}
                        exercise={exercise}
                        onRemoveExercise={onRemoveExercise}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </ScrollArea>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
