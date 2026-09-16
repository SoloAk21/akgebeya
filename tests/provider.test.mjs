import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { providerInput } from '../apps/api/src/provider.ts';
import { createHealthServer } from '../apps/api/src/server.ts';
import { createAuthHandler } from '../apps/api/src/auth.ts';

test('provider type is an exact allowlist with no client-controlled status or account', () => {
  for (const providerType of ['OWNER', 'BROKER', 'AGENT', 'AGENCY', 'DEVELOPER']) {
    assert.deepEqual(providerInput({ providerType }), { providerType });
  }
  for (const value of [null, [], {}, 'OWNER', { providerType: 1 }, { providerType: 'owner' },
    { providerType: 'ADMIN' }, { providerType: ' OWNER ' }, { providerType: '' },
    { providerType: 'OWNER', status: 'APPROVED' }, { providerType: 'OWNER', accountId: 'other' }]) {
    assert.throws(() => providerInput(value), error => error.status === 400);
  }
});

test('provider infrastructure errors are sanitized and not cached', async () => {
  const server = createHealthServer(undefined, createAuthHandler(() => { throw new Error('private database details'); },
    { origin: 'http://127.0.0.1:3000', secure: false }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/provider-application`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.match(body, /SERVICE_UNAVAILABLE/);
    assert.doesNotMatch(body, /private database details/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
