"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { useI18n } from "@/contexts/LanguageContext";

export interface WorkoutCalendarProps {
  selectedDate: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  month: Date;
  onMonthChange: (date: Date) => void;
  loggedDays: Date[];
  deloadDays: Date[];
  today: Date;
  className?: string;
}

/**
 * Shared month calendar with logged/deload markers. Pure UI: it fetches
 * nothing and owns no data state — the caller supplies month, selection and
 * the marked days.
 */
export function WorkoutCalendar({
  selectedDate,
  onSelect,
  month,
  onMonthChange,
  loggedDays,
  deloadDays,
  today,
  className,
}: WorkoutCalendarProps) {
  const { t, language, locale } = useI18n();
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={onSelect}
        month={month}
        onMonthChange={onMonthChange}
        locale={locale}
        weekStartsOn={1}
        toDate={today}
        disabled={{ after: today }}
        modifiers={{ logged: loggedDays, deload: deloadDays }}
        modifiersClassNames={{ logged: "cal-logged", deload: "cal-deload" }}
        className="p-0"
        components={{
          DayContent: (props) => {
            const { date, activeModifiers } = props;
            const isDeload = !!activeModifiers?.deload;
            const isLogged = !!activeModifiers?.logged;
            const isSelected = !!activeModifiers?.selected;
            const isOutside = !!activeModifiers?.outside;

            const label = [
              date.toLocaleDateString(language, {
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
              isDeload ? t('calendar.deloadDay') : isLogged ? t('calendar.workoutLogged') : "",
            ]
              .filter(Boolean)
              .join("");

            return (
              <span
                title={label}
                aria-label={label}
                className="relative flex h-full w-full items-center justify-center self-stretch pb-1"
              >
                {date.getDate()}
                {(isLogged || isDeload) && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                      isSelected
                        ? "bg-primary-foreground"
                        : isOutside
                          ? "bg-muted-foreground"
                          : isDeload
                            ? "bg-warning"
                            : "bg-primary"
                    )}
                  />
                )}
              </span>
            );
          },
        }}
      />

      <div className="mt-3 flex items-center justify-center gap-4 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          {t('calendar.logged')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
          {t('calendar.deload')}
        </span>
      </div>
    </div>
  );
}
