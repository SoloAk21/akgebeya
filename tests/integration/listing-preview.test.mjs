import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';

test('owner preview combines exact source facts, ordered photos and versioned copy without mutating or disclosing private account data', async () => {
  const ids = [randomUUID(), randomUUID()], tokens = ids.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000'; const requestIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const title = '<b>Literal property title</b>', displayName = '<b>Literal provider name</b>';
  const location = { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole', latitude: 8.995123, longitude: 38.785456 };
  const copy = { en: { title: 'Preview fixture home', description: 'Synthetic English copy for a private preview fixture.' },
    am: { title: 'የሙከራ ቤት', description: 'ይህ ለግል ቅድመ እይታ ሙከራ የተዘጋጀ የቤት መግለጫ ነው።' } };
  let server, listing, aiCalls = 0;
  const generator = { model: 'unused-preview-test', async generate() { aiCalls++; throw new Error('Preview must not generate text'); } };
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined }), generator));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], path = `/api/listings/${listing?.id}/preview`, data } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function storage() {
    return {
      listing: await getDatabase().listingDraft.findUniqueOrThrow({ where: { id: listing.id } }),
      media: await getDatabase().listingMedia.findMany({ where: { listingId: listing.id }, orderBy: { position: 'asc' } }),
      copy: await getDatabase().listingAiContent.findUnique({ where: { listingId: listing.id } }),
    };
  }
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `preview-${id}@example.test`, displayName, passwordHash: 'preview-test-only-secret-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
      location: { create: { ...location, confirmed: true } },
    } });
    await start();
    const created = await call({ method: 'POST', path: '/api/listings', data: {
      requestId: requestIds[0], title, transactionType: 'SALE', propertyType: 'HOUSE',
    } });
    assert.equal(created.status, 201); listing = created.body.listing;
    const draft = await call(); assert.equal(draft.status, 200);
    assert.deepEqual(Object.keys(draft.body).sort(), ['listing', 'media', 'mediaVersion', 'copy', 'copyStale', 'provider'].sort());
    assert.deepEqual(draft.body.listing, listing); assert.deepEqual(draft.body.media, []);
    assert.equal(draft.body.copy, null); assert.equal(draft.body.copyStale, false); assert.equal(draft.body.mediaVersion, 1);
    assert.deepEqual(draft.body.provider, { displayName, providerType: 'OWNER' });
    assert.equal(draft.headers.get('cache-control'), 'no-store');
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: sessionToken() })).status, 401);
    assert.equal((await call({ token: tokens[1] })).status, 404);
    assert.equal((await call({ path: `/api/listings/${randomUUID()}/preview` })).status, 404);
    assert.equal((await call({ path: '/api/listings/not-a-uuid/preview' })).status, 400);
    const wrongMethod = await call({ method: 'POST' }); assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    const edited = await call({ method: 'PUT', path: `/api/listings/${listing.id}`, data: {
      version: listing.version, title, description: '<script>Literal source description</script>', transactionType: 'SALE', propertyType: 'HOUSE',
      priceEtb: '999999999999.99', areaSqm: '75.50', bedrooms: 1, bathrooms: 1, complete: true,
    } });
    assert.equal(edited.status, 200); listing = edited.body.listing;
    // Synthetic media fixtures are stored directly; no cloud image or AI calls are involved.
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#314159' } }).jpeg().toBuffer();
    const photoIds = [randomUUID(), randomUUID()];
    for (const [position, id] of photoIds.entries()) await getDatabase().listingMedia.create({ data: {
      id, listingId: listing.id, requestId: requestIds[position + 1], sha256: digest(bytes), position,
      width: 20, height: 10, byteSize: bytes.length, bytes,
    } });
    await getDatabase().listingDraft.update({ where: { id: listing.id }, data: { mediaVersion: 3 } });
    await getDatabase().listingAiContent.create({ data: {
      listingId: listing.id, requestId: requestIds[3], sourceVersion: listing.version, copy, model: 'preview-fixture-model',
    } });
    const before = await storage(); const preview = await call();
    assert.equal(preview.status, 200); assert.deepEqual(preview.body.listing, listing);
    assert.equal(preview.body.listing.title, title); assert.equal(preview.body.listing.description, '<script>Literal source description</script>');
    for (const [key, value] of Object.entries(location)) assert.equal(preview.body.listing.location[key], value);
    assert.equal(preview.body.listing.priceEtb, '999999999999.99'); assert.equal(preview.body.mediaVersion, 3);
    assert.deepEqual(preview.body.media.map(item => item.id), photoIds);
    for (const photo of preview.body.media) {
      assert.deepEqual(Object.keys(photo).sort(), ['id', 'url', 'width', 'height', 'byteSize', 'createdAt'].sort());
      assert.equal(photo.url, `/api/listings/${listing.id}/media/${photo.id}`);
    }
    assert.deepEqual(preview.body.copy.en, copy.en); assert.deepEqual(preview.body.copy.am, copy.am);
    assert.equal(preview.body.copy.sourceVersion, listing.version); assert.equal(preview.body.copyStale, false);
    assert.equal(preview.body.copy.model, 'preview-fixture-model'); assert.ok(Number.isFinite(Date.parse(preview.body.copy.generatedAt)));
    const responseText = JSON.stringify(preview.body);
    for (const secret of [...ids, ...tokens, ...requestIds, 'preview-test-only-secret-hash', '@example.test', 'passwordHash', 'tokenHash', 'reviewerId', 'isAdmin', 'creationPayload', 'sha256', '"bytes"']) {
      assert.equal(responseText.includes(secret), false, `Preview exposes forbidden field or fixture identifier: ${secret}`);
    }
    assert.deepEqual((await call()).body, preview.body); assert.deepEqual(await storage(), before); assert.equal(aiCalls, 0);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body, preview.body); assert.deepEqual(await storage(), before);
    const ordered = await call({ method: 'PUT', path: `/api/listings/${listing.id}/media`, data: { version: 3, mediaIds: [...photoIds].reverse() } });
    assert.equal(ordered.status, 200);
    const afterOrder = (await call()).body; assert.deepEqual(afterOrder.media.map(item => item.id), [...photoIds].reverse());
    assert.equal(afterOrder.mediaVersion, 4); assert.deepEqual(afterOrder.listing, listing); assert.equal(afterOrder.copyStale, false);
    const updated = await call({ method: 'PUT', path: `/api/listings/${listing.id}`, data: {
      version: listing.version, title: 'Updated preview title', description: listing.description, transactionType: 'SALE', propertyType: 'HOUSE',
      priceEtb: listing.priceEtb, areaSqm: listing.areaSqm, bedrooms: 1, bathrooms: 1, complete: true,
    } });
    assert.equal(updated.status, 200); listing = updated.body.listing;
    const stale = (await call()).body; assert.deepEqual(stale.listing, listing); assert.equal(stale.copyStale, true);
    assert.deepEqual(stale.copy, preview.body.copy);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    assert.deepEqual((await call()).body, stale); assert.equal(aiCalls, 0);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call()).status, 401);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
});
