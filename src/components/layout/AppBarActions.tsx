"use client";

import * as React from "react";
import { createPortal } from "react-dom";

interface AppBarActionsProps {
  children: React.ReactNode;
}

/**
 * Portals page-level actions into the app bar's `#appbar-actions` slot
 * (rendered by <AppHeader />). Returns null until the slot node exists,
 * so it is safe during SSR and the first client render.
 */
export function AppBarActions({ children }: AppBarActionsProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setHost(document.getElementById("appbar-actions"));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
