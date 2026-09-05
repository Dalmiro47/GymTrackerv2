
"use client";

import { friendlyErrorMessage } from '@/lib/errorMessages';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { Routine, RoutineData, Exercise } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, Loader2, ListChecks, GripVertical, Save } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { RoutineCard } from '@/components/routines/RoutineCard';
import { AddEditRoutineDialog } from '@/components/routines/AddEditRoutineDialog';
import { RoutineHistorySheet } from '@/components/routines/RoutineHistorySheet';
import { getAllRoutineHistory } from '@/services/routineHistoryService';
import type { RoutineVersion } from '@/types/routineHistory';
import { getExercises as fetchAllUserExercises } from '@/services/exerciseService';
import { 
  addRoutine, 
  getRoutines, 
  updateRoutine, 
  deleteRoutine as deleteRoutineService,
  updateRoutinesOrder 
} from '@/services/routineService';
import { useRouter } from 'next/navigation';

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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useIsMobile } from '@/hooks/use-mobile';
import { CoachChatSheet } from '@/components/coach/CoachChatSheet';
import { buildRoutineReviewContext, type RoutineReviewContext } from '@/lib/ai/context-builders';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { subDays } from 'date-fns';
import { getLogsSince } from '@/services/trainingLogService';
import { confirmDiscardUnsavedChanges } from '@/lib/unsavedChanges';
import { useI18n } from '@/contexts/LanguageContext';
// Module-level `t` for toasts inside memoised fetchers, so a language switch
// never re-creates them (and refetches). Render-time text uses the hook.
import { t } from '@/i18n';


