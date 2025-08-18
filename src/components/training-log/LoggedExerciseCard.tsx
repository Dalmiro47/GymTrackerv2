
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import type { LoggedExercise, LoggedSet, WarmupConfig, WarmupStep } from '@/types';
import { computeWarmup, WarmupInput } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Save, GripVertical, Loader2, Check, Settings2, ArrowLeftRight, Flame } from 'lucide-react';
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>; 
  onRemove: () => void;
  onReplace: () => void;
  isSavingParentLog: boolean; 
  onMarkAsInteracted: () => void;
}

const WarmupPanel: React.FC<{ loggedExercise: LoggedExercise }> = ({ loggedExercise }) => {
    const router = useRouter();
    const workingWeight = useMemo(() => {
        return loggedExercise.sets.reduce((max, set) => Math.max(max, set.weight || 0), 0);
    }, [loggedExercise.sets]);

    const warmupSteps: WarmupStep[] = useMemo(() => {
        if (!loggedExercise.warmupConfig || workingWeight <= 0) return [];
        
        const input: WarmupInput = {
            template: loggedExercise.warmupConfig.template,
            workingWeight: workingWeight,
            isWeightedBodyweight: loggedExercise.warmupConfig.isWeightedBodyweight,
            overrideSteps: loggedExercise.warmupConfig.overrideSteps,
        };
        return computeWarmup(input);
    }, [loggedExercise.warmupConfig, workingWeight]);

    if (workingWeight <= 0) {
        return <div className="p-4 text-sm text-muted-foreground">Enter a working weight to calculate warm-ups.</div>;
    }
    if (warmupSteps.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground">No warm-up sets needed for this exercise.</div>
    }

    return (
        <div className="space-y-4">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Set</TableHead>
                        <TableHead>Weight</TableHead>
                        <TableHead>Reps</TableHead>
                        <TableHead>Rest</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {warmupSteps.map((step, index) => (
                        <TableRow key={index}>
                            <TableCell>{step.label}</TableCell>
                            <TableCell>
                                {`${step.weightTotal}kg`}
                            </TableCell>
                            <TableCell>{step.reps}</TableCell>
                            <TableCell>{step.rest}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <div className="px-4 text-xs text-muted-foreground space-y-1">
                <p>Rest between sets: Warm-ups: 30–90s • Compounds: 2–3 min • Isolations: 1–2 min</p>
                <Button variant="link" className="p-0 h-auto" onClick={() => router.push(`/exercises?edit=${loggedExercise.exerciseId}`)}>
                    Edit warm-up settings
                </Button>
            </div>
        </div>
    );
};


export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onSaveProgress,
  onRemove,
  onReplace,
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
              {loggedExercise.warmupConfig && loggedExercise.warmupConfig.template !== 'NONE' && (
                  <Popover>
                      <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-orange-500 hover:text-orange-400 h-7 w-7">
                              <Flame className="h-4 w-4" />
                          </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px]">
                          <WarmupPanel loggedExercise={loggedExercise} />
                      </PopoverContent>
                  </Popover>
              )}
            </div>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" onClick={onReplace} className="text-primary hover:text-primary/80 h-8 w-8" aria-label={`Replace ${loggedExercise.name}`}>
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive hover:text-destructive/90 h-8 w-8" aria-label={`Remove ${loggedExercise.name}`}>
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
    </>
  );
}
