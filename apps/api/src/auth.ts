import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient } from './generated/prisma/client.js';
import { profileInput } from './profile.js';
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

async function body(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AuthError(415, 'JSON_REQUIRED', 'Send JSON data.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > 4096) {
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

export function createAuthHandler(getDatabase: () => PrismaClient, options: AuthOptions) {
  const cookieName = options.secure ? '__Host-akgebeya_session' : 'akgebeya_session';
  const cookie = (token: string, seconds: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${options.secure ? '; Secure' : ''}`;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url?.split('?')[0];
    const send = (status: number, data: unknown) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    try {
      const isProfile = path === '/api/profile';
      if (!isProfile && !['/api/auth/register', '/api/auth/login', '/api/auth/session', '/api/auth/logout'].includes(path ?? '')) {
        throw new AuthError(404, 'NOT_FOUND', 'Not found.');
      }
      const methods = isProfile ? ['GET', 'PUT'] : [path === '/api/auth/session' ? 'GET' : 'POST'];
      if (!methods.includes(request.method ?? '')) {
        response.setHeader('Allow', methods.join(', '));
        throw new AuthError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      if (request.method !== 'GET' && request.headers.origin !== options.origin) {
        throw new AuthError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
      }
      const token = tokenFromCookie(request.headers.cookie, cookieName);
      const database = getDatabase();
      if (path === '/api/auth/session' || isProfile) {
        const session = token ? await database.session.findUnique({ where: { tokenHash: digest(token) }, include: { account: { select: { ...publicAccount, displayName: true } } } }) : null;
        if (!session || session.expiresAt.getTime() <= Date.now()) {
          response.setHeader('Set-Cookie', cookie('', 0));
          throw new AuthError(401, 'UNAUTHENTICATED', 'Please sign in.');
        }
        if (isProfile) {
          const profile = request.method === 'PUT'
            ? await database.account.update({ where: { id: session.account.id }, data: profileInput(await body(request)), select: { ...publicAccount, displayName: true } })
            : session.account;
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
      if (error instanceof AuthError) {
        if (error.status === 429) response.setHeader('Retry-After', '900');
        send(error.status, { error: error.code, message: error.message });
      } else if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        send(409, { error: 'REGISTRATION_UNAVAILABLE', message: 'Unable to create this account. Try signing in.' });
      } else {
        send(503, { error: 'SERVICE_UNAVAILABLE', message: 'The account service is temporarily unavailable. Please try again.' });
      }
    }
  };
}
