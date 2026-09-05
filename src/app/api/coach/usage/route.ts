import { NextResponse } from 'next/server';
import { isAdminUid } from '@/lib/adminConfig';
import { isAdminConfigured } from '@/lib/firebaseAdmin';
import { DAILY_LIMIT_COACH_CALLS } from '@/lib/limits';
import { getCoachCallsUsedToday } from '@/lib/usageQuota';
import { verifyFirebaseIdToken } from '@/lib/verifyIdToken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * How many AI Coach calls the caller has left today.
 *
 * `unlimited` is true for the admin account, and also when the service account
 * is unset — in that case the limit genuinely is not being enforced, and
 * `enforced: false` lets /admin say so instead of showing a fake count.
 */
export async function GET(req: Request) {
  const uid = await verifyFirebaseIdToken(req);
  if (!uid) {
    return NextResponse.json({ code: 'unauthenticated' }, { status: 401 });
  }

  const enforced = isAdminConfigured();
  const unlimited = isAdminUid(uid) || !enforced;

  if (unlimited) {
    return NextResponse.json({ unlimited: true, enforced, limit: DAILY_LIMIT_COACH_CALLS });
  }

  try {
    const used = await getCoachCallsUsedToday(uid);
    return NextResponse.json({
      unlimited: false,
      enforced,
      limit: DAILY_LIMIT_COACH_CALLS,
      used,
      remaining: Math.max(0, DAILY_LIMIT_COACH_CALLS - used),
    });
  } catch (error) {
    console.error('[coach/usage] read failed:', error);
    // The counter is a UI affordance; a read failure must not break the chat.
    return NextResponse.json({ unlimited: true, enforced, limit: DAILY_LIMIT_COACH_CALLS });
  }
}
