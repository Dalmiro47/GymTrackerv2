
"use client";

import React, { useState, useEffect } from 'react';
import type { LoggedSet } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatWeightHalf } from '@/lib/rounding';


interface SetInputRowProps {
  set: LoggedSet;
  index: number;
  onSetChange: (index: number, field: keyof Omit<LoggedSet, 'id' | 'isProvisional'>, value: string) => void;
  onRemoveSet: () => void;
  isProvisional?: boolean;
  onInteract: () => void;
}

export function SetInputRow({ set, index, onSetChange, onRemoveSet, isProvisional, onInteract }: SetInputRowProps) {
  const [weightDisplay, setWeightDisplay] = useState(formatWeightHalf(set.weight));

  useEffect(() => {
    // Sync local display state if the prop changes from outside
    setWeightDisplay(formatWeightHalf(set.weight));
  }, [set.weight]);
  
  const change = (field: 'reps'|'weight', v: string) => {
    onSetChange(index, field, v); // allow '' to go through -> becomes null in parent
    onInteract();
  };

  return (
    <div className="grid grid-cols-[2rem_1fr_auto_1fr_auto_2.25rem] items-center gap-2" data-dndkit-no-drag>
      <span className="font-medium text-sm text-muted-foreground text-center">{index + 1}.</span>

      {/* Reps: integers only, 2 digits max handled upstream */}
      <Input
        type="number"
        inputMode="numeric"
        draggable={false}
        placeholder="Reps"
        aria-label={`Reps for set ${index + 1}`}
        value={set.reps == null ? '' : String(set.reps)}
        onChange={(e) => change('reps', e.target.value)}
        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
        onClickCapture={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // block scientific notation and signs for reps
          const block = ['e', 'E', '+', '-', '.'];
          if (block.includes(e.key)) e.preventDefault();
        }}
        className={cn(
          "h-9 text-sm text-center placeholder:text-center",
          isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80"
        )}
        min="0"
      />

      <span className="text-muted-foreground text-center">x</span>

      {/* Weight: integers or .5 only */}
      <Input
        type="text"
        inputMode="decimal"
        maxLength={5}
        draggable={false}
        placeholder="Weight"
        aria-label={`Weight for set ${index + 1}`}
        value={weightDisplay}
        onChange={(e) => {
          const raw = e.target.value;

          // allow clearing
          if (raw === '') {
            setWeightDisplay('');
            onSetChange(index, 'weight', ''); // bubble empty string up
            onInteract();
            return;
          }

          // keep only digits + optional single dot
          const cleaned = raw.replace(/[^\d.]/g, '');
          const parts = cleaned.split('.');
          let intPart = parts[0] ?? '';
          let decPart = parts.length > 1 ? parts[1] : '';

          // limit to max 3 digits before decimal
          if (intPart.length > 3) intPart = intPart.slice(0, 3);

          // allow only `.5` as decimal (ignore any other decimals while typing)
          if (decPart.length > 0) {
            decPart = decPart[0] === '5' ? '5' : '';
          }

          // if user typed just ".", keep it only if there is an int part
          let nextDisplay = intPart;
          if (decPart) nextDisplay = `${intPart}.5`;
          else if (cleaned.endsWith('.') && intPart !== '' && parts.length === 2 && !parts[1]) {
            // transient "12." state is allowed
            nextDisplay = `${intPart}.`;
          }

          setWeightDisplay(nextDisplay);
          onSetChange(index, 'weight', nextDisplay);
          onInteract();
        }}
        onBlur={() => {
            // normalize transient "12." to "12" on blur
            if (weightDisplay && weightDisplay.endsWith('.')) {
              const trimmed = weightDisplay.slice(0, -1);
              setWeightDisplay(trimmed);
              onSetChange(index, 'weight', trimmed);
            }
        }}
        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
        onClickCapture={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // block scientific notation and signs; allow '.' for typing ".5"
          const block = ['e', 'E', '+', '-'];
          if (block.includes(e.key)) e.preventDefault();
        }}
        className={cn(
          "h-9 text-sm text-center placeholder:text-center",
          isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80"
        )}
      />

      <span className="text-muted-foreground">kg</span>

      <Button variant="ghost" size="icon" onClick={onRemoveSet}
        className="text-muted-foreground hover:text-destructive h-9 w-9">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

