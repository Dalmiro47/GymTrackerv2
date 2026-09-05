
"use client";

import { PageHeader } from "@/components/PageHeader";
import { WorkoutCalendarSection } from "@/components/dashboard/WorkoutCalendarSection";
import { ProgressionSection } from "@/components/dashboard/ProgressionSection";
import { useI18n } from "@/contexts/LanguageContext";

export default function DashboardPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
      />
      <WorkoutCalendarSection />
      <ProgressionSection />
    </div>
  );
}
