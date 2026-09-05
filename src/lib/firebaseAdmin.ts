// Server-only Firebase Admin SDK. NEVER import this from a client component —
// it carries the service-account private key.
//
// The Admin SDK bypasses firestore.rules, which is the whole point: the daily
// quota counter at users/{uid}/stats/usage is written here and blocked for the
// client in the rules, so a user cannot reset their own limit from devtools.
//
// Credentials come from .env.local (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).
// When they are absent the app still runs — `isAdminConfigured` reports false and
// callers skip quota enforcement rather than blocking the coach for everyone.
//
// firebase-admin v14 exposes only the modular entry points; the old `admin.apps`
// / `admin.credential` namespace is gone.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App | null = null;
let configured = false;

if (getApps().length > 0) {
  app = getApps()[0];
  configured = true;
} else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (clientEmail && privateKey && projectId) {
    try {
      app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          // .env files keep the PEM on one line with literal \n escapes.
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
      configured = true;
    } catch (error) {
      console.error('[firebaseAdmin] initialization failed:', error);
    }
  } else {
    console.warn(
      '[firebaseAdmin] Service account not configured — daily AI limits are NOT being enforced. ' +
        'Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to enable them.',
    );
  }
}

/** False when the service account is missing or failed to load. */
export const isAdminConfigured = (): boolean => configured && app !== null;

/** Only call once `isAdminConfigured()` is true. */
export const adminDb = (): Firestore => getFirestore(app!);
