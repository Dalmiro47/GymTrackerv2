"use client";

import type { RoutineExercise, SetStructure } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, GripVertical, AlertTriangle, Dumbbell } from 'lucide-react';
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
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useIsMobile } from '@/hooks/use-mobile';
import { SetStructurePicker } from '../SetStructurePicker';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';

interface SortableExerciseItemProps {
  exercise: RoutineExercise;
  index: number;
  onRemoveExercise: (exerciseId: string) => void;
  onUpdateSetStructure: (exerciseId: string, structure: SetStructure) => void;
}

function SortableExerciseItem({ exercise, index, onRemoveExercise, onUpdateSetStructure }: SortableExerciseItemProps) {
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
      className={cn(
        "group flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border bg-card shadow-sm transition-all touch-none",
        isDragging && "shadow-md ring-2 ring-primary/20",
        exercise.isMissing && "border-destructive/50 bg-destructive/5"
      )}
    >
      {/* Left Section: Drag + Info */}
      <div className="flex items-center flex-1 gap-3 overflow-hidden">
        {/* Drag Handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-1.5 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded-md transition-colors"
          aria-label={`Drag to reorder ${exercise.name}`}
          disabled={exercise.isMissing}
        >
          <GripVertical className="h-5 w-5" />
        </button>

        {/* Index Number */}
        <span className="text-xs font-mono font-medium text-muted-foreground/70 w-5 text-center shrink-0">
          {index + 1}
        </span>

        {/* Name & Metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
             <p className="text-sm font-semibold truncate text-foreground">{exercise.name}</p>
             {exercise.isMissing && (
                <Badge variant="destructive" className="h-5 px-1 text-[10px] gap-1">
                    <AlertTriangle className="h-3 w-3"/> Missing
                </Badge>
             )}
          </div>
          <div className="flex items-center gap-2">
             <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal text-muted-foreground bg-muted/50 border-transparent">
               {exercise.muscleGroup}
             </Badge>
          </div>
        </div>
      </div>

      {/* Right Section: Controls */}
      <div className="flex items-center gap-2 pl-10 sm:pl-0">
         {!exercise.isMissing && (
            <div className="w-[140px] sm:w-[160px]">
               <SetStructurePicker
                  value={exercise.setStructure ?? 'normal'}
                  onChange={(value) => onUpdateSetStructure(exercise.id, value)}
                  className="h-8 text-xs" // Assuming SetStructurePicker accepts className for sizing
                />
            </div>
         )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemoveExercise(exercise.id)}
          aria-label={`Remove ${exercise.name}`}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
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
      activationConstraint: isMobile
        ? {
            delay: 150,
            tolerance: 5,
          }
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
    <div className="h-full flex flex-col">
      {/* Header hidden to keep it clean, relying on parent Label */}
      
      <div className="flex-grow min-h-0 bg-muted/5 border rounded-lg overflow-hidden relative">
        {selectedExercises.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center p-6">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Dumbbell className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground">No exercises yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
              Tap "Add Exercises" below to build your routine.
            </p>
          </div>
        ) : (
           <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <ScrollArea className="h-full w-full">
                <SortableContext
                    items={selectedExercises.map(ex => ex.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <ul className="space-y-2 p-3">
                    {selectedExercises.map((exercise, index) => (
                        <SortableExerciseItem
                          key={exercise.id}
                          index={index}
                          exercise={exercise}
                          onRemoveExercise={onRemoveExercise}
                          onUpdateSetStructure={onUpdateSetStructure}
                        />
                    ))}
                    </ul>
                </SortableContext>
            </ScrollArea>
          </DndContext>
        )}
      </div>
    </div>
  );
}
