"use client";

// This component is currently not directly used as AppSidebar handles mobile toggling.
// It's kept as a potential structure if a different mobile navigation approach is needed.

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { siteConfig, navItems } from "@/config/site";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "../Logo";

export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="mr-2 px-0 text-base hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:hidden"
          aria-label="Toggle Menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="pr-0 bg-sidebar text-sidebar-foreground">
        <Link
          href="/dashboard"
          className="flex items-center"
          onClick={() => setOpen(false)}
        >
          <Logo className="mr-2" />
        </Link>
        <div className="my-4 h-[calc(100vh-8rem)] pb-10 pl-6">
          <div className="flex flex-col space-y-3">
            {navItems.map(
              (item) =>
                item.href && (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "text-lg font-medium transition-colors hover:text-sidebar-accent",
                      // pathname === item.href ? "text-foreground" : "text-foreground/60" // Add pathname logic if needed
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {item.title}
                  </Link>
                )
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
