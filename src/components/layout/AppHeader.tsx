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
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-card px-4 md:px-6 shadow-sm">
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
          <Logo iconSize={20} textSize="text-xl"/>
        </div>
      </div>
      <UserNav />
    </header>
  );
}
