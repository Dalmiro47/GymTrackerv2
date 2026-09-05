'use client';

// Admin-only feedback inbox. Lives inside (app) so it inherits the auth guard
// and the app shell, but it is deliberately absent from `navItems` — reachable
// only by typing /admin.
//
// The check below is a UX gate, NOT the security boundary: firestore.rules is,
// via isAdmin() on the `feedback` collection. A non-admin who forces this route
// gets permission-denied from Firestore either way.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { getAuth } from 'firebase/auth';
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import type { TranslationKey } from '@/i18n';
import { useI18n } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { isAdminUid } from '@/lib/adminConfig';
import { app } from '@/lib/firebaseConfig';
import { friendlyErrorMessage } from '@/lib/errorMessages';
import { cn } from '@/lib/utils';
import {
  getAllFeedback,
  setFeedbackStatus,
  type FeedbackEntry,
  type FeedbackStatus,
} from '@/services/feedbackService';

const FILTERS: Array<{ value: 'all' | FeedbackStatus; label: TranslationKey }> = [
  { value: 'all', label: 'admin.filterAll' },
  { value: 'pending', label: 'admin.filterPending' },
  { value: 'solved', label: 'admin.filterSolved' },
  { value: 'dismissed', label: 'admin.filterDismissed' },
];

const STATUS_LABEL: Record<FeedbackStatus, TranslationKey> = {
  pending: 'admin.statusPending',
  solved: 'admin.statusSolved',
  dismissed: 'admin.statusDismissed',
};

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  pending: 'border-warning/40 bg-warning/10 text-warning',
  solved: 'border-success/40 bg-success/10 text-success',
  dismissed: 'border-border bg-muted text-muted-foreground',
};

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const { t, locale } = useI18n();
  const { toast } = useToast();

  const [entries, setEntries] = useState<FeedbackEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | FeedbackStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  // False when FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are missing on the
  // server: the daily AI limit silently does nothing, so say so here.
  const [limitsEnforced, setLimitsEnforced] = useState<boolean | null>(null);

  const isAdmin = isAdminUid(user?.id);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setEntries(await getAllFeedback());
    } catch (error) {
      console.error('[AdminPage] feedback load failed:', error);
      setLoadFailed(true);
      setEntries([]);
      toast({
        title: t('common.loadErrorTitle'),
        description: friendlyErrorMessage(error, t('admin.loadErrorDesc')),
        variant: 'destructive',
      });
    }
    // `t` is intentionally omitted: a language switch must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await getAuth(app).currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch('/api/coach/usage', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { enforced?: boolean };
        setLimitsEnforced(data.enforced !== false);
      } catch {
        /* Non-critical: the banner just stays hidden. */
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const visible = useMemo(
    () => (entries ?? []).filter((e) => filter === 'all' || e.status === filter),
    [entries, filter],
  );

  const updateStatus = async (id: string, status: FeedbackStatus) => {
    setBusyId(id);
    try {
      await setFeedbackStatus(id, status);
      setEntries((prev) => (prev ?? []).map((e) => (e.id === id ? { ...e, status } : e)));
    } catch (error) {
      console.error('[AdminPage] status update failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('admin.updateErrorDesc')),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 py-8 text-[15px] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> {t('common.loading')}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card className="animate-enter enter-1">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <p className="text-[17px] font-semibold">{t('admin.deniedTitle')}</p>
            <p className="text-[13px] text-muted-foreground">{t('admin.deniedDesc')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader title={t('admin.title')} description={t('admin.description')} />

      {limitsEnforced === false && (
        <Alert variant="destructive">
          <AlertDescription className="text-[13px]">
            {t('admin.limitsNotEnforced')}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              'pressable h-9 rounded-md border px-3 text-[13px] font-semibold transition-colors',
              filter === f.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card/40 hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {t(f.label)}
          </button>
        ))}
      </div>

      {entries === null ? (
        <div className="flex items-center gap-2 py-8 text-[15px] text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" /> {t('common.loading')}
        </div>
      ) : loadFailed ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3 text-[13px]">
            {t('admin.loadErrorDesc')}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-[15px] text-muted-foreground">
            {t('admin.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => (
            <Card key={entry.id} className="animate-enter">
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      STATUS_CLASS[entry.status],
                    )}
                  >
                    {t(STATUS_LABEL[entry.status])}
                  </span>
                  <span className="text-[12px] text-muted-foreground tabular">
                    {entry.createdAt
                      ? format(entry.createdAt, 'dd MMM yyyy, HH:mm', { locale })
                      : '—'}
                  </span>
                  {entry.page ? (
                    <span className="text-[12px] text-muted-foreground">{entry.page}</span>
                  ) : null}
                </div>

                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{entry.message}</p>

                <p className="break-all text-[12px] text-muted-foreground">
                  {entry.userEmail ?? entry.userId}
                </p>

                <div className="flex gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === entry.id || entry.status === 'solved'}
                    onClick={() => void updateStatus(entry.id, 'solved')}
                  >
                    <CheckCircle2 className="h-4 w-4" /> {t('admin.markSolved')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === entry.id || entry.status === 'dismissed'}
                    onClick={() => void updateStatus(entry.id, 'dismissed')}
                  >
                    <XCircle className="h-4 w-4" /> {t('admin.markDismissed')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
