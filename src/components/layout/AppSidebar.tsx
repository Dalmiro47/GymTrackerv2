"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navItems } from '@/config/site';
import { Logo } from '../Logo';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface AppSidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export function AppSidebar({ isOpen, setIsOpen }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        id="primary-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full transform flex-col border-r bg-sidebar text-sidebar-foreground shadow-lg",
          "transition-transform duration-300 ease-in-out will-change-transform backface-hidden",
          "md:static md:z-auto md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: 'var(--sidebar-width)' }}
      >
        <div className="sticky top-0 z-10 bg-sidebar border-b border-sidebar-border">
          <div className="h-12 flex items-center px-4 justify-between">
            <Logo iconSize={18} textSize="text-lg" />
            <Button variant="ghost" size="icon" className="md:hidden text-sidebar-foreground" onClick={() => setIsOpen(false)} aria-label="Close sidebar">
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>
        <nav className="flex-1 space-y-2 p-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                pathname === item.href
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground"
              )}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.title}</span>
            </Link>
          ))}
        </nav>
        {/* Optional Footer can go here */}
      </aside>
    </>
  );
}
