"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SET_STRUCTURE_OPTIONS, SET_STRUCTURE_LABEL, type SetStructure } from "@/types/setStructure";

interface SetStructurePickerProps {
  value: SetStructure;
  onChange: (value: SetStructure) => void;
  disabled?: boolean;
  className?: string;
}

export function SetStructurePicker({
  value,
  onChange,
  disabled,
  className,
}: SetStructurePickerProps) {
  return (
    <select
      aria-label="Set structure"
      className={cn(
        // chip-shaped, but still a native <select> (best mobile picker there is)
        "h-9 rounded-full border border-border bg-card px-3 text-[13px] font-medium",
        "transition-colors hover:bg-accent",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      value={value ?? "normal"}
      onChange={(e) => onChange(e.target.value as SetStructure)}
      disabled={disabled}
      // Ensure dnd-kit never hijacks this control
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClickCapture={(e) => e.stopPropagation()}
    >
      {SET_STRUCTURE_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {SET_STRUCTURE_LABEL[opt]}
        </option>
      ))}
    </select>
  );
}
