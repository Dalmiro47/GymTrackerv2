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
        "group relative bg-card border rounded-lg shadow-sm transition-all touch-none overflow-hidden hover:border-primary/30",
        isDragging && "shadow-md ring-2 ring-primary/20 z-50",
        exercise.isMissing && "border-destructive/50 bg-destructive/5"
      )}
    >
      <div className="flex items-center gap-3 p-3">
        
        {/* COL 1: Drag Handle & Index */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="p-1.5 -ml-1.5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground hover:bg-muted rounded-md transition-colors"
            aria-label={`Drag to reorder ${exercise.name}`}
            disabled={exercise.isMissing}
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <span className="text-xs font-mono font-medium text-muted-foreground/60 w-5 text-center">
            {index + 1}
          </span>
        </div>

        {/* COL 2: Name & Badge (Flex Grow) */}
        <div className="flex flex-col justify-center min-w-0 flex-grow mr-4">
             <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate text-foreground">{exercise.name}</p>
                {exercise.isMissing && (
                    <Badge variant="destructive" className="h-5 px-1 text-[10px] gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3"/> Missing
                    </Badge>
                )}
             </div>
             <div className="flex items-center mt-0.5">
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal text-muted-foreground bg-muted/50 border-transparent">
                  {exercise.muscleGroup}
                </Badge>
             </div>
        </div>

        {/* COL 3: Controls Group (Right Aligned) */}
        <div className="flex items-center gap-4 ml-auto shrink-0">
          
          {/* Set Picker - Distinct Container */}
          {!exercise.isMissing && (
              <div className="w-[140px]">
                 {/* NOTE: SetStructurePicker should render a SelectTrigger. 
                    We style it to look independent.
                 */}
                 <SetStructurePicker
                    value={exercise.setStructure ?? 'normal'}
                    onChange={(value) => onUpdateSetStructure(exercise.id, value)}
                    className="h-8 text-xs w-full bg-background border shadow-sm" 
                  />
              </div>
           )}

          {/* Delete Button - Distinct Container */}
          <div className="flex items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemoveExercise(exercise.id)}
              aria-label={`Remove ${exercise.name}`}
              className="text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
