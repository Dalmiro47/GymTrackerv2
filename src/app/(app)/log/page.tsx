

"use client";

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { 
  Calendar as CalendarIconLucide, 
  PlusCircle, 
  Save, 
  Trash2, 
  AlertTriangle,
  Info
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar"; 
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea"; 
import { useTrainingLog } from '@/hooks/useTrainingLog';
import type { LoggedExercise, Exercise, MuscleGroup, SetStructure } from '@/types';
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SET_STRUCTURE_COLORS } from '@/types/setStructure';
import { cn } from '@/lib/utils';
import CoachInline from './CoachInline';

// Get the effective structure for an exercise (override, then routine default, then normal)
function effectiveOf(ex: { setStructure?: SetStructure; setStructureOverride?: SetStructure | null } | undefined): SetStructure {
  if (!ex) return 'normal';
  return ex.setStructureOverride ?? ex.setStructure ?? 'normal';
}


function TrainingLogPageContent() {
  const { user, isLoading: authIsLoading } = useAuth();
  const router = useRouter();
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
    saveSingleExercise,
    updateOverallLogNotes,
    deleteCurrentLog,
    markExerciseAsInteracted,
    replaceExerciseInLog,
    updateExerciseSetStructureOverride,
    isDeload,
    setIsDeload,
    displayedMonth,
    setDisplayedMonth,
  } = useTrainingLog(initialDate);

  const [isAddExerciseDialogOpen, setIsAddExerciseDialogOpen] = useState(false);
  const [exerciseInsertionIndex, setExerciseInsertionIndex] = useState<number | null>(null);
  const [isReplaceExerciseDialogOpen, setIsReplaceExerciseDialogOpen] = useState(false);
  const [exerciseToReplace, setExerciseToReplace] = useState<{ id: string; muscleGroup: MuscleGroup } | null>(null);
  const [showLogNotes, setShowLogNotes] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const today = new Date();


  const daysWithLogs = useMemo(
    () => loggedDayStrings.map(s => parseISO(s)).filter(d => !isNaN(d.getTime())),
    [loggedDayStrings]
  );
  const daysWithDeload = useMemo(
    () => deloadDayStrings.map(s => parseISO(s)).filter(d => !isNaN(d.getTime())),
    [deloadDayStrings]
  );

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

  const loggedExerciseIds = useMemo(() => currentLog?.exercises.map(ex => ex.id) || [], [currentLog]);

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
  
  const routineSelectValue = currentLog?.routineId || "";


  if (authIsLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && !authIsLoading) {
     router.push('/login'); 
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Redirecting to login...</p>
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  const deloadDescription = useMemo(() => {
    if (!currentLog?.deloadParams) {
        return "Sets reduced by ~50%, weight by ~10%. This log will be excluded from future progression calculations.";
    }
    const { volumeMultiplier, intensityMultiplier } = currentLog.deloadParams;
    const setsPercent = Math.round((1 - volumeMultiplier) * 100);
    const weightPercent = Math.round((1 - intensityMultiplier) * 100);
    return `Sets reduced by ~${setsPercent}%, weight by ~${weightPercent}%. This log will be excluded from future progression calculations.`;
  }, [currentLog?.deloadParams]);

  const routineDay = React.useMemo(() => {
    const id = currentLog?.routineId && currentLog.routineId !== 'none' ? currentLog.routineId : null;
    if (!id) return null;
    const dayName = availableRoutines.find(r => r.id === id)?.name || id;
    return { dayId: id, dayName };
  }, [currentLog?.routineId, availableRoutines]);
  
  return (
    <div className="space-y-6">
      <PageHeader title="Training Log" description="Record your daily workouts and track progress.">
        {/* Mobile-first: 2-up row (Coach/Delete) + full-width Save; desktop: inline to the right */}
        <div className="w-full sm:w-auto">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            {/* Coach */}
            <div className="col-span-1">
              <CoachInline
                routineContext={routineDay}
                buttonProps={{
                  className: "w-full sm:w-auto",
                  size: "sm", // compact on mobile
                }}
              />
            </div>
      
            {/* Delete (AlertDialog preserved) */}
            <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto border-destructive text-destructive hover:bg-destructive/10"
                  disabled={isDeletingLog || isLoadingLog || !canDeleteLog || isSavingLog}
                  aria-label="Delete day's log"
                >
                  {isDeletingLog ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  <span className="hidden min-[380px]:inline">Delete Day&apos;s Log</span>
                  <span className="min-[380px]:hidden">Delete</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center">
                    <AlertTriangle className="mr-2 h-5 w-5 text-destructive" />
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
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    disabled={isDeletingLog}
                  >
                    {isDeletingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Log"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
      
            {/* Primary Save CTA — full width on mobile, nice min width on desktop */}
            <Button
              onClick={async () => await saveCurrentLog()}
              disabled={isSavingLog || isLoadingLog || isDeletingLog}
              aria-busy={isSavingLog}
              className="col-span-2 w-full sm:col-span-1 sm:w-auto sm:min-w-[170px] bg-accent hover:bg-accent/90"
              size="sm"
              aria-label="Save day's log"
            >
              {isSavingLog ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Day's Log
            </Button>
          </div>
        </div>
      </PageHeader>

      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle className="font-headline text-xl">Log for: {format(selectedDate, 'PPP')}</CardTitle>
              <CardDescription>Select a date, choose a routine, or add exercises manually.</CardDescription>
            </div>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-[280px] justify-start text-left font-normal">
                  <CalendarIconLucide className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                {isLoadingLoggedDayStrings ? (
                  <div className="flex items-center justify-center w-[308px] h-[328px]" aria-busy="true">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <Calendar
                    key={format(displayedMonth, 'yyyy-MM')}
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                      }
                      setIsCalendarOpen(false); 
                    }}
                    month={displayedMonth}
                    onMonthChange={(m) => setDisplayedMonth(startOfMonth(m))}
                    modifiers={{ logged: daysWithLogs, deload: daysWithDeload }}
                    modifiersClassNames={{ logged: 'day-is-logged', deload: 'day-is-deload' }}
                    components={{
                      DayContent: ({ date, activeModifiers }) => {
                        const isDeload = !!activeModifiers?.deload;
                        const isLogged = !!activeModifiers?.logged;
                        const label = [
                          date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
                          isDeload ? '— Deload day' : (isLogged ? '— Workout logged' : '')
                        ].filter(Boolean).join(' ');
                        return (
                          <span title={label} aria-label={label} style={{ display: 'inline-block', width: '100%' }}>
                            {date.getDate()}
                          </span>
                        );
                      },
                    }}
                    weekStartsOn={1}
                    toDate={today}
                    disabled={{ after: today }}
                  />
                )}
                <div className="p-3 border-t">
                  <div className="mt-0 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[3px] w-5 rounded bg-[hsl(var(--primary))]" />
                      Logged
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[3px] w-5 rounded bg-[hsl(var(--accent))]" />
                      Deload
                    </span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select 
              value={routineSelectValue}
              onValueChange={handleSelectRoutine} 
              disabled={isLoadingRoutines || isLoadingLog || isSavingLog || isDeletingLog}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingRoutines || (isLoadingLog && !currentLog?.routineId) ? "Loading routines..." : "Start from a routine (optional)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- Clear Routine / Start Fresh --</SelectItem>
                {availableRoutines.map(routine => (
                  <SelectItem key={routine.id} value={routine.id}>{routine.name}</SelectItem>
                ))}
                {availableRoutines.length === 0 && !isLoadingRoutines && <SelectItem value="no-routines" disabled>No routines available</SelectItem>}
              </SelectContent>
            </Select>
            <Button onClick={() => handleOpenAddDialog(currentLog?.exercises.length ?? 0)} variant="outline">
              <PlusCircle className="mr-2 h-4 w-4" /> Add Exercise Manually
            </Button>
          </div>

          {(currentLog?.exercises.length ?? 0) > 0 && (
            <div className="flex items-center justify-end space-x-2 pt-2">
                <Label htmlFor="deload-mode" className="text-muted-foreground">Deload Mode</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground">
                      <Info className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="max-w-xs text-sm">
                    <p>{deloadDescription}</p>
                  </PopoverContent>
                </Popover>
                <Switch
                    id="deload-mode"
                    checked={isDeload}
                    onCheckedChange={setIsDeload}
                    disabled={isLoadingLog || isSavingLog || isDeletingLog}
                />
            </div>
          )}

           {isDeload && (
              <Alert variant="default" className="border-primary/50 bg-primary/5">
                <AlertTriangle className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary">Deload Mode Active</AlertTitle>
                <AlertDescription>
                  {deloadDescription}
                </AlertDescription>
              </Alert>
            )}
          
          {isLoadingLog ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="ml-3 text-lg text-muted-foreground">Loading log data...</p>
            </div>
          ) : currentLog && currentLog.exercises.length > 0 ? (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={loggedExerciseIds} strategy={verticalListSortingStrategy}>
                  <div>
                    {currentLog.exercises.map((loggedEx, index) => {
                        const currentStructure = effectiveOf(loggedEx);
                        const nextStructure = effectiveOf(currentLog.exercises[index + 1]);

                        // determine group size (0 = no group)
                        const groupSize =
                          currentStructure === 'superset' ? 2 :
                          currentStructure === 'triset'   ? 3 : 0;

                        let posInRun = 0; // 0 for first in run, 1 for second, ...
                        if (groupSize > 0) {
                          for (let j = index - 1; j >= 0; j--) {
                            if (effectiveOf(currentLog.exercises[j]) === currentStructure) posInRun++;
                            else break;
                          }
                        }

                        // Draw connector ONLY if next is same structure AND we're not at the end of a group chunk
                        const groupContinues =
                          groupSize > 0 &&
                          nextStructure === currentStructure &&
                          (posInRun % groupSize) !== (groupSize - 1);
                        
                        const connectorColor = SET_STRUCTURE_COLORS[currentStructure]?.border;

                      return (
                      <React.Fragment key={loggedEx.id}>
                        <div className={cn(!groupContinues && "mb-4")}>
                            <LoggedExerciseCard
                              loggedExercise={loggedEx}
                              onUpdateSets={(sets) => updateExerciseInLog({ ...loggedEx, sets })}
                              onSaveProgress={() => saveSingleExercise(loggedEx.id)}
                              onRemove={() => removeExerciseFromLog(loggedEx.id)}
                              onReplace={() => handleOpenReplaceDialog(loggedEx.id, loggedEx.muscleGroup)}
                              isSavingParentLog={isSavingLog || isDeletingLog}
                              onMarkAsInteracted={() => markExerciseAsInteracted(loggedEx.id)}
                              onUpdateSetStructureOverride={updateExerciseSetStructureOverride}
                            />
                        </div>
                        {index < currentLog.exercises.length - 1 && (
                          <div
                            className={cn(
                              "relative -mx-4 my-2 sm:mx-0",
                              groupContinues && "pointer-events-none"
                            )}
                          >
                           <div
                              className={cn(
                                'relative z-10 flex items-center space-x-2 pointer-events-auto'
                              )}
                            >
                              <Separator
                                className="flex-1 h-[2px]"
                                style={groupContinues ? { backgroundColor: connectorColor } : undefined}
                              />
                              <Button
                                onClick={() => handleOpenAddDialog(index + 1)}
                                variant="outline"
                                size="sm"
                                className='border-dashed hover:border-solid hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                              >
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Exercise Here
                              </Button>
                              <Separator
                                className="flex-1 h-[2px]"
                                style={groupContinues ? { backgroundColor: connectorColor } : undefined}
                              />
                            </div>
                            {groupContinues && (
                              <>
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute left-[1px] top-1/2 -translate-y-1/2 bottom-0 w-[2px] rounded-full"
                                  style={{ backgroundColor: connectorColor }}
                                />
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute right-[1px] top-1/2 -translate-y-1/2 bottom-0 w-[2px] rounded-full"
                                  style={{ backgroundColor: connectorColor }}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              {/* Final Add Button */}
              <div className="flex items-center space-x-2 my-2 pt-4">
                  <Separator className="flex-1" />
                  <Button 
                      onClick={() => handleOpenAddDialog(currentLog.exercises.length)}
                      variant="outline" 
                      size="sm"
                      className="border-dashed hover:border-solid hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  >
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Another Exercise
                  </Button>
                  <Separator className="flex-1" />
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-lg font-semibold">No exercises logged for this day yet.</p>
              <p>Add exercises manually or select a routine to begin.</p>
            </div>
          )}

          <div className="space-y-2 pt-4">
            <Button variant="link" onClick={() => setShowLogNotes(!showLogNotes)} className="px-0">
              {showLogNotes ? "Hide" : "Show"} Overall Workout Notes
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

        </CardContent>
        <CardFooter className="hidden sm:flex justify-end gap-2 pt-6 border-t">
          <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button 
                  variant="outline" 
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  disabled={isDeletingLog || isLoadingLog || !canDeleteLog || isSavingLog}
              >
                {isDeletingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Delete Day's Log
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-5 w-5 text-destructive" />
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
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  disabled={isDeletingLog}
                >
                  {isDeletingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Log"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button onClick={async () => await saveCurrentLog()} disabled={isSavingLog || isLoadingLog || isDeletingLog} className="bg-accent hover:bg-accent/90">
              {isSavingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Day's Log
          </Button>
        </CardFooter>
      </Card>

      <AddExerciseDialog
        isOpen={isAddExerciseDialogOpen}
        setIsOpen={setIsAddExerciseDialogOpen}
        availableExercises={availableExercises}
        isLoadingExercises={isLoadingExercises}
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
        availableExercises={availableExercises.filter(ex => !loggedExerciseIds.includes(ex.id))}
        isLoadingExercises={isLoadingExercises}
        onReplaceExercise={handleReplaceExercise}
        initialMuscleGroup={exerciseToReplace?.muscleGroup}
      />
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
