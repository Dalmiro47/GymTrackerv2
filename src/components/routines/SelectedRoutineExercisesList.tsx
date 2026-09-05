"use client";

import type { RoutineExercise, SetStructure } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, GripVertical, AlertTriangle, Dumbbell, ChevronDown, Plus, PlusCircle, ArrowLeftRight } from 'lucide-react';
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
import { RoutineGroupConnector } from '@/components/training-log/RoutineGroupConnector';
import { SET_STRUCTURE_COLORS } from '@/types/setStructure'; // Import colors
import { useI18n } from '@/contexts/LanguageContext';
import { muscleGroupLabel } from '@/i18n';
import { displayExerciseName } from '@/lib/exerciseDisplay';

// Helper for group sizes
const getGroupSize = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'superset': return 2;
      case 'triset': return 3;
      case 'giant set': return 99;
      default: return 1;
    }
  };

interface SortableExerciseItemProps {
  exercise: RoutineExercise;
  index: number;
  onRemoveExercise: (exerciseId: string) => void;
  onReplaceExercise: (index: number) => void;
  onUpdateSetStructure: (exerciseId: string, structure: SetStructure) => void;
  onInsertExercise: (index: number) => void;
  isLinkedToNext: boolean;
}

function SortableExerciseItem({
    exercise,
    index,
    onRemoveExercise,
    onReplaceExercise,
    onUpdateSetStructure,
    onInsertExercise,
    isLinkedToNext
}: SortableExerciseItemProps) {
  const { t, language } = useI18n();
  const shownName = displayExerciseName(exercise, language);
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

  // Determine border color based on set structure
  const structure = exercise.setStructure || 'normal';
  const theme = SET_STRUCTURE_COLORS[structure] || SET_STRUCTURE_COLORS.normal;
  const isSpecialStructure = structure !== 'normal';

  return (
    <React.Fragment>
      <li
        ref={setNodeRef}
        style={{
            ...style,
            // Use CSS variable or direct style for dynamic border color
            borderColor: isSpecialStructure ? theme.border : undefined
        }}
        className={cn(
          "group relative min-h-[52px] touch-none overflow-hidden rounded-md border bg-card transition-colors",
          // Default hover style if normal, otherwise the style prop handles the color
          !isSpecialStructure ? "hover:border-primary/30" : "hover:border-[theme.border]",
          // Add border width if special structure to make it pop
          isSpecialStructure && "border-2", 
          isDragging && "shadow-md ring-2 ring-primary/20 z-50",
          exercise.isMissing && "border-destructive/50 bg-destructive/5"
        )}
      >
        <div className="flex items-center gap-3 p-3">
          
          {/* COL 1: Drag Handle & Index */}
          <div className="flex items-center gap-3 shrink-0 self-center">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="-ml-1.5 flex h-10 w-10 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
              aria-label={t('card.dragToReorder', { name: shownName })}
              disabled={exercise.isMissing}
            >
              <GripVertical className="h-[18px] w-[18px]" />
            </button>
            <span className="w-5 text-center text-[12px] font-medium tabular-nums text-muted-foreground/60">
              {index + 1}
            </span>
          </div>

          {/* RESPONSIVE WRAPPER */}
          <div className="flex flex-col sm:flex-row sm:items-center flex-grow min-w-0 gap-3 sm:gap-4">
            
            {/* NAME SECTION */}
            <div className="flex flex-col justify-center min-w-0 flex-grow">
                <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-semibold text-foreground">{shownName}</p>
                    {exercise.isMissing && (
                        <Badge variant="destructive" className="h-5 px-1 text-[10px] gap-1 shrink-0">
                            <AlertTriangle className="h-3 w-3"/> {t('routineForm.missing')}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center mt-0.5">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal text-muted-foreground bg-muted/50 border-transparent">
                      {muscleGroupLabel(exercise.muscleGroup, language)}
                    </Badge>
                </div>
            </div>

            {/* CONTROLS SECTION */}
            <div className="flex items-center justify-end gap-2 sm:gap-4 shrink-0">

                {/* Set Picker */}
                {!exercise.isMissing && (
                    <div className="relative w-[116px] sm:w-[130px] border rounded-md bg-background shadow-sm overflow-hidden group/picker">
                      <SetStructurePicker
                          value={exercise.setStructure ?? 'normal'}
                          onChange={(value) => onUpdateSetStructure(exercise.id, value)}
                          className="h-8 text-xs w-full border-none focus:ring-0 pr-6 relative z-10 bg-transparent appearance-none" 
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none z-0 text-muted-foreground/50 group-hover/picker:text-foreground">
                            <ChevronDown className="h-3.5 w-3.5" />
                        </div>
                    </div>
                )}

                {/* Separator Line */}
                <div className="hidden sm:block h-6 w-px bg-border" />

                {/* Replace Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onReplaceExercise(index)}
                  aria-label={t('card.replace', { name: shownName })}
                  className="h-10 w-10 rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>

                {/* Delete Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveExercise(exercise.id)}
                  aria-label={t('card.remove', { name: shownName })}
                  className="h-10 w-10 rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
            </div>

          </div>

        </div>
      </li>
      
      {/* Connector OR Insertion Button */}
      {isLinkedToNext ? (
          <div className="py-1">
             <RoutineGroupConnector structure={exercise.setStructure || 'normal'} />
          </div>
      ) : (
          <div className="flex items-center justify-center py-2">
              <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onInsertExercise(index + 1)}
                  className="h-9 gap-1 rounded-full border border-dashed border-border px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
              >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>{t('routineForm.insertHere')}</span>
              </Button>
          </div>
      )}
    </React.Fragment>
  );
}


interface SelectedRoutineExercisesListProps {
  selectedExercises: RoutineExercise[];
  onRemoveExercise: (exerciseId: string) => void;
  onReplaceExercise: (index: number) => void;
  onReorderExercises: (reorderedExercises: RoutineExercise[]) => void;
  onUpdateSetStructure: (exerciseId: string, structure: SetStructure) => void;
  onInsertExercise: (index: number) => void;
}

export function SelectedRoutineExercisesList({
  selectedExercises,
  onRemoveExercise,
  onReplaceExercise,
  onReorderExercises,
  onUpdateSetStructure,
  onInsertExercise,
}: SelectedRoutineExercisesListProps) {
  const { t } = useI18n();
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
      <div className="relative min-h-0 flex-grow overflow-hidden rounded-md border">
        {selectedExercises.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center p-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Dumbbell className="h-6 w-6" />
            </div>
            <p className="font-headline text-[20px] font-semibold leading-tight text-foreground">{t('routineForm.noExercisesYet')}</p>
            <p className="mt-1 max-w-[220px] text-[13px] text-muted-foreground">
              {t('routineForm.tapAdd')}
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
                    <ul className="p-3">
                    {/* Explicit "Start" Insertion Point */}
                    <div className="flex items-center justify-center pb-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onInsertExercise(0)}
                            className="h-9 gap-1 rounded-full border border-dashed border-border px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                        >
                            <PlusCircle className="h-3.5 w-3.5" />
                            <span>{t('routineForm.insertAtStart')}</span>
                        </Button>
                    </div>

                    {selectedExercises.map((exercise, index) => {
                        // --- SMART GROUPING LOGIC ---
                        const currentStructure = exercise.setStructure || 'normal';
                        const nextExercise = selectedExercises[index + 1];
                        const nextStructure = nextExercise ? (nextExercise.setStructure || 'normal') : 'normal';

                        let shouldLink = false;
                        if (nextExercise && currentStructure !== 'normal' && currentStructure === nextStructure) {
                            let streak = 1;
                            for (let i = index - 1; i >= 0; i--) {
                                const prev = selectedExercises[i];
                                if ((prev.setStructure || 'normal') === currentStructure) {
                                    streak++;
                                } else {
                                    break;
                                }
                            }
                            const maxSize = getGroupSize(currentStructure);
                            if (streak % maxSize !== 0) {
                                shouldLink = true;
                            }
                        }
                        // -----------------------------------------------------

                        return (
                            <SortableExerciseItem
                              key={exercise.id}
                              index={index}
                              exercise={exercise}
                              onRemoveExercise={onRemoveExercise}
                              onReplaceExercise={onReplaceExercise}
                              onUpdateSetStructure={onUpdateSetStructure}
                              onInsertExercise={onInsertExercise}
                              isLinkedToNext={shouldLink}
                            />
                        );
                    })}
                    </ul>
                </SortableContext>
            </ScrollArea>
          </DndContext>
        )}
      </div>
    </div>
  );
}
