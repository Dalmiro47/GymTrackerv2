
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { LoggedExercise, LoggedSet, SetStructure } from '@/types';
import { computeWarmup, WarmupInput, type WarmupStep } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Save, GripVertical, Loader2, Check, Settings2, ArrowLeftRight, Flame, TrendingUp, Dumbbell, Sparkles } from 'lucide-react';
import { SetInputRow } from './SetInputRow'; 
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { SetStructureBadge } from '../SetStructureBadge';
import { SetStructurePicker } from '../SetStructurePicker';
import { Separator } from '../ui/separator';
import { SET_STRUCTURE_COLORS } from '@/types/setStructure';

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

interface LoggedExerciseCardProps {
  loggedExercise: LoggedExercise;
  onUpdateSets: (sets: LoggedSet[]) => void;
  onSaveProgress: () => Promise<void>;
  onRemove: () => void;
  onReplace: () => void;
  isSavingParentLog: boolean;
  onMarkAsInteracted: () => void;
  onUpdateSetStructureOverride: (exerciseId: string, override: SetStructure | null) => void;
  getExerciseHistory: (exerciseId: string) => Promise<any[]>;
  getOverloadAdvice: (exerciseId: string, history: any[], sets: LoggedSet[]) => Promise<string>;
  isAdviceLoading: boolean;
  adviceMap: Record<string, string>;
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
  getExerciseHistory,
  getOverloadAdvice,
  isAdviceLoading,
  adviceMap,
}: LoggedExerciseCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localSets, setLocalSets] = useState<LoggedSet[]>(loggedExercise.sets);
  const [isSavingThisExercise, setIsSavingThisExercise] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [weightDisplays, setWeightDisplays] = useState<string[]>(
    (loggedExercise.sets ?? []).map(s => s.weight == null ? '' : String(s.weight))
  );
  
  const [isThinking, setIsThinking] = useState(false);
  const advice = adviceMap[loggedExercise.exerciseId];

  useEffect(() => {
    if (!isEditing) {
      setWeightDisplays((loggedExercise.sets ?? []).map(
        s => s.weight == null ? '' : String(s.weight)
      ));
    }
  }, [loggedExercise.sets, isEditing]);
  
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
  } = useSortable({ id: loggedExercise.id });

  const effectiveSetStructure = useMemo(() => {
    return loggedExercise.setStructureOverride ?? loggedExercise.setStructure ?? 'normal';
  }, [loggedExercise.setStructure, loggedExercise.setStructureOverride]);

  const [localStructure, setLocalStructure] = useState(effectiveSetStructure);

  useEffect(() => {
    setLocalStructure(effectiveSetStructure);
  }, [effectiveSetStructure]);

  const borderColor = SET_STRUCTURE_COLORS[localStructure]?.border ?? 'hsl(var(--border))';
  
  const style = useMemo<React.CSSProperties>(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 10 : 'auto',
    willChange: transform ? 'transform' : undefined,
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
    }, 250);
  }

  const handleSetChange = (
    index: number,
    field: 'reps' | 'weight',
    value: string
  ) => {
    onMarkAsInteracted();
  
    // Ignore transient "12." values for weight just in case
    if (field === 'weight' && value.endsWith('.')) {
      return;
    }

    setLocalSets(prev => {
      const next = [...prev];
      if (!next[index]) return prev;
  
      if (field === 'weight') {
        const n = value === '' ? null : Number(value);
        next[index] = { ...next[index], weight: Number.isFinite(n as number) ? (n as number) : null, isProvisional: false };
      } else {
        // Reps: integer 0–99
        let n = value === '' ? null : Number(value);
        if (n != null && Number.isFinite(n)) {
          n = Math.trunc(n);
          if (n < 0) n = 0;
          if (n > 99) n = 99;
        } else {
          n = null;
        }
        next[index] = { ...next[index], reps: n as number | null, isProvisional: false };
      }
  
      pushUp(next);
      return next;
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
  
  const handleGetOverloadAdvice = async () => {
      // Use the global loading state and local state as guardrails
      if (isThinking || isAdviceLoading) return;
      setIsThinking(true);
      try {
          // 1. Placeholder call to get history (will be fully functional in Task 2)
          const history = await getExerciseHistory(loggedExercise.exerciseId);
          // 2. Placeholder call to get advice (will be fully functional in Task 4)
          await getOverloadAdvice(loggedExercise.exerciseId, history, loggedExercise.sets);
      } catch (error) {
          console.error('AI Overload Advice failed:', error);
      } finally {
          setIsThinking(false);
      }
  };

  return (
    <div ref={setNodeRef} style={style} data-dragging={isDragging || undefined}>
      <Card 
        style={{
          '--card-border-color': borderColor,
        } as React.CSSProperties}
        className={cn(
          "shadow-md transition-all rounded-lg border", 
          "border-[var(--card-border-color)]",
          localStructure !== 'normal' && "border-2",
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
                  aria-roledescription="Draggable exercise"
              >
                <GripVertical className="h-5 w-5" />
              </button>
              <div className="flex flex-col gap-1 items-start">
                  <CardTitle className="font-headline text-lg">{loggedExercise.name}</CardTitle>
                  <SetStructureBadge value={localStructure} />
              </div>
            </div>
            <div className="flex items-center">
              <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleGetOverloadAdvice}
                  disabled={isThinking || isAdviceLoading}
                  className="text-yellow-500 hover:bg-yellow-100/50 h-8 w-8"
                  title="AI Progressive Overload Advice"
              >
                  {(isThinking || isAdviceLoading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
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
          <div className="pl-8 space-y-0.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
              <span className="flex items-center leading-tight">
                <Dumbbell aria-hidden="true" className="mr-1.5 h-3 w-3 text-primary" />
                <span className="tabular-nums">{loggedExercise.personalRecordDisplay || 'PR: N/A'}</span>
              </span>
            </div>
            {loggedExercise.exerciseSetup && (
                <div className="text-xs text-muted-foreground flex items-center leading-tight">
                    <Settings2 aria-hidden="true" className="mr-1 h-3 w-3 text-primary" />
                    Setup: {loggedExercise.exerciseSetup}
                </div>
            )}
            {loggedExercise.progressiveOverload && (
              <div className="text-xs text-muted-foreground flex items-center leading-tight">
                <TrendingUp aria-hidden="true" className="mr-1 h-3 w-3 text-primary" />
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
          {advice && (
              <div className="mb-4 p-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 dark:bg-yellow-900/20">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 flex items-start">
                      <Sparkles className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                      {advice}
                  </p>
              </div>
          )}
          {/* column headers */}
          <div className="grid grid-cols-[2rem_1fr_auto_1fr_auto_2.25rem] items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="w-full text-center">Set</span>
            <span className="w-full text-center">Reps</span>
            <span className="invisible select-none w-full text-center" aria-hidden>x</span>
            <span className="w-full text-center">Weight</span>
            <span className="invisible select-none w-full text-center" aria-hidden>kg</span>
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
              weightDisplay={weightDisplays[index] ?? ''}
              setWeightDisplay={(val) => 
                setWeightDisplays(prev => {
                  const next = [...prev];
                  next[index] = val;
                  return next;
                })
              }
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
            <div
              className="flex items-center gap-2 flex-1"
              onPointerDownCapture={(e) => e.stopPropagation()}
            >
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Session Set Structure
              </span>

              <SetStructurePicker
                className="h-10 w-44 sm:w-56"
                value={localStructure}
                onChange={(val) => {
                  onMarkAsInteracted();
                  setLocalStructure(val);
                  const base = loggedExercise.setStructure ?? 'normal';
                  const nextOverride = (val === base) ? null : val;
                  onUpdateSetStructureOverride(loggedExercise.id, nextOverride);
                }}
                disabled={isSavingThisExercise || isSavingParentLog}
              />
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-3 mt-4">
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

    
