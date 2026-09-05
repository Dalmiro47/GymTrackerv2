"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * One picker surface for every breakpoint: a floating panel centred in the viewport,
 * the way the AI Coach window sits. It deliberately does NOT slide in from an edge —
 * an edge sheet reads as unrelated to a control at the other end of the screen, and
 * the slide was the part that felt sluggish on device.
 *
 * Name kept for its call sites; "responsive" now means the width/height adapt, not
 * the presentation.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: ResponsiveSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("w-[min(95vw,440px)] p-5 md:p-6", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
