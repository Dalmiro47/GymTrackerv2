import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadDb } from './repo.server';
import { createMcpRouteHandler, type McpRouteDeps } from './server';

// Fake values only. Requests are built in memory and handed to the same handler
// the /api/mcp/[key] route exports; nothing listens on a port and nothing leaves
// the process. The db throws on any use: these cases must never reach it.
const KEY = 'k'.repeat(40);
const OWNER = 'fake-owner';
const URL_BASE = 'http://localhost/api/mcp/';

const untouchableDb = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`db.${String(prop)} must not be reached in this test`);
  },
}) as ReadDb;

const deps = (over: Partial<McpRouteDeps> = {}): McpRouteDeps => ({
  env: { MCP_ACCESS_KEY: KEY, MCP_OWNER_UID: OWNER },
  isAdminConfigured: () => true,
  db: () => untouchableDb,
  ...over,
});

const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

const post = (key: string, message: unknown) =>
  new Request(URL_BASE + key, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });

/** The JSON-RPC message of a response, whether it came back as JSON or as an SSE stream. */
async function rpc(res: Response): Promise<{ id?: number; result?: any; error?: unknown }> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

test('HTTP: initialize, then tools/list returns exactly the six read tools', async () => {
  const handler = createMcpRouteHandler(deps());

  const initRes = await handler(post(KEY, initialize), ctx(KEY));
  assert.equal(initRes.status, 200);
  const init = await rpc(initRes);
  assert.equal(init.id, 1);
  assert.equal(init.result.serverInfo.name, 'gym-tracker');
  assert.ok(init.result.capabilities.tools);

  const listRes = await handler(post(KEY, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), ctx(KEY));
  assert.equal(listRes.status, 200);
  const list = await rpc(listRes);
  assert.equal(list.id, 2);
  const tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean }; inputSchema: { properties?: object } }> =
    list.result.tools;
  assert.deepEqual(tools.map(t => t.name).sort(), [
    'get_exercise_history', 'get_profile', 'get_recent_logs', 'get_routine', 'list_exercises', 'list_routines',
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
    for (const key of Object.keys(tool.inputSchema.properties ?? {})) {
      assert.doesNotMatch(key, /uid|user|owner/i, `${tool.name} must not take ${key}`);
    }
  }
});

test('HTTP: a tool call with invalid input never reaches the db', async () => {
  const handler = createMcpRouteHandler(deps());
  const res = await handler(
    post(KEY, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_recent_logs', arguments: { days: 9999 } } }),
    ctx(KEY),
  );
  const message = await rpc(res);
  // The SDK reports a schema failure as a JSON-RPC error or as an isError result.
  assert.ok(message.error || message.result?.isError === true);
});

test('HTTP: a wrong key is 401 before anything else runs', async () => {
  let dbTouched = false;
  const handler = createMcpRouteHandler(deps({ db: () => { dbTouched = true; return untouchableDb; } }));
  const wrong = 'x'.repeat(40);
  const res = await handler(post(wrong, initialize), ctx(wrong));
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '{"error":"unauthorized"}');
  assert.equal(dbTouched, false);
});

test('HTTP: missing env or an unconfigured admin SDK is the same 401', async () => {
  const cases: McpRouteDeps[] = [
    deps({ env: { MCP_OWNER_UID: OWNER } }),
    deps({ env: { MCP_ACCESS_KEY: KEY } }),
    deps({ env: { MCP_ACCESS_KEY: 'short', MCP_OWNER_UID: OWNER } }),
    deps({ isAdminConfigured: () => false }),
  ];
  for (const d of cases) {
    const res = await createMcpRouteHandler(d)(post(KEY, initialize), ctx(KEY));
    assert.equal(res.status, 401);
    assert.equal(await res.text(), '{"error":"unauthorized"}');
  }
});

test('HTTP: requests over the rate limit get 429, and failed auth does not count', async () => {
  const handler = createMcpRouteHandler(deps({ limits: { perMinute: 1, perHour: 10 } }));
  const wrong = 'x'.repeat(40);
  assert.equal((await handler(post(wrong, initialize), ctx(wrong))).status, 401);
  assert.equal((await handler(post(KEY, initialize), ctx(KEY))).status, 200);
  const limited = await handler(post(KEY, initialize), ctx(KEY));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});
