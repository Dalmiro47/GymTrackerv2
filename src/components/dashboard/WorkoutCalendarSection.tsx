
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkoutCalendar } from "@/components/dashboard/WorkoutCalendar";
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getWorkoutLog, getMonthLogFlags, getLogsSince } from '@/services/trainingLogService';
import { summarizeDeloads, countSessionsInWeek } from '@/lib/deload';
import { useToast } from '@/hooks/use-toast';
import { useToday } from '@/hooks/use-today';
import { friendlyErrorMessage } from '@/lib/errorMessages';
import type { WorkoutLog, LoggedSet } from '@/types';
import { format, parseISO, startOfMonth, getMonth, getYear, isValid, subMonths } from 'date-fns';
import { Loader2, CalendarIcon, ListChecks, ExternalLink, PlusCircle, Flame, CalendarCheck2, BatteryLow } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useI18n } from '@/contexts/LanguageContext';
import { capitalize } from '@/i18n';
import { displayExerciseFields } from '@/lib/exerciseDisplay';

type I18n = Pick<ReturnType<typeof useI18n>, 't' | 'tn' | 'locale'>;

function getMonthlySummaryMessage(
  logCount: number,
  displayedMonth: Date,
  today: Date,
  { t, tn, locale }: I18n,
): string {
  const sameMonth =
    displayedMonth.getFullYear() === today.getFullYear() &&
    displayedMonth.getMonth() === today.getMonth();

  // Current month → keep the existing motivating copy
  if (sameMonth) {
    if (logCount === 0) return t('dashboard.summary.currentNone');
    if (logCount <= 5) return tn('dashboard.summary.currentFew', logCount);
    return t('dashboard.summary.currentMany', { n: logCount });
  }

  // Past (or non-current) month → use past-tense summary
  const month = format(displayedMonth, t('date.monthYear'), { locale });
  if (logCount === 0) return t('dashboard.summary.pastNone', { month });
  if (logCount <= 5) return tn('dashboard.summary.pastFew', logCount, { month });
  return t('dashboard.summary.pastMany', { n: logCount, month });
}

/**
 * Compact one-line summary of a logged exercise's sets, e.g. "10 · 10 · 9 × 32 kg"
 * when every set shares a weight, otherwise "10 × 32 · 8 × 30 kg". Purely a
 * display transform of the same sets the detailed list already showed.
 */
function formatSetsLine(sets: LoggedSet[], t: I18n['t']): string {
  if (sets.length === 0) return t('dashboard.noSets');
  const weights = Array.from(new Set(sets.map(s => s.weight)));
  const reps = (s: LoggedSet) => (s.reps ?? '–');
  if (weights.length === 1) {
    const w = weights[0];
    const repsLine = sets.map(reps).join(' · ');
    return w === null ? repsLine : `${repsLine} × ${w} kg`;
  }
  return `${sets.map(s => `${reps(s)} × ${s.weight ?? '–'}`).join(' · ')} kg`;
}

/** Per-set detail, kept reachable on the compact row via title/aria. */
function describeSets(sets: LoggedSet[], t: I18n['t']): string {
  if (sets.length === 0) return t('dashboard.noSets');
  return sets
    .map((s, i) => t('dashboard.setDetail', { n: i + 1, reps: s.reps ?? '-', weight: s.weight ?? '-' }))
    .join('; ');
}

