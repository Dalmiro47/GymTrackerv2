"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SET_STRUCTURE_OPTIONS, type SetStructure } from "@/types/setStructure";
import { useI18n } from "@/contexts/LanguageContext";
import { setStructureLabel } from "@/i18n";

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
  const { t, language } = useI18n();
  return (
    <select
      aria-label={t('ss.aria')}
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
          {setStructureLabel(opt, language)}
        </option>
      ))}
    </select>
  );
}
