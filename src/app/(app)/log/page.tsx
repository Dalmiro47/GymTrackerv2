"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { confirmDiscardUnsavedChanges } from '@/lib/unsavedChanges';
import { Button } from "@/components/ui/button";
import {
  Plus,
  PlusCircle,
  Trash2,
  AlertTriangle,
  ListChecks,
  BatteryLow,
  Check,
  ChevronDown,
  Save,
  StickyNote,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useTrainingLog } from '@/hooks/useTrainingLog';
import type { Exercise, LoggedExercise, LoggedSet, MuscleGroup, SetStructure } from '@/types';
import { ExerciseList } from '@/components/training-log/ExerciseList';
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
  useSensor,
  useSensors,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAuth } from '@/contexts/AuthContext';

import { useIsMobile } from '@/hooks/use-mobile';
import { useToday } from '@/hooks/use-today';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { WeekStrip } from '@/components/training-log/WeekStrip';
import { WorkoutCalendar } from '@/components/dashboard/WorkoutCalendar';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { CoachChatSheet } from '@/components/coach/CoachChatSheet';
import { serializeLogDayContext } from '@/lib/ai/context-builders';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useI18n } from '@/contexts/LanguageContext';

/**
 * Stable function identity with an always-fresh body. <ExerciseList /> is memoised and
 * only skips renders when EVERY callback prop keeps its identity, but useTrainingLog
 * recreates its handlers each render. Callbacks here are only ever invoked from event
 * handlers (post-commit), so reading the latest body from a ref is safe.
 */
function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}

