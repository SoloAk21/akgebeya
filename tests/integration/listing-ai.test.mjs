import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { AuthError, digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';

const output = { en: { title: 'A home in Bole', description: 'A home with one bedroom and one bathroom in Bole.' },
  am: { title: 'በቦሌ የሚገኝ ቤት', description: 'በቦሌ የሚገኝ አንድ መኝታ ክፍል እና አንድ መታጠቢያ ያለው ቤት።' } };

test('AI listing copy is consented, private, version-bound, retry-safe and stored separately from source facts', async () => {
  const ids = Array.from({ length: 3 }, () => randomUUID()), tokens = ids.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000'; const listings = [];
  const startWindow = Math.floor(Date.now() / 3600000);
  let server, mode = 'success', calls = 0, unblock, announce;
  const factsSeen = [];
  const generator = { model: 'test-listing-model', async generate(facts) {
    calls++; factsSeen.push(facts);
    if (mode === 'failure') throw new AuthError(502, 'AI_UNAVAILABLE', 'Listing writing service is unavailable.');
    if (mode === 'invalid') return { en: { title: 'Incomplete provider result', description: 'Short' } };
    if (mode === 'wait') { announce(); await new Promise(resolve => { unblock = resolve; }); }
    return globalThis.structuredClone(output);
  } };
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined }), generator));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', index = 0, token = tokens[index], path = `/api/listings/${listings[index]?.id}/ai-content`,
    data, raw, contentType = 'application/json', requestOrigin = origin } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType, ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const input = (index = 0) => ({ version: listings[index].version, requestId: randomUUID(), consent: true });
  const source = index => call({ index, path: `/api/listings/${listings[index].id}` });
  const edit = (index, change = {}) => call({ index, method: 'PUT', path: `/api/listings/${listings[index].id}`, data: {
    version: listings[index].version, title: listings[index].title, transactionType: listings[index].transactionType,
    propertyType: listings[index].propertyType, description: 'A home with one bedroom and one bathroom.',
    priceEtb: '5000.00', areaSqm: '70.00', bedrooms: 1, bathrooms: 1, complete: true, ...change,
  } });
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `listing-ai-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
      location: { create: { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole',
        latitude: 8.995123, longitude: 38.785456, confirmed: true } },
    } });
    await start();
    for (let i = 0; i < ids.length; i++) {
      const created = await call({ index: i, method: 'POST', path: '/api/listings', data: {
        requestId: randomUUID(), title: 'Source home', transactionType: 'RENT', propertyType: 'HOUSE',
      } });
      assert.equal(created.status, 201); listings.push(created.body.listing);
    }
    assert.equal((await call({ method: 'POST', data: input() })).status, 409);
    assert.equal(calls, 0);
    for (let i = 0; i < ids.length; i++) { const complete = await edit(i); assert.equal(complete.status, 200); listings[i] = complete.body.listing; }
    const initial = await call(); assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { content: null, currentVersion: listings[0].version, stale: false });
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: tokens[1] })).status, 404);
    assert.equal((await call({ method: 'POST', data: input(), token: '' })).status, 401);
    assert.equal((await call({ method: 'POST', data: input(), token: tokens[1] })).status, 404);
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await call({ method: 'POST', data: input(), requestOrigin })).status, 403);
    for (const data of [null, [], {}, { ...input(), consent: false }, { ...input(), consent: 'true' },
      { ...input(), version: '2' }, { ...input(), requestId: 'invalid' }, { ...input(), model: 'forged' },
      { ...input(), title: 'forged' }, { ...input(), accountId: ids[1] }]) {
      assert.equal((await call({ method: 'POST', data })).status, 400);
    }
    assert.equal((await call({ method: 'POST', data: input(), contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'POST', raw: '{broken' })).status, 400);
    assert.equal((await call({ method: 'POST', raw: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call({ method: 'POST', data: { ...input(), version: 1 } })).status, 409);
    assert.equal(calls, 0);
    const request = input(); const generated = await call({ method: 'POST', data: request });
    assert.ok([200, 201].includes(generated.status));
    const stored = (await call()).body; assert.equal(stored.stale, false);
    assert.deepEqual(stored.content.en, output.en); assert.deepEqual(stored.content.am, output.am);
    assert.equal(stored.content.model, generator.model); assert.equal(stored.content.sourceVersion, listings[0].version);
    assert.ok(Number.isFinite(Date.parse(stored.content.generatedAt)));
    assert.deepEqual((await source(0)).body.listing, listings[0]); assert.equal(calls, 1);
    assert.equal((await call({ method: 'POST', data: request })).status, 200); assert.equal(calls, 1);
    assert.deepEqual((await call()).body, stored);
    // Provider facts must not contain account identifiers, credentials or exact device coordinates.
    const factsJson = JSON.stringify(factsSeen[0]);
    for (const forbidden of [ids[0], tokens[0], '8.995123', '38.785456', 'passwordHash']) assert.equal(factsJson.includes(forbidden), false);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body, stored);
    const changed = await edit(0, { title: 'Changed source title' }); assert.equal(changed.status, 200); listings[0] = changed.body.listing;
    const stale = (await call()).body; assert.equal(stale.stale, true); assert.deepEqual(stale.content, stored.content);
    assert.equal(stale.currentVersion, listings[0].version);
    assert.equal((await call({ method: 'POST', data: { ...request, version: listings[0].version } })).status, 409);

    // A source edit while the provider is working must prevent stale output from being persisted.
    mode = 'wait'; const started = new Promise(resolve => { announce = resolve; });
    const pending = call({ index: 1, method: 'POST', data: input(1) });
    await Promise.race([started, pending.then(result => { throw new Error(`Generation failed before reaching provider: ${result.status}`); })]);
    const busy = await call({ index: 1, method: 'POST', data: input(1) });
    assert.equal(busy.status, 429); assert.ok(Number(busy.headers.get('retry-after')) > 0);
    const newer = await edit(1, { title: 'Changed during generation' }); assert.equal(newer.status, 200); listings[1] = newer.body.listing;
    unblock(); const cancelled = await pending; assert.equal(cancelled.status, 409);
    assert.equal((await call({ index: 1 })).body.content, null);
    mode = 'failure';
    assert.equal((await call({ index: 1, method: 'POST', data: input(1) })).status, 502);
    assert.equal((await call({ index: 1 })).body.content, null);
    assert.deepEqual((await source(1)).body.listing, listings[1]);
    mode = 'invalid';
    assert.equal((await call({ index: 1, method: 'POST', data: input(1) })).status, 502);
    assert.equal((await call({ index: 1 })).body.content, null);
    mode = 'success';
    // Separate owner isolates the hourly quota from failure/race scenarios above.
    const quotaBefore = calls;
    let lastRequest;
    for (let i = 0; i < 5; i++) {
      lastRequest = input(2);
      assert.ok([200, 201].includes((await call({ index: 2, method: 'POST', data: lastRequest })).status));
    }
    const limited = await call({ index: 2, method: 'POST', data: input(2) });
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(calls, quotaBefore + 5);
    assert.equal((await call({ index: 2, method: 'POST', data: lastRequest })).status, 200);
    assert.equal(calls, quotaBefore + 5);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    assert.equal((await call({ method: 'POST', data: input() })).status, 403);
    assert.deepEqual((await call()).body.content, stored.content);
  } finally {
    unblock?.();
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    for (const listing of listings) {
      const [remaining] = await getDatabase().$queryRaw`SELECT count(*)::int AS total FROM akgebeya_foundation.listing_ai_content WHERE "listingId" = ${listing.id}::uuid`;
      assert.equal(remaining.total, 0);
    }
    const windows = new Set([startWindow, Math.floor(Date.now() / 3600000)]);
    await getDatabase().authAttempt.deleteMany({ where: { key: { in: ids.flatMap(id => [...windows].map(window => digest(`listing-ai:${id}:${window}`))) } } });
    await disconnectDatabase();
  }
});
