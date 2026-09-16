import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient } from './generated/prisma/client.js';
import { profileInput } from './profile.js';
import { locationInput, locationOptions, readLocation, saveLocation } from './location.js';
import { geocoder, GeocodingError, limitGeocoding, reverseInput, searchInput, type Geocoder } from './geocoding.js';
import { applicationFields, applyAsProvider, providerInput } from './provider.js';
import { decideApplication, readApplication, reviewInput, reviewQueue, UUID } from './admin.js';
import { createListing, editListing, listingInput, listListings, readListing } from './listing.js';
import { listingEditInput, ListingValidationError } from './listing-validation.js';
import { deleteMedia, mediaDeleteInput, mediaOrderInput, MediaError, orderMedia, readMedia, readMediaImage, uploadMedia } from './media.js';
import { AuthError, credentials, digest, hashPassword, sessionToken, tokenFromCookie, verifyPassword } from './auth-security.js';

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const publicAccount = { id: true, email: true } as const;

export interface AuthOptions { origin: string; secure: boolean }
export function authOptions(): AuthOptions {
  const production = process.env['NODE_ENV'] === 'production';
  const origin = process.env['AUTH_ORIGIN'] ?? (production ? '' : 'http://127.0.0.1:3000');
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('Set AUTH_ORIGIN to the exact application origin.'); }
  if (url.origin !== origin || url.username || url.password || (production && url.protocol !== 'https:')
    || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid AUTH_ORIGIN configuration.');
  return { origin, secure: url.protocol === 'https:' };
}

async function body(request: IncomingMessage, limit = 4096) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AuthError(415, 'JSON_REQUIRED', 'Send JSON data.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > limit) {
      request.resume();
      throw new AuthError(413, 'BODY_TOO_LARGE', 'Request is too large.');
    }
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new AuthError(400, 'INVALID_JSON', 'Send valid JSON data.'); }
}

async function throttle(database: PrismaClient, ip: string, email: string) {
  const window = Math.floor(Date.now() / WINDOW_MS);
  const expiresAt = new Date((window + 1) * WINDOW_MS);
  // Persistent atomic counters survive restarts and multiple API instances.
  const counters = await database.$transaction(async tx => {
    await tx.authAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return Promise.all([`ip:${ip}`, `email:${email}`].map(value => tx.authAttempt.upsert({
      where: { key: digest(`${window}:${value}`) },
      create: { key: digest(`${window}:${value}`), count: 1, expiresAt },
      update: { count: { increment: 1 } },
    })));
  });
  if (counters[0]!.count > 30 || counters[1]!.count > 10) {
    throw new AuthError(429, 'RATE_LIMITED', 'Too many attempts. Please try again in 15 minutes.');
  }
}

