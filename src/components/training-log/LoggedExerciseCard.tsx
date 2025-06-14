
"use client";

import React, { useState, useEffect } from 'react';
import type { LoggedExercise, LoggedSet } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Save, RotateCcw, GripVertical, Loader2, Check, Settings2 } from 'lucide-react';
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>; // Make it async for the card to await
  onRemove: () => void;
  onRefreshLastPerformance: () => void;
  isSavingParentLog: boolean; 
}

export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onSaveProgress,
  onRemove,
  onRefreshLastPerformance,
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
    setLocalSets(loggedExercise.sets);
  }, [loggedExercise.sets]);

  const handleSetChange = (index: number, field: keyof Omit<LoggedSet, 'id'>, value: string) => {
    const newSets = [...localSets];
    const numericValue = value === '' ? null : parseFloat(value); 
    if (newSets[index]) {
       newSets[index] = { ...newSets[index], [field]: numericValue };
       setLocalSets(newSets);
       onUpdateSets(newSets); 
    }
  };

  const addSet = () => {
    const newSet: LoggedSet = { id: `set-${Date.now()}-${localSets.length + 1}`, reps: null, weight: null };
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
    setJustSaved(false); // Reset justSaved state
    try {
      await onSaveProgress(); 
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000); // Display "Saved!" for 2 seconds
    } catch (error) {
      // Handle error if needed (e.g., show a toast from the card, though hook might also show one)
      console.error("Error saving exercise progress from card:", error);
    } finally {
      setIsSavingThisExercise(false);
    }
  };

  return (
    <Card ref={setNodeRef} style={style} className={cn("shadow-md bg-card/80", isDragging && "ring-2 ring-primary")}>
      <CardHeader className="py-3 px-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
             <button 
                type="button" 
                {...attributes} 
                {...listeners} 
                className="cursor-grab p-1 text-muted-foreground hover:text-foreground touch-none" // Added touch-none
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
        <div className="pl-8 space-y-1"> {/* Indent details to align with title after drag handle */}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                <span>Last: {loggedExercise.lastPerformanceDisplay || 'N/A'}</span>
                <Button variant="link" size="sm" onClick={onRefreshLastPerformance} className="p-0 h-auto text-xs">
                    <RotateCcw className="mr-1 h-3 w-3"/> Refresh
                </Button>
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
            isLastSet={index === localSets.length - 1}
            onAddSet={addSet}
          />
        ))}
        {localSets.length === 0 && (
           <Button variant="outline" size="sm" onClick={addSet} className="w-full">
            <PlusCircle className="mr-2 h-4 w-4" /> Add First Set
          </Button>
        )}
        
        <div className="mt-3 flex justify-end">
           <Button 
            onClick={handleSaveThisExercise} 
            disabled={isSavingThisExercise || isSavingParentLog}
            size="sm"
            className="bg-primary/90 hover:bg-primary min-w-[120px]" // Added min-width
            >
            {isSavingThisExercise ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : 
             justSaved ? <Check className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
            {isSavingThisExercise ? "Saving..." : justSaved ? "Saved!" : "Save Exercise"}
          </Button>
        </div>
        {/* Input for notes on the specific exercise for that day - To be implemented if needed */}
        {/* <Input 
            placeholder="Notes for this exercise (e.g., form cues)" 
            defaultValue={loggedExercise.notes} // This should come from LoggedExercise.notes
            className="mt-2 text-sm"
            // onChange={(e) => onUpdateNotes(e.target.value)} // Need an onUpdateNotes prop
        /> */}
      </CardContent>
    </Card>
  );
}
