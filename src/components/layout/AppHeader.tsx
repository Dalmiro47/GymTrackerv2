"use client";

import { Logo } from "@/components/Logo";
import { UserNav } from "./UserNav";

interface AppHeaderProps {
  /** Kept for API compatibility — the mobile drawer was replaced by <BottomNav />. */
  onMenuClick?: () => void;
  isSidebarOpen?: boolean;
}

export function AppHeader({}: AppHeaderProps) {
  return (
    <header
      className="glass fixed top-0 right-0 z-40 border-b border-border
                 left-0 md:left-[var(--sidebar-width)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-[var(--appbar-height)] flex items-center justify-between gap-2 px-4 md:px-6">
        {/* Mobile keeps the wordmark (no hamburger); desktop leaves it to the sidebar. */}
        <div className="flex min-w-0 items-center md:hidden">
          <Logo iconSize={20} textSize="text-[15px]" />
        </div>
        <div className="hidden md:block" />

        <div className="flex shrink-0 items-center gap-2">
          {/* Portal target for page-level app-bar actions (see <AppBarActions />). */}
          <div id="appbar-actions" className="flex items-center gap-2" />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