export function WorkoutCalendarSection() {
  const { user } = useAuth();
  const { t, tn, locale, language } = useI18n();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [displayedMonth, setDisplayedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedLog, setSelectedLog] = useState<WorkoutLog | null>(null);
  const [isLoadingLogDetails, setIsLoadingLogDetails] = useState(false);
  const [loggedDayStrings, setLoggedDayStrings] = useState<string[]>([]);
  const [deloadDayStrings, setDeloadDayStrings] = useState<string[]>([]);
  const [isLoadingLoggedDays, setIsLoadingLoggedDays] = useState(true);
  // Rolling last-3-months deload count (null while loading) — a standing
  // recovery indicator, independent of the month being browsed.
  const [deloadCount3mo, setDeloadCount3mo] = useState<number | null>(null);
  // Sessions logged since Monday, computed from the 3-month window (not the
  // browsed month) so browsing another month or a week spanning two months
  // doesn't skew it. null while loading.
  const [sessionsThisWeek, setSessionsThisWeek] = useState<number | null>(null);
  const { toast } = useToast();
  // Stable "today" that only changes identity when the local day rolls over
  const today = useToday();

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
      toast({ title: t('common.loadErrorTitle'), description: friendlyErrorMessage(err, t('dashboard.loadCalendarError')), variant: 'destructive' });
    } finally {
      setIsLoadingLoggedDays(false);
    }
    // `t` is intentionally excluded: a language switch must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, displayedMonth, toast]);

  // Initial + on month change
  useEffect(() => {
    fetchMonthDates();
  }, [fetchMonthDates]);

  // Rolling last-3-months window (independent of the displayed month):
  // deload count = explicit deload days + full weeks with no entries.
  useEffect(() => {
    if (!user?.id) {
      setDeloadCount3mo(null);
      setSessionsThisWeek(null);
      return;
    }
    let cancelled = false;
    setDeloadCount3mo(null);
    setSessionsThisWeek(null);
    const start = subMonths(today, 3);
    getLogsSince(user.id, start)
      .then(logs => {
        if (cancelled) return;
        setDeloadCount3mo(summarizeDeloads(logs, start, today).total);
        setSessionsThisWeek(countSessionsInWeek(logs, today));
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load 3-month window:', err);
        toast({ title: t('common.loadErrorTitle'), description: friendlyErrorMessage(err, t('dashboard.loadStatsError')), variant: 'destructive' });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, today, toast]);

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
        toast({ title: t('common.loadErrorTitle'), description: friendlyErrorMessage(e, t('dashboard.loadDayError')), variant: 'destructive' });
      } finally {
        setIsLoadingLogDetails(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, user?.id, toast]);

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
    () => getMonthlySummaryMessage(logsInCurrentDisplayedMonth, displayedMonth, today, { t, tn, locale }),
    [logsInCurrentDisplayedMonth, displayedMonth, today, t, tn, locale]
  );

  const noRecentDeload = deloadCount3mo === 0;


  return (
    <div className="space-y-4">
      {/* Monthly stats strip */}
      <div className="animate-enter enter-1 grid grid-cols-3 gap-3">
        <div className="surface p-3.5">
          <div className="eyebrow flex items-center gap-1.5">
            <CalendarCheck2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('dashboard.sessions')}</span>
          </div>
          <p className="mt-2 font-headline text-[36px] font-bold leading-none tabular-nums">
            {isLoadingLoggedDays ? '–' : logsInCurrentDisplayedMonth}
          </p>
          <p className="mt-1.5 truncate text-[12px] text-muted-foreground">{capitalize(format(displayedMonth, 'MMMM', { locale }))}</p>
        </div>
        <div className="surface p-3.5">
          <div className="eyebrow flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('dashboard.thisWeek')}</span>
          </div>
          <p className="mt-2 font-headline text-[36px] font-bold leading-none tabular-nums">
            {sessionsThisWeek === null ? '–' : sessionsThisWeek}
          </p>
          <p className="mt-1.5 truncate text-[12px] text-muted-foreground">{t('dashboard.sinceMonday')}</p>
        </div>
        <div className={cn(
          "surface p-3.5",
          noRecentDeload && "border-destructive/50"
        )}>
          <div className={cn(
            "eyebrow flex items-center gap-1.5",
            noRecentDeload && "text-destructive"
          )}>
            <BatteryLow className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('dashboard.deloads')}</span>
          </div>
          <p className={cn(
            "mt-2 font-headline text-[36px] font-bold leading-none tabular-nums",
            noRecentDeload && "text-destructive"
          )}>
            {deloadCount3mo === null ? '–' : deloadCount3mo}
          </p>
          <p className={cn(
            "mt-1.5 truncate text-[12px]",
            noRecentDeload ? "font-medium text-destructive" : "text-muted-foreground"
          )}>
            {noRecentDeload ? t('dashboard.noneIn3Months') : t('dashboard.last3Months')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
        {/* Left Column: Calendar */}
        <Card className="animate-enter enter-2 flex flex-col">
          <CardContent className="flex flex-grow flex-col items-center p-4">
              {isLoadingLoggedDays ? (
                <div className="flex h-[200px] flex-grow items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <WorkoutCalendar
                  selectedDate={selectedDate}
                  onSelect={handleDateSelect}
                  month={displayedMonth}
                  onMonthChange={(m) => setDisplayedMonth(startOfMonth(m))}
                  loggedDays={daysWithLogs}
                  deloadDays={daysWithDeload}
                  today={today}
                />
              )}
              <p className="mt-3 w-full border-t px-2 pt-3 text-center text-[13px] leading-snug text-muted-foreground">
                {monthlySummaryMessage}
              </p>
            </CardContent>
        </Card>

        {/* Right Column: Workout Details */}
        <Card className="animate-enter enter-3 flex flex-col">
            <CardHeader className="pb-3">
              <p className="eyebrow">{t('dashboard.workoutDetails')}</p>
              <CardTitle>
                {selectedDate ? capitalize(format(selectedDate, t('date.long'), { locale })) : t('dashboard.selectDay')}
              </CardTitle>
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
                      <p className="text-[13px]">
                        <span className="font-semibold">{t('dashboard.routine')}</span> {selectedLog.routineName}
                      </p>
                    )}
                    {selectedLog.notes && selectedLog.notes.trim() !== '' && (
                       <p className="text-[13px]"><span className="font-semibold">{t('dashboard.overallNotes')}</span> {selectedLog.notes}</p>
                    )}
                    <div>
                      <h4 className="eyebrow mb-2 flex items-center">
                        <ListChecks className="mr-2 h-3.5 w-3.5 text-primary" />
                        {t('dashboard.loggedExercises')}
                      </h4>
                      {selectedLog.exercises.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedLog.exercises.map((exercise) => {
                            const shown = displayExerciseFields(exercise, language);
                            return (
                            <li key={exercise.id} className="rounded-md bg-muted/40 p-3">
                              <p className="font-headline text-[18px] font-semibold leading-tight">{shown.name}</p>
                              <p
                                className="mt-1 text-[13px] tabular-nums text-muted-foreground"
                                title={describeSets(exercise.sets, t)}
                                aria-label={`${shown.name}: ${describeSets(exercise.sets, t)}`}
                              >
                                {formatSetsLine(exercise.sets, t)}
                              </p>
                              {shown.exerciseSetup && (
                                <p className="mt-1 text-[12px] text-muted-foreground">{t('dashboard.setup')} {shown.exerciseSetup}</p>
                              )}
                              {exercise.notes && <p className="mt-1 text-[12px]">{t('dashboard.notes')} {exercise.notes}</p>}
                            </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">{t('dashboard.noExercisesForDay')}</p>
                      )}
                    </div>
                    {selectedDate && isValid(selectedDate) && (
                      <Link href={`/log?date=${format(selectedDate, 'yyyy-MM-dd')}`} className="block">
                          <Button variant="outline" size="sm" className="mt-4 w-full">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              {t('dashboard.viewEditLog')}
                          </Button>
                      </Link>
                    )}
                  </div>
                </ScrollArea>
              ) : selectedDate ? (
                <div className="my-1 flex flex-grow flex-col items-center justify-center rounded-md border border-dashed bg-muted/40 px-4 py-10 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CalendarIcon className="h-6 w-6" />
                  </div>
                  <p className="font-headline text-[20px] font-semibold leading-tight">{t('dashboard.restDay')}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t('dashboard.restDayHint')}</p>
                   <Link href={`/log?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                        <Button size="sm" className="mt-4">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            {t('dashboard.logWorkoutForDay')}
                        </Button>
                    </Link>
                </div>
              ) : (
                 <div className="my-1 flex flex-grow flex-col items-center justify-center rounded-md border border-dashed bg-muted/40 px-4 py-10 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <CalendarIcon className="h-6 w-6" />
                    </div>
                    <p className="text-[13px] font-medium text-muted-foreground">{t('dashboard.selectDayHint')}</p>
                </div>
              )}
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
