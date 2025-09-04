
"use client";

import React from 'react';
import type { LoggedSet } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SetInputRowProps {
  set: LoggedSet;
  index: number;
  onSetChange: (index: number, field: keyof Omit<LoggedSet, 'id' | 'isProvisional'>, value: string) => void;
  onRemoveSet: () => void;
  isProvisional?: boolean;
  onInteract: () => void;
}

export function SetInputRow({
  set, index, onSetChange, onRemoveSet, isProvisional, onInteract
}: SetInputRowProps) {

  const change = (field: 'reps'|'weight', v: string) => {
    onSetChange(index, field, v);
    onInteract();
  };

  return (
    <div className="flex items-center gap-2" data-dndkit-no-drag>
      <span className="font-medium text-sm text-muted-foreground w-8 text-center">{index + 1}.</span>

      <Input
        type="number"
        inputMode="numeric"
        draggable={false}
        placeholder="Reps"
        value={set.reps === null ? '' : String(set.reps)}
        onChange={(e) => change('reps', e.target.value)}
        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
        onClickCapture={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => e.stopPropagation()}
        className={cn("h-9 text-sm", isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80")}
        min="0"
      />

      <span className="text-muted-foreground">x</span>

      <Input
        type="number"
        inputMode="decimal"
        step="0.25"
        draggable={false}
        placeholder="Weight"
        value={set.weight === null ? '' : String(set.weight)}
        onChange={(e) => change('weight', e.target.value)}
        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
        onClickCapture={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => e.stopPropagation()}
        className={cn("h-9 text-sm", isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80")}
        min="0"
      />

      <span className="text-muted-foreground">kg</span>

      <Button variant="ghost" size="icon" onClick={onRemoveSet}
        className="text-muted-foreground hover:text-destructive h-9 w-9">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