export default function RoutinesPage() {
  const authContext = useAuth();
  const { user } = authContext;
  const { toast } = useToast();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { t: tr } = useI18n();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [allUserExercises, setAllUserExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDialogSaving, setIsDialogSaving] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [routineToEdit, setRoutineToEdit] = useState<Routine | null>(null);
  const [routineToDeleteId, setRoutineToDeleteId] = useState<string | null>(null);
  const [routineForHistory, setRoutineForHistory] = useState<Routine | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const fetchUserRoutines = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    try {
      const userRoutines = await getRoutines(currentUserId);
      setRoutines(userRoutines);
    } catch (error: any) {
      console.error("Failed to fetch routines:", error);
      toast({
        title: t('routines.fetchErrorTitle'),
        description: friendlyErrorMessage(error, t('routines.fetchErrorDesc')),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchExercises = useCallback(async (currentUserId: string) => {
    setIsLoadingExercises(true);
    try {
      const exercises = await fetchAllUserExercises(currentUserId);
      setAllUserExercises(exercises);
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: friendlyErrorMessage(error, t('routines.fetchExercisesError')),
        variant: "destructive",
      });
    } finally {
      setIsLoadingExercises(false);
    }
  }, [toast]);

  useEffect(() => {
    if (user?.id) {
      fetchUserRoutines(user.id);
      fetchExercises(user.id);
    } else if (!authContext.isLoading && !user) {
      setIsLoading(false);
      setIsLoadingExercises(false);
      setRoutines([]); 
      setAllUserExercises([]);
    }
  }, [user, authContext.isLoading, fetchUserRoutines, fetchExercises]);

  const handleOpenAddDialog = () => {
    setRoutineToEdit(null);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (routine: Routine) => {
    setRoutineToEdit(routine);
    setIsDialogOpen(true);
  };

  const handleOpenHistory = (routine: Routine) => {
    setRoutineForHistory(routine);
    setIsHistoryOpen(true);
  };

  const handleSaveRoutine = async (data: Omit<RoutineData, 'order'>, id?: string) => {
    if (!user?.id) {
      toast({ title: t('common.authErrorTitle'), description: t('common.mustBeLoggedIn'), variant: "destructive" });
      return;
    }
    setIsDialogSaving(true);
    try {
      if (id) {
        await updateRoutine(user.id, id, data);
        toast({ title: t('routines.updatedTitle'), description: t('routines.updatedDesc', { name: data.name }) });
      } else {
        await addRoutine(user.id, data);
        toast({ title: t('routines.createdTitle'), description: t('routines.createdDesc', { name: data.name }) });
      }
      fetchUserRoutines(user.id);
      setIsDialogOpen(false);
      setRoutineToEdit(null);
    } catch (error: any) {
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('routines.saveError')),
        variant: "destructive",
      });
    } finally {
      setIsDialogSaving(false);
    }
  };

  const openDeleteConfirmation = (id: string) => {
    setRoutineToDeleteId(id);
  };

  const handleDeleteRoutine = async () => {
    if (!routineToDeleteId || !user?.id) {
      toast({ title: t('common.error'), description: t('routines.deleteFailed'), variant: "destructive" });
      return;
    }
    const routineName = routines.find(r => r.id === routineToDeleteId)?.name || t('routines.theRoutine');
    setIsLoading(true);
    try {
      await deleteRoutineService(user.id, routineToDeleteId);
      toast({ title: t('routines.deletedTitle'), description: t('routines.deletedDesc', { name: routineName }) });
      const updatedRoutines = await getRoutines(user.id);
      setRoutines(updatedRoutines);
    } catch (error: any) {
      toast({ title: t('common.deleteErrorTitle'), description: friendlyErrorMessage(error, t('routines.deleteError')), variant: "destructive" });
    } finally {
      setRoutineToDeleteId(null);
      setIsLoading(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile
        ? { delay: 200, tolerance: 8 }
        : undefined,
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Lazy context loader for AI Coach chat
  const loadCoachContext = useCallback(async (): Promise<RoutineReviewContext> => {
    if (!user?.id) throw new Error('User not authenticated');

    // Fetch last 90 days of workout logs (cached service read)
    const logs = await getLogsSince(user.id, subDays(new Date(), 90));

    // Fetch profile
    const profileSnap = await getDoc(doc(db, 'users', user.id, 'profile', 'profile'));
    const profile = profileSnap.exists() ? profileSnap.data() : {};

    // Recorded routine changes. Best-effort: the Coach is still useful without them.
    let routineVersions: RoutineVersion[] = [];
    try {
      routineVersions = await getAllRoutineHistory(user.id);
    } catch (err: any) {
      console.warn('Could not load routine history for coach context:', err?.message);
    }

    return buildRoutineReviewContext(
      routines,
      logs,
      { goal: profile.goal, daysPerWeekTarget: profile.daysPerWeekTarget },
      routineVersions,
    );
  }, [user?.id, routines]);

  async function handleDragEndRoutines(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id && user?.id) {
      setIsOrderSaving(true);
      const oldIndex = routines.findIndex((r) => r.id === active.id);
      const newIndex = routines.findIndex((r) => r.id === over.id);
      const reorderedRoutines = arrayMove(routines, oldIndex, newIndex);
      setRoutines(reorderedRoutines); // Optimistically update UI

      const orderedIds = reorderedRoutines.map(r => r.id);
      try {
        await updateRoutinesOrder(user.id, orderedIds);
        toast({ title: t('routines.orderSavedTitle'), description: t('routines.orderSavedDesc') });
      } catch (error: any) {
        toast({
          title: t('routines.orderErrorTitle'),
          description: friendlyErrorMessage(error, t('routines.orderErrorDesc')),
          variant: "destructive",
        });
        fetchUserRoutines(user.id);
      } finally {
        setIsOrderSaving(false);
      }
    }
  }


  if (authContext.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-[15px] font-medium text-muted-foreground">{tr('common.loadingAuth')}</p>
      </div>
    );
  }

  if (!user && !authContext.isLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="mb-4 font-headline text-[22px] font-semibold leading-none">{tr('routines.loginPrompt')}</p>
        <Button onClick={() => { if (confirmDiscardUnsavedChanges()) router.push('/login'); }}>{tr('common.goToLogin')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={tr('routines.title')} description={tr('routines.description')}>
        <div className="flex w-full items-center justify-end gap-3">
            {isOrderSaving && (
                <div className="flex items-center text-[13px] text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {tr('routines.savingOrder')}
                </div>
            )}
            <Button
                variant="default"
                onClick={handleOpenAddDialog}
                disabled={isLoading || isOrderSaving || isLoadingExercises}
            >
            <PlusCircle className="mr-2 h-4 w-4" /> {tr('routines.create')}
            </Button>
        </div>
      </PageHeader>

      <AddEditRoutineDialog
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        onSave={handleSaveRoutine}
        routineToEdit={routineToEdit}
        isSaving={isDialogSaving}
        allUserExercises={allUserExercises}
        isLoadingExercises={isLoadingExercises}
      />

      {isLoading && user ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-3 text-[15px] text-muted-foreground">{tr('routines.loading')}</p>
        </div>
      ) : routines.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEndRoutines}
        >
          <SortableContext items={routines.map(r => r.id)} strategy={rectSortingStrategy}>
            <div className="animate-enter enter-1 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {routines.map(routine => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  onEdit={handleOpenEditDialog}
                  onDelete={openDeleteConfirmation}
                  onViewHistory={handleOpenHistory}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <Card className="animate-enter enter-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-primary"/>
                {tr('routines.yourRoutines')}
            </CardTitle>
            <CardDescription>{tr('routines.noneYet')}</CardDescription>
          </CardHeader>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ListChecks className="h-6 w-6" />
            </div>
            <p className="font-headline text-[22px] font-semibold leading-none">{tr('routines.noneFound')}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">{tr('routines.clickCreate')}</p>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!routineToDeleteId} onOpenChange={(open) => !open && setRoutineToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('routines.areYouSure')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('routines.deleteDesc', { name: routines.find(r => r.id === routineToDeleteId)?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRoutineToDeleteId(null)}>{tr('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRoutine} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              {tr('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoutineHistorySheet
        userId={user?.id}
        routine={routineForHistory}
        isOpen={isHistoryOpen}
        setIsOpen={setIsHistoryOpen}
      />

      {/* Floating AI Coach */}
      <CoachChatSheet mode="routine-review" loadContext={loadCoachContext} />
    </div>
  );
}
