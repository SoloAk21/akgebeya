import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';
import { Prisma } from '../../apps/api/src/generated/prisma/client.ts';

test('private listing photos preserve ownership, idempotency, order and versions across uploads, edits and restart', async () => {
  const ids = [randomUUID(), randomUUID()]; const tokens = ids.map(() => sessionToken());
  const startWindow = Math.floor(Date.now() / 3600000);
  const origin = 'http://127.0.0.1:3000';
  const red = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#dc2626' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 100, height: 70, channels: 3, background: '#2563eb' } }).webp().toBuffer();
  let server; let path = '/api/listings'; let listing;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined })));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], requestPath = path, data, raw, contentType = 'application/json',
    requestOrigin = origin, uploadId } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType, ...(token ? { Cookie: `akgebeya_session=${token}` } : {}),
        ...(uploadId === undefined ? {} : { 'X-Upload-Id': uploadId }) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    const binary = response.headers.get('content-type')?.startsWith('image/');
    return { status: response.status, headers: response.headers,
      body: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  }
  const upload = options => call({ method: 'POST', raw: red, contentType: 'image/png', uploadId: randomUUID(), ...options });
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `media-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
      location: { create: { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole',
        latitude: 8.995123, longitude: 38.785456, confirmed: true } },
    } });
    await start();
    const created = await call({ method: 'POST', data: { requestId: randomUUID(), title: 'Photo test home', transactionType: 'RENT', propertyType: 'HOUSE' } });
    assert.equal(created.status, 201); listing = created.body.listing;
    const listingPath = `/api/listings/${listing.id}`; path = `${listingPath}/media`;
    const initial = await call(); assert.equal(initial.status, 200); assert.deepEqual(initial.body.media, []);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: tokens[1] })).status, 404);
    assert.equal((await upload({ token: '' })).status, 401);
    assert.equal((await upload({ token: tokens[1] })).status, 404);
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await upload({ requestOrigin })).status, 403);
    for (const uploadId of [undefined, '', 'invalid']) assert.equal((await upload({ uploadId })).status, 400);
    assert.equal((await upload({ contentType: 'image/svg+xml', raw: Buffer.from('<svg/>') })).status, 415);
    assert.equal((await upload({ raw: Buffer.from('not a photo') })).status, 415);
    assert.equal((await upload({ contentType: 'image/jpeg' })).status, 415);
    assert.equal((await upload({ raw: Buffer.alloc(8 * 1024 * 1024 + 1) })).status, 413);
    assert.deepEqual((await call()).body, initial.body);

    const uploadId = randomUUID();
    const race = await Promise.all([upload({ uploadId }), upload({ uploadId })]);
    assert.equal(race.filter(result => result.status === 201).length, 1);
    assert.equal(race.filter(result => result.status === 200).length, 1);
    let gallery = race[0].body;
    assert.deepEqual(race[1].body, gallery); assert.equal(gallery.media.length, 1);
    assert.equal(gallery.version, initial.body.version + 1);
    const first = gallery.media[0];
    assert.equal(first.width, 80); assert.equal(first.height, 60); assert.ok(first.byteSize <= 1024 * 1024);
    assert.ok(Number.isFinite(Date.parse(first.createdAt)));
    const photo = await call({ requestPath: first.url });
    assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.equal(photo.headers.get('cache-control'), 'no-store');
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(photo.body.length, first.byteSize); assert.equal((await sharp(photo.body).metadata()).format, 'jpeg');
    assert.equal((await call({ requestPath: first.url, token: '' })).status, 401);
    assert.equal((await call({ requestPath: first.url, token: tokens[1] })).status, 404);
    assert.equal((await upload({ uploadId, raw: blue, contentType: 'image/webp' })).status, 409);
    assert.deepEqual((await upload({ uploadId })).body, gallery);
    const second = await upload({ raw: blue, contentType: 'image/webp' });
    assert.equal(second.status, 201); gallery = second.body;
    const originalOrder = gallery.media.map(item => item.id);
    assert.equal((await call({ method: 'PUT', data: { version: gallery.version - 1, mediaIds: [...originalOrder].reverse() } })).status, 409);
    assert.equal((await call({ method: 'PUT', data: { version: gallery.version, mediaIds: [originalOrder[0]] } })).status, 400);
    assert.equal((await call({ method: 'PUT', data: { version: gallery.version, mediaIds: [originalOrder[0], randomUUID()] } })).status, 400);
    const noop = await call({ method: 'PUT', data: { version: gallery.version, mediaIds: originalOrder } });
    assert.deepEqual(noop.body, gallery);
    const reordered = await call({ method: 'PUT', data: { version: gallery.version, mediaIds: [...originalOrder].reverse() } });
    assert.equal(reordered.status, 200); assert.equal(reordered.body.version, gallery.version + 1); gallery = reordered.body;
    assert.deepEqual(gallery.media.map(item => item.id), [...originalOrder].reverse());
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body, gallery);
    const deletePath = `${path}/${first.id}`;
    assert.equal((await call({ method: 'DELETE', requestPath: deletePath, data: { version: gallery.version - 1 } })).status, 409);
    assert.equal((await call({ method: 'DELETE', requestPath: deletePath, data: { version: gallery.version }, token: tokens[1] })).status, 404);
    const deleted = await call({ method: 'DELETE', requestPath: deletePath, data: { version: gallery.version } });
    assert.equal(deleted.status, 200); assert.equal(deleted.body.media.length, 1); gallery = deleted.body;
    assert.equal((await call({ requestPath: first.url })).status, 404);
    assert.deepEqual((await call({ requestPath: listingPath })).body.listing, listing);
    // Fill to nine, then compete for the final slot without exceeding the cap.
    for (let i = 0; i < 8; i++) { const result = await upload(); assert.equal(result.status, 201); gallery = result.body; }
    const cap = await Promise.all([upload(), upload()]);
    assert.equal(cap.filter(result => result.status === 201).length, 1);
    assert.equal(cap.filter(result => result.status === 409).length, 1);
    gallery = (await call()).body; assert.equal(gallery.media.length, 10);
    await checkConstraints(getDatabase(), gallery.media[0].id);
    assert.deepEqual((await call({ requestPath: listingPath })).body.listing, listing);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    assert.equal((await upload()).status, 403);
    assert.equal((await call({ method: 'PUT', data: { version: gallery.version, mediaIds: gallery.media.map(item => item.id) } })).status, 403);
    assert.equal((await call({ method: 'DELETE', requestPath: `${path}/${gallery.media[0].id}`, data: { version: gallery.version } })).status, 403);
    assert.deepEqual((await call()).body, gallery);
    assert.equal((await call({ requestPath: gallery.media[0].url })).status, 200);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    const windows = new Set([startWindow, Math.floor(Date.now() / 3600000)]);
    await getDatabase().authAttempt.deleteMany({ where: { key: { in: ids.flatMap(id => [...windows].map(window => digest(`media:${id}:${window}`))) } } });
    if (listing) {
      const [remaining] = await getDatabase().$queryRaw`SELECT count(*)::int AS total FROM akgebeya_foundation.listing_media WHERE "listingId" = ${listing.id}::uuid`;
      assert.equal(remaining.total, 0);
    }
    await disconnectDatabase();
  }
});

async function checkConstraints(db, id) {
  async function rejects(operation, expected) {
    const rollback = new Error('Media constraint accepted invalid data');
    await assert.rejects(db.$transaction(async tx => {
      await operation(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; throw rollback;
    }), error => {
      assert.notEqual(error, rollback); assert.equal(error.code, 'P2010');
      assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, expected); return true;
    });
  }
  for (const change of [Prisma.sql`position = 10`, Prisma.sql`width = 0`, Prisma.sql`height = 1601`,
    Prisma.sql`"byteSize" = 0`, Prisma.sql`"byteSize" = "byteSize" + 1`, Prisma.sql`bytes = ''::bytea`, Prisma.sql`sha256 = 'bad'`]) {
    await rejects(tx => tx.$executeRaw`UPDATE akgebeya_foundation.listing_media SET ${change} WHERE id = ${id}::uuid`, '23514');
  }
  await rejects(tx => tx.$executeRaw`UPDATE akgebeya_foundation.listing_media SET "listingId" = ${randomUUID()}::uuid WHERE id = ${id}::uuid`, '23503');
  await rejects(tx => tx.$executeRaw`
    INSERT INTO akgebeya_foundation.listing_media (id, "listingId", "requestId", sha256, position, width, height, "byteSize", bytes)
    SELECT ${randomUUID()}::uuid, "listingId", "requestId", sha256, position, width, height, "byteSize", bytes
    FROM akgebeya_foundation.listing_media WHERE id = ${id}::uuid`, '23505');
}
