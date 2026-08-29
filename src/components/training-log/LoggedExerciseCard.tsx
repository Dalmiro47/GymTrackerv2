"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { LoggedExercise, LoggedSet, SetStructure } from '@/types';
import { computeWarmup, inferWarmupTemplate, WarmupInput, type WarmupStep } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, GripVertical, Settings2, ArrowLeftRight, Flame, TrendingUp, Dumbbell, X, ArrowUpCircle, ArrowDownCircle, History } from 'lucide-react';
import { differenceInCalendarDays } from 'date-fns';
import { parseRepRange, isRepGoalReached, isBelowRepRange, getNextRepTarget, suggestWeightBump, type NextRepTarget } from '@/lib/repGoal';
import { formatWeightHalf } from '@/lib/rounding';
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
        if (!loggedExercise.warmupConfig || (workingWeight <= 0 && loggedExercise.warmupConfig.template !== 'BODYWEIGHT')) return [];
        // For Bodyweight, we want to show steps even if workingWeight is 0 (handled in utils)

        const input: WarmupInput = {
            template: loggedExercise.warmupConfig.template,
            workingWeight: workingWeight,
            // Lower-body barbell lifts get an extra "Empty Bar" step
            isLowerBodyBarbell: inferWarmupTemplate(loggedExercise.name).isLowerBodyBarbell,
            overrideSteps: loggedExercise.warmupConfig.overrideSteps,
        };
        return computeWarmup(input);
    }, [loggedExercise.warmupConfig, loggedExercise.name, workingWeight]);

    if (workingWeight <= 0 && loggedExercise.warmupConfig?.template !== 'BODYWEIGHT') {
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
                                {step.weightTotal > 0 ? `${step.weightTotal}kg` : '-'}
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

// Centered modal for warm-up sets — styled to match the AI Coach window so it
// reads as a distinct dialog rather than a full-width sheet glued to the page.
const WarmupModal: React.FC<{ loggedExercise: LoggedExercise; onClose: () => void }> = ({ loggedExercise, onClose }) => {
    // Lock body scroll while open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[49] bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />
            {/* Floating panel — centered, constrained width like the AI Coach dialog */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Warm-up sets"
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex flex-col rounded-2xl border bg-background shadow-2xl"
                style={{ width: 'min(360px, calc(100vw - 2rem))', maxHeight: 'calc(100dvh - 4rem)' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Flame className="h-5 w-5 text-chart-5" />
                        <div>
                            <p className="text-sm font-semibold leading-tight">Warm-up Sets</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[220px]">{loggedExercise.name}</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close warm-up">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                {/* Body */}
                <div className="overflow-y-auto py-4">
                    <WarmupPanel loggedExercise={loggedExercise} />
                </div>
            </div>
        </>,
        document.body,
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
  onRemove: () => void;
  onReplace: () => void;
  isSavingParentLog: boolean;
  onUpdateSetStructureOverride: (exerciseId: string, override: SetStructure | null) => void;
  /** Deload Mode shows a derived (reduced) view — set values must not be edited
   *  there, or the reduced numbers would be written back into the baseline. */
  isReadOnly?: boolean;
  /** True when this exercise's sets already match the saved log for this day.
   *  Suppresses the overload cues/targets: guidance is for work not yet saved. */
  isSavedForDay?: boolean;
}

export function LoggedExerciseCard({
  loggedExercise,
  onUpdateSets,
  onRemove,
  onReplace,
  isSavingParentLog,
  onUpdateSetStructureOverride,
  isReadOnly = false,
  isSavedForDay = false,
}: LoggedExerciseCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localSets, setLocalSets] = useState<LoggedSet[]>(loggedExercise.sets);
  const [warmupOpen, setWarmupOpen] = useState(false);
  const [weightDisplays, setWeightDisplays] = useState<string[]>(
    (loggedExercise.sets ?? []).map(s => s.weight == null ? '' : String(s.weight))
  );
  
  useEffect(() => {
    if (!isEditing) {
      setWeightDisplays((loggedExercise.sets ?? []).map(
        s => s.weight == null ? '' : String(s.weight)
      ));
    }
  }, [loggedExercise.sets, isEditing]);
  
  const contentRef = useRef<HTMLDivElement | null>(null);
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

  // "Last session" chip: shown only while the card is still the untouched pre-fill
  // (planned, not done). Disappears as soon as any set is edited.
  const lastTimeLabel = useMemo(() => {
    const pf = loggedExercise.prefill;
    if (!loggedExercise.isProvisional || !pf || pf.lastPerformedDate == null) return null;
    if (!pf.sets.some(s => s.reps != null || s.weight != null)) return null;
    // The sets themselves are already visible in the inputs below — the chip
    // only needs to say "this is pre-filled" and from when, so it stays short.
    const days = differenceInCalendarDays(new Date(), new Date(pf.lastPerformedDate));
    const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days}d ago` : `${Math.round(days / 7)}w ago`;
    return `Last session · ${when}`;
  }, [loggedExercise.prefill, loggedExercise.isProvisional]);

  // Progressive-overload cue: every set at the top of the exercise's rep range
  // means it's time to add weight; every set under the bottom means the load is
  // too heavy. Reads `localSets` so it reacts as you type. Suppressed in Deload
  // Mode — the shown values are a derived, reduced view — and once the exercise
  // is saved for the day (the increase belongs to the next session by then).
  const repRange = useMemo(
    () => parseRepRange(loggedExercise.progressiveOverload),
    [loggedExercise.progressiveOverload]
  );
  const rawCue = useMemo<'above' | 'below' | null>(() => {
    if (isReadOnly || isSavedForDay || !repRange) return null;
    if (isRepGoalReached(localSets, repRange)) return 'above';
    if (isBelowRepRange(localSets, repRange)) return 'below';
    return null;
  }, [isReadOnly, isSavedForDay, localSets, repRange]);

  // The under-range cue fires on a single set, which puts it in the path of every
  // keystroke — typing "12" into an 8–12 range passes through "1". Let it settle
  // before showing, but drop it immediately once it no longer applies. ("above"
  // needs every set at the top, so it can't trigger mid-typing and isn't delayed.)
  const [belowCueSettled, setBelowCueSettled] = useState(false);
  useEffect(() => {
    if (rawCue !== 'below') {
      setBelowCueSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setBelowCueSettled(true), 600);
    return () => window.clearTimeout(timer);
  }, [rawCue]);

  const repCue = rawCue === 'below' && !belowCueSettled ? null : rawCue;

  // "What do I do next?" for the in-range case the two cues above leave open.
  // Only one of the three ever shows: the target yields to an active cue.
  const rawNextTarget = useMemo<NextRepTarget | null>(() => {
    if (isReadOnly || isSavedForDay || rawCue) return null;
    return getNextRepTarget(localSets, repRange);
  }, [isReadOnly, isSavedForDay, rawCue, localSets, repRange]);

  // Every keystroke re-targets (9 → 1 → 10 walks through three different answers),
  // and this one renders inside a set row, so an un-delayed version would shuffle
  // the rows as you type. Show a settled snapshot instead: it appears once typing
  // stops and disappears at once when it no longer applies.
  // Only meaningful for the "above" cue, so it isn't computed for the others.
  const weightBump = useMemo(
    () => (repCue === 'above' ? suggestWeightBump(localSets) : null),
    [repCue, localSets]
  );

  const [nextTarget, setNextTarget] = useState<NextRepTarget | null>(null);
  useEffect(() => {
    if (!rawNextTarget) {
      setNextTarget(null);
      return;
    }
    const timer = window.setTimeout(() => setNextTarget(rawNextTarget), 600);
    return () => window.clearTimeout(timer);
  }, [rawNextTarget]);

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
  
  // Latest debounced value not yet pushed to the parent. Flushed on blur (a
  // tap on Save blurs the input first) and on unmount, so a keystroke within
  // the 250 ms window is never lost.
  const pendingPush = useRef<LoggedSet[] | null>(null);
  const onUpdateSetsRef = useRef(onUpdateSets);
  onUpdateSetsRef.current = onUpdateSets;

  const flushPush = useCallback(() => {
    if (pushUpTimer.current) {
      window.clearTimeout(pushUpTimer.current);
      pushUpTimer.current = null;
    }
    if (pendingPush.current) {
      const next = pendingPush.current;
      pendingPush.current = null;
      onUpdateSetsRef.current(next);
    }
  }, []);

  useEffect(() => {
    return () => { flushPush(); };
  }, [flushPush]);

  function pushUp(next: LoggedSet[]) {
    if (pushUpTimer.current) clearTimeout(pushUpTimer.current);
    pendingPush.current = next;
    pushUpTimer.current = window.setTimeout(() => {
      pushUpTimer.current = null;
      pendingPush.current = null;
      onUpdateSets(next);
    }, 250);
  }

  const handleSetChange = (
    index: number,
    field: 'reps' | 'weight',
    value: string
  ) => {
    if (isReadOnly) return;
  
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
    if (isReadOnly) return;
    const newSet: LoggedSet = {
        id: `set-${Date.now()}-${localSets.length + 1}`,
        reps: null,
        weight: null,
        isProvisional: false
    };
    const newSets = [...localSets, newSet];
    setLocalSets(newSets);
    setWeightDisplays(prev => [...prev, '']);
    onUpdateSets(newSets);
  };

  const removeSet = (setId: string) => {
    if (isReadOnly) return;
    const removedIndex = localSets.findIndex(s => s.id === setId);
    const newSets = localSets.filter(s => s.id !== setId);
    setLocalSets(newSets);
    // Keep the index-aligned weight display strings in sync with the sets
    if (removedIndex !== -1) {
      setWeightDisplays(prev => prev.filter((_, i) => i !== removedIndex));
    }
    onUpdateSets(newSets);
  };

  return (
    <div ref={setNodeRef} style={style} data-dragging={isDragging || undefined}>
      <Card 
        style={{
          '--card-border-color': borderColor,
        } as React.CSSProperties}
        className={cn(
          "shadow-sm transition-all rounded-lg border",
          "border-[var(--card-border-color)]",
          localStructure !== 'normal' && "border-2",
          // No rep-cue ring here on purpose: this border is the set-structure
          // channel. The cue lives in the sets band inside CardContent.
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
              {loggedExercise.warmupConfig && loggedExercise.warmupConfig.template !== 'NONE' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setWarmupOpen(true)}
                    className="text-chart-5 hover:text-chart-5/80 h-8 w-8"
                    aria-label={`Warm-up sets for ${loggedExercise.name}`}
                  >
                      <Flame className="h-4 w-4" />
                  </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onReplace} className="text-primary hover:text-primary/80 h-8 w-8" aria-label={`Replace ${loggedExercise.name}`}>
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive hover:text-destructive/90 h-8 w-8" aria-label={`Remove ${loggedExercise.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="pl-8 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary leading-tight">
              <Dumbbell aria-hidden="true" className="h-3 w-3" />
              <span className="tabular-nums">{loggedExercise.personalRecordDisplay || 'PR: N/A'}</span>
            </span>
            {lastTimeLabel && (
              <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground leading-tight" title="Sets pre-filled from your last session. Edit a set to log it as done.">
                <History aria-hidden="true" className="h-3 w-3" />
                <span className="tabular-nums">{lastTimeLabel}</span>
              </span>
            )}
            {loggedExercise.exerciseSetup && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground leading-tight">
                    <Settings2 aria-hidden="true" className="h-3 w-3" />
                    {loggedExercise.exerciseSetup}
                </span>
            )}
            {loggedExercise.progressiveOverload && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-tight",
                  repCue === 'above' && "border border-success/30 bg-success/10 font-medium text-success",
                  repCue === 'below' && "border border-chart-4/30 bg-chart-4/10 font-medium text-chart-4",
                  !repCue && "bg-muted text-muted-foreground"
                )}
              >
                <TrendingUp aria-hidden="true" className="h-3 w-3" />
                {loggedExercise.progressiveOverload}
              </span>
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
            const stillInside = !!(active && contentRef.current?.contains(active));
            setIsEditing(stillInside);
            if (!stillInside) flushPush();
          }}
        >
          {/* Rep-cue band. The card's outer border belongs to the set-structure
              palette, so the cue can't use it — a second ring there reads as two
              competing outlines. Instead the sets section itself becomes the
              highlight: a full-bleed tinted band with only top/bottom edges, so
              nothing ever runs parallel to the structure border.
              Always rendered (only its colors toggle) so the set inputs are never
              remounted mid-typing, and its padding never shifts the layout. */}
          <div
            className={cn(
              "-mx-4 px-4 py-3 space-y-3 border-y border-transparent transition-colors duration-300",
              repCue === 'above' && "border-success/25 bg-success/5",
              repCue === 'below' && "border-chart-4/25 bg-chart-4/5"
            )}
          >
            {repCue && repRange && (
              <p
                role="status"
                className={cn(
                  "flex items-start gap-2 text-xs leading-snug",
                  repCue === 'above' ? "text-success" : "text-chart-4"
                )}
              >
                {repCue === 'above' ? (
                  <ArrowUpCircle aria-hidden="true" className="h-4 w-4 shrink-0 mt-px" />
                ) : (
                  <ArrowDownCircle aria-hidden="true" className="h-4 w-4 shrink-0 mt-px" />
                )}
                <span>
                  {repCue === 'above' ? (
                    <>
                      <span className="font-semibold">Rep goal reached.</span>{' '}
                      Every set is at {repRange.max}+ reps —{' '}
                      {weightBump ? (
                        <>
                          go up to{' '}
                          <span className="font-semibold tabular-nums">
                            {formatWeightHalf(weightBump.next)}kg
                          </span>{' '}
                          <span className="tabular-nums">(+{formatWeightHalf(weightBump.step)}kg)</span>{' '}
                          and rebuild the reps from the bottom of the range.
                        </>
                      ) : (
                        <>increase the weight to keep overloading.</>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">Below your rep range.</span>{' '}
                      At least one set is under {repRange.min} reps — lower the weight, or update the
                      range on the exercise if this load is right.
                    </>
                  )}
                </span>
              </p>
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
                disabled={isReadOnly}
                weightDisplay={weightDisplays[index] ?? ''}
                setWeightDisplay={(val) =>
                  setWeightDisplays(prev => {
                    const next = [...prev];
                    next[index] = val;
                    return next;
                  })
                }
                /* Advisory only: the note renders under this row's reps box and
                   never writes into it, so the logged entry stays as it is. */
                repTarget={nextTarget?.setIndex === index ? nextTarget.target : null}
              />
            ))}
          </div>

          <div className="pt-2">
            <Separator className="mb-4 border-dashed" />
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={addSet}
                className="border-dashed hover:border-solid hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                disabled={isSavingParentLog || isReadOnly}
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
                                setLocalStructure(val);
                  const base = loggedExercise.setStructure ?? 'normal';
                  const nextOverride = (val === base) ? null : val;
                  onUpdateSetStructureOverride(loggedExercise.id, nextOverride);
                }}
                disabled={isSavingParentLog}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {warmupOpen && (
        <WarmupModal loggedExercise={loggedExercise} onClose={() => setWarmupOpen(false)} />
      )}
    </div>
  );
}