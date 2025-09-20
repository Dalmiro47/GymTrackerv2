"use client";

import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserNav } from './UserNav';
import { Logo } from '../Logo';

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="h-16 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="md:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-6 w-6" />
          </Button>
          <div className="hidden md:block">
            <Logo iconSize={20} textSize="text-xl" />
          </div>
        </div>
        <UserNav />
      </div>
    </header>
  );
}
