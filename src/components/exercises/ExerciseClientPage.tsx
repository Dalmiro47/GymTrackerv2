"use client";

import { friendlyErrorMessage } from '@/lib/errorMessages';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Exercise, ExerciseData, Routine } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import type { ExerciseFormData } from './AddExerciseDialog';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { 
  addExercise, 
  getExercises, 
  updateExercise, 
  deleteExercise as deleteExerciseService, 
  ensureExercisesSeeded,
  getHiddenDefaultExercises,
  restoreHiddenDefaults,
  type SeedResult 
} from '@/services/exerciseService';
import { getRoutines, updateRoutine } from '@/services/routineService';
import { stripUndefinedDeep } from '@/lib/sanitize';
import { assertMuscleGroup } from '@/lib/muscleGroup';

import { PageHeader } from '@/components/PageHeader';
import { ExerciseCard } from './ExerciseCard';
import { MuscleGroupIcon } from './MuscleGroupIcon';
import { AddExerciseDialog } from './AddExerciseDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Search, Loader2, AlertTriangle, History, ArrowLeft, Dumbbell, Check } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '../ui/scroll-area';
import {
  Dialog,
  DialogClose,
  DialogContent as RestoreDialogContent,
  DialogDescription as RestoreDialogDescription,
  DialogFooter as RestoreDialogFooter,
  DialogHeader as RestoreDialogHeader,
  DialogTitle as RestoreDialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils'; // Make sure cn is imported
import { useI18n } from '@/contexts/LanguageContext';
// Module-level `t`/`tn` for toasts inside memoised fetchers, so a language switch
// never re-creates them (and refetches). Render-time text uses the hook.
import { t, tn, muscleGroupLabel } from '@/i18n';
import { compareByDisplayName, displayExerciseFields, displayExerciseName, exerciseMatchesQuery } from '@/lib/exerciseDisplay';

type HiddenDefault = { id: string; name: string; muscleGroup: string };

export function ExerciseClientPage() {
  const authContext = useAuth();
  const { user } = authContext;
  const { toast } = useToast();
  const router = useRouter();
  const { t: tr, tn: trn, language } = useI18n();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [activeMuscleGroup, setActiveMuscleGroup] = useState<MuscleGroup | 'All' | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [exerciseToEdit, setExerciseToEdit] = useState<Exercise | null>(null);
  const [exerciseToDeleteId, setExerciseToDeleteId] = useState<string | null>(null);
  const [isBusyDeleting, setIsBusyDeleting] = useState(false);
  const [affectedRoutines, setAffectedRoutines] = useState<Routine[]>([]);

  const [isLoading, setIsLoading] = useState(true); 
  const [isDialogSaving, setIsDialogSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [hiddenDefaults, setHiddenDefaults] = useState<HiddenDefault[]>([]);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [selectedToRestore, setSelectedToRestore] = useState<string[]>([]);
  const [isRestoring, setIsRestoring] = useState(false);


  const fetchUserExercises = useCallback(async (currentUserId: string | null | undefined): Promise<void> => {
    if (!currentUserId) {
      setExercises([]);
      return;
    }
    try {
      const userExercises = await getExercises(currentUserId);
      setExercises(userExercises);
    } catch (error: any) {
      console.error("Failed to fetch exercises:", error);
      toast({
        title: t('ex.fetchErrorTitle'),
        description: friendlyErrorMessage(error, t('ex.fetchErrorDesc')),
        variant: "destructive",
      });
    }
  }, [toast]);
  
  const fetchHiddenDefaults = useCallback(async (currentUserId: string) => {
    try {
      const list = await getHiddenDefaultExercises(currentUserId);
      setHiddenDefaults(list);
    } catch (e) {
      console.error("Failed to fetch hidden defaults:", e);
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      let cancelled = false;
      (async () => {
        setIsLoading(true);
        try {
          const { addedCount } = await ensureExercisesSeeded(user.id);
          if (!cancelled && addedCount > 0) {
            toast({
              title: t('ex.syncedTitle'),
              description: tn('ex.syncedDesc', addedCount),
            });
          }
        } catch (err: any) {
          if (!cancelled) {
            console.error('[ExerciseClientPage] library sync failed:', err);
            toast({
              title: t('ex.syncFailedTitle'),
              description: friendlyErrorMessage(err, t('ex.syncFailedDesc')),
              variant: "destructive",
            });
          }
        } finally {
          if (!cancelled) {
            await Promise.all([
              fetchUserExercises(user.id),
              fetchHiddenDefaults(user.id),
            ]);
            setIsLoading(false);
          }
        }
      })();
      return () => { cancelled = true; };
    } else if (!authContext.isLoading && !user) {
      setExercises([]);
      setHiddenDefaults([]);
      setIsLoading(false);
    }
  }, [user, authContext.isLoading, fetchUserExercises, fetchHiddenDefaults, toast]);
  
  const searchParams = useSearchParams();

  // Open the edit dialog when arriving via /exercises?edit=<id>
  // (e.g. from the warm-up panel's "Edit warm-up settings" link).
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || isLoading) return;
    const exercise = exercises.find(ex => ex.id === editId);
    if (exercise) {
      setExerciseToEdit(exercise);
      setIsDialogOpen(true);
    }
    router.replace('/exercises', { scroll: false });
  }, [searchParams, isLoading, exercises, router]);

  // Firestore orders by the stored (English) name; re-sort by the displayed one
  // so a Spanish library still reads alphabetically.
  const canonicalExercises = useMemo(() => {
      return exercises
        .map(e => ({...e, muscleGroup: assertMuscleGroup(e.muscleGroup as any)}))
        .sort(compareByDisplayName(language));
  }, [exercises, language]);

  const exerciseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    canonicalExercises.forEach(ex => {
      const group = ex.muscleGroup;
      counts[group] = (counts[group] || 0) + 1;
    });
    return counts;
  }, [canonicalExercises]);

  const displayedExercises = useMemo(() => {
    // Search hits the stored English name AND the displayed one, so a Spanish
    // user finds "Press de banca" and an English query still works.
    if (activeMuscleGroup === null && searchTerm.trim() !== '') {
       return canonicalExercises.filter(ex => exerciseMatchesQuery(ex, searchTerm, language));
    }

    let temp = [...canonicalExercises];

    if (activeMuscleGroup && activeMuscleGroup !== 'All') {
      temp = temp.filter(ex => ex.muscleGroup === activeMuscleGroup);
    }

    if (searchTerm.trim() !== '') {
      temp = temp.filter(ex => exerciseMatchesQuery(ex, searchTerm, language));
    }

    return temp;
  }, [canonicalExercises, searchTerm, activeMuscleGroup, language]);


  const handleOpenAddDialog = () => {
    setExerciseToEdit(null);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (exercise: Exercise) => {
    setExerciseToEdit(exercise);
    setIsDialogOpen(true);
  };

  const handleSaveExercise = async (formData: ExerciseFormData) => {
    if (!user?.id) {
      toast({ title: t('common.authErrorTitle'), description: t('ex.authError'), variant: "destructive" });
      return;
    }

    // The edit form is pre-filled with the DISPLAYED (possibly Spanish) text of a
    // seeded default. A field the user left as-is must be written back as the
    // stored English canonical, or "saving without changes" would silently turn
    // a default into a Spanish-named custom exercise.
    const keepCanonical = (submitted: string | undefined, stored: string | undefined, shown: string | undefined) =>
      (submitted ?? '').trim() === (shown ?? '').trim() ? (stored ?? '').trim() : (submitted ?? '').trim();
    const shownBefore = exerciseToEdit ? displayExerciseFields(exerciseToEdit, language) : null;
    const canonical = exerciseToEdit && shownBefore
      ? {
          name: keepCanonical(formData.name, exerciseToEdit.name, shownBefore.name),
          targetNotes: keepCanonical(formData.targetNotes, exerciseToEdit.targetNotes, shownBefore.targetNotes),
          exerciseSetup: keepCanonical(formData.exerciseSetup, exerciseToEdit.exerciseSetup, shownBefore.exerciseSetup),
          progressiveOverload: keepCanonical(formData.progressiveOverload, exerciseToEdit.progressiveOverload, shownBefore.progressiveOverload),
        }
      : {
          name: formData.name.trim(),
          targetNotes: (formData.targetNotes || '').trim(),
          exerciseSetup: (formData.exerciseSetup || '').trim(),
          progressiveOverload: (formData.progressiveOverload || '').trim(),
        };

    // Identity is name + muscleGroup (never name alone): "Dips" (Chest) and
    // "Dips" (Triceps) may coexist, but two "Dips" (Chest) may not. Both the
    // stored and the displayed name count, so "Press de banca" (Chest) is a
    // duplicate of the seeded "Bench Press" for a Spanish user.
    const identityKey = (name: string, muscle: string) =>
      `${name.trim().toLowerCase()}::${String(muscle ?? '').trim().toLowerCase()}`;
    const newKeys = new Set([identityKey(canonical.name, formData.muscleGroup), identityKey(formData.name, formData.muscleGroup)]);
    const duplicate = exercises.find(
      ex => ex.id !== exerciseToEdit?.id &&
        (newKeys.has(identityKey(ex.name, ex.muscleGroup)) || newKeys.has(identityKey(displayExerciseName(ex, language), ex.muscleGroup)))
    );
    if (duplicate) {
      toast({
        title: t('ex.duplicateTitle'),
        description: t('ex.duplicateDesc', { name: displayExerciseName(duplicate, language), group: muscleGroupLabel(duplicate.muscleGroup) }),
        variant: "destructive",
      });
      return;
    }

    setIsDialogSaving(true);
    try {
      const exercisePayload: ExerciseData = {
        name: canonical.name,
        muscleGroup: formData.muscleGroup,
        targetNotes: canonical.targetNotes,
        exerciseSetup: canonical.exerciseSetup,
        progressiveOverload: canonical.progressiveOverload,
        dataAiHint: canonical.name.toLowerCase().split(" ").slice(0,2).join(" ") || 'exercise',
        warmup: formData.warmup,
      };

      if (exerciseToEdit) {
        await updateExercise(user.id, exerciseToEdit.id, exercisePayload);
        toast({ title: t('ex.updatedTitle'), description: t('ex.updatedDesc', { name: formData.name }) });

        const routines = await getRoutines(user.id);
        const affected = routines.filter(r =>
          r.exercises.some(e => e.id === exerciseToEdit.id)
        );

        if (affected.length > 0) {
            await Promise.all(affected.map(r => {
                const updatedExercises = r.exercises.map(e =>
                    e.id === exerciseToEdit.id ? { ...e, ...exercisePayload } : e
                );
                return updateRoutine(user.id!, r.id, { exercises: updatedExercises }, 'exercise-cascade');
            }));
            toast({
                title: t('ex.routinesSyncedTitle'),
                description: t('ex.routinesSyncedDesc', { name: exercisePayload.name, count: tn('routines.count', affected.length) }),
            });
        }


      } else {
        await addExercise(user.id, exercisePayload);
        toast({ title: t('ex.addedTitle'), description: t('ex.addedDesc', { name: formData.name }) });
      }
      
      await fetchUserExercises(user.id);

      setIsDialogOpen(false);
      setExerciseToEdit(null);
    } catch (error: any) {
      console.error("Detailed error adding/updating exercise to Firestore: ", error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('ex.saveError', { name: formData.name })),
        variant: "destructive",
      });
    } finally {
      setIsDialogSaving(false);
    }
  };

  const openDeleteConfirmation = async (exerciseId: string) => {
    if (!user?.id) return;
    setExerciseToDeleteId(exerciseId);
    setIsBusyDeleting(true);
    try {
      const routines = await getRoutines(user.id);
      const affected = routines.filter(r => r.exercises.some(e => e.id === exerciseId));
      setAffectedRoutines(affected);
    } catch (e) {
      toast({ title: t('ex.checkRoutinesErrorTitle'), description: t('ex.checkRoutinesErrorDesc'), variant: "destructive" });
    } finally {
      setIsBusyDeleting(false); 
    }
  };

  const closeDeleteDialog = () => {
    setExerciseToDeleteId(null);
    setAffectedRoutines([]);
  };

  const handleDeleteExercise = async () => {
    if (!exerciseToDeleteId || !user?.id) {
      toast({ title: t('common.error'), description: t('ex.deleteMissing'), variant: "destructive" });
      return;
    }

    setIsBusyDeleting(true);
    const toDelete = exercises.find(ex => ex.id === exerciseToDeleteId);
    const exerciseName = toDelete ? displayExerciseName(toDelete) : t('ex.theExercise');

    try {
      // Delete the exercise first: if this fails nothing else has changed.
      await deleteExerciseService(user.id, exerciseToDeleteId);
      toast({ title: t('ex.deletedTitle'), description: t('ex.deletedDesc', { name: exerciseName }) });

      if (affectedRoutines.length > 0) {
        await Promise.all(
          affectedRoutines.map(routine =>
            updateRoutine(user.id!, routine.id, stripUndefinedDeep({
              name: routine.name,
              description: routine.description ?? '',
              order: routine.order,
              exercises: routine.exercises.filter(e => e.id !== exerciseToDeleteId),
            }), 'exercise-cascade')
          )
        );
        toast({ title: t('ex.routinesUpdatedTitle'), description: t('ex.routinesUpdatedDesc', { name: exerciseName, count: tn('routines.count', affectedRoutines.length) }) });
      }

      await fetchUserExercises(user.id);
      await fetchHiddenDefaults(user.id);
    } catch (error: any) {
      console.error("Failed to delete exercise and update routines:", error);
      toast({ title: t('common.deleteErrorTitle'), description: friendlyErrorMessage(error, t('ex.deleteError', { name: exerciseName })), variant: "destructive" });
    } finally {
      setIsBusyDeleting(false);
      closeDeleteDialog();
    }
  };
 
  const handleOpenRestoreDialog = () => {
    setSelectedToRestore(hiddenDefaults.map(h => h.id));
    setIsRestoreDialogOpen(true);
  };

  const handleToggleRestoreSelection = (id: string) => {
    setSelectedToRestore(prev => 
      prev.includes(id) 
        ? prev.filter(x => x !== id) 
        : [...prev, id]
    );
  };

  const handleConfirmRestore = async () => {
    if (!user?.id || selectedToRestore.length === 0) return;
    setIsRestoring(true);
    try {
      const { addedCount } = await restoreHiddenDefaults(user.id, selectedToRestore);
      toast({
        title: t('ex.restoreSuccessTitle'),
        description: addedCount > 0 ? tn('ex.restoredDesc', addedCount) : t('ex.noneRestored'),
      });
      setIsRestoreDialogOpen(false);
      await fetchUserExercises(user.id);
      await fetchHiddenDefaults(user.id);
    } catch(e: any) {
      console.error('[ExerciseClientPage] restore failed:', e);
      toast({ title: t('ex.restoreFailedTitle'), description: friendlyErrorMessage(e, t('ex.restoreFailedDesc')), variant: 'destructive'});
    } finally {
      setIsRestoring(false);
    }
  };


  if (authContext.isLoading || isLoading) { 
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-[15px] font-medium text-muted-foreground">
          {authContext.isLoading ? tr('common.loadingAuth') : tr('ex.loading')}
        </p>
      </div>
    );
  }

  if (!user && !authContext.isLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="mb-4 font-headline text-[22px] font-semibold leading-none">{tr('ex.loginPrompt')}</p>
        <Button onClick={() => router.push('/login')}>{tr('common.goToLogin')}</Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={tr('ex.title')} description={tr('ex.description')}>
         <div className="flex items-center gap-2">
            {hiddenDefaults.length > 0 && (
                <Button variant="outline" onClick={handleOpenRestoreDialog} className="hidden sm:flex">
                  <History className="mr-2 h-4 w-4" />
                  {tr('ex.restoreDefaults')}
                  <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground text-xs font-bold">
                    {hiddenDefaults.length}
                  </span>
                </Button>
            )}
            <Button
              variant="default"
              onClick={handleOpenAddDialog}
              disabled={isLoading}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {tr('ex.add')}
            </Button>
         </div>
      </PageHeader>

      <AddExerciseDialog
        exerciseToEdit={exerciseToEdit}
        onSave={handleSaveExercise}
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        isSaving={isDialogSaving}
      />
      
      {/* Restore Dialog - Updated UI */}
      <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <RestoreDialogContent>
          <RestoreDialogHeader>
            <RestoreDialogTitle>{tr('ex.restoreTitle')}</RestoreDialogTitle>
            <RestoreDialogDescription>{tr('ex.restoreDesc')}</RestoreDialogDescription>
          </RestoreDialogHeader>

          <div className="py-2">
            {hiddenDefaults.length > 0 ? (
                <ScrollArea className="max-h-[300px] w-full p-1 pr-3">
                    <div className="space-y-2">
                    {hiddenDefaults.map(ex => {
                        const isSelected = selectedToRestore.includes(ex.id);
                        return (
                            <div
                                key={ex.id}
                                className={cn(
                                    "flex min-h-[52px] cursor-pointer items-center justify-between rounded-md border p-3 transition-colors",
                                    isSelected
                                        ? "border-primary bg-primary/10"
                                        : "border-transparent bg-muted/30 hover:bg-muted/50"
                                )}
                                onClick={() => handleToggleRestoreSelection(ex.id)}
                            >
                                <div className="min-w-0">
                                    <p className={cn("truncate text-[15px] font-medium leading-snug", isSelected && "text-primary")}>
                                        {displayExerciseName(ex, language)}
                                    </p>
                                    <p className="text-[12px] text-muted-foreground">{muscleGroupLabel(ex.muscleGroup, language)}</p>
                                </div>

                                {isSelected ? (
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                        <Check className="h-3.5 w-3.5" />
                                    </div>
                                ) : (
                                    <div className="h-6 w-6 shrink-0 rounded-full border border-muted-foreground/30" />
                                )}
                            </div>
                        );
                    })}
                    </div>
                </ScrollArea>
            ) : (
                <p className="py-4 text-center text-[13px] text-muted-foreground">{tr('ex.noHidden')}</p>
            )}
          </div>

          <RestoreDialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
                <Button variant="ghost" disabled={isRestoring}>{tr('common.cancel')}</Button>
            </DialogClose>
            <Button onClick={handleConfirmRestore} disabled={isRestoring || selectedToRestore.length === 0}>
                {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                {tr('ex.restoreSelected', { n: selectedToRestore.length })}
            </Button>
          </RestoreDialogFooter>
        </RestoreDialogContent>
      </Dialog>

      {/* Main Content Area */}
      <div className="space-y-6">
        {/* VIEW 1: Categories Grid */}
        {activeMuscleGroup === null && (
            <div className="animate-enter enter-1 space-y-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder={tr('picker.searchAll')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-11 w-full pl-10"
                    />
                </div>

                {searchTerm ? (
                    displayedExercises.length > 0 ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {displayedExercises.map(exercise => (
                            <ExerciseCard
                                key={exercise.id}
                                exercise={exercise}
                                onEdit={() => handleOpenEditDialog(exercise)}
                                onDelete={() => openDeleteConfirmation(exercise.id)}
                            />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-md border border-dashed bg-muted/40 py-12 text-center text-[13px] text-muted-foreground">{tr('picker.noneFound')}</div>
                    )
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                        <button
                            onClick={() => setActiveMuscleGroup('All')}
                            className="pressable flex min-h-[72px] items-center gap-3 rounded-md border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                        >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                                <Dumbbell className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <span className="block truncate text-[15px] font-semibold leading-snug">{tr('picker.allExercises')}</span>
                                <span className="text-[12px] text-muted-foreground">{trn('items.count', canonicalExercises.length)}</span>
                            </div>
                        </button>

                        {MUSCLE_GROUPS_LIST.map(mg => {
                            const count = exerciseCounts[mg] || 0;
                            if (count === 0) return null;
                            return (
                                <button
                                    key={mg}
                                    onClick={() => setActiveMuscleGroup(mg)}
                                    className="pressable flex min-h-[72px] items-center gap-3 rounded-md border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                                >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                        <MuscleGroupIcon muscleGroup={mg} size={20} />
                                    </div>
                                    <div className="min-w-0">
                                        <span className="block truncate text-[15px] font-semibold leading-snug">{muscleGroupLabel(mg, language)}</span>
                                        <span className="text-[12px] text-muted-foreground">{trn('exercises.count', count)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        )}

        {/* VIEW 2: Exercise List */}
        {activeMuscleGroup !== null && (
            <div className="animate-enter enter-1 space-y-6">
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setActiveMuscleGroup(null);
                                setSearchTerm('');
                            }}
                            className="px-2 text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            {tr('common.categories')}
                        </Button>
                        <h2 className="font-headline text-[22px] font-semibold leading-none tracking-tight">
                            {activeMuscleGroup === 'All' ? tr('picker.allExercises') : muscleGroupLabel(activeMuscleGroup, language)}
                        </h2>
                    </div>
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder={activeMuscleGroup === 'All' ? tr('ex.search') : tr('ex.searchIn', { group: muscleGroupLabel(activeMuscleGroup, language) })}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-11 pl-9"
                        />
                    </div>
                </div>

                {displayedExercises.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {displayedExercises.map(exercise => (
                        <ExerciseCard
                            key={exercise.id}
                            exercise={exercise}
                            onEdit={() => handleOpenEditDialog(exercise)}
                            onDelete={() => openDeleteConfirmation(exercise.id)}
                        />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed bg-muted/40 py-12 text-center">
                        <p className="font-headline text-[22px] font-semibold leading-none text-muted-foreground">{tr('picker.noneFound')}</p>
                        <Button variant="link" onClick={() => setSearchTerm('')}>{tr('ex.clearSearch')}</Button>
                    </div>
                )}
            </div>
        )}

      </div>

      <AlertDialog open={!!exerciseToDeleteId} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive"/>
              {tr('common.confirmDeletion')}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
              <div>
                {isBusyDeleting ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {tr('ex.checkingRoutines')}
                  </div>
                ) : affectedRoutines.length > 0 ? (
                    <div className='space-y-3'>
                      <div className="font-semibold text-foreground">{tr('ex.usedIn', { count: trn('routines.count', affectedRoutines.length) })}</div>
                      <ScrollArea className="max-h-32 w-full rounded-md border p-2">
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {affectedRoutines.map(r => <li key={r.id}>{r.name}</li>)}
                        </ul>
                      </ScrollArea>
                      <div>{tr('ex.willRemove.pre')}<span className="font-bold">{tr('ex.willRemove.strong')}</span>.</div>
                      <div>{tr('ex.proceed')}</div>
                    </div>
                ) : (
                  <div>
                    {tr('ex.permanentDelete', { name: (() => { const ex = exercises.find(e => e.id === exerciseToDeleteId); return ex ? displayExerciseName(ex, language) : ''; })() })}
                  </div>
                )}
              </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog} disabled={isBusyDeleting}>
              {tr('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExercise}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              disabled={isBusyDeleting}
            >
              {isBusyDeleting ? <Loader2 className="h-4 w-4 animate-spin"/> : (affectedRoutines.length > 0 ? tr('ex.deleteAnyway') : tr('common.delete'))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
