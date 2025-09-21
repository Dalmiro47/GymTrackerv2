
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as ShadCNCalendar } from "@/components/ui/calendar"; // ShadCN Calendar
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getWorkoutLog, getMonthLogFlags } from '@/services/trainingLogService';
import type { WorkoutLog, LoggedSet } from '@/types';
import { format, parseISO, startOfMonth, getMonth, getYear, isValid } from 'date-fns';
import { Loader2, CalendarIcon, ListChecks, ExternalLink, PlusCircle } from 'lucide-react';
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
  const today = new Date();

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

  return (
    <Card className="shadow-xl overflow-hidden">
      <CardHeader>
        <CardTitle className="font-headline text-2xl flex items-center">
          <CalendarIcon className="mr-2 h-6 w-6 text-primary" />
          Workout Calendar
        </CardTitle>
        <CardDescription>Visualize your training consistency and review past workouts.</CardDescription>
      </CardHeader>
      <CardContent className="grid md:grid-cols-2 gap-6 p-4 md:p-6">
        {/* Left Column: Calendar */}
        <div className="space-y-4">
          <Card className="shadow-md h-full flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-headline">Your Training Schedule</CardTitle>
              <CardDescription>Days with logged workouts are underlined. Click a day to see details.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center flex-grow">
              {isLoadingLoggedDays ? (
                <div className="flex-grow flex justify-center items-center h-[200px]">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ShadCNCalendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  month={displayedMonth}
                  onMonthChange={(m) => setDisplayedMonth(startOfMonth(m))}
                  modifiers={{ logged: daysWithLogs, deload: daysWithDeload }}
                  modifiersClassNames={{ logged: 'day-is-logged', deload: 'day-is-deload' }}
                  className="rounded-md border bg-card shadow"
                  weekStartsOn={1}
                  toDate={today}
                  disabled={{ after: today }}
                />
              )}
              <p className="text-sm text-muted-foreground mt-3 text-center px-2">
                {monthlySummaryMessage}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Workout Details */}
        <div className="space-y-4">
          <Card className="shadow-md h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg font-headline">Workout Details</CardTitle>
              <CardDescription>
                {selectedDate ? `Details for ${format(selectedDate, 'MMMM do, yyyy')}` : "Select a day to see details."}
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
                <div className="flex-grow flex flex-col justify-center items-center text-center py-10">
                  <CalendarIcon className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
                  <p className="text-md text-muted-foreground font-semibold">No workout logged for this day.</p>
                  <p className="text-sm text-muted-foreground">Select another day or log a workout!</p>
                   <Link href={`/log?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                        <Button variant="default" size="sm" className="mt-4 bg-accent hover:bg-accent/90">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Log Workout for this Day
                        </Button>
                    </Link>
                </div>
              ) : (
                 <div className="flex-grow flex flex-col justify-center items-center text-center py-10">
                    <CalendarIcon className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
                    <p className="text-md text-muted-foreground font-semibold">Please select a day on the calendar.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

    
    