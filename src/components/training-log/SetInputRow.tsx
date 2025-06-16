
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
  onInteract: () => void; // New prop
}

export function SetInputRow({ set, index, onSetChange, onRemoveSet, isProvisional, onInteract }: SetInputRowProps) {
  
  const handleInputChange = (field: keyof Omit<LoggedSet, 'id' | 'isProvisional'>, value: string) => {
    onSetChange(index, field, value);
    onInteract(); // Call onInteract when input changes
  };

  const handleInputFocus = () => {
    onInteract(); // Call onInteract on focus as well
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-sm text-muted-foreground w-8 text-center">{index + 1}.</span>
      <Input
        type="number"
        placeholder="Reps"
        value={set.reps === null ? '' : String(set.reps)}
        onChange={(e) => handleInputChange('reps', e.target.value)}
        onFocus={handleInputFocus}
        className={cn(
            "h-9 text-sm",
            isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80"
        )}
        min="0"
      />
      <span className="text-muted-foreground">x</span>
      <Input
        type="number"
        placeholder="Weight"
        value={set.weight === null ? '' : String(set.weight)}
        onChange={(e) => handleInputChange('weight', e.target.value)}
        onFocus={handleInputFocus}
        className={cn(
            "h-9 text-sm",
            isProvisional && "bg-muted/40 dark:bg-muted/20 placeholder:text-muted-foreground/70 opacity-80"
        )}
        min="0"
        step="0.25"
      />
      <span className="text-muted-foreground">kg</span>
      <Button variant="ghost" size="icon" onClick={onRemoveSet} className="text-muted-foreground hover:text-destructive h-9 w-9">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
