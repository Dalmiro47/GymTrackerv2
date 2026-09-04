"use client";

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { confirmDiscardUnsavedChanges } from '@/lib/unsavedChanges';
import { Button } from "@/components/ui/button";
import {
  Plus,
  PlusCircle,
  Trash2,
  AlertTriangle,
  Info,
  ListChecks,
  BatteryLow,
  Check,
  ChevronDown,
  MoreHorizontal,
  StickyNote,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useTrainingLog } from '@/hooks/useTrainingLog';
import type { Exercise, MuscleGroup, SetStructure } from '@/types';
import { LoggedExerciseCard } from '@/components/training-log/LoggedExerciseCard';
import { AddExerciseDialog } from '@/components/training-log/AddExerciseDialog';
import { ReplaceExerciseDialog } from '@/components/training-log/ReplaceExerciseDialog';
import { format, parseISO, isValid as isDateValid, startOfMonth } from 'date-fns';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAuth } from '@/contexts/AuthContext';

import { useIsMobile } from '@/hooks/use-mobile';
import { useToday } from '@/hooks/use-today';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { RoutineGroupConnector } from '@/components/training-log/RoutineGroupConnector'; // NEW IMPORT
import { WeekStrip } from '@/components/training-log/WeekStrip';
import { WorkoutCalendar } from '@/components/dashboard/WorkoutCalendar';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { AppBarActions } from '@/components/layout/AppBarActions';
import { CoachChatSheet } from '@/components/coach/CoachChatSheet';
import { serializeLogDayContext } from '@/lib/ai/context-builders';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

// Get the effective structure for an exercise (override, then routine default, then normal)
function effectiveOf(ex: { setStructure?: SetStructure; setStructureOverride?: SetStructure | null } | undefined): SetStructure {
  if (!ex) return 'normal';
  return ex.setStructureOverride ?? ex.setStructure ?? 'normal';
}

// NEW HELPER: Logic for max group size
const getGroupSize = (type: string) => {
    const t = type.toLowerCase();
    if (t === 'superset') return 2;
    if (t === 'triset') return 3;
    if (t === 'giant set') return 99;
    return 1;
};


