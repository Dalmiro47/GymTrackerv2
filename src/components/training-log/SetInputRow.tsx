
"use client";

import React from 'react';
import type { LoggedSet } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react'; // PlusCircle removed
import { cn } from '@/lib/utils';

interface SetInputRowProps {
  set: LoggedSet;
  index: number;
  onSetChange: (index: number, field: keyof Omit<LoggedSet, 'id'>, value: string) => void;
  onRemoveSet: () => void;
  isProvisional?: boolean;
}

export function SetInputRow({ set, index, onSetChange, onRemoveSet, isProvisional }: SetInputRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-sm text-muted-foreground w-8 text-center">{index + 1}.</span>
      <Input
        type="number"
        placeholder="Reps"
        value={set.reps === null ? '' : String(set.reps)}
        onChange={(e) => onSetChange(index, 'reps', e.target.value)}
        className={cn(
            "h-9 text-sm",
            isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70"
        )}
        min="0"
        disabled={isProvisional}
      />
      <span className="text-muted-foreground">x</span>
      <Input
        type="number"
        placeholder="Weight"
        value={set.weight === null ? '' : String(set.weight)}
        onChange={(e) => onSetChange(index, 'weight', e.target.value)}
        className={cn(
            "h-9 text-sm",
            isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70"
        )}
        min="0"
        step="0.25"
        disabled={isProvisional}
      />
      <span className="text-muted-foreground">kg</span>
      <Button variant="ghost" size="icon" onClick={onRemoveSet} className="text-muted-foreground hover:text-destructive h-9 w-9">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
