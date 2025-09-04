
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { LoggedExercise, LoggedSet, SetStructure } from '@/types';
import { computeWarmup, WarmupInput, type WarmupStep } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Save, GripVertical, Loader2, Check, Settings2, ArrowLeftRight, Flame, TrendingUp } from 'lucide-react';
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { SetStructureBadge } from '../SetStructureBadge';
import { SetStructurePicker } from '../SetStructurePicker';
import { Separator } from '../ui/separator';
import { SET_STRUCTURE_COLORS } from '@/types/setStructure';

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>; 
  onRemove: () => void;
  onReplace: () => void;
  isSavingParentLog: boolean; 
  onMarkAsInteracted: () => void;
  onUpdateSetStructureOverride: (structure: SetStructure | null) => void;
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
            <h4 className="font-medium text-center text-sm px-4">Warm-up Sets</h4>
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

function setsShallowEqual(a: LoggedSet[], b: LoggedSet[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.reps !== y.reps || x.weight !== y.weight) return false;
  }
  return true;
}

export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onSaveProgress,
  onRemove,
  onReplace,
  isSavingParentLog,
  onMarkAsInteracted,
  onUpdateSetStructureOverride,
}: LoggedExerciseCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localSets, setLocalSets] = useState<LoggedSet[]>(loggedExercise.sets);
  const [isSavingThisExercise, setIsSavingThisExercise] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  
  const contentRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const pushUpTimer = useRef<number | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: loggedExercise.id, disabled: isEditing });

  const effectiveSetStructure = useMemo(() => {
    return loggedExercise.setStructureOverride ?? loggedExercise.setStructure ?? 'normal';
  }, [loggedExercise.setStructure, loggedExercise.setStructureOverride]);

  const borderColor = SET_STRUCTURE_COLORS[effectiveSetStructure]?.border ?? 'hsl(var(--border))';
  
  const wrapperStyle = useMemo<React.CSSProperties>(() => ({
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    zIndex: isDragging ? 10 : 'auto',
  }), [transform, transition, isDragging]);
  
  useEffect(() => {
    // Do NOT overwrite while the user is typing in this card
    if (!isEditing && !setsShallowEqual(localSets, loggedExercise.sets)) {
      setLocalSets(loggedExercise.sets);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedExercise.sets, isEditing]);
  
  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (pushUpTimer.current) window.clearTimeout(pushUpTimer.current);
    };
  }, []);

  function pushUp(next: LoggedSet[]) {
    if (pushUpTimer.current) clearTimeout(pushUpTimer.current);
    pushUpTimer.current = window.setTimeout(() => {
      onUpdateSets(next);
    }, 150);
  }

  const handleSetChange = (index: number, field: keyof Omit<LoggedSet, 'id' | 'isProvisional'>, value: string) => {
    onMarkAsInteracted();
    setLocalSets(prev => {
        const next = [...prev];
        const n = value === '' ? null : Number(value);
        if (next[index]) {
            next[index] = { ...next[index], [field]: (Number.isFinite(n) ? n : null), isProvisional: false };
        }
        pushUp(next); // Debounce parent update
        return next; // Local immediately reflects typing
    });
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
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setJustSaved(false), 2000); 
    } catch (error) {
      console.error("Error saving exercise progress from card:", error);
    } finally {
      setIsSavingThisExercise(false);
    }
  };

  return (
    <div ref={setNodeRef} style={wrapperStyle} data-dragging={isDragging || undefined}>
      <Card 
        style={{
          '--card-border-color': borderColor,
        } as React.CSSProperties}
        className={cn(
          "shadow-md transition-all rounded-lg border", 
          "border-[var(--card-border-color)]",
          effectiveSetStructure !== 'normal' && "border-2",
          isDragging && "ring-2 ring-primary"
        )}
      >
        <CardHeader className="py-3 px-4 border-b">
          <div className="flex items-start justify-between">
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
              <div className="flex flex-col gap-1 items-start">
                  <CardTitle className="font-headline text-lg">{loggedExercise.name}</CardTitle>
                  <SetStructureBadge value={effectiveSetStructure} />
              </div>
            </div>
            <div className="flex items-center">
              {loggedExercise.warmupConfig && loggedExercise.warmupConfig.template !== 'NONE' && (
                  <Popover>
                      <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-orange-500 hover:text-orange-400 h-8 w-8">
                              <Flame className="h-4 w-4" />
                          </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px]">
                          <WarmupPanel loggedExercise={loggedExercise} />
                      </PopoverContent>
                  </Popover>
              )}
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
              {loggedExercise.progressiveOverload && (
                <div className="text-xs text-muted-foreground flex items-center">
                  <TrendingUp className="mr-1 h-3 w-3 text-primary" />
                  Progressive overload: {loggedExercise.progressiveOverload}
                </div>
              )}
          </div>
        </CardHeader>
        <CardContent 
          ref={contentRef}
          className="p-4 space-y-3"
          data-dndkit-no-drag
          style={{ WebkitUserSelect: 'text' }}
          onFocusCapture={(e) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
              setIsEditing(true);
            }
          }}
          onBlurCapture={(e) => {
            // iOS often gives null relatedTarget — compute from activeElement
            const active = document.activeElement as HTMLElement | null;
            setIsEditing(!!(active && contentRef.current?.contains(active)));
          }}
        >
          {/* column headers */}
          <div className="grid grid-cols-[2rem_1fr_auto_1fr_auto_2.25rem] items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="w-full text-center">Set</span>
            <span className="w-full text-center">Reps</span>

            {/* keep width for the 'x' column */}
            <span className="invisible select-none w-full text-center" aria-hidden>x</span>

            <span className="w-full text-center">Weight</span>

            {/* keep width for the 'kg' column */}
            <span className="invisible select-none w-full text-center" aria-hidden>kg</span>

            {/* delete button column placeholder */}
            <span className="invisible" aria-hidden />
          </div>

          {localSets.map((set, index) => (
            <SetInputRow
              key={set.id} 
              set={set}
              index={index}
              onSetChange={handleSetChange}
              onRemoveSet={() => removeSet(set.id)}
              isProvisional={set.isProvisional} 
              onInteract={onMarkAsInteracted} 
            />
          ))}
          
          <div className="pt-2">
            <Separator className="mb-4 border-dashed" />
            <div className="flex justify-center">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={addSet} 
                className="border-dashed hover:border-solid hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                disabled={isSavingThisExercise || isSavingParentLog}
              >
                <PlusCircle className="mr-2 h-4 w-4" /> 
                Add Set Here
              </Button>
            </div>
          </div>
          <div className="border-t -mx-4 px-4 pt-4 sm:mx-0 sm:px-0">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  Session Set Structure
                </span>
                <SetStructurePicker
                  className="h-10 w-44 sm:w-56"
                  value={loggedExercise.setStructureOverride ?? (loggedExercise.setStructure ?? 'normal')}
                  onChange={(val) => {
                    onMarkAsInteracted();
                    const base = loggedExercise.setStructure ?? 'normal';
                    const nextOverride = (val === base) ? null : val;
                    onUpdateSetStructureOverride(nextOverride);
                  }}
                  disabled={isSavingThisExercise || isSavingParentLog}
                />
              </div>
              <Button
                onClick={handleSaveThisExercise}
                disabled={isSavingThisExercise || isSavingParentLog}
                className="w-full sm:w-auto sm:ml-auto"
              >
                {isSavingThisExercise ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                  justSaved ? <Check className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                {isSavingThisExercise ? "Saving..." : justSaved ? "Progress Saved!" : "Save Progress"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
