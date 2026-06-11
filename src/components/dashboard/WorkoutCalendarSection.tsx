
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as ShadCNCalendar } from "@/components/ui/calendar"; // ShadCN Calendar
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getWorkoutLog, getMonthLogFlags } from '@/services/trainingLogService';
import type { WorkoutLog, LoggedSet } from '@/types';
import { format, parseISO, startOfMonth, getMonth, getYear, isValid, startOfWeek, isWithinInterval } from 'date-fns';
import { Loader2, CalendarIcon, ListChecks, ExternalLink, PlusCircle, Flame, CalendarCheck2, BatteryLow } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';

function getMonthlySummaryMessage(
  logCount: number,
  displayedMonth: Date,
  today: Date
): string {
  const sameMonth =
    displayedMonth.getFullYear() === today.getFullYear() &&
    displayedMonth.getMonth() === today.getMonth();

  // Current month → keep the existing motivating copy
  if (sameMonth) {
    if (logCount === 0) {
      return "No workouts yet this month—your future self is waiting. Let’s get moving! 💪";
    }
    if (logCount <= 5) {
      return `Great start! You’ve logged ${logCount} session${logCount > 1 ? "s" : ""} this month. Keep the momentum going!`;
    }
    return `Wow—${logCount} sessions already! You’re turning gains into a habit. Keep crushing it! 🚀`;
  }

  // Past (or non-current) month → use past-tense summary
  const monthLabel = format(displayedMonth, "MMMM yyyy");
  if (logCount === 0) {
    return `No workouts logged in ${monthLabel}.`;
  }
  if (logCount <= 5) {
    return `You logged ${logCount} session${logCount > 1 ? "s" : ""} in ${monthLabel}. Solid effort.`;
  }
  return `You logged ${logCount} sessions in ${monthLabel}—nice consistency!`;
}

