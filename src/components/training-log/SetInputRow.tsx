
"use client";

import React, { useState, useEffect } from 'react';
import type { LoggedSet } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatWeightHalf, snapToHalf } from '@/lib/rounding';


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

      {/* Weight: integers or .5 only (accepts '.' or ',' as decimal; normalizes to '.') */}
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
            onSetChange(index, 'weight', '');
            onInteract();
            return;
          }

          // Keep only digits + at most one decimal separator (either '.' or ',')
          // Then normalize first comma to dot for internal handling.
          let cleaned = raw.replace(/[^\d.,]/g, '');
          // If there are multiple separators, keep the first, drop the rest
          const firstSepIndex = Math.max(cleaned.indexOf('.'), cleaned.indexOf(','));
          if (firstSepIndex !== -1) {
            // remove any additional separators after the first
            const head = cleaned.slice(0, firstSepIndex + 1);
            const tail = cleaned.slice(firstSepIndex + 1).replace(/[.,]/g, '');
            cleaned = head + tail;
          }
          // Normalize comma → dot for parsing and display normalization
          cleaned = cleaned.replace(',', '.');

          const parts = cleaned.split('.');
          let intPart = parts[0] ?? '';
          let decPart = parts.length > 1 ? parts[1] : '';

          // limit to max 3 digits before decimal
          if (intPart.length > 3) intPart = intPart.slice(0, 3);

          // if there is a decimal and it isn't ".5", SNAP to nearest .5 immediately
          if (decPart.length > 0 && decPart[0] !== '5') {
            const n = Number(`${intPart || '0'}.${decPart}`);
            // guard against NaN if user typed just "."
            const snapped = isNaN(n) ? null : snapToHalf(n);
            const nextDisplay = snapped == null ? '' : formatWeightHalf(snapped);

            setWeightDisplay(nextDisplay);
            onSetChange(index, 'weight', nextDisplay);
            onInteract();
            return;
          }

          // allow only ".5" as decimal while typing
          if (decPart.length > 0) {
            decPart = '5';
          }

          // support transient "12." state
          let nextDisplay = intPart;
          if (decPart) nextDisplay = `${intPart}.5`;
          else if (cleaned.endsWith('.') && intPart !== '' && parts.length === 2 && !parts[1]) {
            nextDisplay = `${intPart}.`;
          }

          setWeightDisplay(nextDisplay);
          onSetChange(index, 'weight', nextDisplay);
          onInteract();
        }}
        onBlur={() => {
          // normalize transient "12." or "12," to "12" on blur
          if (weightDisplay && (weightDisplay.endsWith('.') || weightDisplay.endsWith(','))) {
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
          // block scientific notation and signs; allow '.' and ',' for decimals
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
