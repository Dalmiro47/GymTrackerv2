"use client";

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
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
import { Form, FormItem, FormLabel, FormControl, FormMessage, FormField } from '@/components/ui/form';
import { assertMuscleGroup } from '@/lib/muscleGroup';
import { useI18n } from '@/contexts/LanguageContext';
import { muscleGroupLabel, warmupTemplateLabel, type TranslationKey } from '@/i18n';
import { displayExerciseFields } from '@/lib/exerciseDisplay';

// Schemas are built per language so validation messages are translated too.
type Translate = (key: TranslationKey) => string;

const makeExerciseFormSchema = (t: Translate) => {
  const warmupStepSchema = z.object({
    type: z.enum(['PERCENT', 'LABEL']),
    percent: z.number().min(0).max(1).optional(),
    reps: z.string().min(1, t('exForm.repsRequired')),
    rest: z.string().min(1, t('exForm.restRequired')),
    appliesTo: z.enum(['TOTAL', 'ADDED']).optional(),
    note: z.string().optional(),
  });

  const muscleGroupSchema = z.preprocess(
    (v) => (typeof v === 'string' ? assertMuscleGroup(v) : v),
    z.enum(MUSCLE_GROUPS_LIST, { message: t('exForm.selectGroup') })
  );

  return z.object({
    name: z.string().min(2, t('exForm.nameMin')),
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
};

export type ExerciseFormData = z.infer<ReturnType<typeof makeExerciseFormSchema>>;

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
    const { t, language } = useI18n();
    const exerciseFormSchema = useMemo(() => makeExerciseFormSchema(t), [t]);
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
      // Pre-fill with what the user sees (a seeded default reads in the UI
      // language); the page maps untouched fields back to the stored English on save.
      const shown = displayExerciseFields(exerciseToEdit, language);
      reset({
        name: shown.name,
        muscleGroup: assertMuscleGroup(exerciseToEdit.muscleGroup as any),
        targetNotes: shown.targetNotes ?? '',
        exerciseSetup: shown.exerciseSetup ?? '',
        progressiveOverload: shown.progressiveOverload ?? '',
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
  }, [exerciseToEdit, isOpen, reset, language]);


  const onSubmit = (data: ExerciseFormData) => {
    onSave(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent
        className="flex max-h-[85dvh] w-[min(95vw,560px)] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()} // STOP MOBILE KEYBOARD
      >

        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{exerciseToEdit ? t('exForm.editTitle') : t('exForm.addTitle')}</DialogTitle>
          <DialogDescription>
            {exerciseToEdit ? t('exForm.editDesc') : t('exForm.addDesc')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="flex-grow overflow-y-auto">
                <div className="grid grid-cols-1 gap-6 p-4">

                    {/* Basic Info */}
                    <div className="space-y-4">
                        <div className="eyebrow flex h-8 items-center gap-2 border-b pb-2">
                            <Dumbbell className="h-4 w-4" /> {t('exForm.basicInfo')}
                        </div>

                        <FormField
                        control={control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel className="flex items-center h-5">{t('exForm.name')}</FormLabel>
                            <FormControl>
                                <Input {...field} placeholder={t('exForm.namePlaceholder')} />
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
                            <FormLabel className="flex items-center h-5">{t('exForm.muscleGroup')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder={t('exForm.selectMuscleGroup')} />
                                </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                {MUSCLE_GROUPS_LIST.map((group) => (
                                    <SelectItem key={group} value={group}>
                                    {muscleGroupLabel(group, language)}
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
                                <FormLabel className="flex items-center h-5">{t('exForm.notes')}</FormLabel>
                                <FormControl>
                                    <Textarea {...field} placeholder={t('exForm.notesPlaceholder')} className="h-24 resize-none" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                    </div>

                    {/* Advanced Details */}
                    <div className="space-y-4">
                        <div className="eyebrow flex h-8 items-center gap-2 border-b pb-2">
                            <Settings2 className="h-4 w-4" /> {t('exForm.trainingDetails')}
                        </div>

                        <FormField
                        control={control}
                        name="exerciseSetup"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex items-center h-5">{t('exForm.setup')}</FormLabel>
                                <FormControl>
                                    <Input {...field} placeholder={t('exForm.setupPlaceholder')} />
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
                                {t('exForm.overload')}
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                            </FormLabel>
                            <FormControl>
                                <Input {...field} placeholder={t('exForm.overloadPlaceholder')} />
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
                                        <Flame className="h-3.5 w-3.5 text-chart-5" />
                                        {t('exForm.warmupConfig')}
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button type="button" variant="ghost" size="icon" className="-my-1.5 ml-1 h-8 w-8 rounded-full p-0 text-muted-foreground" aria-label={t('exForm.aboutWarmup')}>
                                                    <Info className="h-3.5 w-3.5" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="max-w-xs p-3 text-xs" side="top">
                                                <p className="font-semibold mb-1">{t('exForm.warmupTemplates')}</p>
                                                <p className="text-muted-foreground">{t('exForm.warmupHelp')}</p>
                                            </PopoverContent>
                                        </Popover>
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('exForm.selectTemplate')} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {WARMUP_TEMPLATES.map((template) => (
                                                <SelectItem key={template} value={template}>{warmupTemplateLabel(template, language)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <DialogFooter className="border-t bg-muted/30 p-4">
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
                    {t('common.cancel')}
                    </Button>
                    <Button type="submit" disabled={isSaving} className="min-w-[140px]">
                    {isSaving ? (exerciseToEdit ? t('routineForm.savingEllipsis') : t('exForm.adding')) : (exerciseToEdit ? t('routineForm.saveChanges') : t('ex.add'))}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
