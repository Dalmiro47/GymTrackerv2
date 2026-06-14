"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CoachChatSheet } from '@/components/coach/CoachChatSheet';
import { useAuth } from '@/contexts/AuthContext';
import { getLogsSince } from '@/services/trainingLogService';
import {
  computeProgression,
  sortProgression,
  type ProgressionResult,
} from '@/lib/progression';
import { serializeDashboardContext, type DashboardDeloadSummary } from '@/lib/ai/context-builders';
import { subWeeks, parseISO, differenceInCalendarDays } from 'date-fns';
import { Loader2, TrendingUp, Minus, TrendingDown, HelpCircle, LineChart, ChevronDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// How far back to look. WINDOW_SESSIONS picks the last few sessions out of this.
// 26 weeks so weeksSincePr can surface long plateaus instead of capping near
// the window length. PR recency is only as deep as this window — a PR set
// before it reads as if it were set on the first loaded session. The query is
// date-indexed, so widening it needs no new Firestore index.
const LOOKBACK_WEEKS = 26;

type RowMeta = { label: string; icon: React.ElementType; tone: string; badge: string };

function getMeta(item: ProgressionResult): RowMeta {
  switch (item.status) {
    case 'progressing':
      return {
        label: 'Progressing',
        icon: TrendingUp,
        tone: 'text-success',
        badge: 'border-success/30 bg-success/10 text-success',
      };
    case 'regressing':
      return {
        label: 'Regressing',
        icon: TrendingDown,
        tone: 'text-destructive',
        badge: 'border-destructive/30 bg-destructive/10 text-destructive',
      };
    case 'plateau':
      // Amber alarm only for key lifts; steady accessories stay neutral.
      return item.isKey
        ? {
            label: 'Plateau',
            icon: Minus,
            tone: 'text-chart-4',
            badge: 'border-chart-4/30 bg-chart-4/10 text-chart-4',
          }
        : {
            label: 'Plateau',
            icon: Minus,
            tone: 'text-muted-foreground',
            badge: 'border-border bg-muted/40 text-muted-foreground',
          };
    case 'insufficient':
    default:
      return {
        label: 'Not enough data',
        icon: HelpCircle,
        tone: 'text-muted-foreground',
        badge: 'border-border bg-muted/40 text-muted-foreground',
      };
  }
}

function prLabel(item: ProgressionResult): string | null {
  if (item.weeksSincePr === null) return null;
  if (item.weeksSincePr <= 0) return 'PR this week';
  return `${item.weeksSincePr}w since PR`;
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const width = 64;
  const height = 20;
  const pad = 2;

  if (values.length < 2) {
    // A single point (or none) has no trend to draw — show a flat baseline.
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.4}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProgressionRow({ item }: { item: ProgressionResult }) {
  const meta = getMeta(item);
  const Icon = meta.icon;
  const recency = prLabel(item);

  return (
    <li className="flex flex-col gap-2 border-b border-border/70 py-3 sm:flex-row sm:items-center sm:gap-4 sm:py-2.5">
      {/* Name — on mobile this takes the full row width so it no longer truncates. */}
      <div className="min-w-0 sm:flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="truncate text-xs text-muted-foreground">{item.muscleGroup}</p>
      </div>

      {/* Meta cluster — spread on mobile, packed to the right on wider screens. */}
      <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
        <div className={cn('shrink-0', meta.tone)}>
          <Sparkline values={item.series} />
        </div>

        <div className="w-24 shrink-0 text-right">
          {item.pr ? (
            <p className="whitespace-nowrap text-sm font-semibold tabular-nums leading-none">
              {item.metricKind === 'reps' ? (
                <>
                  {item.pr.reps} <span className="text-xs font-normal text-muted-foreground">reps</span>
                </>
              ) : (
                <>
                  {item.pr.weight}
                  <span className="text-xs font-normal text-muted-foreground">kg</span> × {item.pr.reps}
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
          <p className={cn('mt-0.5 text-xs font-medium tabular-nums', meta.tone)}>{recency ?? '—'}</p>
        </div>

        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            meta.badge
          )}
        >
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
      </div>
    </li>
  );
}

// Toggle + collapsed grid, shared by the "Show N more" (insufficient) and
// "Show N inactive" groups so both behave identically.
function CollapsibleRows({
  items,
  open,
  onToggle,
  showLabel,
}: {
  items: ProgressionResult[];
  open: boolean;
  onToggle: () => void;
  showLabel: string;
}) {
  return (
    <div className="mt-1">
      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onToggle}>
        <ChevronDown className={cn('mr-1 h-4 w-4 transition-transform', open && 'rotate-180')} />
        {open ? 'Hide' : showLabel}
      </Button>
      {open && (
        <ul className="grid grid-cols-1 xl:grid-cols-2 xl:gap-x-10">
          {items.map(item => (
            <ProgressionRow key={item.exerciseId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProgressionSection() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState<ProgressionResult[]>([]);
  const [deload, setDeload] = useState<DashboardDeloadSummary | null>(null);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setResults([]);
      setDeload(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    getLogsSince(user.id, subWeeks(new Date(), LOOKBACK_WEEKS))
      .then(logs => {
        if (cancelled) return;
        // Exclude deload sessions: their reduced loads would read as regressions.
        const nonDeload = logs.filter(l => l?.isDeload !== true);
        setResults(computeProgression(nonDeload));

        // Deload summary, derived from the logs already loaded — no extra fetch
        // or new analytics. Feeds the dashboard coach's "ready for a deload?" chip.
        const deloadDates = logs
          .filter(l => l?.isDeload === true)
          .map(l => l.date)
          .filter(Boolean)
          .sort();
        const lastDeload = deloadDates.length ? deloadDates[deloadDates.length - 1] : null;
        setDeload({
          countInWindow: deloadDates.length,
          weeksSinceLast: lastDeload
            ? Math.floor(differenceInCalendarDays(new Date(), parseISO(lastDeload)) / 7)
            : null,
          windowWeeks: LOOKBACK_WEEKS,
        });
      })
      .catch(err => {
        console.error('Failed to load progression data:', err);
        if (!cancelled) {
          setResults([]);
          setDeload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const sorted = useMemo(() => sortProgression(results), [results]);
  // Three mutually exclusive buckets. Inactive wins over insufficient so an
  // exercise that is both is listed once (under "inactive"), never twice.
  const activeVisible = useMemo(
    () => sorted.filter(r => r.isActive && r.status !== 'insufficient'),
    [sorted],
  );
  const activeInsufficient = useMemo(
    () => sorted.filter(r => r.isActive && r.status === 'insufficient'),
    [sorted],
  );
  const inactive = useMemo(() => sorted.filter(r => !r.isActive), [sorted]);

  // Dashboard-scoped coach context (reuses the same coach window/wiring).
  const coachContext = useMemo(
    () => serializeDashboardContext(sorted, deload ?? undefined),
    [sorted, deload],
  );

  // Starter chips: focus, the top actionable active key lift (regressing →
  // plateau → fallback), and deload readiness.
  const coachPrompts = useMemo(() => {
    const topKey =
      activeVisible.find(r => r.isKey && r.status === 'regressing') ??
      activeVisible.find(r => r.isKey && r.status === 'plateau');
    const dynamic = topKey
      ? `Why is ${topKey.name} stalling?`
      : 'How is my overall progression trending?';
    return ['What should I focus on this week?', dynamic, 'Am I ready for a deload?'];
  }, [activeVisible]);

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="font-headline flex items-center gap-2">
              <LineChart className="h-5 w-5 text-primary" />
              Progression
            </CardTitle>
            <CardDescription>
              Per-exercise trend over your last {LOOKBACK_WEEKS} weeks of training.
            </CardDescription>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                aria-label="How to read this section"
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-2 text-xs leading-relaxed">
              <p>
                The number shown is your <strong>best set (PR)</strong> for that exercise — the
                actual weight × reps you lifted (or your best reps, for bodyweight moves).
              </p>
              <p>
                <strong>&quot;Xw since PR&quot;</strong> is how many weeks since you last beat that
                best set.
              </p>
              <p>
                <span className="font-medium text-success">Green</span> is a recent PR,{' '}
                <span className="font-medium text-chart-4">amber</span> is a key lift with no recent
                PR, <span className="font-medium text-destructive">red</span> is a drop.
              </p>
              <p>
                <span className="font-medium text-muted-foreground">Grey</span> means an accessory or
                not enough data yet.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Active exercises — single column on mobile, two columns on wide
                screens so the full-width hero is used without stretching rows. */}
            {activeVisible.length > 0 ? (
              <ul className="grid grid-cols-1 xl:grid-cols-2 xl:gap-x-10">
                {activeVisible.map(item => (
                  <ProgressionRow key={item.exerciseId} item={item} />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <LineChart className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold">No active exercises.</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Log a session and your current trends will show up here.
                </p>
              </div>
            )}

            {/* Active but not enough sessions yet — existing collapsible pattern. */}
            {activeInsufficient.length > 0 && (
              <CollapsibleRows
                items={activeInsufficient}
                open={showInsufficient}
                onToggle={() => setShowInsufficient(v => !v)}
                showLabel={`Show ${activeInsufficient.length} more`}
              />
            )}

            {/* Not logged within ACTIVE_WEEKS — kept reachable, not dropped. */}
            {inactive.length > 0 && (
              <CollapsibleRows
                items={inactive}
                open={showInactive}
                onToggle={() => setShowInactive(v => !v)}
                showLabel={`Show ${inactive.length} inactive`}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>

    {/* Same coach window/wiring as log & routines — dashboard-scoped context.
        The trigger is a fixed floating button, so it never overlaps the
        in-card Info button or other dashboard controls. */}
    {!isLoading && results.length > 0 && (
      <CoachChatSheet mode="dashboard" context={coachContext} suggestedPrompts={coachPrompts} />
    )}
    </>
  );
}
