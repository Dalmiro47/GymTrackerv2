"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { navItems } from "@/config/site";
import { confirmDiscardUnsavedChanges } from "@/lib/unsavedChanges";

/**
 * Mobile-only tab bar (thumb zone). Desktop keeps <AppSidebar />.
 * Links guard navigation with confirmDiscardUnsavedChanges() exactly like the sidebar.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex h-[var(--bottomnav-height)] items-stretch">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                onClick={(e) => {
                  if (pathname !== item.href && !confirmDiscardUnsavedChanges()) {
                    e.preventDefault();
                  }
                }}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.title}
                className={cn(
                  "pressable relative flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon size={22} className="shrink-0" />
                <span className="max-w-full truncate whitespace-nowrap px-0.5 text-[11px] font-medium leading-none">
                  {item.title}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1 h-1 w-1 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-transparent"
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
