"use client";

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Exercise } from '@/types';
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
import { Info, Dumbbell, Settings2, TrendingUp, Flame } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFormField, Form, FormItem, FormLabel, FormControl, FormMessage, FormField } from '@/components/ui/form';
import { assertMuscleGroup } from '@/lib/muscleGroup';


const warmupStepSchema = z.object({
  type: z.enum(['PERCENT', 'LABEL']),
  percent: z.number().min(0).max(1).optional(),
  reps: z.string().min(1, "Reps are required"),
  rest: z.string().min(1, "Rest is required"),
  appliesTo: z.enum(['TOTAL', 'ADDED']).optional(),
  note: z.string().optional(),
});

const muscleGroupSchema = z.preprocess(
  (v) => (typeof v === 'string' ? assertMuscleGroup(v) : v),
  z.enum(MUSCLE_GROUPS_LIST, { message: 'Please select a muscle group' })
);

const exerciseFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  muscleGroup: muscleGroupSchema,
  targetNotes: z.string().optional(),
  exerciseSetup: z.string().optional(),
  progressiveOverload: z.string().optional(), 
  warmup: z.object({
    template: z.enum(WARMUP_TEMPLATES),
    // isWeightedBodyweight removed from UI, keeping optional in schema for backward compatibility if needed
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
            muscleGroup: 'Back', 
            targetNotes: '',
            exerciseSetup: '',
            progressiveOverload: '',
            warmup: undefined,
        },
    });

  const { control, handleSubmit, reset } = form;

  useEffect(() => {
    if (!isOpen) return;

    if (exerciseToEdit) {
      reset({
        name: exerciseToEdit.name,
        muscleGroup: assertMuscleGroup(exerciseToEdit.muscleGroup as any),
        targetNotes: exerciseToEdit.targetNotes ?? '',
        exerciseSetup: exerciseToEdit.exerciseSetup ?? '',
        progressiveOverload: exerciseToEdit.progressiveOverload ?? '',
        warmup: exerciseToEdit.warmup,
      });
    } else {
      reset({
        name: '',
        muscleGroup: 'Back',
        targetNotes: '',
        exerciseSetup: '',
        progressiveOverload: '',
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
      <DialogContent 
        className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()} // Prevents mobile keyboard on open
      >
        
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="font-headline text-xl">{exerciseToEdit ? 'Edit Exercise' : 'Add New Exercise'}</DialogTitle>
          <DialogDescription>
            {exerciseToEdit ? 'Update the details for this exercise.' : 'Fill in the details for the new exercise.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="flex-grow overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                    
                    {/* LEFT COLUMN: Basic Info */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-primary font-semibold border-b pb-2 mb-2 h-8">
                            <Dumbbell className="h-4 w-4" /> Basic Info
                        </div>

                        <FormField
                        control={control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel className="flex items-center h-5">Exercise Name</FormLabel>
                            <FormControl>
                                <Input {...field} placeholder="e.g. Bench Press" />
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
                            <FormLabel className="flex items-center h-5">Muscle Group</FormLabel>
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
                                <FormLabel className="flex items-center h-5">Notes / Target Area (Optional)</FormLabel>
                                <FormControl>
                                    <Textarea {...field} placeholder="e.g. Focus on upper chest..." className="h-24 resize-none" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                    </div>

                    {/* RIGHT COLUMN: Advanced Details */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-primary font-semibold border-b pb-2 mb-2 h-8">
                            <Settings2 className="h-4 w-4" /> Training Details
                        </div>

                        <FormField
                        control={control}
                        name="exerciseSetup"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex items-center h-5">Exercise Setup (Optional)</FormLabel>
                                <FormControl>
                                    <Input {...field} placeholder="e.g. Seat height 4, Pin 3" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />

                        <FormField
                        control={control}
                        name="progressiveOverload"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel className="flex items-center gap-2 h-5">
                                Progressive Overload (Optional)
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                            </FormLabel>
                            <FormControl>
                                <Input {...field} placeholder="e.g. 8–10 reps" />
                            </FormControl>
                            <FormMessage />
                            </FormItem>
                        )}
                        />
                        
                        {/* Warmup Section */}
                        <FormField
                            control={control}
                            name="warmup.template"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center gap-2 h-5">
                                        <Flame className="h-3.5 w-3.5 text-orange-500" /> 
                                        Warm-up Config
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button type="button" variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground hover:bg-transparent p-0 ml-1">
                                                    <Info className="h-3.5 w-3.5" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="max-w-xs p-3 text-xs" side="top">
                                                <p className="font-semibold mb-1">Warm-up Templates</p>
                                                <p className="text-muted-foreground">Automatically calculates warm-up sets based on your working weight.</p>
                                            </PopoverContent>
                                        </Popover>
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a template" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {WARMUP_TEMPLATES.map((template) => (
                                                <SelectItem key={template} value={template}>{template.replace(/_/g, ' ')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <DialogFooter className="p-4 border-t bg-muted/5">
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
                    Cancel
                    </Button>
                    <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]">
                    {isSaving ? (exerciseToEdit ? "Saving..." : "Adding...") : (exerciseToEdit ? "Save Changes" : "Add Exercise")}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
