import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isAdminConfigured } from '@/lib/firebaseAdmin';
import { createHealthIngestHandler } from '@/lib/health/handler';

// firebase-admin needs Node; every request is authenticated, nothing is cacheable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Health ingest for the owner's own data: an iOS Shortcut posts Apple Health and
// scale values, stored as users/{MCP_OWNER_UID}/health/{YYYY-MM-DD} with merge.
// The handler fails closed (401) when HEALTH_INGEST_KEY or MCP_OWNER_UID is missing
// or the Admin SDK is not configured. The key travels in the x-ingest-key header.
const handler = createHealthIngestHandler({
  env: process.env,
  isAdminConfigured,
  db: () => adminDb(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
});

export { handler as POST };
