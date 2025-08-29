
"use client";

import { useState, useEffect } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise, MuscleGroup, WarmupTemplate } from '@/types';
import { MUSCLE_GROUPS_LIST, WARMUP_TEMPLATES } from '@/lib/constants';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Trash2, PlusCircle, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFormField, Form, FormItem, FormLabel, FormControl, FormMessage, FormField } from '@/components/ui/form';


const warmupStepSchema = z.object({
  type: z.enum(['PERCENT', 'LABEL']),
  percent: z.number().min(0).max(1).optional(),
  reps: z.string().min(1, "Reps are required"),
  rest: z.string().min(1, "Rest is required"),
  appliesTo: z.enum(['TOTAL', 'ADDED']).optional(),
  note: z.string().optional(),
});

const exerciseFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  muscleGroup: z.enum(MUSCLE_GROUPS_LIST, { message: "Please select a muscle group" }),
  targetNotes: z.string().optional(),
  exerciseSetup: z.string().optional(),
  warmup: z.object({
    template: z.enum(WARMUP_TEMPLATES),
    isWeightedBodyweight: z.boolean().optional(),
    roundingIncrementKg: z.number().optional(),
    overrideSteps: z.array(warmupStepSchema).optional(),
  }).optional(),
});

export type ExerciseFormData = z.infer<typeof exerciseFormSchema>;

interface AddExerciseDialogProps {
  exerciseToEdit?: Exercise | null;
  onSave: (data: ExerciseFormData) => void;
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
    const form = useForm<ExerciseFormData>({
        resolver: zodResolver(exerciseFormSchema),
        defaultValues: {
            name: '',
            muscleGroup: 'Back', // A sensible default
            targetNotes: '',
            exerciseSetup: '',
            warmup: undefined,
        },
    });

  const { control, register, handleSubmit, reset, formState: { errors } } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "warmup.overrideSteps"
  });

  useEffect(() => {
    if (!isOpen) return;

    if (exerciseToEdit) {
      reset({
        name: exerciseToEdit.name,
        muscleGroup: exerciseToEdit.muscleGroup,
        targetNotes: exerciseToEdit.targetNotes ?? '',
        exerciseSetup: exerciseToEdit.exerciseSetup ?? '',
        warmup: exerciseToEdit.warmup,
      });
    } else {
      reset({
        name: '',
        muscleGroup: 'Back',
        targetNotes: '',
        exerciseSetup: '',
        warmup: undefined,
      });
    }
  }, [exerciseToEdit, isOpen, reset]);


  const onSubmit = (data: ExerciseFormData) => {
    onSave(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="font-headline">{exerciseToEdit ? 'Edit Exercise' : 'Add New Exercise'}</DialogTitle>
          <DialogDescription>
            {exerciseToEdit ? 'Update the details for this exercise.' : 'Fill in the details for the new exercise.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-4">
            
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Exercise Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="muscleGroup"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Muscle Group</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a muscle group" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MUSCLE_GROUPS_LIST.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="targetNotes"
              render={({ field }) => (
                  <FormItem>
                      <FormLabel>Notes / Target Area (Optional)</FormLabel>
                      <FormControl>
                          <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                  </FormItem>
              )}
            />

            <FormField
              control={control}
              name="exerciseSetup"
              render={({ field }) => (
                  <FormItem>
                      <FormLabel>Exercise Setup (Optional)</FormLabel>
                      <FormControl>
                          <Input {...field} placeholder="e.g., Machine position 8, Bench incline 30°" />
                      </FormControl>
                      <FormMessage />
                  </FormItem>
              )}
            />
            
            <Accordion type="single" collapsible className="w-full" defaultValue="warmup-settings">
                <AccordionItem value="warmup-settings">
                <AccordionTrigger>Warm-up Settings</AccordionTrigger>
                <AccordionContent className="space-y-4">
                    <div className="grid gap-2">
                    <div className="flex items-center gap-2">
                        <Label htmlFor="warmup.template">Warm-up Template</Label>
                        <Popover>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground">
                            <Info className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-xs sm:max-w-sm" side="top">
                            <div className="space-y-2 p-1 text-xs">
                            <p>Warm-up sets are calculated based on the working weight you enter in the Training Log.</p>
                            <h4 className="font-bold text-sm">Template Details:</h4>
                            <div><strong>HEAVY_BARBELL:</strong> 3 sets (40%, 65%, 80%). Adds an "Empty Bar" set for lower body exercises.</div>
                            <div><strong>HEAVY_DB:</strong> 2 sets (50%, 70%). Assumes total weight of both dumbbells.</div>
                            <div><strong>MACHINE_COMPOUND:</strong> 2 sets (50%, 70%).</div>
                            <div><strong>BODYWEIGHT:</strong> For weighted, one bodyweight set then one set at 50% of added weight. For unweighted, one light/assisted set.</div>
                            <div><strong>ISOLATION:</strong> A single "feeler" set at 50% of working weight.</div>
                            <div><strong>NONE:</strong> No warm-up sets will be shown.</div>
                            </div>
                        </PopoverContent>
                        </Popover>
                    </div>
                    <Controller
                        name="warmup.template"
                        control={control}
                        render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger id="warmup.template">
                            <SelectValue placeholder="Select a template" />
                            </SelectTrigger>
                            <SelectContent>
                            {WARMUP_TEMPLATES.map((template) => (
                                <SelectItem key={template} value={template}>{template.replace(/_/g, ' ')}</SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        )}
                    />
                    </div>
                    <div className="flex items-center space-x-2">
                    <Controller
                        name="warmup.isWeightedBodyweight"
                        control={control}
                        render={({ field }) => (
                            <Checkbox
                            id="warmup.isWeightedBodyweight"
                            checked={!!field.value}
                            onCheckedChange={(v) => field.onChange(!!v)}
                            />
                        )}
                        />
                    <Label htmlFor="warmup.isWeightedBodyweight">Weighted bodyweight</Label>
                    </div>

                    <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="override-steps">
                        <AccordionTrigger>Customize Steps (Advanced)</AccordionTrigger>
                        <AccordionContent className="space-y-2">
                        {fields.map((field, index) => (
                            <div key={field.id} className="grid grid-cols-4 gap-2 border p-2 rounded-md">
                            <Input {...register(`warmup.overrideSteps.${index}.reps`)} placeholder="Reps" />
                            <Input {...register(`warmup.overrideSteps.${index}.rest`)} placeholder="Rest" />
                            <Input {...register(`warmup.overrideSteps.${index}.percent`, { valueAsNumber: true })} placeholder="Percent (0.5)" type="number" step="0.01" />
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={() => append({ type: 'PERCENT', reps: '8', rest: '60s', percent: 0.5 })}>
                            <PlusCircle className="mr-2 h-4 w-4"/> Add Step
                        </Button>
                        </AccordionContent>
                    </AccordionItem>
                    </Accordion>

                </AccordionContent>
                </AccordionItem>
            </Accordion>

            <DialogFooter className="sticky bottom-0 bg-background py-4">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
                Cancel
                </Button>
                <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {isSaving ? (exerciseToEdit ? "Saving..." : "Adding...") : (exerciseToEdit ? "Save Changes" : "Add Exercise")}
                </Button>
            </DialogFooter>
            </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    