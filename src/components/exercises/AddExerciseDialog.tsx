
"use client";

import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, MuscleGroup } from '@/types';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Schema for form validation, does not include 'id' or 'image'
const exerciseFormSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  muscleGroup: z.enum(MUSCLE_GROUPS_LIST, { message: "Please select a muscle group" }),
  description: z.string().optional(),
  // dataAiHint could be added here if needed in the form, but typically generated
});

export type ExerciseFormData = z.infer<typeof exerciseFormSchema>;

interface AddExerciseDialogProps {
  exerciseToEdit?: Exercise | null; // Full exercise object if editing
  onSave: (data: ExerciseFormData) => void; // Passes form data up
  triggerButton?: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isSaving: boolean;
}

export function AddExerciseDialog({ 
  exerciseToEdit, 
  onSave, 
  triggerButton,
  isOpen,
  setIsOpen,
  isSaving
}: AddExerciseDialogProps) {
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<ExerciseFormData>({
    resolver: zodResolver(exerciseFormSchema),
    defaultValues: {
      name: '',
      muscleGroup: undefined,
      description: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (exerciseToEdit) {
        reset({
          name: exerciseToEdit.name,
          muscleGroup: exerciseToEdit.muscleGroup,
          description: exerciseToEdit.description || '',
        });
      } else {
        reset({ name: '', muscleGroup: undefined, description: '' });
      }
    }
  }, [exerciseToEdit, reset, isOpen]);

  const onSubmit = (data: ExerciseFormData) => {
    onSave(data); // `ExerciseClientPage` will handle if it's an add or update
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-headline">{exerciseToEdit ? 'Edit Exercise' : 'Add New Exercise'}</DialogTitle>
          <DialogDescription>
            {exerciseToEdit ? 'Update the details of this exercise.' : 'Fill in the details for the new exercise.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Exercise Name</Label>
            <Input id="name" {...register('name')} aria-invalid={errors.name ? "true" : "false"} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="muscleGroup">Muscle Group</Label>
            <Controller
              name="muscleGroup"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                  <SelectTrigger id="muscleGroup" aria-invalid={errors.muscleGroup ? "true" : "false"}>
                    <SelectValue placeholder="Select a muscle group" />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSCLE_GROUPS_LIST.map((group) => (
                      <SelectItem key={group} value={group}>
                        {group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.muscleGroup && <p className="text-sm text-destructive">{errors.muscleGroup.message}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea id="description" {...register('description')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {isSaving ? (exerciseToEdit ? "Saving..." : "Adding...") : (exerciseToEdit ? "Save Changes" : "Add Exercise")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
