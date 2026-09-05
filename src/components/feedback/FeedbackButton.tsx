'use client';

// Sticky feedback affordance, mounted once in the (app) layout so it rides
// every protected page.
//
// Placement: bottom-LEFT. The AI Coach FAB owns bottom-right (z-50) and the
// Training Log's save dock is centred in the content column, so the left edge
// is the only corner free on every page. z-40 keeps it under the coach backdrop
// (z-[49]), matching the dock — the button disappears while the coach is open
// instead of floating over its blur. On desktop it clears the sidebar.

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus, Loader2, Send } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/errorMessages';
import { FEEDBACK_MAX_LENGTH, submitFeedback } from '@/services/feedbackService';
import { cn } from '@/lib/utils';

export function FeedbackButton() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!user) return null;

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await submitFeedback({
        message: trimmed,
        userId: user.id,
        userEmail: user.email,
        page: pathname,
      });
      setMessage('');
      setOpen(false);
      toast({ title: t('feedback.sentTitle'), description: t('feedback.sentDesc') });
    } catch (error) {
      console.error('[FeedbackButton] submit failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('feedback.sendErrorDesc')),
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const remaining = FEEDBACK_MAX_LENGTH - message.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('feedback.button')}
        className={cn(
          'pressable fixed z-40 flex items-center justify-center gap-2 rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent hover:text-accent-foreground',
          'h-12 w-12 md:h-auto md:w-auto md:px-4 md:py-2.5 md:text-sm md:font-semibold',
          'left-4 md:left-[calc(var(--sidebar-width)+1.5rem)]',
          // Same vertical rhythm as the coach FAB, clearing the mobile tab bar.
          'bottom-[calc(var(--bottomnav-height)+env(safe-area-inset-bottom)+1rem)] md:bottom-6',
        )}
      >
        <MessageSquarePlus className="h-5 w-5 md:h-4 md:w-4" />
        <span className="hidden md:inline">{t('feedback.button')}</span>
      </button>

      <Dialog open={open} onOpenChange={(v) => !sending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('feedback.title')}</DialogTitle>
            <DialogDescription>{t('feedback.description')}</DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            rows={5}
            maxLength={FEEDBACK_MAX_LENGTH}
            placeholder={t('feedback.placeholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-right text-[12px] text-muted-foreground tabular">
            {t('feedback.charsLeft', { n: remaining })}
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={!message.trim() || sending}>
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('feedback.sending')}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> {t('feedback.send')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
