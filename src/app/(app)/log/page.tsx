
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { 
  Calendar as CalendarIconLucide, // Renamed to avoid conflict
  PlusCircle, 
  Save, 
  RotateCcw, 
  Trash2, 
  GripVertical,
  AlertTriangle // For delete confirmation
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar"; // ShadCN Calendar
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea"; 
import { useTrainingLog } from '@/hooks/useTrainingLog';
import type { LoggedExercise, Exercise } from '@/types';
import { LoggedExerciseCard } from '@/components/training-log/LoggedExerciseCard';
import { AddExerciseDialog } from '@/components/training-log/AddExerciseDialog';
import { format, parseISO } from 'date-fns';
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
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function TrainingLogPage() {
  const { user, isLoading: authIsLoading } = useAuth();
  const router = useRouter();
  
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
    handleSelectRoutine,
    addExerciseToLog,
    removeExerciseFromLog,
    reorderExercisesInLog,
    updateExerciseInLog,
    saveExerciseProgress,
    saveCurrentLog,
    updateOverallLogNotes,
    fetchAndSetLastPerformance,
    deleteCurrentLog,
  } = useTrainingLog(new Date());

  const [isAddExerciseDialogOpen, setIsAddExerciseDialogOpen] = useState(false);
  const [showLogNotes, setShowLogNotes] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);


  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (currentLog && over && active.id !== over.id) {
      const oldIndex = currentLog.exercises.findIndex((ex) => ex.id === active.id);
      const newIndex = currentLog.exercises.findIndex((ex) => ex.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderExercisesInLog(arrayMove(currentLog.exercises, oldIndex, newIndex));
      }
    }
  }

  const handleOverallNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateOverallLogNotes(e.target.value);
  };

  const loggedExerciseIds = useMemo(() => currentLog?.exercises.map(ex => ex.id) || [], [currentLog]);

  const handleDeleteConfirmed = async () => {
    await deleteCurrentLog();
    setIsDeleteConfirmOpen(false);
  };

  const canDeleteLog = useMemo(() => {
    return currentLog && (currentLog.exercises.length > 0 || (currentLog.notes && currentLog.notes.trim() !== ''));
  }, [currentLog]);

  const routineSelectValue = useMemo(() => {
    if (isLoadingLog || !currentLog) {
      return ""; 
    }
    return currentLog.routineId || "";
  }, [currentLog, isLoadingLog]);

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
  
  return (
    <div className="space-y-6">
      <PageHeader title="Training Log" description="Record your daily workouts and track progress.">
        <div className="flex gap-2">
            <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button 
                    variant="outline" 
                    className="border-destructive text-destructive hover:bg-destructive/10"
                    disabled={isDeletingLog || isLoadingLog || !canDeleteLog}
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

            <Button onClick={() => saveCurrentLog()} disabled={isSavingLog || isLoadingLog} className="bg-accent hover:bg-accent/90">
                {isSavingLog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Day's Log
            </Button>
        </div>
      </PageHeader>

      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle className="font-headline text-xl">Log for: {format(selectedDate, 'PPP')}</CardTitle>
              <CardDescription>Select a date, choose a routine, or add exercises manually.</CardDescription>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-[280px] justify-start text-left font-normal">
                  <CalendarIconLucide className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <Select 
              value={routineSelectValue}
              onValueChange={handleSelectRoutine} 
              disabled={isLoadingRoutines || isLoadingLog}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingRoutines || isLoadingLog ? "Loading routines..." : "Start from a routine (optional)"} />
              </SelectTrigger>
              <SelectContent>
                {availableRoutines.map(routine => (
                  <SelectItem key={routine.id} value={routine.id}>{routine.name}</SelectItem>
                ))}
                {availableRoutines.length === 0 && !isLoadingRoutines && <SelectItem value="no-routines" disabled>No routines available</SelectItem>}
              </SelectContent>
            </Select>
            <Button onClick={() => setIsAddExerciseDialogOpen(true)} variant="outline" className="w-full md:w-auto">
              <PlusCircle className="mr-2 h-4 w-4" /> Add Exercise Manually
            </Button>
          </div>
          
          {isLoadingLog ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="ml-3 text-lg text-muted-foreground">Loading log data...</p>
            </div>
          ) : currentLog && currentLog.exercises.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={loggedExerciseIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-4">
                  {currentLog.exercises.map(loggedEx => (
                    <LoggedExerciseCard
                      key={loggedEx.id}
                      loggedExercise={loggedEx}
                      onUpdateSets={(sets) => updateExerciseInLog({ ...loggedEx, sets })}
                      onSaveProgress={() => saveExerciseProgress(loggedEx)}
                      onRemove={() => removeExerciseFromLog(loggedEx.id)}
                      onRefreshLastPerformance={() => fetchAndSetLastPerformance(loggedEx.exerciseId)}
                      isSavingParentLog={isSavingLog}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
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
                disabled={isLoadingLog || isSavingLog}
              />
            )}
          </div>

        </CardContent>
      </Card>

      <AddExerciseDialog
        isOpen={isAddExerciseDialogOpen}
        setIsOpen={setIsAddExerciseDialogOpen}
        availableExercises={availableExercises}
        isLoadingExercises={isLoadingExercises}
        onAddExercise={(exercise) => {
          addExerciseToLog(exercise);
          setIsAddExerciseDialogOpen(false);
        }}
      />
    </div>
  );
}

