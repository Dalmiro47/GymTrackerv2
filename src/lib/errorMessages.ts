// Maps raw Firebase/network errors to a short, friendly Spanish message.
// The technical detail should go to console.error at the call site; never
// interpolate `error.message` into a toast.

export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const msg = ((error as { message?: string } | null)?.message ?? '').toLowerCase();

  if (code === 'permission-denied' || msg.includes('insufficient permissions')) {
    return 'No tienes permiso para realizar esta acción. Vuelve a iniciar sesión.';
  }
  if (code === 'unavailable' || msg.includes('offline') || msg.includes('network') || msg.includes('failed to fetch')) {
    return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  }
  if (code === 'unauthenticated') {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  return fallback;
}
