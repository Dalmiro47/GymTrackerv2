import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isAdminConfigured } from '@/lib/firebaseAdmin';
import { createMcpRouteHandler } from '@/lib/mcp/server';

// firebase-admin needs Node; every request is authenticated, nothing is cacheable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// MCP endpoint for the owner's own data: read tools, plus write tools for routines
// and exercises (no deletes). The handler fails closed (401) when MCP_ACCESS_KEY or
// MCP_OWNER_UID is missing or the Admin SDK is not configured.
const handler = createMcpRouteHandler({
  env: process.env,
  isAdminConfigured,
  db: () => adminDb(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  removeField: () => FieldValue.delete(),
});

export { handler as GET, handler as POST, handler as DELETE };
