import type { MuscleGroup } from '@/types';
import { MUSCLE_GROUP_ICONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface MuscleGroupIconProps {
  muscleGroup: MuscleGroup;
  className?: string;
  size?: number;
}

export function MuscleGroupIcon({ muscleGroup, className, size = 16 }: MuscleGroupIconProps) {
  const IconComponent = MUSCLE_GROUP_ICONS[muscleGroup] || MUSCLE_GROUP_ICONS.Other;
  return <IconComponent className={cn("inline-block", className)} size={size} aria-label={muscleGroup}/>;
}
