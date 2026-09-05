"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navItems } from '@/config/site';
import { Logo } from '../Logo';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { confirmDiscardUnsavedChanges } from '@/lib/unsavedChanges';
import { useI18n } from '@/contexts/LanguageContext';

interface AppSidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/**
 * Desktop (md+) primary navigation. Mobile navigation lives in <BottomNav />;
 * the overlay/drawer props are kept so the API is unchanged.
 */
export function AppSidebar({ isOpen, setIsOpen }: AppSidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        id="primary-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full transform flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          "transition-transform duration-300 ease-in-out will-change-transform backface-hidden",
          "md:static md:z-auto md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: 'var(--sidebar-width)' }}
      >
        <div className="sticky top-0 z-10 border-b border-sidebar-border bg-sidebar">
          <div className="flex h-[var(--appbar-height)] items-center justify-between px-4">
            <div
              onClickCapture={(e) => {
                if (pathname !== '/dashboard' && !confirmDiscardUnsavedChanges()) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                setIsOpen(false);
              }}
            >
              <Logo iconSize={20} textSize="text-[17px]" />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => setIsOpen(false)}
              aria-label={t('sidebar.close')}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  if (pathname !== item.href && !confirmDiscardUnsavedChanges()) {
                    e.preventDefault();
                    return;
                  }
                  setIsOpen(false);
                }}
                className={cn(
                  "pressable flex min-h-[44px] items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-sidebar-primary")} />
                <span className="truncate">{t(item.title)}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
