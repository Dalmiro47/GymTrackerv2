"use client";

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ChevronDown, History } from 'lucide-react';
import type { Routine } from '@/types';
import type { RoutineVersionWithDiff } from '@/types/routineHistory';
import {
  buildVersionTimeline,
  getRoutineHistory,
} from '@/services/routineHistoryService';
import {
  markersForSnapshot,
  removedExercisesFor,
  summarizeRoutineChanges,
} from '@/lib/routineHistory';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SetStructureBadge } from '@/components/SetStructureBadge';
import { cn } from '@/lib/utils';
import { useI18n } from '@/contexts/LanguageContext';
import { muscleGroupLabel } from '@/i18n';
import { displayExerciseName } from '@/lib/exerciseDisplay';

/**
 * Entries rendered per page. The full history is fetched in one go (a routine has
 * dozens of versions at most here), so this paginates the *render* only — it keeps
 * a long timeline from becoming an unscrollable wall.
 */
const PAGE_SIZE = 15;

interface RoutineHistorySheetProps {
  userId: string | undefined;
  routine: Routine | null;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

/**
 * Read-only timeline of a routine's recorded changes.
 *
 * Read-only by design: restoring a version is a write back into `updateRoutine`
 * that would silently rewrite the live routine and needs missing-exercise
 * resolution for exercises since deleted from the library.
 */
export function RoutineHistorySheet({ userId, routine, isOpen, setIsOpen }: RoutineHistorySheetProps) {
  const { t, tn, locale } = useI18n();
  const [timeline, setTimeline] = useState<RoutineVersionWithDiff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadHistory = useCallback(async () => {
    if (!userId || !routine) return;
    setIsLoading(true);
    setError(null);
    try {
      const versions = await getRoutineHistory(userId, routine.id);
      setTimeline(buildVersionTimeline(versions));
      setVisibleCount(PAGE_SIZE);
    } catch (err: any) {
      console.error('Failed to load routine history:', err);
      setError(err?.message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId, routine]);

  useEffect(() => {
    if (isOpen) {
      setExpandedId(null);
      setVisibleCount(PAGE_SIZE);
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  const oldest = timeline[timeline.length - 1];
  const visible = timeline.slice(0, visibleCount);
  const remaining = timeline.length - visible.length;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Same floating shell as AddEditRoutineDialog so it matches the app's dialogs. */}
      <DialogContent className="flex h-[85dvh] max-h-[85dvh] w-[min(95vw,560px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">{t('history.title', { name: routine?.name ?? '' })}</span>
          </DialogTitle>
          <DialogDescription>
            {isLoading
              ? t('history.loading')
              : timeline.length > 0 && oldest
                ? tn('history.entriesSince', timeline.length, { date: format(new Date(oldest.version.createdAtMs), t('date.short'), { locale }) })
                : t('history.recordedHere')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          <div className="py-4">
            {isLoading && (
              <div className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('history.loadFailed')}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p className="text-xs">{t('history.checkConnection')}</p>
                  <Button variant="outline" size="sm" onClick={loadHistory}>
                    {t('common.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!isLoading && !error && timeline.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-md border border-dashed bg-muted/40 py-12 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <History className="h-6 w-6" />
                </div>
                <p className="font-headline text-[20px] font-semibold leading-tight">
                  {t('history.noChanges')}
                </p>
                <p className="mt-1 max-w-[240px] text-[13px] text-muted-foreground">
                  {t('history.noChangesHint')}
                </p>
              </div>
            )}

            {!isLoading && !error && timeline.length > 0 && (
              <>
                <ol className="space-y-0">
                  {visible.map((entry, index) => (
                    <TimelineEntry
                      key={entry.version.id}
                      entry={entry}
                      isCurrent={index === 0}
                      // Keep the connector running when more entries follow.
                      isLast={index === visible.length - 1 && remaining === 0}
                      isExpanded={expandedId === entry.version.id}
                      onToggle={() =>
                        setExpandedId(expandedId === entry.version.id ? null : entry.version.id)
                      }
                    />
                  ))}
                </ol>

                {remaining > 0 && (
                  <div className="pl-6">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    >
                      {t('history.loadMore', { n: Math.min(remaining, PAGE_SIZE) })}
                      <span className="ml-1 text-muted-foreground">{t('history.older', { n: remaining })}</span>
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function TimelineEntry({
  entry,
  isCurrent,
  isLast,
  isExpanded,
  onToggle,
}: {
  entry: RoutineVersionWithDiff;
  isCurrent: boolean;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { t, language, locale } = useI18n();
  const { version, changes, hasGapBefore } = entry;
  const markers = markersForSnapshot(changes);
  const removed = removedExercisesFor(changes);
  const isDeletion = version.changeType === 'deleted';

  return (
    <li className="relative pb-5 pl-6">
      {!isLast && <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden />}
      <span
        className={cn(
          'absolute left-0 top-[6px] h-[11px] w-[11px] rounded-full border-2',
          isCurrent ? 'border-primary bg-primary' : 'border-border bg-background',
        )}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <time className="text-[12px] font-medium tabular-nums text-muted-foreground">
          {format(new Date(version.createdAtMs), t('date.short'), { locale })}
        </time>
        {isCurrent && !isDeletion && <Badge className="h-6 px-2 text-[11px]">{t('history.current')}</Badge>}
        {version.changeType === 'created' && (
          <Badge variant="secondary" className="h-6 px-2 text-[11px]">{t('history.created')}</Badge>
        )}
        {isDeletion && (
          <Badge variant="destructive" className="h-6 px-2 text-[11px]">{t('history.deleted')}</Badge>
        )}
        {version.source === 'exercise-cascade' && (
          <Badge variant="outline" className="h-6 px-2 text-[11px]">{t('history.libraryEdit')}</Badge>
        )}
      </div>

      <p className="mt-1 text-[15px] leading-snug">{summarizeRoutineChanges(changes)}</p>

      {hasGapBefore && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {t('history.gap')}
        </p>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('history.viewRoutine')}
        <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {isExpanded && (
        <ul className="mt-2 space-y-1 rounded-md bg-muted/40 p-2.5">
          {version.snapshot.exercises.map((ex, i) => {
            // Change names are already display names (see diffRoutineSnapshots),
            // so the marker lookup must use the same form.
            const shownName = displayExerciseName(ex, language);
            const marker = markers.get(shownName);
            return (
              <li key={`${ex.id}-${i}`} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'w-3 shrink-0 text-center font-semibold',
                    marker === 'added' && 'text-primary',
                    marker === 'replaced' && 'text-primary',
                    !marker && 'text-muted-foreground/40',
                  )}
                  aria-hidden
                >
                  {marker === 'added' ? '+' : marker === 'replaced' ? '↻' : marker === 'modified' ? '·' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{shownName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{muscleGroupLabel(ex.muscleGroup, language)}</span>
                <SetStructureBadge value={ex.setStructure} />
              </li>
            );
          })}
          {removed.map((ex, i) => (
            <li key={`removed-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-3 shrink-0 text-center font-semibold" aria-hidden>−</span>
              <span className="min-w-0 flex-1 truncate line-through">{ex.name}</span>
              <span className="shrink-0 text-[10px]">{muscleGroupLabel(ex.muscleGroup, language)}</span>
            </li>
          ))}
          {version.snapshot.exercises.length === 0 && removed.length === 0 && (
            <li className="text-xs text-muted-foreground">{t('history.noExercisesInVersion')}</li>
          )}
        </ul>
      )}
    </li>
  );
}
