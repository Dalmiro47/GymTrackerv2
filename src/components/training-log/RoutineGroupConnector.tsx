"use client";

import React from 'react';
import type { SetStructure } from '@/types/setStructure';
import { SET_STRUCTURE_COLORS, SET_STRUCTURE_LABEL } from '@/types/setStructure';
import { Link } from 'lucide-react';

interface RoutineGroupConnectorProps {
  structure: SetStructure;
}

export function RoutineGroupConnector({ structure }: RoutineGroupConnectorProps) {
  const theme = SET_STRUCTURE_COLORS[structure] ?? SET_STRUCTURE_COLORS.normal;
  
  return (
    <div className="relative flex items-center justify-center py-2 -my-3 z-10">
      {/* The Vertical Line - Thicker and more opaque */}
      <div 
        className="absolute inset-y-0 w-1 rounded-full"
        style={{ backgroundColor: theme.border, opacity: 0.6 }}
      />

      {/* The Badge */}
      <div
        className="relative flex h-6 items-center gap-1.5 rounded-full border bg-popover px-3"
        style={{ borderColor: theme.border }}
      >
        <Link
            className="h-3 w-3"
            style={{ color: theme.text }}
        />
        <span
            className="text-[10px] font-bold uppercase leading-none tracking-widest"
            style={{ color: theme.text }}
        >
            {SET_STRUCTURE_LABEL[structure]} Link
        </span>
      </div>
    </div>
  );
}
