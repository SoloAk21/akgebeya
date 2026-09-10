import { randomBytes, randomUUID } from 'node:crypto';
import { parseAuthConfig } from '../src/config.js';
import { AuthService } from '../src/auth/service.js';
import type { AuthRepository, AuthUserRecord, SessionRecord } from '../src/auth/types.js';

export class MemoryAuthRepository implements AuthRepository {
  users = new Map<string, AuthUserRecord>();
  sessions = new Map<string, Omit<SessionRecord, 'user'>>();
  async findUser(id: string) { return this.users.get(id) ?? null; }
  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    const session = { ...input, id: randomUUID(), revokedAt: null };
    this.sessions.set(input.tokenHash, session);
    return { id: session.id };
  }
  async findSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    const user = session && this.users.get(session.userId);
    return session && user ? { ...session, user } : null;
  }
  async revokeSession(id: string, userId: string, at: Date) {
    for (const session of this.sessions.values()) {
      if (session.id === id && session.userId === userId && session.revokedAt === null) session.revokedAt = at;
    }
  }
}

export function createAuthFixture() {
  let now = new Date();
  const config = parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url'), AUTH_SESSION_TTL_SECONDS: '60' });
  const repository = new MemoryAuthRepository();
  const user: AuthUserRecord = { id: randomUUID(), email: 'auth-test@example.com', phone: null,
    displayName: 'Auth test', role: 'USER', preferredLocale: 'en', status: 'ACTIVE', deletedAt: null };
  repository.users.set(user.id, user);
  const service = new AuthService(repository, config, () => now);
  return { config, repository, user, service, getNow: () => now, setNow: (date: Date) => { now = date; } };
}
