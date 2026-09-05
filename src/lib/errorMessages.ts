// Maps raw Firebase/network errors to a short, friendly message in the active
// UI language. The technical detail should go to console.error at the call
// site; never interpolate `error.message` into a toast.

import { t } from '@/i18n';

export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const msg = ((error as { message?: string } | null)?.message ?? '').toLowerCase();

  if (code === 'permission-denied' || msg.includes('insufficient permissions')) {
    return t('errors.permission');
  }
  if (code === 'unavailable' || msg.includes('offline') || msg.includes('network') || msg.includes('failed to fetch')) {
    return t('errors.offline');
  }
  if (code === 'unauthenticated') {
    return t('errors.sessionExpired');
  }
  return fallback;
}
