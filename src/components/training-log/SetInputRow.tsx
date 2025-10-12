
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
  weightDisplay: string;
  setWeightDisplay: (value: string) => void;
}

export function SetInputRow({ set, index, onSetChange, onRemoveSet, isProvisional, onInteract, weightDisplay, setWeightDisplay }: SetInputRowProps) {
  
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

          // Keep digits + at most one decimal separator ('.' or ','); keep the FIRST one
          let cleaned = raw.replace(/[^\d.,]/g, '');
          const dot = cleaned.indexOf('.');
          const comma = cleaned.indexOf(',');
          let firstSepIndex = -1;
          if (dot !== -1 && comma !== -1) firstSepIndex = Math.min(dot, comma);
          else firstSepIndex = Math.max(dot, comma); // whichever exists

          if (firstSepIndex !== -1) {
            const head = cleaned.slice(0, firstSepIndex + 1);
            const tail = cleaned.slice(firstSepIndex + 1).replace(/[.,]/g, '');
            cleaned = head + tail;
          }

          // Normalize comma to dot
          cleaned = cleaned.replace(',', '.');

          const parts = cleaned.split('.');
          let intPart = (parts[0] ?? '').slice(0, 3); // limit to 3 digits
          let decPart = parts.length > 1 ? parts[1] : '';

          // TRANSIENT: user just typed a dot after an int (e.g., "12.")
          // Show it locally but DO NOT push up yet (prevents parent from resetting to 12)
          if (cleaned.endsWith('.') && decPart === '' && intPart !== '') {
            setWeightDisplay(`${intPart}.`);
            return; // <-- critical: no onSetChange here
          }

          // If there's any decimal, snap to nearest 0.5 and COMMIT
          if (decPart.length > 0) {
            const n = Number(`${intPart || '0'}.${decPart}`);
            const snapped = isNaN(n) ? null : snapToHalf(n);
            const nextDisplay = snapped == null ? '' : formatWeightHalf(snapped);

            setWeightDisplay(nextDisplay);
            onSetChange(index, 'weight', nextDisplay);
            onInteract();
            return;
          }

          // Integer only → commit
          const nextDisplay = intPart;
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
