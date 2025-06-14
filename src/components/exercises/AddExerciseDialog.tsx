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
import { useToast } from '@/hooks/use-toast';

const exerciseSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  muscleGroup: z.enum(MUSCLE_GROUPS_LIST, { message: "Please select a muscle group" }),
  description: z.string().optional(),
  image: z.string().url("Must be a valid URL").optional().or(z.literal('')),
});

type ExerciseFormData = z.infer<typeof exerciseSchema>;

interface AddExerciseDialogProps {
  exerciseToEdit?: Exercise | null;
  onSave: (exercise: Exercise) => void;
  triggerButton?: React.ReactNode; // Optional custom trigger
}

export function AddExerciseDialog({ exerciseToEdit, onSave, triggerButton }: AddExerciseDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ExerciseFormData>({
    resolver: zodResolver(exerciseSchema),
    defaultValues: {
      name: '',
      muscleGroup: undefined,
      description: '',
      image: '',
    },
  });

  useEffect(() => {
    if (exerciseToEdit) {
      reset({
        name: exerciseToEdit.name,
        muscleGroup: exerciseToEdit.muscleGroup,
        description: exerciseToEdit.description || '',
        image: exerciseToEdit.image || '',
      });
    } else {
      reset({ name: '', muscleGroup: undefined, description: '', image: '' });
    }
  }, [exerciseToEdit, reset, isOpen]); // Reset form when dialog opens or exerciseToEdit changes

  const onSubmit = (data: ExerciseFormData) => {
    const exerciseData: Exercise = {
      id: exerciseToEdit ? exerciseToEdit.id : crypto.randomUUID(), // Generate new ID or use existing
      name: data.name,
      muscleGroup: data.muscleGroup,
      description: data.description,
      image: data.image || undefined, // No default placeholder image
      // dataAiHint can be added here if there's a way to input it or generate it
    };
    onSave(exerciseData);
    toast({
      title: exerciseToEdit ? "Exercise Updated" : "Exercise Added",
      description: `${data.name} has been successfully ${exerciseToEdit ? 'updated' : 'added'}.`,
      variant: "default",
    });
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {triggerButton ? (
        <DialogTrigger asChild>{triggerButton}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground">
            {exerciseToEdit ? "Edit Exercise" : "Add New Exercise"}
          </Button>
        </DialogTrigger>
      )}
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

          <div className="grid gap-2">
            <Label htmlFor="image">Image URL (Optional)</Label>
            <Input id="image" {...register('image')} placeholder="https://example.com/image.png" aria-invalid={errors.image ? "true" : "false"}/>
             {errors.image && <p className="text-sm text-destructive">{errors.image.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {isSubmitting ? (exerciseToEdit ? "Saving..." : "Adding...") : (exerciseToEdit ? "Save Changes" : "Add Exercise")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
