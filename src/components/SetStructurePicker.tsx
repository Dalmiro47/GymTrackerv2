
"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SET_STRUCTURE_OPTIONS, SET_STRUCTURE_LABEL, type SetStructure } from '@/types/setStructure';

interface SetStructurePickerProps {
  value: SetStructure;
  onChange: (value: SetStructure) => void;
  disabled?: boolean;
}

export function SetStructurePicker({ value, onChange, disabled }: SetStructurePickerProps) {
  return (
    <Select
      value={value ?? 'normal'}
      onValueChange={(v: SetStructure) => onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 text-xs px-2 py-1 w-full sm:w-[150px]">
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
