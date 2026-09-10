import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../../prisma/client.js';
import { createApp } from '../../src/app.js';
import { parseAuthConfig, parseConfig } from '../../src/config.js';
import { AuthService } from '../../src/auth/service.js';
import { PrismaAuthRepository } from '../../src/auth/repository.js';
import { hashSessionIdentifier } from '../../src/auth/tokens.js';
import { withServer } from '../helpers.js';

test('Neon sessions store only hashes, use current user state, revoke through logout, and reject expired/revoked sessions', async () => {
  const database = createDatabaseClient('pooled');
  let userId: string | undefined;
  try {
    const user = await database.user.create({ data: { email: `auth-${randomUUID()}@example.com`, displayName: 'Auth database test' } });
    userId = user.id;
    const config = parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url') });
    const service = new AuthService(new PrismaAuthRepository(database), config);
    const issued = await service.createSessionForVerifiedUser(user.id);
    const identifier = String(decodeJwt(issued.token).jti);
    const stored = await database.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(identifier) } });
    assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(stored.tokenHash !== identifier && stored.tokenHash !== issued.token);
    assert.equal(stored.userId, user.id);
    assert.equal(stored.expiresAt.getTime(), issued.expiresAt.getTime());
    assert.equal(stored.revokedAt, null);
    await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), service), async base => {
      const me = () => fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${issued.token}` } });
      let response = await me();
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { user: { id: string } }).user.id, user.id);
      await database.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      response = await me();
      assert.equal(((await response.json()) as { user: { role: string } }).user.role, 'ADMIN');
      await database.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      response = await me();
      assert.equal(response.status, 401); await response.arrayBuffer();
      await database.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', role: 'USER' } });
      const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${issued.token}` } });
      assert.equal(logout.status, 200);
      assert.deepEqual(await logout.json(), { status: 'ok' });
      const revoked = await database.session.findUniqueOrThrow({ where: { id: stored.id } });
      assert.ok(revoked.revokedAt instanceof Date);
      response = await me();
      assert.equal(response.status, 401); await response.arrayBuffer();
      const second = await service.createSessionForVerifiedUser(user.id);
      const expiredAt = new Date(Date.now() - 1000);
      await database.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: {
        createdAt: new Date(expiredAt.getTime() - 1000), expiresAt: expiredAt,
      } });
      response = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${second.token}` } });
      assert.equal(response.status, 401); await response.arrayBuffer();
    });
  } finally {
    if (userId) await database.user.delete({ where: { id: userId } });
    if (userId) assert.equal(await database.session.count({ where: { userId } }), 0);
    await database.$disconnect();
  }
});
