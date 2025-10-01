
"use client";

import { useRef } from "react";
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

export function SetStructurePicker({
  value,
  onChange,
  disabled,
  className,
  open,
  onOpenChange,
}: SetStructurePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const forceClose = () => {
    // close controlled state
    onOpenChange?.(false);
    // make Radix unmount content in all cases
    requestAnimationFrame(() => {
      triggerRef.current?.blur();
      const el = document.activeElement as HTMLElement | null;
      el?.blur?.();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  };

  return (
    <Select
      value={value ?? 'normal'}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      onValueChange={(v: SetStructure) => {
        onChange(v);
        forceClose(); // <-- close deterministically after pick
      }}
    >
      <SelectTrigger
        ref={triggerRef}
        className={cn("h-8 text-xs px-2 py-1 w-full sm:w-[150px]", className)}
        aria-label="Set structure"
        onPointerDownCapture={(e) => e.stopPropagation()}  // <-- block dnd-kit
      >
        <SelectValue placeholder="Set Structure" />
      </SelectTrigger>
      <SelectContent
        onPointerDownCapture={(e) => e.stopPropagation()}  // <-- block dnd-kit inside menu
      >
        {SET_STRUCTURE_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {SET_STRUCTURE_LABEL[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
