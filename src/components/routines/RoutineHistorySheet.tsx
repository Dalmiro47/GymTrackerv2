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
      <DialogContent className="flex h-[85dvh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:h-[85vh] sm:w-[95vw]">
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 pr-10 text-left">
          <DialogTitle className="font-headline flex items-center gap-2 text-lg">
            <History className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">History · {routine?.name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isLoading
              ? 'Loading changes…'
              : timeline.length > 0 && oldest
                ? `${timeline.length} ${timeline.length === 1 ? 'entry' : 'entries'} since ${format(new Date(oldest.version.createdAtMs), 'MMM d, yyyy')}`
                : 'Changes you make to this routine are recorded here.'}
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
                <AlertTitle>Couldn&apos;t load this routine&apos;s history.</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p className="text-xs">Check your connection and try again.</p>
                  <Button variant="outline" size="sm" onClick={loadHistory}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!isLoading && !error && timeline.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <History className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  No changes recorded yet.
                </p>
                <p className="mt-1 max-w-[240px] text-xs text-muted-foreground/70">
                  Edits you make to this routine from now on will show up here.
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
                      Load {Math.min(remaining, PAGE_SIZE)} more
                      <span className="ml-1 text-muted-foreground">({remaining} older)</span>
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
        <time className="text-xs font-medium text-muted-foreground">
          {format(new Date(version.createdAtMs), 'MMM d, yyyy')}
        </time>
        {isCurrent && !isDeletion && <Badge className="h-5 px-1.5 text-[10px]">Current</Badge>}
        {version.changeType === 'created' && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Created</Badge>
        )}
        {isDeletion && (
          <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Deleted</Badge>
        )}
        {version.source === 'exercise-cascade' && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Library edit</Badge>
        )}
      </div>

      <p className="mt-1 text-sm leading-snug">{summarizeRoutineChanges(changes)}</p>

      {hasGapBefore && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Some earlier changes may not have been recorded.
        </p>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        View routine
        <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {isExpanded && (
        <ul className="mt-2 space-y-1 rounded-md border bg-muted/30 p-2.5">
          {version.snapshot.exercises.map((ex, i) => {
            const marker = markers.get(ex.name);
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
                <span className="min-w-0 flex-1 truncate">{ex.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{ex.muscleGroup}</span>
                <SetStructureBadge value={ex.setStructure} />
              </li>
            );
          })}
          {removed.map((ex, i) => (
            <li key={`removed-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-3 shrink-0 text-center font-semibold" aria-hidden>−</span>
              <span className="min-w-0 flex-1 truncate line-through">{ex.name}</span>
              <span className="shrink-0 text-[10px]">{ex.muscleGroup}</span>
            </li>
          ))}
          {version.snapshot.exercises.length === 0 && removed.length === 0 && (
            <li className="text-xs text-muted-foreground">No exercises in this version.</li>
          )}
        </ul>
      )}
    </li>
  );
}
