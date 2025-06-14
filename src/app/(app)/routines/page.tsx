
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { Routine, RoutineData } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, Loader2, ListChecks } from 'lucide-react';
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
import { addRoutine, getRoutines, updateRoutine, deleteRoutine as deleteRoutineService } from '@/services/routineService';
import { useRouter } from 'next/navigation'; // For redirecting if not logged in

export default function RoutinesPage() {
  const authContext = useAuth();
  const { user } = authContext;
  const { toast } = useToast();
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDialogSaving, setIsDialogSaving] = useState(false);
  const [routineToEdit, setRoutineToEdit] = useState<Routine | null>(null);
  const [routineToDeleteId, setRoutineToDeleteId] = useState<string | null>(null);

  const fetchUserRoutines = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    try {
      const userRoutines = await getRoutines(currentUserId);
      setRoutines(userRoutines);
    } catch (error: any) {
      console.error("Failed to fetch routines:", error);
      toast({
        title: "Error Fetching Routines",
        description: `Could not fetch your routines. ${error.message || 'Please try again later.'}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (user?.id) {
      fetchUserRoutines(user.id);
    } else if (!authContext.isLoading && !user) {
      // Not loading and no user, means definitely logged out
      setIsLoading(false);
      setRoutines([]); // Clear routines if user logs out
    }
  }, [user, authContext.isLoading, fetchUserRoutines]);

  const handleOpenAddDialog = () => {
    setRoutineToEdit(null);
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (routine: Routine) => {
    setRoutineToEdit(routine);
    setIsDialogOpen(true);
  };

  const handleSaveRoutine = async (data: RoutineData, id?: string) => {
    if (!user?.id) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    setIsDialogSaving(true);
    try {
      if (id) { // Editing existing routine
        await updateRoutine(user.id, id, data);
        toast({ title: "Routine Updated", description: `${data.name} has been successfully updated.` });
      } else { // Creating new routine
        await addRoutine(user.id, data);
        toast({ title: "Routine Created", description: `${data.name} has been successfully created.` });
      }
      fetchUserRoutines(user.id); // Refresh list
      setIsDialogOpen(false);
      setRoutineToEdit(null);
    } catch (error: any) {
      toast({
        title: "Save Error",
        description: `Could not save routine ${data.name}. ${error.message || 'Unknown error'}`,
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
      toast({ title: "Error", description: "Could not delete routine.", variant: "destructive" });
      return;
    }
    const routineName = routines.find(r => r.id === routineToDeleteId)?.name || "The routine";
    try {
      await deleteRoutineService(user.id, routineToDeleteId);
      toast({ title: "Routine Deleted", description: `${routineName} has been removed.` });
      fetchUserRoutines(user.id); // Refresh list
    } catch (error: any) {
      toast({ title: "Delete Error", description: `Could not delete ${routineName}. ${error.message}`, variant: "destructive" });
    } finally {
      setRoutineToDeleteId(null);
    }
  };

  if (authContext.isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-xl text-primary font-semibold">Loading authentication...</p>
      </div>
    );
  }

  if (!user && !authContext.isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-64">
        <p className="text-xl text-primary font-semibold mb-4">Please log in to manage your routines.</p>
        <Button onClick={() => router.push('/login')}>Go to Login</Button>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <PageHeader title="Workout Routines" description="Design and manage your custom workout plans.">
        <Button 
            variant="default" 
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={handleOpenAddDialog}
            disabled={isLoading}
        >
          <PlusCircle className="mr-2 h-4 w-4" /> Create Routine
        </Button>
      </PageHeader>

      <AddEditRoutineDialog
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        onSave={handleSaveRoutine}
        routineToEdit={routineToEdit}
        isSaving={isDialogSaving}
      />

      {isLoading && user ? (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="ml-3 text-lg text-primary">Loading your routines...</p>
        </div>
      ) : routines.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {routines.map(routine => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              onEdit={handleOpenEditDialog}
              onDelete={openDeleteConfirmation}
            />
          ))}
        </div>
      ) : (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-xl flex items-center">
                <ListChecks className="mr-2 h-5 w-5 text-primary"/>
                Your Routines
            </CardTitle>
            <CardDescription>You haven't created any routines yet.</CardDescription>
          </CardHeader>
          <CardContent className="text-center py-12">
            <ListChecks className="mx-auto h-20 w-20 text-muted-foreground mb-4 opacity-50" />
            <p className="text-lg text-muted-foreground font-semibold">No routines found.</p>
            <p className="text-muted-foreground">Click "Create Routine" to get started!</p>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!routineToDeleteId} onOpenChange={(open) => !open && setRoutineToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the routine
              "{routines.find(r => r.id === routineToDeleteId)?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRoutineToDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRoutine} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
