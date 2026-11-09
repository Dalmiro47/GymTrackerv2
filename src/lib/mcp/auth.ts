// server-only: src/lib/mcp/auth.ts
import { createHash, timingSafeEqual } from 'crypto';

// 32 bytes of entropy as hex/base64url is >= 43 chars; anything shorter is a config mistake.
const MIN_KEY_LENGTH = 32;

/**
 * Everything the check depends on is passed in, so tests run with fake values and
 * never load an env file or the Admin SDK.
 */
export type AuthDeps = {
  /** `process.env` in the route; only MCP_ACCESS_KEY and MCP_OWNER_UID are read. */
  env: Record<string, string | undefined>;
  /** `isAdminConfigured` from src/lib/firebaseAdmin.ts. */
  isAdminConfigured: () => boolean;
};

export type McpConfig = { accessKey: string; ownerUid: string };

/**
 * Reads and checks the MCP config. Returns null (fail closed) when anything is
 * missing, so a half-configured deployment rejects every request instead of
 * serving the wrong account. Logs a short code only: never the key or the uid.
 */
export function readMcpConfig(deps: AuthDeps): McpConfig | null {
  const accessKey = deps.env.MCP_ACCESS_KEY?.trim();
  const ownerUid = deps.env.MCP_OWNER_UID?.trim();

  if (!accessKey || accessKey.length < MIN_KEY_LENGTH) {
    console.error('[mcp] refused: key_config');
    return null;
  }
  // A uid is one path segment; a slash would let it address another document.
  if (!ownerUid || ownerUid.includes('/')) {
    console.error('[mcp] refused: owner_config');
    return null;
  }
  if (!deps.isAdminConfigured()) {
    console.error('[mcp] refused: admin_config');
    return null;
  }
  return { accessKey, ownerUid };
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Constant-time key check. Both sides are hashed first so the comparison always
 * runs over 32 bytes and the key length does not leak through timing.
 */
export function isValidAccessKey(presented: string | undefined | null, expected: string): boolean {
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * The owner uid when the presented key is right, else null. The uid always comes
 * from the config, never from the request.
 */
export function authorize(presentedKey: string | undefined | null, deps: AuthDeps): { ownerUid: string } | null {
  const config = readMcpConfig(deps);
  if (!config || !isValidAccessKey(presentedKey, config.accessKey)) return null;
  return { ownerUid: config.ownerUid };
}

/** One answer for every refusal, so the cause never shows from outside. */
export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
