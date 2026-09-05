
import type { Exercise } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MuscleGroupIcon } from './MuscleGroupIcon';
import { Edit3, Trash2, Info, Settings2, TrendingUp } from 'lucide-react';
import { useI18n } from '@/contexts/LanguageContext';
import { muscleGroupLabel } from '@/i18n';
import { displayExerciseFields } from '@/lib/exerciseDisplay';

interface ExerciseCardProps {
  exercise: Exercise;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exerciseId: string) => void;
  onViewDetails?: (exercise: Exercise) => void; // Optional: if details view is separate
}

export function ExerciseCard({ exercise, onEdit, onDelete, onViewDetails }: ExerciseCardProps) {
  const { t, language } = useI18n();
  // Seeded defaults show in the UI language while their fields are untouched.
  const shown = displayExerciseFields(exercise, language);
  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-lg transition-colors hover:border-primary/40">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="font-headline text-[18px] leading-tight">
          {shown.name}
        </CardTitle>
        <div className="flex items-center text-[13px] text-muted-foreground">
          <MuscleGroupIcon muscleGroup={exercise.muscleGroup} className="mr-1.5 text-primary" />
          {muscleGroupLabel(exercise.muscleGroup, language)}
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-2 pb-3">
        <div>
          <p className="eyebrow">{t('ex.targetNotes')}</p>
          <CardDescription className="mt-0.5 line-clamp-3 text-[13px] leading-snug">
            {shown.targetNotes || t('ex.noTargetNotes')}
          </CardDescription>
        </div>
        {shown.exerciseSetup && (
          <div>
            <p className="eyebrow flex items-center">
              <Settings2 className="mr-1 h-3 w-3 text-primary" />
              {t('ex.setup')}
            </p>
            <CardDescription className="mt-0.5 line-clamp-2 text-[13px] leading-snug">
              {shown.exerciseSetup}
            </CardDescription>
          </div>
        )}
        {shown.progressiveOverload && (
          <div>
            <p className="eyebrow flex items-center">
              <TrendingUp className="mr-1 h-3 w-3 text-primary" />
              {t('ex.progressiveOverload')}
            </p>
            <CardDescription className="mt-0.5 line-clamp-2 text-[13px] leading-snug">
              {shown.progressiveOverload}
            </CardDescription>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-1 border-t p-2">
        {onViewDetails && (
           <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onViewDetails(exercise)} aria-label={t('ex.viewDetails', { name: shown.name })}>
            <Info className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onEdit(exercise)} aria-label={t('ex.edit', { name: shown.name })}>
          <Edit3 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(exercise.id)} aria-label={t('ex.deleteAria', { name: shown.name })} className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
