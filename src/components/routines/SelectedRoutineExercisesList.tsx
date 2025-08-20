
"use client";

import type { RoutineExercise, SetStructure } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, ListChecks, GripVertical } from 'lucide-react';
import React from 'react';
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
import { Card } from '../ui/card';
import { SetStructurePicker } from '../SetStructurePicker';

interface SortableExerciseItemProps {
  exercise: RoutineExercise;
  onRemoveExercise: (exerciseId: string) => void;
  onUpdateSetStructure: (exerciseId: string, structure: SetStructure) => void;
}

function SortableExerciseItem({ exercise, onRemoveExercise, onUpdateSetStructure }: SortableExerciseItemProps) {
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
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="p-2.5 rounded-md border bg-card shadow-sm touch-none"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center flex-1">
          <button
            type="button"
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
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemoveExercise(exercise.id)}
          aria-label={`Remove ${exercise.name}`}
          className="text-destructive hover:text-destructive/90"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
       <div className="pl-8 pt-2">
           <SetStructurePicker
              value={exercise.setStructure ?? 'normal'}
              onChange={(value) => onUpdateSetStructure(exercise.id, value)}
            />
        </div>
    </li>
  );
}


interface SelectedRoutineExercisesListProps {
  selectedExercises: RoutineExercise[];
  onRemoveExercise: (exerciseId: string) => void;
  onReorderExercises: (reorderedExercises: RoutineExercise[]) => void;
  onUpdateSetStructure: (exerciseId: string, structure: SetStructure) => void;
}

export function SelectedRoutineExercisesList({
  selectedExercises,
  onRemoveExercise,
  onReorderExercises,
  onUpdateSetStructure,
}: SelectedRoutineExercisesListProps) {
  const isMobile = useIsMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // This is the key fix: it requires a short delay and some movement
      // before a drag is initiated, allowing for scrolling.
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
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
    <div className="space-y-3 h-full flex flex-col">
      <h3 className="text-lg font-medium flex items-center flex-shrink-0">
        Selected Exercises for Routine ({selectedExercises.length})
        <ListChecks className="ml-2 h-5 w-5 text-primary" />
      </h3>

      <div className="flex-grow min-h-0">
        {selectedExercises.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center border rounded-lg bg-muted/30">
            <ListChecks className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
            <p className="text-muted-foreground font-semibold">No exercises selected.</p>
            <p className="text-sm text-muted-foreground">
              Select exercises from the list to add them here.
            </p>
          </div>
        ) : (
           <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Card className="h-full w-full bg-muted/30 p-0 border">
                <ScrollArea className="h-full w-full rounded-md p-4">
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
                          onUpdateSetStructure={onUpdateSetStructure}
                        />
                    ))}
                    </ul>
                </SortableContext>
                </ScrollArea>
            </Card>
          </DndContext>
        )}
      </div>
    </div>
  );
}
