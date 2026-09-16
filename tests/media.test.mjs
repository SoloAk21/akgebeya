import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { processImage, mediaOrderInput, mediaDeleteInput, acquireUploadSlot } from '../apps/api/src/media.ts';

const fixture = (width = 40, height = 30) => sharp({ create: { width, height, channels: 3, background: '#1267a3' } });

test('media processor validates actual formats and emits resized, oriented JPEG without source metadata', async () => {
  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const input = await fixture().toFormat(format).toBuffer();
    const result = await processImage(input, mime);
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, result.width); assert.equal(meta.height, result.height);
    assert.equal(meta.width, 40); assert.equal(meta.height, 30); assert.ok(result.bytes.length <= 1024 * 1024);
    assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
  }
  const rotated = await fixture(2400, 1200).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Private test identity' } } }).toBuffer();
  const result = await processImage(rotated, 'image/jpeg');
  assert.equal(result.width, 800); assert.equal(result.height, 1600);
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.orientation, undefined); assert.equal(meta.exif, undefined);
  assert.equal(result.bytes.includes(Buffer.from('Private test identity')), false);
});

test('media processor rejects spoofed, corrupt, oversized and unsupported files', async () => {
  const png = await fixture().png().toBuffer();
  const tooManyPixels = await fixture(5001, 5000).png().toBuffer();
  for (const [bytes, contentType] of [[png, 'image/jpeg'], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
    [Buffer.from('not an image'), 'image/png'], [png.subarray(0, 20), 'image/png'], [Buffer.alloc(0), 'image/jpeg'],
    [Buffer.alloc(8 * 1024 * 1024 + 1), 'image/jpeg'], [tooManyPixels, 'image/png']]) {
    await assert.rejects(processImage(bytes, contentType), error => [400, 413, 415].includes(error.status));
  }
  const aborted = new globalThis.AbortController(); aborted.abort();
  await assert.rejects(processImage(png, 'image/png', aborted.signal));
});

test('media order and deletion accept exact versioned payloads and reject forged or repeated identifiers', () => {
  const ids = [randomUUID(), randomUUID()];
  assert.deepEqual(mediaOrderInput({ version: 1, mediaIds: ids }), { version: 1, mediaIds: ids });
  assert.deepEqual(mediaDeleteInput({ version: 1 }), { version: 1 });
  for (const value of [null, [], {}, { version: 1, mediaIds: [ids[0], ids[0]] }, { version: 1, mediaIds: ['invalid'] },
    { version: '1', mediaIds: ids }, { version: -1, mediaIds: ids }, { version: 1.5, mediaIds: ids },
    { version: 1, mediaIds: ids, accountId: randomUUID() }, { version: 1, mediaIds: Array.from({ length: 11 }, () => randomUUID()) }]) {
    assert.throws(() => mediaOrderInput(value), error => error.status === 400);
  }
  for (const value of [null, [], {}, { version: '1' }, { version: -1 }, { version: 1.5 }, { version: 1, mediaId: ids[0] }]) {
    assert.throws(() => mediaDeleteInput(value), error => error.status === 400);
  }
});

test('photo processing concurrency is bounded and releasing a slot twice does not bypass the limit', () => {
  const first = acquireUploadSlot(), second = acquireUploadSlot();
  try {
    assert.throws(acquireUploadSlot, error => error.status === 429 && error.retryAfter > 0);
    first(); first();
    const replacement = acquireUploadSlot();
    try { assert.throws(acquireUploadSlot, error => error.status === 429); } finally { replacement(); }
  } finally { first(); second(); }
});
