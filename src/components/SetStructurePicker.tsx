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
        // keep styles close to shadcn trigger
        "h-10 w-44 sm:w-56 rounded-md border bg-background px-3 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring/50",
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
