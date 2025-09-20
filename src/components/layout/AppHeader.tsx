"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserNav } from "./UserNav";

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* h-12 = 48px top bar */}
      <div className="h-12 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="md:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        <UserNav />
      </div>
    </header>
  );
}