export function createAuthHandler(getDatabase: () => PrismaClient, options: AuthOptions, lookup: Geocoder = geocoder) {
  const cookieName = options.secure ? '__Host-akgebeya_session' : 'akgebeya_session';
  const cookie = (token: string, seconds: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${options.secure ? '; Secure' : ''}`;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url?.split('?')[0];
    const send = (status: number, data: unknown) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    response.once('close', cancel);
    try {
      const isProfile = path === '/api/profile';
      const isListings = path === '/api/listings';
      const mediaMatch = path?.match(/^\/api\/listings\/([^/]+)\/media(?:\/([^/]+))?$/);
      const mediaListingId = mediaMatch?.[1], mediaId = mediaMatch?.[2];
      if (mediaListingId && (!UUID.test(mediaListingId) || (mediaId && !UUID.test(mediaId)))) throw new AuthError(400, 'INVALID_ID', 'Use valid property and photo IDs.');
      const isMedia = Boolean(mediaListingId);
      const listingId = path?.match(/^\/api\/listings\/([^/]+)$/)?.[1];
      if (listingId && !UUID.test(listingId)) throw new AuthError(400, 'INVALID_ID', 'Use a valid draft ID.');
      const isListing = isListings || Boolean(listingId);
      const isLocation = path === '/api/location';
      const isLocationOptions = path === '/api/location-options';
      const isSearch = path === '/api/location-search';
      const isReverse = path === '/api/location-reverse';
      const isGeocoding = isSearch || isReverse;
      const isProvider = path === '/api/provider-application';
      const isAccess = path === '/api/admin/access';
      const isQueue = path === '/api/admin/provider-applications';
      const reviewId = path?.match(/^\/api\/admin\/provider-applications\/([^/]+)$/)?.[1];
      if (reviewId && !UUID.test(reviewId)) throw new AuthError(400, 'INVALID_ID', 'Use a valid application ID.');
      const isAdmin = isAccess || isQueue || Boolean(reviewId);
      if (!isMedia && !isListing && !isAdmin && !isProfile && !isProvider && !isLocation && !isLocationOptions && !isGeocoding && !['/api/auth/register', '/api/auth/login', '/api/auth/session', '/api/auth/logout'].includes(path ?? '')) {
        throw new AuthError(404, 'NOT_FOUND', 'Not found.');
      }
      const methods = isMedia ? mediaId ? ['GET', 'DELETE'] : ['GET', 'POST', 'PUT'] : listingId ? ['GET', 'PUT'] : isListings ? ['GET', 'POST'] : isGeocoding ? ['POST'] : reviewId ? ['GET', 'POST'] : isAdmin || isLocationOptions ? ['GET'] : isProvider ? ['GET', 'POST'] : isProfile || isLocation ? ['GET', 'PUT'] : [path === '/api/auth/session' ? 'GET' : 'POST'];
      if (!methods.includes(request.method ?? '')) {
        response.setHeader('Allow', methods.join(', '));
        throw new AuthError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      if (request.method !== 'GET' && request.headers.origin !== options.origin) {
        throw new AuthError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
      }
      const token = tokenFromCookie(request.headers.cookie, cookieName);
      const database = getDatabase();
      if (path === '/api/auth/session' || isMedia || isListing || isProfile || isProvider || isAdmin || isLocation || isLocationOptions || isGeocoding) {
        const session = token ? await database.session.findUnique({ where: { tokenHash: digest(token) }, include: { account: { select: { ...publicAccount, displayName: true, isAdmin: true } } } }) : null;
        if (!session || session.expiresAt.getTime() <= Date.now()) {
          response.setHeader('Set-Cookie', cookie('', 0));
          throw new AuthError(401, 'UNAUTHENTICATED', 'Please sign in.');
        }
        if (mediaListingId) {
          if (mediaId && request.method === 'GET') {
            const bytes = await readMediaImage(database, session.account.id, mediaListingId, mediaId);
            response.setHeader('Content-Type', 'image/jpeg');
            response.setHeader('Content-Length', bytes.length);
            response.setHeader('Content-Disposition', `inline; filename="${mediaId.toLowerCase()}.jpg"`);
            response.setHeader('Content-Security-Policy', "default-src 'none'");
            response.writeHead(200); response.end(bytes);
          } else if (mediaId) send(200, await deleteMedia(database, session.account.id, mediaListingId, mediaId, mediaDeleteInput(await body(request))));
          else if (request.method === 'POST') {
            const result = await uploadMedia(database, session.account.id, mediaListingId, request, cancellation.signal);
            send(result.created ? 201 : 200, { media: result.media, version: result.version });
          } else if (request.method === 'PUT') send(200, await orderMedia(database, session.account.id, mediaListingId, mediaOrderInput(await body(request))));
          else send(200, await readMedia(database, session.account.id, mediaListingId));
        } else if (isListing) {
          if (listingId) send(200, { listing: request.method === 'PUT'
            ? await editListing(database, session.account.id, listingId, listingEditInput(await body(request, 16384)))
            : await readListing(database, session.account.id, listingId) });
          else if (request.method === 'POST') {
            const result = await createListing(database, session.account.id, listingInput(await body(request)));
            send(result.created ? 201 : 200, { listing: result.listing });
          } else send(200, { listings: await listListings(database, session.account.id) });
        } else if (isGeocoding) {
          const data = await body(request);
          if (isSearch) {
            const input = searchInput(data);
            await limitGeocoding(database, session.account.id);
            send(200, { results: await lookup.search(input, cancellation.signal, session.account.id) });
          } else {
            const input = reverseInput(data);
            await limitGeocoding(database, session.account.id);
            send(200, { result: await lookup.reverse(input, cancellation.signal, session.account.id) });
          }
        } else if (isLocationOptions) {
          send(200, locationOptions);
        } else if (isLocation) {
          const location = request.method === 'PUT'
            ? await saveLocation(database, session.account.id, locationInput(await body(request)), lookup, cancellation.signal)
            : await readLocation(database, session.account.id);
          send(200, { location });
        } else if (isAdmin) {
          if (isAccess) { send(200, { isAdmin: session.account.isAdmin }); return; }
          if (!session.account.isAdmin) throw new AuthError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
          if (reviewId) {
            const application = request.method === 'POST'
              ? await decideApplication(database, session.account.id, reviewId, reviewInput(await body(request)))
              : await readApplication(database, reviewId);
            send(200, { application });
          } else send(200, await reviewQueue(database, session.account.id, request.url!));
        } else if (isProvider) {
          if (request.method === 'POST') {
            const result = await applyAsProvider(database, session.account.id, providerInput(await body(request)));
            send(result.created ? 201 : 200, { application: result.application });
          } else {
            const application = await database.providerApplication.findUnique({ where: { accountId: session.account.id }, select: applicationFields });
            send(200, { application });
          }
        } else if (isProfile) {
          const profile = request.method === 'PUT'
            ? await database.account.update({ where: { id: session.account.id }, data: profileInput(await body(request)), select: { ...publicAccount, displayName: true } })
            : { id: session.account.id, email: session.account.email, displayName: session.account.displayName };
          send(200, { profile });
        } else {
          send(200, { user: { id: session.account.id, email: session.account.email } });
        }
        return;
      }
      if (path === '/api/auth/logout') {
        if (token) await database.session.deleteMany({ where: { tokenHash: digest(token) } });
        response.setHeader('Set-Cookie', cookie('', 0));
        send(200, { status: 'signed_out' });
        return;
      }
      const input = credentials(await body(request));
      // Forwarded IP headers are deliberately not trusted.
      await throttle(database, request.socket.remoteAddress ?? 'unknown', input.email);
      const newToken = sessionToken();
      const sessionData = { tokenHash: digest(newToken), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) };
      let user;
      if (path === '/api/auth/register') {
        const passwordHash = await hashPassword(input.password);
        user = await database.$transaction(async tx => {
          const account = await tx.account.create({ data: { email: input.email, passwordHash }, select: publicAccount });
          await tx.session.create({ data: { ...sessionData, accountId: account.id } });
          if (token) await tx.session.deleteMany({ where: { tokenHash: digest(token) } });
          return account;
        });
      } else {
        const account = await database.account.findUnique({ where: { email: input.email } });
        if (!await verifyPassword(input.password, account?.passwordHash) || !account) {
          throw new AuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
        }
        user = { id: account.id, email: account.email };
        await database.$transaction(async tx => {
          await tx.session.create({ data: { ...sessionData, accountId: account.id } });
          if (token) await tx.session.deleteMany({ where: { tokenHash: digest(token) } });
          await tx.session.deleteMany({ where: { accountId: account.id, expiresAt: { lte: new Date() } } });
        });
      }
      response.setHeader('Set-Cookie', cookie(newToken, SESSION_SECONDS));
      send(path === '/api/auth/register' ? 201 : 200, { user });
    } catch (error) {
      if (cancellation.signal.aborted && response.destroyed) return;
      if (error instanceof AuthError) {
        if (error.status === 429) response.setHeader('Retry-After', error instanceof GeocodingError || error instanceof MediaError ? String(error.retryAfter) : '900');
        send(error.status, { error: error.code, message: error.message, ...(error instanceof ListingValidationError ? { fieldErrors: error.fieldErrors } : {}) });
      } else if (path === '/api/auth/register' && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        send(409, { error: 'REGISTRATION_UNAVAILABLE', message: 'Unable to create this account. Try signing in.' });
      } else {
        // Log only an allowlisted diagnostic code, never error messages, requests, or credentials.
        const code = typeof error === 'object' && error !== null && 'code' in error
          && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : 'UNEXPECTED';
        const timedOut = error instanceof Error && /expired|timed out|timeout/i.test(error.message);
        console.error('Account operation failed:', code, timedOut ? 'TIMEOUT' : 'OTHER');
        send(503, { error: 'SERVICE_UNAVAILABLE', message: 'The account service is temporarily unavailable. Please try again.' });
      }
    } finally { response.removeListener('close', cancel); }
  };
}
