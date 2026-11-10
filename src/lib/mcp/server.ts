// server-only: src/lib/mcp/server.ts
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { authorize, unauthorized, type AuthDeps } from './auth';
import { createRequestLimiter, type RequestLimits } from './limits';
import { createRepo, type ReadDb } from './repo.server';
import { createWriteRepo, type WriteDb } from './repo.write.server';
import { registerReadTools } from './tools.read';
import { registerWriteTools } from './tools.write';

/**
 * What the route needs from outside. The route file passes the real env and Admin
 * SDK; tests pass fakes, so they never load an env file or reach Firestore.
 */
export type McpRouteDeps = AuthDeps & {
  /** Called only after auth passed. */
  db: () => ReadDb & WriteDb;
  /** The Admin SDK's `FieldValue.serverTimestamp()`; stamps `createdAt` / `updatedAt` on routine writes. */
  serverTimestamp: () => unknown;
  now?: () => Date;
  limits?: RequestLimits;
};

type RouteContext = { params: Promise<{ key: string }> };

/**
 * Builds the handler for /api/mcp/[key]. The key in the path is the only
 * credential (a Claude connector registered as "no sign in" cannot send headers),
 * so it is checked in constant time before anything else, and the owner uid always
 * comes from env, never from the request.
 *
 * Stateless: each request gets its own server and transport, so nothing is shared
 * between requests and no session survives a serverless cold start.
 */
export function createMcpRouteHandler(deps: McpRouteDeps) {
  const limiter = createRequestLimiter(deps.limits);

  return async function handler(req: Request, { params }: RouteContext): Promise<Response> {
    const { key } = await params;
    const auth = authorize(key, deps);
    if (!auth) return unauthorized();

    const limited = limiter.check();
    if (limited) return limited;

    try {
      const server = new McpServer({ name: 'gym-tracker', version: '1.0.0' });
      const db = deps.db();
      const repo = createRepo(db, auth.ownerUid);
      registerReadTools(server, repo, deps.now);
      registerWriteTools(server, {
        repo,
        writes: createWriteRepo(db, auth.ownerUid, deps.serverTimestamp),
        now: deps.now,
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return await transport.handleRequest(req);
    } catch {
      console.error('[mcp] request_failed');
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
  };
}
