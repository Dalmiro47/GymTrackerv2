"use client";

import React from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { Loader2 } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useRequireAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-[100dvh]" style={{ ['--sidebar-width' as any]: '16rem' }}>
      <AppHeader onMenuClick={() => setSidebarOpen((v) => !v)} />

      <div className="flex">
        {/* Desktop sidebar */}
        <div
          className="hidden md:block sticky"
          style={{
            top: 0,
            height: "100dvh",
            width: "var(--sidebar-width)",
          }}
        >
          <AppSidebar isOpen={true} setIsOpen={() => {}} />
        </div>

        {/* Mobile sidebar (overlay) */}
        <div className="md:hidden">
          <AppSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        </div>

        {/* Content column */}
        <div className="flex-1 w-full">
          {/* Spacer only for the content area */}
          <div
            aria-hidden
            className="pointer-events-none"
            style={{ height: "calc(48px + env(safe-area-inset-top))" }}
          />
          <main className="p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