function TrainingLogPageContent() {
  const { user, isLoading: authIsLoading } = useAuth();
  const isMobile = useIsMobile();

  const searchParams = useSearchParams();

  const getInitialDateFromParams = () => {
    const dateQueryParam = searchParams.get('date');
    if (dateQueryParam) {
      const parsedDate = parseISO(dateQueryParam);
      if (isDateValid(parsedDate)) {
        return parsedDate;
      }
    }
    return new Date();
  };

  const initialDate = getInitialDateFromParams();

  const {
    selectedDate,
    setSelectedDate,
    currentLog,
    isLoadingLog,
    isSavingLog,
    isDeletingLog,
    isDirty,
    savedExerciseIds,
    availableRoutines,
    isLoadingRoutines,
    availableExercises,
    isLoadingExercises,
    loggedDayStrings,
    deloadDayStrings,
    isLoadingLoggedDayStrings,
    handleSelectRoutine,
    addExerciseToLog,
    removeExerciseFromLog,
    reorderExercisesInLog,
    updateExerciseInLog,
    saveCurrentLog,
    updateOverallLogNotes,
    deleteCurrentLog,
    replaceExerciseInLog,
    updateExerciseSetStructureOverride,
    isDeload,
    setIsDeload,
    displayedMonth,
    setDisplayedMonth,
  } = useTrainingLog(initialDate);

  // Load user profile for AI Coach context
  const [userProfile, setUserProfile] = useState<{ goal?: string; daysPerWeekTarget?: number; constraints?: string[] } | undefined>();
  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, 'users', user.id, 'profile', 'profile'))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setUserProfile({ goal: data.goal, daysPerWeekTarget: data.daysPerWeekTarget, constraints: data.constraints });
        }
      })
      .catch(() => {}); // Non-critical — coach works without profile
  }, [user?.id]);

  const [isAddExerciseDialogOpen, setIsAddExerciseDialogOpen] = useState(false);
  const [exerciseInsertionIndex, setExerciseInsertionIndex] = useState<number | null>(null);
  const [isReplaceExerciseDialogOpen, setIsReplaceExerciseDialogOpen] = useState(false);
  const [exerciseToReplace, setExerciseToReplace] = useState<{ id: string; muscleGroup: MuscleGroup } | null>(null);
  const [showLogNotes, setShowLogNotes] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isRoutineSheetOpen, setIsRoutineSheetOpen] = useState(false);
  const [isDeloadInfoOpen, setIsDeloadInfoOpen] = useState(false);
  // Stable "today" that only changes identity when the local day rolls over
  const today = useToday();


  const daysWithLogs = useMemo(
    () => loggedDayStrings.map(s => parseISO(s)).filter(d => !isNaN(d.getTime())),
    [loggedDayStrings]
  );
  const daysWithDeload = useMemo(
    () => deloadDayStrings.map(s => parseISO(s)).filter(d => !isNaN(d.getTime())),
    [deloadDayStrings]
  );
  // The week strip marks days by key, not by Date identity.
  const loggedDaySet = useMemo(() => new Set(loggedDayStrings), [loggedDayStrings]);
  const deloadDaySet = useMemo(() => new Set(deloadDayStrings), [deloadDayStrings]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile
        ? { delay: 120, tolerance: 6 }
        : { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );


  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!currentLog || !over || active.id === over.id) return;

    const oldIndex = currentLog.exercises.findIndex(ex => ex.id === String(active.id));
    const newIndex = currentLog.exercises.findIndex(ex => ex.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(currentLog.exercises, oldIndex, newIndex);
    reorderExercisesInLog(reordered);
  }

  const handleOverallNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateOverallLogNotes(e.target.value);
  };

  // Same guard the date popover has always used: a date change discards the
  // in-progress log, so it must go through the unsaved-changes confirm.
  const handleDateChange = (date: Date | undefined) => {
    if (date && confirmDiscardUnsavedChanges()) {
      setSelectedDate(date);
    }
  };

  const handleChooseRoutine = (routineId: string) => {
    if (confirmDiscardUnsavedChanges()) handleSelectRoutine(routineId);
    setIsRoutineSheetOpen(false);
  };

  // Row ids (LoggedExercise.id) — for dnd-kit sorting only.
  const loggedExerciseIds = useMemo(() => currentLog?.exercises.map(ex => ex.id) || [], [currentLog]);
  // Library ids (Exercise.id) — the identity used to keep an exercise from being logged
  // twice on the same day. Never mix the two: LoggedExercise.id is a composite row id and
  // will never match a library exercise id.
  const loggedExerciseDefIds = useMemo(() => currentLog?.exercises.map(ex => ex.exerciseId) || [], [currentLog]);

  const handleDeleteConfirmed = async () => {
    await deleteCurrentLog();
    setIsDeleteConfirmOpen(false);
  };

  const handleOpenAddDialog = (index: number) => {
    setExerciseInsertionIndex(index);
    setIsAddExerciseDialogOpen(true);
  };

  const handleOpenReplaceDialog = (exerciseId: string, muscleGroup: MuscleGroup) => {
    setExerciseToReplace({ id: exerciseId, muscleGroup });
    setIsReplaceExerciseDialogOpen(true);
  };

  const handleReplaceExercise = (newExercise: Exercise) => {
    if (exerciseToReplace) {
      replaceExerciseInLog(exerciseToReplace.id, newExercise);
    }
    setIsReplaceExerciseDialogOpen(false);
    setExerciseToReplace(null);
  };

  const canDeleteLog = useMemo(() => {
    const formattedCurrentDate = format(selectedDate, 'yyyy-MM-dd');
    const existsOnBackend = loggedDayStrings.includes(formattedCurrentDate) || deloadDayStrings.includes(formattedCurrentDate);

    return currentLog && (currentLog.exercises.length > 0 || (currentLog.notes && currentLog.notes.trim() !== '') || existsOnBackend);
  }, [currentLog, selectedDate, loggedDayStrings, deloadDayStrings]);

  const logDayContext = useMemo(
    () => serializeLogDayContext(currentLog ?? null, userProfile),
    [currentLog, userProfile],
  );

  const activeRoutine = useMemo(
    () => availableRoutines.find(r => r.id === currentLog?.routineId),
    [availableRoutines, currentLog?.routineId]
  );

  const controlsDisabled = isLoadingRoutines || isLoadingLog || isSavingLog || isDeletingLog;
  const hasExercises = (currentLog?.exercises.length ?? 0) > 0;

  const deloadDescription = useMemo(() => {
    if (!currentLog?.deloadParams) {
        return "Sets reduced by ~50%, weight by ~10%. This log will be excluded from future progression calculations.";
    }
    const { volumeMultiplier, intensityMultiplier } = currentLog.deloadParams;
    const setsPercent = Math.round((1 - volumeMultiplier) * 100);
    const weightPercent = Math.round((1 - intensityMultiplier) * 100);
    return `Sets reduced by ~${setsPercent}%, weight by ~${weightPercent}%. This log will be excluded from future progression calculations.`;
  }, [currentLog?.deloadParams]);

  if (authIsLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // AppLayout (useRequireAuth) redirects unauthenticated visitors to /login.
  if (!user) {
    return null;
  }

  return (
    <div className="space-y-5">
      {/* Save / delete live in the app bar — the page has no bottom action bar. */}
      <AppBarActions>
        <Button
          size="sm"
          onClick={async () => await saveCurrentLog()}
          disabled={isSavingLog || isLoadingLog || isDeletingLog}
          className="h-9 rounded-full px-4"
        >
          {isSavingLog && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
          {isDirty && !isSavingLog && (
            <span
              className="h-2 w-2 rounded-full bg-destructive"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 md:h-9 md:w-9" aria-label="More log actions">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              disabled={!canDeleteLog || isDeletingLog || isLoadingLog || isSavingLog}
              onSelect={() => setIsDeleteConfirmOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete this day&apos;s log
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </AppBarActions>

      <WeekStrip
        className="animate-enter"
        selectedDate={selectedDate}
        onSelect={handleDateChange}
        today={today}
        loggedDays={loggedDaySet}
        deloadDays={deloadDaySet}
        onOpenMonth={() => setIsCalendarOpen(true)}
        onVisibleMonthChange={(month) => setDisplayedMonth(startOfMonth(month))}
      />

      {/* ONE control rail — routine, deload, add exercise. */}
      <div className="animate-enter enter-1 -mx-4 flex items-center gap-2 overflow-x-auto px-4 no-scrollbar md:mx-0 md:overflow-visible md:px-0">
        <Button
          variant="outline"
          onClick={() => setIsRoutineSheetOpen(true)}
          disabled={controlsDisabled}
          className="h-10 shrink-0 gap-2 rounded-full px-3.5 text-[14px] font-medium"
        >
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[9rem] truncate">
            {isLoadingRoutines ? 'Loading…' : (activeRoutine?.name ?? 'Choose routine')}
          </span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>

        {hasExercises && (
          <Button
            variant="outline"
            aria-pressed={isDeload}
            onClick={() => setIsDeload(!isDeload)}
            disabled={isLoadingLog || isSavingLog || isDeletingLog}
            className={cn(
              "h-10 shrink-0 gap-2 rounded-full px-3.5 text-[14px] font-medium",
              isDeload
                ? "border-warning/40 bg-warning/15 text-warning hover:bg-warning/20 hover:text-warning"
                : "text-muted-foreground"
            )}
          >
            <BatteryLow className="h-4 w-4" />
            Deload
          </Button>
        )}

        <Button
          onClick={() => handleOpenAddDialog(currentLog?.exercises.length ?? 0)}
          disabled={isLoadingLog || isSavingLog || isDeletingLog}
          className="h-10 shrink-0 gap-2 rounded-full px-3.5 text-[14px]"
        >
          <Plus className="h-4 w-4" />
          Add exercise
        </Button>
      </div>

      {isDeload && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] leading-snug">
          <AlertTriangle aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-semibold text-warning">Deload mode active.</span>{' '}
            <span className="text-muted-foreground">{deloadDescription}</span>
          </p>
        </div>
      )}

      <div className="animate-enter enter-2 space-y-4">
        {isLoadingLog ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-3 text-[15px] text-muted-foreground">Loading log data…</p>
          </div>
        ) : currentLog && currentLog.exercises.length > 0 ? (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={loggedExerciseIds} strategy={verticalListSortingStrategy}>
                <div>
                  {currentLog.exercises.map((loggedEx, index) => {
                      const currentStructure = effectiveOf(loggedEx);
                      const nextExercise = currentLog.exercises[index + 1];
                      const nextStructure = nextExercise ? effectiveOf(nextExercise) : 'normal';

                      // LOGIC: Only link if next is same structure AND we are not at the end of a group size cap
                      let shouldLink = false;

                      if (nextExercise && currentStructure !== 'normal' && currentStructure === nextStructure) {
                          // Calculate streak (how many items before this one were the same type?)
                          let streak = 1;
                          for (let i = index - 1; i >= 0; i--) {
                              const prev = currentLog.exercises[i];
                              if (effectiveOf(prev) === currentStructure) {
                                  streak++;
                              } else {
                                  break;
                              }
                          }

                          const maxSize = getGroupSize(currentStructure);
                          // Link if we haven't hit the max size for this group chunk
                          if (streak % maxSize !== 0) {
                              shouldLink = true;
                          }
                      }

                    return (
                    <React.Fragment key={loggedEx.id}>
                      <div className={cn(!shouldLink && "mb-3")}>
                          <LoggedExerciseCard
                            loggedExercise={loggedEx}
                            onUpdateSets={(sets) => updateExerciseInLog({ ...loggedEx, sets })}
                            onRemove={() => removeExerciseFromLog(loggedEx.id)}
                            onReplace={() => handleOpenReplaceDialog(loggedEx.id, loggedEx.muscleGroup)}
                            isSavingParentLog={isSavingLog || isDeletingLog}
                            onUpdateSetStructureOverride={updateExerciseSetStructureOverride}
                            isReadOnly={isDeload}
                            isSavedForDay={savedExerciseIds.has(loggedEx.id)}
                          />
                      </div>
                      {index < currentLog.exercises.length - 1 && (
                        shouldLink ? (
                          <RoutineGroupConnector structure={currentStructure} />
                        ) : (
                          // Standard Divider
                          <div className="relative my-2 group">
                              <div className="relative z-10 flex items-center justify-center">
                                  <Button
                                      onClick={() => handleOpenAddDialog(index + 1)}
                                      variant="outline"
                                      size="sm"
                                      className="h-8 rounded-full border-dashed bg-background px-3 text-[12px] font-medium text-muted-foreground hover:border-solid hover:text-foreground"
                                  >
                                      <PlusCircle className="h-3.5 w-3.5" />
                                      Add exercise here
                                  </Button>
                              </div>
                              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                  <div className="w-full border-t border-border" />
                              </div>
                          </div>
                        )
                      )}
                    </React.Fragment>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {/* Final Add Button */}
            <div className="flex items-center gap-2 pt-1">
                <Separator className="flex-1" />
                <Button
                    onClick={() => handleOpenAddDialog(currentLog.exercises.length)}
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-full border-dashed px-3.5 text-[13px] font-medium text-muted-foreground hover:border-solid hover:text-foreground"
                >
                    <PlusCircle className="h-4 w-4" />
                    Add another exercise
                </Button>
                <Separator className="flex-1" />
            </div>
          </>
        ) : (
          <div className="surface flex flex-col items-center gap-1 px-4 py-12 text-center">
            <p className="font-headline text-[22px] font-semibold leading-none">Nothing logged yet</p>
            <p className="text-[13px] text-muted-foreground">
              Pick a routine or add an exercise to start this session.
            </p>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogNotes(!showLogNotes)}
            className="h-9 gap-2 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <StickyNote className="h-4 w-4" />
            {showLogNotes ? "Hide" : "Show"} workout notes
          </Button>
          {showLogNotes && (
            <Textarea
              placeholder="Add any overall notes for this workout session..."
              value={currentLog?.notes || ''}
              onChange={handleOverallNotesChange}
              rows={3}
              disabled={isLoadingLog || isSavingLog || isDeletingLog}
            />
          )}
        </div>
      </div>

      {/* Month picker */}
      <ResponsiveSheet
        open={isCalendarOpen}
        onOpenChange={setIsCalendarOpen}
        title="Pick a day"
      >
        {isLoadingLoggedDayStrings ? (
          <div className="flex h-[340px] items-center justify-center" aria-busy="true">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <WorkoutCalendar
            className="pb-2"
            selectedDate={selectedDate}
            onSelect={(date) => {
              handleDateChange(date);
              setIsCalendarOpen(false);
            }}
            month={displayedMonth}
            onMonthChange={(m) => setDisplayedMonth(startOfMonth(m))}
            loggedDays={daysWithLogs}
            deloadDays={daysWithDeload}
            today={today}
          />
        )}
      </ResponsiveSheet>

      {/* Routine picker */}
      <ResponsiveSheet
        open={isRoutineSheetOpen}
        onOpenChange={setIsRoutineSheetOpen}
        title="Routine"
        description="Start fresh, or load one of your routines into this day."
      >
        <div className="space-y-1 pb-2">
          <button
            type="button"
            onClick={() => handleChooseRoutine('none')}
            className="pressable flex min-h-[52px] w-full items-center gap-3 rounded-md border border-transparent px-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-[15px] font-medium">Start fresh</span>
            {!currentLog?.routineId && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
          </button>

          {isLoadingRoutines ? (
            <div className="flex min-h-[52px] items-center gap-2 px-3 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading routines…
            </div>
          ) : availableRoutines.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              No routines yet. Create one on the Routines page.
            </p>
          ) : (
            availableRoutines.map(routine => {
              const isCurrent = currentLog?.routineId === routine.id;
              return (
                <button
                  key={routine.id}
                  type="button"
                  onClick={() => handleChooseRoutine(routine.id)}
                  className={cn(
                    "pressable flex min-h-[52px] w-full items-center gap-3 rounded-md border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isCurrent ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{routine.name}</span>
                    <span className="block text-[12px] text-muted-foreground tabular-nums">
                      {routine.exercises.length} exercises
                    </span>
                  </span>
                  {isCurrent && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDeloadInfoOpen(true)}
            className="h-9 gap-2 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Info className="h-4 w-4" />
            What is deload mode?
          </Button>
        </div>
      </ResponsiveSheet>

      {/* Deload explainer — same copy the old info popover carried. */}
      <ResponsiveSheet
        open={isDeloadInfoOpen}
        onOpenChange={setIsDeloadInfoOpen}
        title="Deload mode"
      >
        <p className="pb-2 text-[15px] leading-snug text-muted-foreground">{deloadDescription}</p>
      </ResponsiveSheet>

      <AddExerciseDialog
        isOpen={isAddExerciseDialogOpen}
        setIsOpen={setIsAddExerciseDialogOpen}
        availableExercises={availableExercises}
        isLoadingExercises={isLoadingExercises}
        loggedExerciseIds={loggedExerciseDefIds}
        onAddExercise={(exercise) => {
          if (exerciseInsertionIndex !== null) {
            addExerciseToLog(exercise, exerciseInsertionIndex);
          }
          setIsAddExerciseDialogOpen(false);
          setExerciseInsertionIndex(null);
        }}
      />
      <ReplaceExerciseDialog
        isOpen={isReplaceExerciseDialogOpen}
        setIsOpen={setIsReplaceExerciseDialogOpen}
        availableExercises={availableExercises.filter(ex => !loggedExerciseDefIds.includes(ex.id))}
        isLoadingExercises={isLoadingExercises}
        onReplaceExercise={handleReplaceExercise}
        initialMuscleGroup={exerciseToReplace?.muscleGroup}
      />

      {/* Delete-log confirmation (triggered from the app-bar overflow menu) */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the entire log for {format(selectedDate, 'PPP')}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              disabled={isDeletingLog}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Log"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Floating AI Coach */}
      <CoachChatSheet mode="log-day" context={logDayContext} logDate={format(selectedDate, 'yyyy-MM-dd')} />
    </div>
  );
}


export default function TrainingLogPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
      <TrainingLogPageContent />
    </Suspense>
  );
}
