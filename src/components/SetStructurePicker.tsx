
"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SET_STRUCTURE_OPTIONS, SET_STRUCTURE_LABEL, type SetStructure } from '@/types/setStructure';
import { cn } from '@/lib/utils';

interface SetStructurePickerProps {
  value: SetStructure;
  onChange: (value: SetStructure) => void;
  disabled?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SetStructurePicker({ value, onChange, disabled, className, open, onOpenChange }: SetStructurePickerProps) {
  return (
    <Select
      value={value ?? 'normal'}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      onValueChange={(v: SetStructure) => {
        onChange(v);
        onOpenChange?.(false); // Close deterministically
      }}
    >
      <SelectTrigger className={cn("h-8 text-xs px-2 py-1 w-full sm:w-[150px]", className)} aria-label="Set structure">
        <SelectValue placeholder="Set Structure" />
      </SelectTrigger>
      <SelectContent>
        {SET_STRUCTURE_OPTIONS.map(option => (
          <SelectItem key={option} value={option}>
            {SET_STRUCTURE_LABEL[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
