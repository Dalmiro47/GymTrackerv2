// Server-only helpers for the daily quota doc at users/{uid}/stats/usage.
// Imports firebaseAdmin — must never be pulled into a client bundle.
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb, isAdminConfigured } from '@/lib/firebaseAdmin';

/**
 * Quota days are UTC on purpose: the server is the quota authority and has no
 * reliable client timezone. Workout logs key on the user's LOCAL day — the two
 * "days" intentionally differ, and quotas reset at midnight UTC.
 */
export const utcDayKey = (): string => new Date().toISOString().split('T')[0];

const usageRef = (userId: string) =>
  adminDb().collection('users').doc(userId).collection('stats').doc('usage');

/** Coach calls the user has spent today. 0 when the doc is missing or stale-dated. */
export async function getCoachCallsUsedToday(userId: string): Promise<number> {
  if (!isAdminConfigured()) return 0;
  const snap = await usageRef(userId).get();
  if (!snap.exists) return 0;
  const data = snap.data() ?? {};
  if (data.date !== utcDayKey()) return 0;
  return typeof data.coachCallsUsed === 'number' ? data.coachCallsUsed : 0;
}

/**
 * Atomically count one coach call.
 *
 * On day rollover the doc is REWRITTEN with the counters reset rather than
 * incremented, so yesterday's count can never leak into today — an increment()
 * merged onto a stale-dated doc is the classic bug here.
 */
export async function bumpCoachCall(userId: string): Promise<void> {
  if (!isAdminConfigured()) return;
  const ref = usageRef(userId);
  const today = utcDayKey();
  await adminDb().runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.date !== today) {
      tx.set(ref, {
        date: today,
        coachCallsUsed: 1,
        lastCoachCallAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(
        ref,
        {
          coachCallsUsed: FieldValue.increment(1),
          lastCoachCallAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
}
