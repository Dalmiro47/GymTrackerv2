
"use client";

import { PageHeader } from "@/components/PageHeader";
import { WorkoutCalendarSection } from "@/components/dashboard/WorkoutCalendarSection";
// VolumeChart import removed
// Card imports removed as they were only used for the VolumeChart section here

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Dashboard" 
        description="Your central hub for tracking fitness activities." 
      />
      <WorkoutCalendarSection />
      
      {/* Section for VolumeChart removed
      <section className="mt-8">
        <VolumeChart containerClassName="shadow-xl"/>
      </section>
      */}
    </div>
  );
}