export function WorkoutCalendarSection() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [displayedMonth, setDisplayedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedLog, setSelectedLog] = useState<WorkoutLog | null>(null);
  const [isLoadingLogDetails, setIsLoadingLogDetails] = useState(false);
  const [loggedDayStrings, setLoggedDayStrings] = useState<string[]>([]);
  const [deloadDayStrings, setDeloadDayStrings] = useState<string[]>([]);
  const [isLoadingLoggedDays, setIsLoadingLoggedDays] = useState(true);
  // Stable per-mount "today" so it doesn't invalidate memos/props every render
  const today = useMemo(() => new Date(), []);

  // Fetch the month’s underlines whenever month/user changes
  const fetchMonthDates = useCallback(async () => {
    if (!user?.id) {
      setLoggedDayStrings([]);
      setDeloadDayStrings([]);
      setIsLoadingLoggedDays(false);
      return;
    }
    setIsLoadingLoggedDays(true);
    try {
      const { logged, deload } = await getMonthLogFlags(user.id, displayedMonth);
      setLoggedDayStrings(logged);
      setDeloadDayStrings(deload);
    } catch (err) {
      console.error('Failed to load month dates:', err);
      setLoggedDayStrings([]);
      setDeloadDayStrings([]);
    } finally {
      setIsLoadingLoggedDays(false);
    }
  }, [user?.id, displayedMonth]);

  // Initial + on month change
  useEffect(() => {
    fetchMonthDates();
  }, [fetchMonthDates]);

  // Fetch details for the selected day (run when selectedDate changes)
  useEffect(() => {
    const load = async () => {
      if (!selectedDate || !user?.id) {
        setSelectedLog(null);
        return;
      }
      setIsLoadingLogDetails(true);
      try {
        const dateId = format(selectedDate, 'yyyy-MM-dd');
        const log = await getWorkoutLog(user.id, dateId);
        setSelectedLog(log);
      } catch (e) {
        console.error('Error fetching selected log:', e);
        setSelectedLog(null);
      } finally {
        setIsLoadingLogDetails(false);
      }
    };
    load();
  }, [selectedDate, user?.id]);

  const daysWithLogs = useMemo(() => loggedDayStrings.map(d => parseISO(d)).filter(d => !isNaN(d.getTime())), [loggedDayStrings]);
  const daysWithDeload = useMemo(() => deloadDayStrings.map(d => parseISO(d)).filter(d => !isNaN(d.getTime())), [deloadDayStrings]);

  const logsInCurrentDisplayedMonth = useMemo(() => {
    const all = [...loggedDayStrings, ...deloadDayStrings];
    return all.filter(dateStr => {
      const d = parseISO(dateStr);
      return !isNaN(d.getTime()) &&
        d.getFullYear() === displayedMonth.getFullYear() &&
        d.getMonth() === displayedMonth.getMonth();
    }).length;
  }, [loggedDayStrings, deloadDayStrings, displayedMonth]);

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date && (getMonth(date) !== getMonth(displayedMonth) || getYear(date) !== getYear(displayedMonth))) {
      setDisplayedMonth(startOfMonth(date)); // triggers month refetch
    }
  };
  
  const monthlySummaryMessage = useMemo(
    () => getMonthlySummaryMessage(logsInCurrentDisplayedMonth, displayedMonth, today),
    [logsInCurrentDisplayedMonth, displayedMonth, today]
  );

  // Compact stats derived from data already loaded for the displayed month
  const deloadsInDisplayedMonth = useMemo(() => {
    return deloadDayStrings.filter(dateStr => {
      const d = parseISO(dateStr);
      return !isNaN(d.getTime()) &&
        d.getFullYear() === displayedMonth.getFullYear() &&
        d.getMonth() === displayedMonth.getMonth();
    }).length;
  }, [deloadDayStrings, displayedMonth]);

  const sessionsThisWeek = useMemo(() => {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    return [...loggedDayStrings, ...deloadDayStrings].filter(dateStr => {
      const d = parseISO(dateStr);
      return !isNaN(d.getTime()) && isWithinInterval(d, { start: weekStart, end: today });
    }).length;
  }, [loggedDayStrings, deloadDayStrings, today]);

  return (
    <div className="space-y-4">
      {/* Monthly stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarCheck2 className="h-3.5 w-3.5" />
            <span className="truncate">Sessions</span>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums leading-none">
            {isLoadingLoggedDays ? '–' : logsInCurrentDisplayedMonth}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground truncate">{format(displayedMonth, 'MMMM')}</p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flame className="h-3.5 w-3.5" />
            <span className="truncate">This week</span>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums leading-none">
            {isLoadingLoggedDays ? '–' : sessionsThisWeek}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground truncate">since Monday</p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BatteryLow className="h-3.5 w-3.5" />
            <span className="truncate">Deloads</span>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums leading-none">
            {isLoadingLoggedDays ? '–' : deloadsInDisplayedMonth}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground truncate">{format(displayedMonth, 'MMMM')}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 md:items-stretch">
        {/* Left Column: Calendar */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-col items-center flex-grow p-4 sm:p-5">
              {isLoadingLoggedDays ? (
                <div className="flex-grow flex justify-center items-center h-[200px]">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  <ShadCNCalendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                    month={displayedMonth}
                    onMonthChange={(m) => setDisplayedMonth(startOfMonth(m))}
                    modifiers={{ logged: daysWithLogs, deload: daysWithDeload }}
                    modifiersClassNames={{ logged: 'day-is-logged', deload: 'day-is-deload' }}
                    components={{
                      DayContent: (props) => {
                        const { date, activeModifiers } = props;
                        const isDeload = !!activeModifiers?.deload;
                        const isLogged = !!activeModifiers?.logged;

                        const label = [
                          date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
                          isDeload ? '— Deload day' : (isLogged ? '— Workout logged' : '')
                        ].filter(Boolean).join(' ');

                        return (
                          <span title={label} aria-label={label} style={{ display: 'inline-block', width: '100%' }}>
                            {date.getDate()}
                          </span>
                        );
                      },
                    }}
                    className="p-0"
                    weekStartsOn={1}
                    toDate={today}
                    disabled={{ after: today }}
                  />
                  <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[3px] w-5 rounded bg-primary" />
                      Logged
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[3px] w-5 rounded bg-chart-4" />
                      Deload
                    </span>
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center px-2 border-t pt-3 w-full">
                {monthlySummaryMessage}
              </p>
            </CardContent>
        </Card>

        {/* Right Column: Workout Details */}
        <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="font-headline">Workout Details</CardTitle>
              <CardDescription>
                {selectedDate ? `${format(selectedDate, 'MMMM do, yyyy')}` : "Select a day to see details."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col">
              {isLoadingLogDetails ? (
                <div className="flex-grow flex justify-center items-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : selectedLog ? (
                <ScrollArea className="flex-grow pr-3">
                  <div className="space-y-4">
                    {selectedLog.routineName && (
                      <p className="text-sm">
                        <span className="font-semibold">Routine:</span> {selectedLog.routineName}
                      </p>
                    )}
                    {selectedLog.notes && selectedLog.notes.trim() !== '' && (
                       <p className="text-sm"><span className="font-semibold">Overall Notes:</span> {selectedLog.notes}</p>
                    )}
                    <div>
                      <h4 className="font-semibold text-md mb-2 flex items-center">
                        <ListChecks className="mr-2 h-4 w-4 text-primary" />
                        Logged Exercises:
                      </h4>
                      {selectedLog.exercises.length > 0 ? (
                        <ul className="space-y-3">
                          {selectedLog.exercises.map((exercise) => (
                            <li key={exercise.id} className="text-sm p-3 border rounded-md bg-muted/30">
                              <p className="font-semibold">{exercise.name}</p>
                              {exercise.exerciseSetup && <p className="text-xs text-muted-foreground">Setup: {exercise.exerciseSetup}</p>}
                              <ul className="list-disc list-inside pl-2 mt-1 space-y-0.5">
                                {exercise.sets.map((set, index) => (
                                  <li key={set.id} className="text-xs">
                                    Set {index + 1}: {set.reps ?? '-'} reps @ {set.weight ?? '-'} kg
                                  </li>
                                ))}
                              </ul>
                              {exercise.notes && <p className="text-xs mt-1">Exercise Notes: {exercise.notes}</p>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No exercises were recorded for this day.</p>
                      )}
                    </div>
                    {selectedDate && isValid(selectedDate) && (
                      <Link href={`/log?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                          <Button variant="outline" size="sm" className="mt-4 w-full">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              View/Edit Full Log for this Day
                          </Button>
                      </Link>
                    )}
                  </div>
                </ScrollArea>
              ) : selectedDate ? (
                <div className="flex-grow flex flex-col justify-center items-center text-center rounded-lg border border-dashed bg-muted/30 px-4 py-10 my-1">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                    <CalendarIcon className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-semibold">Rest day — nothing logged.</p>
                  <p className="text-sm text-muted-foreground mt-0.5">Pick another day, or start a session for this one.</p>
                   <Link href={`/log?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                        <Button size="sm" className="mt-4">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Log Workout for this Day
                        </Button>
                    </Link>
                </div>
              ) : (
                 <div className="flex-grow flex flex-col justify-center items-center text-center rounded-lg border border-dashed bg-muted/30 px-4 py-10 my-1">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                      <CalendarIcon className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-muted-foreground">Select a day on the calendar to see its workout.</p>
                </div>
              )}
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
