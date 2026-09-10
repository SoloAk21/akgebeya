import { z } from 'zod';
import { HttpError } from '../errors.js';
import type { AuthConfig } from '../config.js';
import type { AuthContext, AuthRepository, AuthUser, AuthUserRecord } from './types.js';
import { SessionTokens } from './tokens.js';

function activeUser(user: AuthUserRecord | null): user is AuthUserRecord {
  return user !== null && user.status === 'ACTIVE' && user.deletedAt === null;
}

function publicUser(user: AuthUserRecord): AuthUser {
  return { id: user.id, email: user.email, phone: user.phone, displayName: user.displayName,
    role: user.role, preferredLocale: user.preferredLocale };
}

export class AuthService {
  private readonly tokens: SessionTokens;
  constructor(private readonly repository: AuthRepository, config: AuthConfig,
    private readonly now: () => Date = () => new Date()) {
    this.tokens = new SessionTokens(config);
  }

  // Internal only: future login adapters must verify identity BEFORE calling this.
  // There is intentionally no HTTP endpoint accepting a user ID to mint tokens.
  async createSessionForVerifiedUser(userId: string) {
    if (!z.string().uuid().safeParse(userId).success) throw new HttpError('UNAUTHORIZED');
    const user = await this.repository.findUser(userId);
    if (!activeUser(user)) throw new HttpError('UNAUTHORIZED');
    const issued = await this.tokens.issue(user.id, this.now());
    await this.repository.createSession({ userId: user.id, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt });
    return { token: issued.token, expiresAt: issued.expiresAt };
  }

  async authenticate(token: string): Promise<AuthContext> {
    const claims = await this.tokens.verify(token, this.now());
    const session = await this.repository.findSession(claims.tokenHash);
    // Check again after the database read so expiration during I/O also fails closed.
    if (claims.expiresAt <= this.now().getTime() || !session || session.revokedAt !== null || session.expiresAt.getTime() <= this.now().getTime()
      || session.userId !== claims.userId || !activeUser(session.user) || session.user.id !== claims.userId) {
      throw new HttpError('UNAUTHORIZED');
    }
    return { sessionId: session.id, user: publicUser(session.user) };
  }

  async logout(context: AuthContext) {
    await this.repository.revokeSession(context.sessionId, context.user.id, this.now());
  }
}
