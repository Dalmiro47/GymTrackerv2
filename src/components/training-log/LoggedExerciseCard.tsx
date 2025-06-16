
"use client";

import React, { useState, useEffect } from 'react';
import type { LoggedExercise, LoggedSet } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Save, GripVertical, Loader2, Check, Settings2 } from 'lucide-react'; // RotateCcw removed
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>; 
  onRemove: () => void;
  // onRefreshPersonalRecord prop removed
  isSavingParentLog: boolean; 
}

export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onSaveProgress,
  onRemove,
  // onRefreshPersonalRecord prop removed from destructuring
  isSavingParentLog
}: LoggedExerciseCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: loggedExercise.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  const [localSets, setLocalSets] = useState<LoggedSet[]>(loggedExercise.sets);
  const [isSavingThisExercise, setIsSavingThisExercise] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    // When the exercise itself changes (e.g. from provisional to not), update local sets
    // and correctly reflect the provisional status in them for styling.
    setLocalSets(loggedExercise.sets.map(s => ({...s, isProvisional: loggedExercise.isProvisional }))); 
  }, [loggedExercise.sets, loggedExercise.isProvisional]);

  const handleSetChange = (index: number, field: keyof Omit<LoggedSet, 'id'>, value: string) => {
    const newSets = [...localSets];
    const numericValue = value === '' ? null : parseFloat(value); 
    if (newSets[index]) {
       // Mark this exercise as no longer provisional because user interacted with its sets
       newSets[index] = { ...newSets[index], [field]: numericValue, isProvisional: false };
       const updatedExerciseWithNonProvisionalSets = {
         ...loggedExercise,
         sets: newSets,
         isProvisional: false // Mark the whole exercise as non-provisional
       };
       setLocalSets(newSets); 
       onUpdateSets(newSets); // This sends all sets up, but we also need to tell the parent exercise is no longer provisional
       // Consider if onUpdateSets should take the whole exercise object or if a separate callback is needed for provisional status.
       // For now, onUpdateSets in useTrainingLog handles marking the exercise non-provisional.
    }
  };

  const addSet = () => {
    const newSet: LoggedSet = { id: `set-${Date.now()}-${localSets.length + 1}`, reps: null, weight: null, isProvisional: false };
    const newSets = [...localSets, newSet];
    setLocalSets(newSets);
    onUpdateSets(newSets);
  };

  const removeSet = (setId: string) => {
    const newSets = localSets.filter(s => s.id !== setId);
    setLocalSets(newSets);
    onUpdateSets(newSets);
  };

  const handleSaveThisExercise = async () => {
    setIsSavingThisExercise(true);
    setJustSaved(false); 
    try {
      await onSaveProgress(); 
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000); 
    } catch (error) {
      console.error("Error saving exercise progress from card:", error);
    } finally {
      setIsSavingThisExercise(false);
    }
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style} 
      className={cn(
        "shadow-md", 
        isDragging && "ring-2 ring-primary",
        loggedExercise.isProvisional ? "bg-muted/30 border-dashed border-primary/50" : "bg-card/80"
      )}
    >
      <CardHeader className="py-3 px-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
             <button 
                type="button" 
                {...attributes} 
                {...listeners} 
                className="cursor-grab p-1 text-muted-foreground hover:text-foreground touch-none"
                aria-label={`Drag to reorder ${loggedExercise.name}`}
            >
              <GripVertical className="h-5 w-5" />
            </button>
            <CardTitle className="font-headline text-lg">{loggedExercise.name}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive hover:text-destructive/90">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="pl-8 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                <span>{loggedExercise.personalRecordDisplay || 'PR: N/A'}</span>
                {/* Refresh PR button removed */}
            </div>
            {loggedExercise.exerciseSetup && (
                <div className="text-xs text-muted-foreground flex items-center">
                    <Settings2 className="mr-1 h-3 w-3 text-primary" />
                    Setup: {loggedExercise.exerciseSetup}
                </div>
            )}
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {localSets.map((set, index) => (
          <SetInputRow
            key={set.id} 
            set={set}
            index={index}
            onSetChange={handleSetChange}
            onRemoveSet={() => removeSet(set.id)}
            isProvisional={loggedExercise.isProvisional} // Pass provisional status to SetInputRow
          />
        ))}
        
        <Button 
          variant="outline" 
          size="sm" 
          onClick={addSet} 
          className="w-full mt-2 border-dashed hover:border-solid hover:bg-primary/5 hover:text-primary"
          disabled={isSavingThisExercise || isSavingParentLog}
        >
          <PlusCircle className="mr-2 h-4 w-4" /> 
          {localSets.length === 0 ? "Add First Set" : "Add Another Set"}
        </Button>
        
        <div className="mt-4 flex justify-end">
           <Button 
            onClick={handleSaveThisExercise} 
            disabled={isSavingThisExercise || isSavingParentLog || !!loggedExercise.isProvisional} // Disable if provisional
            size="sm"
            className="bg-primary/90 hover:bg-primary min-w-[140px]" 
            >
            {isSavingThisExercise ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : 
             justSaved ? <Check className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
            {isSavingThisExercise ? "Saving..." : justSaved ? "Progress Saved!" : "Save Progress"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
