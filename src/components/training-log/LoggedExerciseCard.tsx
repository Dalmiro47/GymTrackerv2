
"use client";

import React, { useState, useEffect } from 'react';
import type { LoggedExercise, LoggedSet } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Save, GripVertical, Loader2, Check, Settings2, LineChart as LineChartIcon } from 'lucide-react';
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VolumeChart } from '@/components/analytics/VolumeChart';

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>; 
  onRemove: () => void;
  isSavingParentLog: boolean; 
  onMarkAsInteracted: () => void;
}

export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onSaveProgress,
  onRemove,
  isSavingParentLog,
  onMarkAsInteracted,
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
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  useEffect(() => {
    setLocalSets(loggedExercise.sets.map(s => ({...s, isProvisional: loggedExercise.isProvisional }))); 
  }, [loggedExercise.sets, loggedExercise.isProvisional]);

  const handleSetChange = (index: number, field: keyof Omit<LoggedSet, 'id' | 'isProvisional'>, value: string) => {
    onMarkAsInteracted(); 
    const newSets = [...localSets];
    const numericValue = value === '' ? null : parseFloat(value); 
    if (newSets[index]) {
       newSets[index] = { ...newSets[index], [field]: numericValue, isProvisional: false };
       setLocalSets(newSets); 
       onUpdateSets(newSets); 
    }
  };

  const addSet = () => {
    onMarkAsInteracted(); 
    const newSet: LoggedSet = { 
        id: `set-${Date.now()}-${localSets.length + 1}`, 
        reps: null, 
        weight: null, 
        isProvisional: false 
    };
    const newSets = [...localSets, newSet];
    setLocalSets(newSets);
    onUpdateSets(newSets);
  };

  const removeSet = (setId: string) => {
    onMarkAsInteracted(); 
    const newSets = localSets.filter(s => s.id !== setId);
    setLocalSets(newSets);
    onUpdateSets(newSets);
  };

  const handleSaveThisExercise = async () => {
    onMarkAsInteracted(); 
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
    <>
      <Card 
        ref={setNodeRef} 
        style={style} 
        className={cn(
          "shadow-md transition-all border rounded-lg", 
          isDragging && "ring-2 ring-primary",
          loggedExercise.isProvisional 
            ? "opacity-60 bg-muted/30 border-dashed border-primary/30" 
            : "opacity-100 bg-card border-border"
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
            <div className="flex items-center">
              <Button variant="ghost" size="icon" onClick={() => setIsHistoryDialogOpen(true)} className="text-primary hover:text-primary/80 h-8 w-8">
                <LineChartIcon className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive hover:text-destructive/90 h-8 w-8">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="pl-8 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                  <span>{loggedExercise.personalRecordDisplay || 'PR: N/A'}</span>
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
              isProvisional={loggedExercise.isProvisional} 
              onInteract={onMarkAsInteracted} 
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
              disabled={isSavingThisExercise || isSavingParentLog} 
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

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="p-2 sm:p-6 w-full max-w-[95vw] sm:max-w-3xl rounded-lg">
           <DialogHeader>
            <DialogTitle className="font-headline text-xl">
              {loggedExercise.name} - Volume History
            </DialogTitle>
            <DialogDescription>
              Track your total volume (sets × reps × weight) over time for this exercise.
            </DialogDescription>
          </DialogHeader>
          <VolumeChart 
            defaultExerciseId={loggedExercise.exerciseId} 
            defaultMuscleGroup={loggedExercise.muscleGroup}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
