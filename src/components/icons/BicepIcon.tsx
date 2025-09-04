"use client";

import * as React from "react";

/**
 * Flexed bicep icon, lucide-style (stroke only, currentColor).
 * Size is controlled via className (e.g., h-3 w-3). 
 */
export function BicepIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 12.5a5 5 0 1 0 10 0" />
      <path d="M12.5 7.5V12L10 14" />
      <path d="M8 12.5h-1a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2" />
    </svg>
  );
}
