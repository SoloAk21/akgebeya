import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import sharp from 'sharp';
import { AuthError, digest } from './auth-security.js';
import { UUID } from './admin.js';
import type { PrismaClient } from './generated/prisma/client.js';

const INPUT_LIMIT = 8 * 1024 * 1024, OUTPUT_LIMIT = 1024 * 1024;
export class MediaError extends AuthError {
  constructor(status: number, code: string, message: string, public retryAfter = 5) { super(status, code, message); }
}
let uploads = 0;
export function acquireUploadSlot() {
  if (uploads >= 2) throw new MediaError(429, 'UPLOAD_BUSY', 'Photo processing is busy. Try again shortly.');
  uploads++; let released = false;
  return () => { if (!released) { released = true; uploads--; } };
}
export async function processImage(bytes: Buffer, contentType: string, signal?: AbortSignal) {
  if (!bytes.length || bytes.length > INPUT_LIMIT) throw new MediaError(413, 'PHOTO_TOO_LARGE', 'Choose a photo up to 8 MiB.');
  const format = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format || contentType !== `image/${format}`) throw new MediaError(415, 'INVALID_PHOTO_TYPE', 'Choose a JPEG, PNG, or WebP photo matching its file type.');
  // Some PNG decoders expose only the default APNG frame. Inspect the animation control chunk too.
  if (format === 'png') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) break;
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL' && length >= 8 && bytes.readUInt32BE(offset + 8) > 1) {
        throw new MediaError(415, 'INVALID_PHOTO_TYPE', 'Animated images are not supported. Choose a still photo.');
      }
      offset += length + 12;
    }
  }
  const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning', animated: false }).timeout({ seconds: 10 });
  const abort = () => { image.destroy(new Error('Photo processing cancelled')); };
  try {
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) throw new MediaError(415, 'INVALID_PHOTO_TYPE', 'Animated images are not supported. Choose a still photo.');
    const { data, info } = await image.rotate().flatten({ background: '#ffffff' })
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
    signal?.throwIfAborted();
    if (data.length > OUTPUT_LIMIT) throw new MediaError(413, 'PROCESSED_PHOTO_TOO_LARGE', 'This photo is too detailed to store. Choose a smaller photo.');
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (signal?.aborted) throw new MediaError(408, 'UPLOAD_CANCELLED', 'Photo upload was cancelled.');
    if (error instanceof MediaError) throw error;
    throw new MediaError(400, 'INVALID_PHOTO', 'The photo could not be safely processed. Choose a valid still image.');
  } finally { signal?.removeEventListener('abort', abort); image.destroy(); }
}
export function mediaDeleteInput(value: unknown): { version: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('version' in value)
    || !Number.isInteger(value.version) || (value.version as number) < 1 || (value.version as number) >= 2147483647) throw new MediaError(400, 'INVALID_MEDIA_INPUT', 'Reload the current photo version.');
  return { version: value.version as number };
}
export function mediaOrderInput(value: unknown): { version: number; mediaIds: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !('version' in value) || !('mediaIds' in value)
    || !Array.isArray(value.mediaIds) || value.mediaIds.length > 10 || value.mediaIds.some(id => typeof id !== 'string' || !UUID.test(id))) throw new MediaError(400, 'INVALID_MEDIA_INPUT', 'Send the full ordered list of photo IDs.');
  const version = mediaDeleteInput({ version: value.version }).version;
  const mediaIds = (value.mediaIds as string[]).map(id => id.toLowerCase());
  if (new Set(mediaIds).size !== mediaIds.length) throw new MediaError(400, 'INVALID_MEDIA_INPUT', 'Each photo must appear exactly once.');
  return { version, mediaIds };
}
type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
interface MediaRow { id: string; width: number; height: number; byteSize: number; createdAt: Date; position: number }
async function owner(database: Database, accountId: string, listingId: string, mutation = false, lock = false) {
  if (lock) await database.$queryRaw`SELECT id FROM akgebeya_foundation.account WHERE id = ${accountId}::uuid FOR UPDATE`;
  const providers = mutation ? await database.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR SHARE` : [];
  const rows = lock ? await database.$queryRaw<Array<{ mediaVersion: number }>>`
    SELECT "mediaVersion" FROM akgebeya_foundation.listing_draft WHERE id = ${listingId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`
    : await database.$queryRaw<Array<{ mediaVersion: number }>>`
    SELECT "mediaVersion" FROM akgebeya_foundation.listing_draft WHERE id = ${listingId}::uuid AND "accountId" = ${accountId}::uuid`;
  if (!rows[0]) throw new MediaError(404, 'LISTING_NOT_FOUND', 'Property not found.');
  if (mutation && providers[0]?.status !== 'APPROVED') throw new MediaError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to change photos.');
  return rows[0].mediaVersion;
}
async function snapshot(database: Database, listingId: string, version: number) {
  const rows = await database.$queryRaw<MediaRow[]>`
    SELECT id, width, height, "byteSize", "createdAt", position FROM akgebeya_foundation.listing_media
    WHERE "listingId" = ${listingId}::uuid ORDER BY position`;
  return { version, media: rows.map(row => ({ id: row.id, width: row.width, height: row.height,
    byteSize: row.byteSize, createdAt: row.createdAt, url: `/api/listings/${listingId}/media/${row.id}` })) };
}
export async function readMedia(database: PrismaClient, accountId: string, listingId: string) {
  return database.$transaction(async tx => {
    const version = await owner(tx, accountId, listingId, false, true);
    return snapshot(tx, listingId, version);
  });
}
export async function readMediaImage(database: PrismaClient, accountId: string, listingId: string, mediaId: string) {
  const [image] = await database.$queryRaw<Array<{ bytes: Uint8Array }>>`
    SELECT m.bytes FROM akgebeya_foundation.listing_media m JOIN akgebeya_foundation.listing_draft l ON l.id = m."listingId"
    WHERE m.id = ${mediaId}::uuid AND l.id = ${listingId}::uuid AND l."accountId" = ${accountId}::uuid`;
  if (!image) throw new MediaError(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
  return Buffer.from(image.bytes);
}
async function uploadBody(request: IncomingMessage, signal: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const timer = setTimeout(() => fail(new MediaError(408, 'UPLOAD_TIMEOUT', 'Photo upload timed out. Try again.')), 15000);
    function clean() { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted); signal.removeEventListener('abort', aborted); }
    function fail(error: unknown) { clean(); request.resume(); reject(error); }
    function aborted() { fail(new MediaError(408, 'UPLOAD_CANCELLED', 'Photo upload was cancelled.')); }
    function data(chunk: Buffer) { size += chunk.length; if (size > INPUT_LIMIT) fail(new MediaError(413, 'PHOTO_TOO_LARGE', 'Choose a photo up to 8 MiB.')); else chunks.push(chunk); }
    function end() { clean(); resolve(Buffer.concat(chunks)); }
    if (signal.aborted || request.aborted) { aborted(); return; }
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', aborted); signal.addEventListener('abort', aborted, { once: true });
  });
}
export async function uploadMedia(database: PrismaClient, accountId: string, listingId: string, request: IncomingMessage, signal: AbortSignal) {
  await owner(database, accountId, listingId, true);
  const requestId = request.headers['x-upload-id'];
  const contentType = request.headers['content-type'];
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new MediaError(400, 'INVALID_UPLOAD_ID', 'Send a valid upload ID.');
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new MediaError(415, 'INVALID_PHOTO_TYPE', 'Choose a JPEG, PNG, or WebP photo.');
  const release = acquireUploadSlot();
  try {
    const window = Math.floor(Date.now() / 3600000), expiresAt = new Date((window + 1) * 3600000);
    await database.authAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const key = digest(`media:${accountId}:${window}`);
    const attempt = await database.authAttempt.upsert({ where: { key }, create: { key, count: 1, expiresAt }, update: { count: { increment: 1 } } });
    if (attempt.count > 30) throw new MediaError(429, 'UPLOAD_RATE_LIMITED', 'Too many photo uploads. Try again next hour.', Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)));
    const raw = await uploadBody(request, signal);
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const processed = await processImage(raw, contentType, signal);
    signal.throwIfAborted();
    return await database.$transaction(async tx => {
      const version = await owner(tx, accountId, listingId, true, true);
      const [existing] = await tx.$queryRaw<Array<{ sha256: string }>>`
        SELECT sha256 FROM akgebeya_foundation.listing_media WHERE "listingId" = ${listingId}::uuid AND "requestId" = ${requestId}::uuid`;
      if (existing) {
        if (existing.sha256 !== sha256) throw new MediaError(409, 'UPLOAD_CONFLICT', 'This upload ID was already used for another photo.');
        return { created: false, ...await snapshot(tx, listingId, version) };
      }
      const [count] = await tx.$queryRaw<Array<{ total: bigint }>>`SELECT count(*) AS total FROM akgebeya_foundation.listing_media WHERE "listingId" = ${listingId}::uuid`;
      const position = Number(count?.total ?? 0);
      if (position >= 10) throw new MediaError(409, 'PHOTO_LIMIT_REACHED', 'Each property can have up to 10 photos.');
      await tx.$executeRaw`INSERT INTO akgebeya_foundation.listing_media
        (id, "listingId", "requestId", sha256, position, width, height, "byteSize", bytes)
        VALUES (${randomUUID()}::uuid, ${listingId}::uuid, ${requestId}::uuid, ${sha256}, ${position}, ${processed.width}, ${processed.height}, ${processed.bytes.length}, ${processed.bytes})`;
      await tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET "mediaVersion" = "mediaVersion" + 1 WHERE id = ${listingId}::uuid`;
      return { created: true, ...await snapshot(tx, listingId, version + 1) };
    });
  } finally { release(); }
}
export async function orderMedia(database: PrismaClient, accountId: string, listingId: string, input: ReturnType<typeof mediaOrderInput>) {
  return database.$transaction(async tx => {
    const version = await owner(tx, accountId, listingId, true, true);
    if (version !== input.version) throw new MediaError(409, 'MEDIA_VERSION_CONFLICT', 'Photos changed. Reload before saving again.');
    const current = await snapshot(tx, listingId, version);
    if (current.media.length !== input.mediaIds.length || current.media.some(photo => !input.mediaIds.includes(photo.id))) throw new MediaError(400, 'INVALID_MEDIA_INPUT', 'Include every current photo exactly once.');
    if (current.media.every((photo, i) => photo.id === input.mediaIds[i])) return current;
    await tx.$executeRaw`UPDATE akgebeya_foundation.listing_media m SET position = (ordered.ordinality - 1)::integer
      FROM unnest(${input.mediaIds}::uuid[]) WITH ORDINALITY AS ordered(id, ordinality)
      WHERE m.id = ordered.id AND m."listingId" = ${listingId}::uuid`;
    await tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET "mediaVersion" = "mediaVersion" + 1 WHERE id = ${listingId}::uuid`;
    return snapshot(tx, listingId, version + 1);
  });
}
export async function deleteMedia(database: PrismaClient, accountId: string, listingId: string, mediaId: string, input: ReturnType<typeof mediaDeleteInput>) {
  return database.$transaction(async tx => {
    const version = await owner(tx, accountId, listingId, true, true);
    if (version !== input.version) throw new MediaError(409, 'MEDIA_VERSION_CONFLICT', 'Photos changed. Reload before saving again.');
    const deleted = await tx.$executeRaw`DELETE FROM akgebeya_foundation.listing_media WHERE id = ${mediaId}::uuid AND "listingId" = ${listingId}::uuid`;
    if (!deleted) throw new MediaError(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
    await tx.$executeRaw`UPDATE akgebeya_foundation.listing_media m SET position = ordered.position
      FROM (SELECT id, (row_number() OVER (ORDER BY position) - 1)::integer AS position FROM akgebeya_foundation.listing_media WHERE "listingId" = ${listingId}::uuid) ordered
      WHERE m.id = ordered.id`;
    await tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET "mediaVersion" = "mediaVersion" + 1 WHERE id = ${listingId}::uuid`;
    return snapshot(tx, listingId, version + 1);
  });
}
