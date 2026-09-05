"use client";

import * as React from "react";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/LanguageContext";
import { capitalize } from "@/i18n";

export interface WeekStripProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  today: Date;
  /** yyyy-MM-dd keys */
  loggedDays: Set<string>;
  /** yyyy-MM-dd keys */
  deloadDays: Set<string>;
  onOpenMonth: () => void;
  onVisibleMonthChange?: (month: Date) => void;
  className?: string;
}

const SWIPE_THRESHOLD = 40;

/**
 * The Training Log's date header: a big headline for the selected day plus a
 * swipeable Mon–Sun week row. Pure UI — it fetches nothing; the caller owns
 * the selection and supplies the marker sets.
 */
export function WeekStrip({
  selectedDate,
  onSelect,
  today,
  loggedDays,
  deloadDays,
  onOpenMonth,
  onVisibleMonthChange,
  className,
}: WeekStripProps) {
  const { t, language, locale } = useI18n();
  // The week currently shown. Follows `selectedDate`, but paging moves it alone.
  const [anchor, setAnchor] = React.useState<Date>(selectedDate);

  React.useEffect(() => {
    setAnchor(selectedDate);
  }, [selectedDate]);

  const weekStart = React.useMemo(
    () => startOfWeek(anchor, { weekStartsOn: 1 }),
    [anchor]
  );

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Paging into a week that lies entirely in the future is not allowed.
  const canGoForward = weekStart < startOfWeek(today, { weekStartsOn: 1 });

  const page = React.useCallback(
    (deltaDays: number) => {
      const next = addDays(anchor, deltaDays);
      // Never page into a week that lies entirely in the future.
      if (
        deltaDays > 0 &&
        startOfWeek(next, { weekStartsOn: 1 }) >
          startOfWeek(today, { weekStartsOn: 1 })
      ) {
        return;
      }
      setAnchor(next);
      if (!isSameMonth(next, anchor)) {
        onVisibleMonthChange?.(startOfMonth(next));
      }
    },
    [anchor, today, onVisibleMonthChange]
  );

  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (startX === null || startY === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const endY = e.changedTouches[0]?.clientY ?? startY;
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    page(dx < 0 ? 7 : -7);
  };

  const isToday = isSameDay(selectedDate, today);

  return (
    <div className={cn("select-none", className)}>
      {/* Row 1 — headline + month picker */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {isToday ? t('common.today') : format(selectedDate, "EEEE", { locale })}
          </p>
          <p className="mt-1 font-headline text-[34px] font-bold leading-none tracking-tight">
            {capitalize(format(selectedDate, t('date.dayMonth'), { locale }))}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => page(-7)}
            aria-label={t('week.prev')}
            className="pressable inline-flex h-11 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => page(7)}
            disabled={!canGoForward}
            aria-label={t('week.next')}
            className="pressable inline-flex h-11 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onOpenMonth}
            aria-label={t('week.pickDay')}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <CalendarDays className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Row 2 — the week */}
      <div
        className="mt-3 grid grid-cols-7 gap-1.5"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const isSelected = isSameDay(day, selectedDate);
          const isTodayCell = isSameDay(day, today);
          const isFuture = day > today && !isTodayCell;
          const isDeload = deloadDays.has(key);
          const isLogged = loggedDays.has(key);

          return (
            <button
              key={key}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(day)}
              aria-label={day.toLocaleDateString(language, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "pressable relative flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-md border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isSelected
                  ? "animate-pop border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent",
                !isSelected && isTodayCell && "ring-1 ring-primary/60",
                isFuture && "pointer-events-none opacity-30"
              )}
            >
              <span
                className={cn(
                  "text-[11px] uppercase leading-none",
                  isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                )}
              >
                {format(day, "EEEEE", { locale })}
              </span>
              <span className="font-headline text-[20px] font-semibold leading-none tabular-nums">
                {format(day, "d")}
              </span>
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  !isLogged && !isDeload
                    ? "bg-transparent"
                    : isSelected
                      ? "bg-primary-foreground"
                      : isDeload
                        ? "bg-warning"
                        : "bg-primary"
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
