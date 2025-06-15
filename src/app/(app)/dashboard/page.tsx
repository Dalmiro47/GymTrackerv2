
"use client";

import { PageHeader } from "@/components/PageHeader";
import { WorkoutCalendarSection } from "@/components/dashboard/WorkoutCalendarSection";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Dashboard" 
        description="Your central hub for tracking fitness activities." 
      />
      <WorkoutCalendarSection />
    </div>
  );
}
