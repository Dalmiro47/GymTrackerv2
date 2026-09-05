// Server-side Firebase ID token verification, shared by the coach routes.
//
// Uses the Identity Toolkit REST API rather than firebase-admin's verifyIdToken:
// it needs no service account, so token checks keep working even when the
// service-account env vars are absent (only the quota counter depends on those).
export async function verifyFirebaseIdToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const uid = data?.users?.[0]?.localId;
    return typeof uid === 'string' && uid ? uid : null;
  } catch {
    return null;
  }
}
