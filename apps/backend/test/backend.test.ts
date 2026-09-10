import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { errorHandler } from '../src/errors.js';

import { withServer } from './helpers.js';
import { createAuthFixture } from './auth-fixture.js';

const app = () => createApp(parseConfig({ NODE_ENV: 'test' }), createAuthFixture().service);

test('health returns HTTP 200 JSON with security headers', async () => {
  await withServer(app(), async (base) => {
    const response = await fetch(`${base}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('unknown paths and unsupported methods return JSON 404', async () => {
  await withServer(app(), async (base) => {
    for (const [path, method] of [['/health', 'GET'], ['/api/v1/missing', 'GET'], ['/api/v1/health', 'POST']]) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
  });
});

test('CORS allows configured origins and omits permission for others', async () => {
  await withServer(createApp(parseConfig({ CORS_ORIGINS: 'https://example.com' }), createAuthFixture().service), async (base) => {
    for (const origin of ['https://example.com', 'https://untrusted.example']) {
      const response = await fetch(`${base}/api/v1/health`, { headers: { origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), origin === 'https://example.com' ? origin : null);
      await response.arrayBuffer();
    }
  });
  await withServer(app(), async (base) => {
    const response = await fetch(`${base}/api/v1/health`, { headers: { origin: 'https://example.com' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await response.arrayBuffer();
  });
});

test('invalid and oversized JSON receive safe errors', async () => {
  await withServer(app(), async (base) => {
    for (const [body, status, code] of [
      ['{secret', 400, 'INVALID_JSON'],
      [JSON.stringify({ data: 'x'.repeat(17000) }), 413, 'PAYLOAD_TOO_LARGE'],
    ] as const) {
      const response = await fetch(`${base}/api/v1/health`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      });
      assert.equal(response.status, status);
      const result = await response.json() as { error: { code: string } };
      assert.equal(result.error.code, code);
      assert.equal(JSON.stringify(result).includes('secret'), false);
    }
  });
});

test('unexpected errors return a generic 500 without leaking details', async (context) => {
  context.mock.method(console, 'error', () => {});
  const failingApp = express();
  failingApp.get('/failure', async () => { throw new Error('private database credentials'); });
  failingApp.use(errorHandler);
  await withServer(failingApp, async (base) => {
    const response = await fetch(`${base}/failure`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
});

test('configuration validates input without exposing invalid values', () => {
  const config = parseConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.apiPrefix, '/api/v1');
  assert.deepEqual(config.corsOrigins, []);
  for (const PORT of ['', '0', '-1', '65536', '1.5', 'abc']) {
    assert.throws(() => parseConfig({ PORT }), /Invalid environment configuration: PORT/);
  }
  assert.throws(() => parseConfig({ NODE_ENV: 'invalid' }), /NODE_ENV/);
  assert.throws(() => parseConfig({ HOST: ' ' }), /HOST/);
  for (const CORS_ORIGINS of ['*', 'file:///tmp', 'https://example.com/path', 'https://user:secret@example.com']) {
    assert.throws(() => parseConfig({ CORS_ORIGINS }), { message: 'Invalid environment configuration: CORS_ORIGINS' });
  }
  assert.deepEqual(parseConfig({ CORS_ORIGINS: 'https://example.com/, http://localhost:5173' }).corsOrigins,
    ['https://example.com', 'http://localhost:5173']);
});
