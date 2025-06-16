
"use client";

import { PageHeader } from "@/components/PageHeader";
import { WorkoutCalendarSection } from "@/components/dashboard/WorkoutCalendarSection";
import { VolumeChart } from "@/components/analytics/VolumeChart"; 
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Dashboard" 
        description="Your central hub for tracking fitness activities." 
      />
      <WorkoutCalendarSection />
      
      <section className="mt-8">
        {/* The VolumeChart component is already wrapped in a Card, so no need for an extra one here unless for section styling */}
        <VolumeChart containerClassName="shadow-xl"/>
      </section>
    </div>
  );
}
