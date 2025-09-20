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
    <div className="bg-background min-h-[100dvh]">
      {/* Fixed header */}
      <AppHeader onMenuClick={() => setSidebarOpen((v) => !v)} />

      {/* Spacer = header visual height + safe area */}
      <div
        aria-hidden
        className="pointer-events-none"
        style={{ height: "calc(48px + env(safe-area-inset-top))" }}
      />

      <div className="flex">
        {/* Desktop sidebar (if you show it) */}
        <div
          className="hidden md:block sticky"
          style={{
            top: "calc(48px + env(safe-area-inset-top))",
            height: "calc(100dvh - (48px + env(safe-area-inset-top)))",
            width: "240px",
          }}
        >
          <AppSidebar isOpen={true} setIsOpen={() => {}} />
        </div>


        {/* Mobile sidebar (toggled via header menu) */}
        <div className="md:hidden">
          <AppSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        </div>

        {/* MAIN CONTENT — IMPORTANT: no overflow-y-auto here */}
        <main className="flex-1 w-full p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
