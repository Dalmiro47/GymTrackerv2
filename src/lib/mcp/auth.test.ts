import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, isValidAccessKey, readMcpConfig, unauthorized, type AuthDeps } from './auth';

// Fake values only: nothing here is a real key or uid.
const KEY = 'k'.repeat(40);
const OWNER = 'fake-owner';

const deps = (over: Partial<AuthDeps['env']> = {}, adminConfigured = true): AuthDeps => ({
  env: { MCP_ACCESS_KEY: KEY, MCP_OWNER_UID: OWNER, ...over },
  isAdminConfigured: () => adminConfigured,
});

test('readMcpConfig: full config returns the owner', () => {
  assert.deepEqual(readMcpConfig(deps()), { accessKey: KEY, ownerUid: OWNER });
});

test('readMcpConfig: missing key fails closed', () => {
  assert.equal(readMcpConfig(deps({ MCP_ACCESS_KEY: undefined })), null);
  assert.equal(readMcpConfig(deps({ MCP_ACCESS_KEY: '   ' })), null);
});

test('readMcpConfig: missing owner uid fails closed', () => {
  assert.equal(readMcpConfig(deps({ MCP_OWNER_UID: undefined })), null);
  assert.equal(readMcpConfig(deps({ MCP_OWNER_UID: '' })), null);
});

test('readMcpConfig: an owner uid with a slash fails closed', () => {
  assert.equal(readMcpConfig(deps({ MCP_OWNER_UID: 'a/b' })), null);
});

test('readMcpConfig: a key of 31 chars fails closed, 32 passes', () => {
  assert.equal(readMcpConfig(deps({ MCP_ACCESS_KEY: 'k'.repeat(31) })), null);
  assert.notEqual(readMcpConfig(deps({ MCP_ACCESS_KEY: 'k'.repeat(32) })), null);
});

test('readMcpConfig: admin SDK not configured fails closed', () => {
  assert.equal(readMcpConfig(deps({}, false)), null);
});

test('isValidAccessKey: right key only', () => {
  assert.equal(isValidAccessKey(KEY, KEY), true);
  assert.equal(isValidAccessKey('x'.repeat(40), KEY), false); // same length
  assert.equal(isValidAccessKey('k'.repeat(39), KEY), false); // other length
  assert.equal(isValidAccessKey(KEY + 'k', KEY), false);
  assert.equal(isValidAccessKey('', KEY), false);
  assert.equal(isValidAccessKey(undefined, KEY), false);
  assert.equal(isValidAccessKey(null, KEY), false);
});

test('authorize: right key returns only the owner uid from env', () => {
  assert.deepEqual(authorize(KEY, deps()), { ownerUid: OWNER });
});

test('authorize: every failure returns null', () => {
  assert.equal(authorize('x'.repeat(40), deps()), null);
  assert.equal(authorize(undefined, deps()), null);
  assert.equal(authorize(KEY, deps({ MCP_ACCESS_KEY: undefined })), null);
  assert.equal(authorize(KEY, deps({ MCP_OWNER_UID: undefined })), null);
  assert.equal(authorize(KEY, deps({}, false)), null);
  // A short configured key is refused even when the caller presents it.
  assert.equal(authorize('short', deps({ MCP_ACCESS_KEY: 'short' })), null);
});

test('unauthorized: 401, fixed body, never cached', async () => {
  const a = unauthorized();
  const b = unauthorized();
  assert.equal(a.status, 401);
  assert.equal(a.headers.get('cache-control'), 'no-store');
  const body = await a.text();
  assert.equal(body, '{"error":"unauthorized"}');
  assert.equal(await b.text(), body);
});
