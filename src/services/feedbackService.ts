// Top-level `feedback` collection — NOT under users/{uid}, because /admin has
// to read every user's entries and firestore.rules only ever grant a user their
// own subtree. The rules there allow any signed-in user to create (with a
// length-capped `message`) and only the admin UID to read, update or delete.
import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

export const FEEDBACK_MAX_LENGTH = 1000;

export type FeedbackStatus = 'pending' | 'solved' | 'dismissed';

export type FeedbackEntry = {
  id: string;
  message: string;
  userId: string;
  userEmail?: string;
  page?: string;
  deviceInfo?: string;
  status: FeedbackStatus;
  createdAt: Date | null;
};

/** Rejects on failure — the caller owns the toast (see the sessionCache note in CLAUDE.md). */
export async function submitFeedback(input: {
  message: string;
  userId: string;
  userEmail?: string | null;
  page?: string;
}): Promise<void> {
  const trimmed = input.message.trim();
  if (!trimmed) return;

  await addDoc(collection(db, 'feedback'), {
    // Sliced to match the cap the rules enforce, so an over-long message is
    // saved truncated rather than rejected by Firestore.
    message: trimmed.slice(0, FEEDBACK_MAX_LENGTH),
    userId: input.userId,
    // Stored so /admin can reply; it is the submitter's own address, shown only
    // to the admin, and never logged to the console or sent anywhere else.
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    ...(input.page ? { page: input.page } : {}),
    deviceInfo: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 300),
    status: 'pending' as FeedbackStatus,
    createdAt: serverTimestamp(),
  });
}

/** Admin only — the rules reject this for anyone else. Newest first. */
export async function getAllFeedback(): Promise<FeedbackEntry[]> {
  const snap = await getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, any>;
    return {
      id: d.id,
      message: typeof data.message === 'string' ? data.message : '',
      userId: typeof data.userId === 'string' ? data.userId : '',
      userEmail: data.userEmail,
      page: data.page,
      deviceInfo: data.deviceInfo,
      status: (data.status as FeedbackStatus) ?? 'pending',
      // serverTimestamp() is null on the local echo until the server resolves it.
      createdAt: data.createdAt?.toDate?.() ?? null,
    };
  });
}

/** Admin only. */
export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  await updateDoc(doc(db, 'feedback', id), { status, updatedAt: serverTimestamp() });
}
