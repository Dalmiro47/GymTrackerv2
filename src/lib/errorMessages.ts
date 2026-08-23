// Maps raw Firebase/network errors to a short, friendly English message.
// The technical detail should go to console.error at the call site; never
// interpolate `error.message` into a toast.

export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const msg = ((error as { message?: string } | null)?.message ?? '').toLowerCase();

  if (code === 'permission-denied' || msg.includes('insufficient permissions')) {
    return "You don't have permission to do that. Please sign in again.";
  }
  if (code === 'unavailable' || msg.includes('offline') || msg.includes('network') || msg.includes('failed to fetch')) {
    return "You're offline. Check your connection and try again.";
  }
  if (code === 'unauthenticated') {
    return 'Your session expired. Please sign in again.';
  }
  return fallback;
}
