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
      {/* fist/forearm */}
      <path d="M13 8c1.2-.6 2.4-1 3.5-1 .8 0 1.5.2 2 .5" />
      <path d="M18.5 7.5c.4.7.5 1.6.2 2.5-.4 1.2-1.6 2-2.9 2H14" />

      {/* bicep/upper arm curve */}
      <path d="M14 12c-1.8 0-3.3-.6-4.5-2l-1.2-1.4" />

      {/* shoulder/torso anchor */}
      <path d="M6.5 7.5C5 8.6 4 10.3 4 12c0 3.3 2.7 6 6 6h5c2.2 0 4-1.8 4-4v-1" />

      {/* elbow/belly of the bicep */}
      <path d="M9.5 10.5c.8 1 1.8 1.5 3 1.5" />
    </svg>
  );
}
