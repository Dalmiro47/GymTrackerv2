"use client";

import React from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { BottomNav } from "@/components/layout/BottomNav";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { Loader2 } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useRequireAuth();

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh]" style={{ ['--sidebar-width' as any]: '16rem' }}>
      <AppHeader />

      <div className="flex">
        {/* Desktop sidebar — mobile navigation is <BottomNav /> */}
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

        {/* Content column */}
        <div className="flex-1 w-full min-w-0">
          {/* Spacer only for the content area */}
          <div
            aria-hidden
            className="pointer-events-none"
            style={{ height: "var(--appbar-offset)" }}
          />
          <main className="p-4 pb-[calc(var(--bottomnav-height)+env(safe-area-inset-bottom)+1.5rem)] md:p-6 md:pb-8 lg:p-8 lg:pb-8">
            {children}
          </main>
        </div>
      </div>

      <BottomNav />

      {/* Sticky on every protected page; bottom-LEFT so it clears the coach FAB. */}
      <FeedbackButton />

      {/* First-run setup — renders nothing once the user has been onboarded. */}
      <OnboardingGate />
    </div>
  );
}