function TrainingLogPageContent() {
  const { user, isLoading: authIsLoading } = useAuth();
  const isMobile = useIsMobile();
  const { t, tn, locale, language } = useI18n();

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

  // dnd-kit memoises each sensor on its options OBJECT identity, so an inline literal
  // hands <ExerciseList /> a fresh `sensors` array every render and silently defeats its
  // React.memo. Hoist both option objects.
  const pointerSensorOptions = useMemo(
    () => ({
      activationConstraint: isMobile
        ? { delay: 120, tolerance: 6 }
        : { distance: 6 },
    }),
    [isMobile]
  );
  const keyboardSensorOptions = useMemo(
    () => ({ coordinateGetter: sortableKeyboardCoordinates }),
    []
  );

  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions)
  );


  const handleDragEnd = useStableCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!currentLog || !over || active.id === over.id) return;

    const oldIndex = currentLog.exercises.findIndex(ex => ex.id === String(active.id));
    const newIndex = currentLog.exercises.findIndex(ex => ex.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(currentLog.exercises, oldIndex, newIndex);
    reorderExercisesInLog(reordered);
  });

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

  // Library ids (Exercise.id) — the identity used to keep an exercise from being logged
  // twice on the same day. Never mix the two: LoggedExercise.id is a composite row id and
  // will never match a library exercise id.
  const loggedExerciseDefIds = useMemo(() => currentLog?.exercises.map(ex => ex.exerciseId) || [], [currentLog]);

  const handleDeleteConfirmed = async () => {
    await deleteCurrentLog();
    setIsDeleteConfirmOpen(false);
  };

  const handleOpenAddDialog = useStableCallback((index: number) => {
    setExerciseInsertionIndex(index);
    setIsAddExerciseDialogOpen(true);
  });

  const handleOpenReplaceDialog = useStableCallback((exerciseId: string, muscleGroup: MuscleGroup) => {
    setExerciseToReplace({ id: exerciseId, muscleGroup });
    setIsReplaceExerciseDialogOpen(true);
  });

  const handleUpdateSets = useStableCallback((loggedExercise: LoggedExercise, sets: LoggedSet[]) => {
    updateExerciseInLog({ ...loggedExercise, sets });
  });

  const handleRemoveExercise = useStableCallback((rowId: string) => {
    removeExerciseFromLog(rowId);
  });

  const handleUpdateSetStructureOverride = useStableCallback(
    (exerciseId: string, structure: SetStructure | null) => {
      updateExerciseSetStructureOverride(exerciseId, structure);
    }
  );

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

  // `language` is a dep because the serializer localizes default exercise names.
  const logDayContext = useMemo(
    () => serializeLogDayContext(currentLog ?? null, userProfile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLog, userProfile, language],
  );

  const activeRoutine = useMemo(
    () => availableRoutines.find(r => r.id === currentLog?.routineId),
    [availableRoutines, currentLog?.routineId]
  );

  const controlsDisabled = isLoadingRoutines || isLoadingLog || isSavingLog || isDeletingLog;
  const hasExercises = (currentLog?.exercises.length ?? 0) > 0;
  // A routine is "in play" only while its exercises are on screen — that is when the
  // inline "Add exercise here" dividers exist to replace the rail button.
  const routineInPlay = Boolean(currentLog?.routineId) && hasExercises;

  const deloadDescription = useMemo(() => {
    if (!currentLog?.deloadParams) {
        return t('log.deloadDescription', { sets: 50, weight: 10 });
    }
    const { volumeMultiplier, intensityMultiplier } = currentLog.deloadParams;
    const setsPercent = Math.round((1 - volumeMultiplier) * 100);
    const weightPercent = Math.round((1 - intensityMultiplier) * 100);
    return t('log.deloadDescription', { sets: setsPercent, weight: weightPercent });
  }, [currentLog?.deloadParams, t]);

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

      {/* ONE control rail — routine, add exercise, deload.
          Single line at every width: only the routine button flexes, so it
          truncates its name rather than pushing anything off-screen. Deload is
          icon-only (its active state colours the button and the banner below
          spells out what it does), which is what buys the room. */}
      <div className="animate-enter enter-1 flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setIsRoutineSheetOpen(true)}
          disabled={controlsDisabled}
          className="h-10 min-w-0 flex-1 gap-2 rounded-full px-3.5 text-[14px] font-medium md:flex-none"
        >
          {/* Decorative only, and the 24px it costs is what makes the rail
              overflow a 360px phone in Spanish — measured. Back from sm up. */}
          <ListChecks className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
          <span className="truncate md:max-w-[9rem]">
            {isLoadingRoutines ? t('common.loading') : (activeRoutine?.name ?? t('log.chooseRoutine'))}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>

        {/* With a routine loaded, exercises are added from the inline dividers
            between cards — the rail button is redundant there. */}
        {!routineInPlay && (
          <Button
            onClick={() => handleOpenAddDialog(currentLog?.exercises.length ?? 0)}
            disabled={isLoadingLog || isSavingLog || isDeletingLog}
            className="h-10 shrink-0 gap-2 rounded-full px-3.5 text-[14px]"
          >
            <Plus className="h-4 w-4" />
            {t('log.addExercise')}
          </Button>
        )}

        {hasExercises && (
          <Button
            variant="outline"
            size="icon"
            aria-pressed={isDeload}
            onClick={() => setIsDeload(!isDeload)}
            disabled={isLoadingLog || isSavingLog || isDeletingLog}
            title={t('log.deload')}
            aria-label={t('log.deload')}
            className={cn(
              "h-10 w-10 shrink-0 rounded-full",
              isDeload
                ? "border-warning/40 bg-warning/15 text-warning hover:bg-warning/20 hover:text-warning"
                : "text-muted-foreground"
            )}
          >
            <BatteryLow className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isDeload && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] leading-snug">
          <AlertTriangle aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-semibold text-warning">{t('log.deloadActive')}</span>{' '}
            <span className="text-muted-foreground">{deloadDescription}</span>
          </p>
        </div>
      )}

      <div className="animate-enter enter-2 space-y-4">
        {isLoadingLog ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-3 text-[15px] text-muted-foreground">{t('log.loadingLog')}</p>
          </div>
        ) : currentLog && currentLog.exercises.length > 0 ? (
          <>
            <ExerciseList
              exercises={currentLog.exercises}
              sensors={sensors}
              savedExerciseIds={savedExerciseIds}
              isBusy={isSavingLog || isDeletingLog}
              isReadOnly={isDeload}
              onDragEnd={handleDragEnd}
              onUpdateSets={handleUpdateSets}
              onRemove={handleRemoveExercise}
              onReplace={handleOpenReplaceDialog}
              onUpdateSetStructureOverride={handleUpdateSetStructureOverride}
              onAddAt={handleOpenAddDialog}
            />
          </>
        ) : (
          <div className="surface flex flex-col items-center gap-1 px-4 py-12 text-center">
            <p className="font-headline text-[22px] font-semibold leading-none">{t('log.nothingLogged')}</p>
            <p className="text-[13px] text-muted-foreground">
              {t('log.nothingLoggedHint')}
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
            {showLogNotes ? t('log.hideNotes') : t('log.showNotes')}
          </Button>
          {showLogNotes && (
            <Textarea
              placeholder={t('log.notesPlaceholder')}
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
        title={t('log.pickDay')}
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
        title={t('log.routine')}
        description={t('log.routineDescription')}
      >
        <div className="space-y-1 pb-2">
          <button
            type="button"
            onClick={() => handleChooseRoutine('none')}
            className="pressable flex min-h-[52px] w-full items-center gap-3 rounded-md border border-transparent px-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-[15px] font-medium">{t('log.startFresh')}</span>
            {!currentLog?.routineId && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
          </button>

          {isLoadingRoutines ? (
            <div className="flex min-h-[52px] items-center gap-2 px-3 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('log.loadingRoutines')}
            </div>
          ) : availableRoutines.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              {t('log.noRoutines')}
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
                      {tn('exercises.count', routine.exercises.length)}
                    </span>
                  </span>
                  {isCurrent && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
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

      {/* Clears the floating action dock below. */}
      <div aria-hidden className="h-14" />

      {/* Floating action dock — Save + Delete ride at the same height as the
          AI Coach button (centred in the content column; the coach hugs the
          right edge, so the two never overlap). z-40 keeps it under the
          coach backdrop (z-49) when the chat is open. */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4",
          "bottom-[calc(var(--bottomnav-height)+env(safe-area-inset-bottom)+1rem)]",
          "md:left-[var(--sidebar-width)] md:bottom-6"
        )}
      >
        <div className="glass pointer-events-auto flex items-center gap-2 rounded-full border border-border p-1.5 shadow-lg">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsDeleteConfirmOpen(true)}
            disabled={!canDeleteLog || isDeletingLog || isLoadingLog || isSavingLog}
            aria-label={t('log.deleteDayAria')}
            className="h-11 w-11 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isDeletingLog ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
          </Button>

          <Button
            onClick={async () => await saveCurrentLog()}
            disabled={isSavingLog || isLoadingLog || isDeletingLog}
            className="h-11 shrink-0 gap-2 rounded-full px-5 text-[15px] font-semibold"
          >
            {isSavingLog ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            {t('common.save')}
            {isDirty && !isSavingLog && (
              <span
                className="h-2 w-2 rounded-full bg-destructive"
                aria-label={t('common.unsavedChanges')}
                title={t('common.unsavedChanges')}
              />
            )}
          </Button>
        </div>
      </div>

      {/* Delete-log confirmation (triggered from the floating action dock) */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t('common.confirmDeletion')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('log.deleteConfirmDesc', { date: format(selectedDate, 'PPP', { locale }) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              disabled={isDeletingLog}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : t('log.deleteLog')}
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
